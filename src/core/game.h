#pragma once
#include <array>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <vector>
#include "config.h"
#include "grid.h"
#include "tank.h"
#include "util.h"
#include "world.h"
#include "worldgen.h"

struct Game;

// ------------------------------------------------------------------ squads
// Groups of allied tanks sharing one order and stance. The AI reads
// `t.squad` and `t.ai.dest`.
//   follow: formation slot around the player (per-tank FORMATION slot)
//   move:   drive to the point, only stop to fight when hit or a foe is close
//   attack: drive to the point, engaging everything on the way
//   hold:   take cover around the point, fight within a leash
// Stance: aggressive never retreats; cautious falls back to the player below
// 40% hull and stays there until the order is renewed.
constexpr int MAX_SQUADS = 4;
constexpr double RETREAT_HULL = 0.4;

struct Squad {
  int id = 0;
  int team = 0;            // 0 = ours (tactical map), 1 = enemy (commander)
  std::vector<Tank*> tanks;
  std::string order = "follow";
  Pt goal;
  bool hasGoal = false;
  double heading = 0;
  std::string stance = "aggressive";
  int orderT = 0, planT = 0, planN = 0;
  std::vector<Tank*> alive() const;
};

Pt centroid(const std::vector<Tank*>& tanks);
Pt snapPassable(const Nav& nav, double x, double y, int maxR = 8);
void orderSquad(Game& game, Squad& sq, const std::string& order, bool hasPoint = false, double x = 0, double y = 0);
void toggleStance(Squad& sq);
void planSquad(Game& game, Squad& sq);
void updateSquads(Game& game);

// ------------------------------------------------------------------ vision
// Fog of war for one team: what its tanks can see, and what it remembers.
constexpr int VISION_NODE = 16;

struct Known { Tank* tank; double x, y, a; int t; bool vis; };

struct Vision {
  int w, h;
  std::vector<int32_t> seen;   // tick each node was last seen
  std::vector<uint8_t> ever;   // explored at least once
  std::vector<Known> known;    // enemy tanks seen or remembered (insertion order)
  int tick = 0;

  Vision(int worldW, int worldH);
  bool visible(double x, double y) const;
  void cast(Game& game, const Tank& t);
  void update(Game& game, const std::vector<Tank*>& eyes, const std::vector<Tank*>& foes);
  double fade(const Known& k) const;
  void clear();
};

// ------------------------------------------------------------------ AI
void initAI(Tank& t, int idx, const std::string& order = "hold");
void updateAI(Tank& t, Game& game);
bool lineOfSight(Game& game, double x0, double y0, double x1, double y1);

// ------------------------------------------------------------------ cards
// Two families: player (upgrades your tank), team (grows / strengthens the squad).
struct Card {
  std::string id, fam, name, rarity;
  std::vector<std::string> tags;
  bool stack;
  std::string desc;
  std::function<void(Tank&, Game&)> apply;
};
struct Reward { const Card* card; std::vector<std::string> synergy; };

const std::vector<Card>& cards();
extern const char* RARITIES[4];
std::vector<Reward> pickRewards(Rng& rng, const std::vector<std::string>& build, const std::map<std::string, int>& tagCount, int level, int n = 3);

// ------------------------------------------------------------------ game
extern const Power POWER[3];
extern const char* PART_LABEL[NPARTS];

struct RosterEntry {
  std::string type;
  bool hasHp = false;
  std::array<double, NPARTS> hp{};
  int squad = 0;
};

struct Popup { std::string text; double x, y, size; bool accent, burst; int t, life; double rot; };
struct Flash { double x, y, r; int t; double spin; };
struct Pending { int t; std::function<void()> fn; };
struct Wreck { double x, y; int t, max; };
struct Scrap { double x, y, vx, vy; int t; };
struct SmokeCloud { double x, y; int t; };
struct Flag { double x = 0, y = 0, r = 64, progress = 0; bool contested = false; };
struct Input { double throttle = 0, turn = 0, aimX = 0, aimY = 0; bool fire = false, mg = false; };
struct BlastOpts { bool incendiary = false; bool noSplash = false; };

