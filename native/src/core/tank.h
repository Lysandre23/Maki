#pragma once
#include <array>
#include <string>
#include <vector>
#include "grid.h"
#include "util.h"
#include "world.h"

enum Part { HULL, TRACK_L, TRACK_R, TURRET, CANNON, ENGINE, AMMO, NPARTS, NO_PART = -1 };
inline constexpr Part PARTS[NPARTS] = {HULL, TRACK_L, TRACK_R, TURRET, CANNON, ENGINE, AMMO};

struct ShellStats { double speed, dmg, r, power; };

// speed/turn in cells (radians) per tick, reload in ticks.
// armorFront multiplies damage from frontal hits. body/top are gray levels.
struct TankStats {
  double len, wid, speed, turn, turretRate, reload, armorFront;
  std::array<double, NPARTS> hp;
  ShellStats shell;
  int body, top;
  double range;
};

const TankStats& tankType(const std::string& type);

// Engine power split between driving, turret traverse and the autoloader.
struct Power { const char* name; double move, turret, reload; };

// Player build flags, see rewards.
struct Mods {
  int bounces = 0;
  bool cluster = false;
  double mgCool = 1, crewRate = 1;
  int extraSmoke = 0, extraEmergency = 0;
  double allyReload = 1, allyArmor = 1;
  bool fieldWorkshop = false;
  double quickCapture = 1;
  double fireDmg = 1;
};

struct PartHp { double hp, max; };

struct HitResult { bool ricochet; double eff, nx, ny; int face; bool pen; };
enum Face { FACE_FRONT, FACE_SIDE, FACE_REAR };

struct Squad;

struct AIState {
  int phase = 0;
  std::string order = "hold";
  Pt post, goal;
  bool hasGoal = false;
  Pt slot;
  bool hasSlot = false;
  struct Tank* target = nullptr;
  bool los = false;
  Pt lastSeen;
  bool hasLastSeen = false;
  int lastSeenT = 0;
  Pt dest;                 // squad-planned destination (allies)
  bool hasDest = false;
  bool retreat = false;    // cautious stance, falling back to the player
  int exempt = 0;          // squad order under which it already fell back
  double strafe = 1;
  double strafeT = 0;
  int stuck = 0, unstuck = 0;
  double unTurn = 1;
  int breach = 0;
  int wake = 0;
};

// Rigid-body tank made of parts. Movement is differential drive: the two
// tracks each push, so a dead track makes the tank pivot around it.
struct Tank {
  std::string type;
  int team; // 0 = player's side
  TankStats s;
  double x, y, a, ta;
  double vx = 0, vy = 0, av = 0;
  double throttle = 0, turn = 0;
  double reload = 30, reloadMax;
  bool alive = true, cookoff = false;
  double burning = 0;
  int flashT = 0; Part flashZone = NO_PART; int hitT = 0;
  int hurtT = 0;   // counts down after real damage (AI: "under fire")
  double treadL = 0, treadR = 0;
  double turretLock = 0, drag = 1;
  Power power{"BALANCED", 1, 1, 1};
  int charge = 0, chargeMax = 1;     // AI shot telegraph countdown
  int mgCd = 0; double mgHeat = 0; bool overheat = false;
  double reloadBoost = 1;  // set each tick by upgrades (player)
  double dmgTaken = 1;
  Mods mods;
  bool isPlayer;
  std::vector<Part> events;
  std::array<PartHp, NPARTS> parts;
  int abandonT = 0;
  AIState ai;
  Squad* squad = nullptr;
  struct RosterEntry* rosterRef = nullptr;

  // geometry
  double len, wid, hl, hw, trackW, turretR, barrelLen, turretOff, engineLen, ammoLen, mass, bound, bound2;
  struct Sample { double u, v, nu, nv; };
  std::vector<Sample> samples;

  Tank(const std::string& type, double x, double y, double a, int team);
  void setGeometry();
  double frac(Part k) const { const auto& p = parts[k]; return std::max(0.0, p.hp) / p.max; }
  double trackFactor(Part k) const { return parts[k].hp <= 0 ? 0 : 0.45 + 0.55 * frac(k); }
  double engineFactor() const { return parts[ENGINE].hp <= 0 ? 0 : 0.5 + 0.5 * frac(ENGINE); }
  double turretFactor() const {
    if (parts[TURRET].hp <= 0) return 0;
    return (0.4 + 0.6 * frac(TURRET)) * (parts[ENGINE].hp <= 0 ? 0.4 : 1);
  }
  bool canFire() const { return alive && parts[CANNON].hp > 0 && reload <= 0; }
  void aimAt(double target);
  struct Circle { double x, y, r; };
  std::array<Circle, 2> circles() const;
  bool collide(const Grid& grid, double x, double y, double a, double& px, double& py) const;
  void update(Grid& grid, Debris& debris);
  void move(const Grid& grid);
  void plow(Grid& grid, Debris& debris);
  void stampTracks(Grid& grid, double fs);
  Part hitTest(double px, double py) const;
  bool damagePart(Part name, double amount);
  HitResult takeHit(Part zone, double dmg, double dirx, double diry, double px, double py, bool light = false);
};

enum ProjKind { PK_SHELL, PK_MG, PK_SMOKE };

// Projectiles, moved in sub-steps of <= 1 cell so they never tunnel.
struct Projectile {
  ProjKind kind = PK_SHELL;
  double x = 0, y = 0, vx = 0, vy = 0;
  Tank* owner = nullptr;
  Tank* ignore = nullptr;
  int team = 0;
  bool fromPlayer = false;
  double dmg = 0, r = 0, power = 0;
  int life = 0;
  int bounces = 0;
  bool cluster = false;
};