// Whole game state, raylib-free (also runs headless in tools/).
// states: play -> cleared -> reward -> play ... | dead | win
struct Game {
  Rng rng;
  Grid grid;
  Debris debris;
  Gas gas;
  Fire flames;
  Nav nav;
  Vision vision; // our team's fog of war
  std::vector<Projectile> projectiles;
  std::vector<Flash> flashes;
  std::vector<Popup> popups;
  std::vector<Pending> pending;
  std::vector<Wreck> wrecks;
  std::vector<Scrap> scrap;           // spare-part pickups dropped by wrecks
  std::vector<SmokeCloud> smokeClouds; // active smoke grenade emitters
  Pt cam;
  double shake = 0;
  int tick = 0;
  Hooks hooks;

  int level = 1, kills = 0;
  std::vector<std::string> build;          // card ids taken this run
  std::map<std::string, int> tagCount;     // tag -> owned cards carrying it
  std::unique_ptr<Tank> playerPtr;
  Tank* player = nullptr;
  std::vector<std::unique_ptr<RosterEntry>> roster; // allies carried between battles
  std::map<int, std::string> stances;      // squad id -> stance, kept across battles
  int orderSeq = 0;
  double spares = 40;
  std::array<Part, 2> crew{NO_PART, NO_PART}; // part each mechanic is working on
  int crewNext = 0;
  int powerMode = 0;

  std::vector<std::unique_ptr<Tank>> battleTanks; // allies + enemies of this battle
  std::vector<Tank*> allies, enemies, friendlies, tanks;
  std::vector<std::unique_ptr<Squad>> squads; // ours
  std::vector<Barrel> barrels;
  int emergency = 0, smokeCharges = 0, smokeCd = 0;
  int pickupAcc = 0, rushT = 0;
  uint32_t gasVersion = 0;
  Flag flag;
  std::string state = "play";
  int stateT = 0;
  std::vector<Reward> choices;

  // Rolling per-section timings in ms (perf overlay / bench).
  struct Prof { double ai = 0, tanks = 0, proj = 0, fire = 0, gasSync = 0, gas = 0, debris = 0, other = 0; } prof;

  explicit Game(uint32_t seed);
  void newRun();
  void startBattle();
  void popup(const std::string& text, double x, double y, double size = 14, bool accent = false, bool burst = false);

  bool fire(Tank& t);
  void fireMG(Tank& t);
  void chip(double x, double y);
  HitResult onBulletHit(Tank& t, Part zone, Projectile& p);
  void throwSmoke();
  void deploySmoke(double x, double y);
  void assignCrew(Part part);
  void emergencyRepair();
  void cyclePower();
  void collapse(const std::vector<int>& cells, double bx, double by);
  void blast(double x, double y, double r, double power, BlastOpts opts = {});
  HitResult onTankHit(Tank& t, Part zone, Projectile& p);
  void impact(const Projectile& p, double x, double y);
  void triggerBarrel(int id);
  void killTank(Tank& t);
  void stampWreck(Tank& t);
  void saveRoster();
  void addRecruit(const std::string& type);

  Squad* squad(int id);
  void orderSquad(int id, const std::string& order, bool hasPoint = false, double x = 0, double y = 0);
  void toggleStance(int id);
  // Nearest hostile to a point as seen by `team`: our side uses what the
  // fog of war knows, the enemy uses the real positions.
  bool threatNear(double x, double y, int team, Pt& out) const;

  // reinforcement waves + enemy commander (commander.cpp)
  std::vector<std::unique_ptr<Squad>> enemySquads;
  int waveNo = 0, waveT = 0, commandT = 0;
  int waveIn() const; // ticks until the next wave, -1 when waves have stopped
  void resetWaves();
  void updateWaves();
  void spawnWave();
  void command();

  void chooseReward(int i);
  void update(const Input& inp);
  void updateProjectiles();
  void updateFlag();
  void missionKills();
  void updateCrew();
  void updateScrap();
  void emitters();
  void collideTanks();
  void updateState();
  void updateCamera(const Input* inp);
};
