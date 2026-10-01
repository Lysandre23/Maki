#include "game.h"
#include <algorithm>
#include <chrono>
#include <cmath>

int VIEW_W = 640;
int VIEW_H = 360;
uint32_t g_rndState = 0x9e3779b9u;

static const char* breakText(Part p) {
  switch (p) {
    case TRACK_L: case TRACK_R: return "SNAP!";
    case CANNON: return "CRUNCH!";
    case TURRET: return "JAMMED!";
    case ENGINE: return "FWOOSH!";
    default: return nullptr;
  }
}

const char* PART_LABEL[NPARTS] = {"HULL", "LEFT TRACK", "RIGHT TRACK", "TURRET", "CANNON", "ENGINE", "AMMO RACK"};

// Engine power split between driving, turret traverse and the autoloader.
const Power POWER[3] = {
  {"BALANCED", 1, 1, 1},
  {"DRIVE", 1.35, 0.7, 0.7},
  {"GUNNERY", 0.6, 1.45, 1.4},
};

static constexpr int EMERGENCY_PER_BATTLE = 2;
static constexpr int SMOKE_PER_BATTLE = 3;
static constexpr double MG_OVERHEAT = 60;
static constexpr int RUSH_TICKS = 180;       // LOADER RUSH: reload x2 for 3 s after a kill
static constexpr int ABANDON_TICKS = 120;    // crew bails out, then the tank blows
static constexpr int CAPTURE_TICKS = 30 * 60; // flag capture time with the player alone
static const char* START_ROSTER[4] = {"gunner", "gunner", "scout", "scout"};

// Formation slots around the player's tank, in its frame (x forward).
static const Pt FORMATION[9] = {
  {-50, -52}, {-50, 52}, {-100, -24}, {-100, 24},
  {-150, -60}, {-150, 60}, {-190, 0}, {-230, -40}, {-230, 40},
};

Game::Game(uint32_t seed)
    : rng(seed), grid(ROOM_W, ROOM_H), debris(MAX_DEBRIS), gas(ROOM_W, ROOM_H, GAS_SCALE, GAS_WIN_W, GAS_WIN_H),
      nav(grid, 12), vision(ROOM_W, ROOM_H) {
  hooks.onBarrel = [this](int id) { triggerBarrel(id); };
  hooks.ignite = [this](int x, int y) { flames.ignite(grid, x, y); };
  newRun();
}

void Game::newRun() {
  level = 1;
  kills = 0;
  build.clear();
  tagCount.clear();
  playerPtr = std::make_unique<Tank>("player", 0, 0, 0, 0);
  player = playerPtr.get();
  player->mods = Mods{};
  // allies carried between battles; two squads of two to start
  roster.clear();
  for (int i = 0; i < 4; i++) {
    auto r = std::make_unique<RosterEntry>();
    r->type = START_ROSTER[i];
    r->squad = i >> 1;
    roster.push_back(std::move(r));
  }
  stances.clear();
  orderSeq = 0;
  spares = 40;
  crew = {NO_PART, NO_PART};
  crewNext = 0;
  powerMode = 0;
  player->power = POWER[0];
  startBattle();
}

void Game::startBattle() {
  Layout layout = generateBattle(grid, rng, level);
  debris.clear();
  gas.clear();
  flames.clear(grid);
  projectiles.clear();
  flashes.clear();
  pending.clear();
  wrecks.clear();
  popups.clear();
  scrap.clear();
  smokeClouds.clear();
  vision.clear();
  enemySquads.clear();
  resetWaves();
  barrels = layout.barrels;
  const Mods& m = player->mods;
  emergency = EMERGENCY_PER_BATTLE + m.extraEmergency;
  smokeCharges = SMOKE_PER_BATTLE + m.extraSmoke;
  smokeCd = 0;
  pickupAcc = 0;
  rushT = 0;
  flag = Flag{layout.flag.x, layout.flag.y, 64, 0, false};

  Tank& p = *player;
  p.x = layout.spawn.x; p.y = layout.spawn.y;
  p.a = 0; p.ta = 0; p.vx = p.vy = p.av = 0;
  p.burning = 0; p.reload = 20; p.events.clear();
  p.mgHeat = 0; p.overheat = false;

  // allies from the roster, in formation behind the player
  battleTanks.clear();
  squads.clear();
  allies.clear();
  for (size_t i = 0; i < roster.size(); i++) {
    RosterEntry& r = *roster[i];
    Pt sl = i < 9 ? FORMATION[i] : Pt{-240.0 - (double)(i - 9) * 40, (i % 2 ? 1.0 : -1.0) * 30};
    auto t = std::make_unique<Tank>(r.type, p.x + sl.x * 0.6 + 60, clamp(p.y + sl.y, 40, ROOM_H - 40), 0, 0);
    if (r.hasHp) for (int k = 0; k < NPARTS; k++) t->parts[k].hp = r.hp[k];
    t->s.reload *= m.allyReload;
    t->dmgTaken = m.allyArmor;
    t->rosterRef = &r;
    initAI(*t, (int)i, "follow");
    t->ai.slot = sl; t->ai.hasSlot = true;
    t->ai.wake = 20;
    allies.push_back(t.get());
    battleTanks.push_back(std::move(t));
  }
  // squads from the roster's squad ids, all following the player at first
  std::map<int, Squad*> byId;
  for (Tank* t : allies) {
    int id = t->rosterRef->squad;
    if (!byId.count(id)) {
      auto sq = std::make_unique<Squad>();
      sq->id = id;
      auto st = stances.find(id);
      if (st != stances.end()) sq->stance = st->second;
      byId[id] = sq.get();
      squads.push_back(std::move(sq));
    }
    t->squad = byId[id];
    t->squad->tanks.push_back(t);
  }
  std::sort(squads.begin(), squads.end(), [](auto& a, auto& b) { return a->id < b->id; });

  enemies.clear();
  for (size_t i = 0; i < layout.enemies.size(); i++) {
    const auto& e = layout.enemies[i];
    auto t = std::make_unique<Tank>(e.type, e.x, e.y, e.a, 1);
    t->ta = e.a;
    initAI(*t, (int)i, "hold");
    enemies.push_back(t.get());
    battleTanks.push_back(std::move(t));
  }
  friendlies.clear();
  friendlies.push_back(player);
  friendlies.insert(friendlies.end(), allies.begin(), allies.end());
  tanks = friendlies;
  tanks.insert(tanks.end(), enemies.begin(), enemies.end());

  gas.follow(p.x, p.y);
  gas.syncSolid(grid);
  gasVersion = grid.version;
  double wx = rng();
  gas.windX = (wx - 0.5) * 0.004;
  double wy = rng();
  gas.windY = (wy - 0.5) * 0.004;
  nav.rebuild(grid);

  state = "play";
  stateT = 0;
  choices.clear();
  cam.x = clamp(p.x - VIEW_W / 2.0, 0, ROOM_W - VIEW_W);
  cam.y = clamp(p.y - VIEW_H / 2.0, 0, ROOM_H - VIEW_H);
  popup(level >= BATTLES ? "FINAL ASSAULT!" : "BATTLE " + std::to_string(level), p.x + 80, p.y - 40, 18, true, true);
  popup("TAKE THE FLAG!", p.x + 80, p.y - 18, 12, true);
}

void Game::popup(const std::string& text, double x, double y, double size, bool accent, bool burst) {
  double rot = (rnd() - 0.5) * 0.3;
  popups.push_back({text, x, y, size, accent, burst, 0, 70, rot});
}

// ---------------------------------------------------------------- actions

bool Game::fire(Tank& t) {
  if (!t.canFire()) return false;
  const ShellStats& sh = t.s.shell;
  double cf = t.frac(CANNON);
  double ang = t.ta + (rnd() - 0.5) * 0.25 * (1 - cf); // damaged cannon = spread
  double c = std::cos(ang), s = std::sin(ang);
  double bx = t.x + t.turretOff * std::cos(t.a), by = t.y + t.turretOff * std::sin(t.a);
  double tip = t.turretR + t.barrelLen;
  double x = bx + c * tip, y = by + s * tip;
  Projectile p;
  p.kind = PK_SHELL; p.x = x; p.y = y; p.vx = c * sh.speed; p.vy = s * sh.speed;
  p.owner = &t; p.team = t.team; p.fromPlayer = t.isPlayer;
  p.dmg = sh.dmg; p.r = sh.r; p.power = sh.power; p.life = 150;
  p.bounces = t.mods.bounces; p.cluster = t.mods.cluster;
  projectiles.push_back(p);
  t.reload = t.reloadMax = t.s.reload * (2 - cf); // damaged cannon = slower reload
  double kick = 0.3 * (500 / t.mass); // recoil
  t.vx -= c * kick; t.vy -= s * kick;
  gas.addSmoke(x, y, 0.6);
  gas.addHeat(x, y, 0.5);
  gas.addVel(x, y, c * 3, s * 3);
  flashes.push_back({x, y, 8, 3, rnd() * 6.28});
  for (int k = 0; k < 5; k++) {
    double a = ang + (rnd() - 0.5) * 0.8;
    double v = 1 + rnd() * 2.5;
    debris.spawn(x, y, std::cos(a) * v, std::sin(a) * v, M::SPARK, 8 + (int)(rnd() * 10));
  }
  if (&t == player) shake = std::min(14.0, shake + 2);
  return true;
}

// Coaxial machine gun: fast, weak, chews bricks and hedges, strips tracks.
void Game::fireMG(Tank& t) {
  if (t.mgCd > 0 || t.overheat || t.parts[TURRET].hp <= 0) return;
  double ang = t.ta + (rnd() - 0.5) * 0.07;
  double c = std::cos(ang), s = std::sin(ang);
  double bx = t.x + t.turretOff * std::cos(t.a), by = t.y + t.turretOff * std::sin(t.a);
  double px = -std::sin(t.ta) * 3, py = std::cos(t.ta) * 3; // offset beside the main gun
  double x = bx + px + c * (t.turretR + 3), y = by + py + s * (t.turretR + 3);
  Projectile p;
  p.kind = PK_MG; p.x = x; p.y = y; p.vx = c * 10; p.vy = s * 10;
  p.owner = &t; p.team = t.team; p.fromPlayer = t.isPlayer; p.dmg = 3; p.life = 45;
  projectiles.push_back(p);
  t.mgCd = 5;
  t.mgHeat += 2.4 * t.mods.mgCool;
  if (t.mgHeat >= MG_OVERHEAT) { t.overheat = true; if (&t == player) popup("OVERHEAT!", t.x, t.y - t.hw - 10, 10, true); }
  double jx = rnd() - 0.5;
  double jy = rnd() - 0.5;
  debris.spawn(x, y, c * 2 + jx, s * 2 + jy, M::SPARK, 4 + (int)(rnd() * 5));
}

// Bullet hitting something solid: chips a few cells, can bring down weakened walls.
void Game::chip(double x, double y) {
  explode(grid, debris, x, y, 2.2, 3.5, &hooks);
  gas.addSmoke(x, y, 0.05);
  int cx = (int)std::floor(x), cy = (int)std::floor(y);
  for (int k = 0; k < 4; k++) {
    int ox = (int)(rnd() * 3);
    int oy = (int)(rnd() * 3);
    int nx = cx + ox - 1, ny = cy + oy - 1;
    if (grid.inBounds(nx, ny) && FLAMMABLE[grid.mat[ny * grid.w + nx]] && rnd() < 0.03) flames.ignite(grid, nx, ny);
  }
  for (const auto& cells : findCollapses(grid, x, y, 26)) collapse(cells, x, y);
}

HitResult Game::onBulletHit(Tank& t, Part zone, Projectile& p) {
  double sp = std::hypot(p.vx, p.vy);
  if (sp == 0) sp = 1;
  double dirx = p.vx / sp, diry = p.vy / sp;
  double dmg = p.dmg * (zone == TRACK_L || zone == TRACK_R ? 1.8 : 1);
  HitResult res = t.takeHit(zone, dmg, dirx, diry, p.x, p.y, true);
  for (int k = 0; k < 3; k++) {
    double a = std::atan2(-diry, -dirx) + (rnd() - 0.5) * 2;
    double v = 1 + rnd() * 2;
    debris.spawn(p.x, p.y, std::cos(a) * v, std::sin(a) * v, M::SPARK, 5 + (int)(rnd() * 8));
  }
  return res;
}

void Game::throwSmoke() {
  Tank& p = *player;
  if (!p.alive || smokeCharges <= 0 || smokeCd > 0) return;
  if (state != "play" && state != "cleared") return;
  for (double off : {-0.45, 0.0, 0.45}) {
    double a = p.ta + off, v = 3.2;
    Projectile pr;
    pr.kind = PK_SMOKE; pr.x = p.x; pr.y = p.y; pr.vx = std::cos(a) * v; pr.vy = std::sin(a) * v;
    pr.owner = &p; pr.team = 0; pr.dmg = 0; pr.life = 16 + (int)(rnd() * 8);
    projectiles.push_back(pr);
  }
  smokeCharges--;
  smokeCd = 60;
}

void Game::deploySmoke(double x, double y) {
  smokeClouds.push_back({x, y, 260});
  gas.addSmoke(x, y, 2);
  gas.addExpand(x, y, 0.8);
}

void Game::assignCrew(Part part) {
  auto& c = crew;
  if (c[0] == part && c[1] == part) { c[0] = c[1] = NO_PART; return; } // both on it: recall
  int i = c[0] == NO_PART ? 0 : c[1] == NO_PART ? 1 : -1;
  if (i < 0) i = crewNext;
  if (c[i] == part) i = 1 - i;
  c[i] = part;
  crewNext = 1 - i;
}

void Game::emergencyRepair() {
  Tank& p = *player;
  if (!p.alive || emergency <= 0 || (state != "play" && state != "cleared")) return;
  static const Part order[7] = {ENGINE, TRACK_L, TRACK_R, CANNON, TURRET, AMMO, HULL};
  Part k = NO_PART;
  for (Part n : order) if (p.parts[n].hp <= 0) { k = n; break; }
  if (k == NO_PART) {
    k = order[0];
    for (Part b : order) if (p.frac(b) < p.frac(k)) k = b;
  }
  auto& pp = p.parts[k];
  pp.hp = std::max(pp.hp, pp.max * 0.35);
  if (k == ENGINE) p.burning = 0;
  emergency--;
  popup(std::string("PATCHED ") + PART_LABEL[k] + "!", p.x, p.y - p.hw - 12, 12, true, true);
}

void Game::cyclePower() {
  powerMode = (powerMode + 1) % 3;
  player->power = POWER[powerMode];
  Tank& p = *player;
  popup(std::string("POWER: ") + POWER[powerMode].name, p.x, p.y - p.hw - 12, 11);
}

// A masonry fragment lost its support: it topples away from the blast,
// spills rubble, raises dust, and crushes whatever it lands on.
void Game::collapse(const std::vector<int>& cells, double bx, double by) {
  Grid& g = grid;
  double cx = 0, cy = 0;
  for (int i : cells) { cx += i % g.w; cy += i / g.w; }
  cx /= cells.size(); cy /= cells.size();
  double vx = 0, vy = 0;
  for (int i : cells) { vx += sq(i % g.w - cx); vy += sq(i / g.w - cy); }
  double dx, dy;
  if (vx > vy * 2 || vy > vx * 2) {
    // elongated wall piece: it tips over across its long axis, away from the shot
    double nx = vx > vy ? 0 : 1, ny = vx > vy ? 1 : 0;
    double side = (cx - bx) * nx + (cy - by) * ny;
    double sgn = std::abs(side) > 0.5 ? sign(side) : rnd() < 0.5 ? -1 : 1;
    dx = nx * sgn; dy = ny * sgn;
  } else {
    // chunky piece (pillar stump): falls away from the blast
    dx = cx - bx; dy = cy - by;
    double d = std::hypot(dx, dy);
    if (d < 0.5) { double a = rnd() * 6.28; dx = std::cos(a); dy = std::sin(a); d = 1; }
    dx /= d; dy /= d;
  }
  for (int i : cells) {
    int x = i % g.w, y = i / g.w;
    uint8_t m = g.mat[i];
    g.mat[i] = M::EMPTY; g.hp[i] = 0; g.data[i] = 0;
    g.markDirty(x, y);
    g.navTouch(x, y);
    if (rnd() < 0.55) {
      double s = 0.8 + rnd() * 1.8;
      double jx = (rnd() - 0.5) * 0.8;
      double jy = (rnd() - 0.5) * 0.8;
      debris.spawn(x + 0.5, y + 0.5, dx * s + jx, dy * s + jy, m);
    }
    if (rnd() < 0.08) gas.addSmoke(x, y, 0.3);
  }
  g.version++;
  double n = (double)cells.size();
  double reach = std::sqrt(n) * 0.8 + 10;
  double lx = cx + dx * reach * 0.6, ly = cy + dy * reach * 0.6;
  for (Tank* t : tanks) {
    if (!t->alive) continue;
    double dd = std::hypot(t->x - lx, t->y - ly);
    if (dd > reach + t->hw) continue;
    double dmg = std::min(90.0, n * 0.2) * (1 - (dd / (reach + t->hw)) * 0.5);
    t->damagePart(HULL, dmg);
    t->damagePart(TURRET, dmg * 0.4);
    t->damagePart(rnd() < 0.5 ? TRACK_L : TRACK_R, dmg * 0.5);
    t->vx += dx * 1.2; t->vy += dy * 1.2;
    t->hitT = 4;
    popup("CRUSHED!", t->x, t->y - t->hw - 8, 14, t == player, true);
  }
  if (n > 60) {
    popup("CRASH!", cx, cy, 16, false, true);
    shake = std::min(14.0, shake + 6);
  }
  gas.addExpand(cx, cy, 0.4);
}

// Explosion: carves terrain, pushes gas, shoves and damages tanks.
// Hot blasts sometimes light the dry grass and hedges around them.
void Game::blast(double x, double y, double r, double power, BlastOpts opts) {
  explode(grid, debris, x, y, r, power, &hooks);
  for (const auto& cells : findCollapses(grid, x, y, r * 2.5 + 24)) collapse(cells, x, y);
  gas.blast(x, y, r, power, opts.incendiary ? 2 : 1);
  flashes.push_back({x, y, r, 0, rnd() * 6.28});
  shake = std::min(14.0, shake + r * 0.2);

  Grid& g = grid;
  if (opts.incendiary) {
    double R = r * 1.4;
    for (int yy = std::max(0, (int)std::floor(y - R)); yy <= std::min((double)g.h - 1, y + R); yy++) {
      for (int xx = std::max(0, (int)std::floor(x - R)); xx <= std::min((double)g.w - 1, x + R); xx++) {
        if (sq(xx - x) + sq(yy - y) <= R * R && FLAMMABLE[g.mat[yy * g.w + xx]] && rnd() < 0.6) flames.ignite(g, xx, yy);
      }
    }
  } else if (rnd() < 0.25) { // one blast in four starts a small fire in the dry grass
    for (int k = 0; k < 3; k++) {
      double a = rnd() * 6.28;
      double d = r * (0.6 + rnd() * 0.6);
      flames.ignite(g, (int)std::floor(x + std::cos(a) * d), (int)std::floor(y + std::sin(a) * d));
    }
  }
  if (opts.incendiary) {
    for (int k = 0; k < 14; k++) {
      double a = rnd() * 6.28;
      double v = 0.8 + rnd() * 2.5;
      debris.spawn(x, y, std::cos(a) * v, std::sin(a) * v, M::EMBER, 40 + (int)(rnd() * 60));
    }
  }

  for (Tank* t : tanks) {
    if (!t->alive) continue;
    double dx = t->x - x, dy = t->y - y;
    double d = std::hypot(dx, dy);
    if (d == 0) d = 0.01;
    double reach = r * 1.8 + t->hw;
    if (d > reach) continue;
    double f = 1 - d / reach;
    double k = power * 0.045 * f * (500 / t->mass);
    t->vx += (dx / d) * k; t->vy += (dy / d) * k;
    t->av += (rnd() - 0.5) * k * 0.04;
    double edge = std::max(0.0, d - t->hw);
    if (edge < r && !opts.noSplash) {
      double dmg = power * 1.1 * (1 - edge / r);
      // sandbags between the blast and the tank soak most of it up
      for (double k = 0.15; k < 1; k += 0.15) {
        int sx = (int)std::floor(x + dx * k), sy = (int)std::floor(y + dy * k);
        if (grid.inBounds(sx, sy) && grid.mat[sy * grid.w + sx] == M::SAND) { dmg *= 0.4; break; }
      }
      t->damagePart(HULL, dmg);
      double v = -dx * std::sin(t->a) + dy * std::cos(t->a); // blast side, in tank frame
      t->damagePart(v > 0 ? TRACK_L : TRACK_R, dmg * 0.5);
      t->hitT = std::max(t->hitT, 3);
    }
  }
}

HitResult Game::onTankHit(Tank& t, Part zone, Projectile& p) {
  double sp = std::hypot(p.vx, p.vy);
  if (sp == 0) sp = 1;
  double dirx = p.vx / sp, diry = p.vy / sp;
  HitResult res = t.takeHit(zone, p.dmg, dirx, diry, p.x, p.y);
  if (res.pen) popup("PENETRATION!", p.x, p.y - 14, 13, !t.team, !res.ricochet && t.team);
  double push = p.dmg * 0.008 * (500 / t.mass) * (res.ricochet ? 0.3 : 1);
  t.vx += dirx * push; t.vy += diry * push;
  if (res.ricochet) {
    popup("KLANG!", p.x, p.y - 8, 12, false, true);
    for (int k = 0; k < 10; k++) {
      double a = std::atan2(res.ny, res.nx) + (rnd() - 0.5) * 1.8;
      double v = 1.5 + rnd() * 2.5;
      debris.spawn(p.x, p.y, std::cos(a) * v, std::sin(a) * v, M::SPARK, 10 + (int)(rnd() * 12));
    }
    if (&t == player) shake = std::min(14.0, shake + 2);
    return res;
  }
  blast(p.x, p.y, p.r * 0.45, p.power * 0.5, {false, true});
  impact(p, p.x, p.y);
  if (zone == ENGINE) gas.addSteam(p.x, p.y, 1.2);
  if (&t == player) shake = std::min(14.0, shake + 5);
  return res;
}

// Extra effects where a shell lands (wall or tank).
void Game::impact(const Projectile& p, double x, double y) {
  if (!p.cluster) return;
  for (int k = 0; k < 3; k++) {
    double a = rnd() * 6.28;
    double v = 2 + rnd() * 1.5;
    Projectile b;
    b.kind = PK_SHELL; b.x = x; b.y = y; b.vx = std::cos(a) * v; b.vy = std::sin(a) * v;
    b.owner = nullptr; b.team = p.team; b.fromPlayer = p.fromPlayer;
    b.dmg = p.dmg * 0.3; b.r = p.r * 0.55; b.power = p.power * 0.55;
    b.life = 6 + (int)(rnd() * 8); b.cluster = false; b.bounces = 0;
    projectiles.push_back(b);
  }
}

void Game::triggerBarrel(int id) {
  if (id < 1 || id > (int)barrels.size()) return;
  Barrel& b = barrels[id - 1];
  if (b.done) return;
  b.done = true;
  double bx = b.x, by = b.y;
  pending.push_back({6, [this, bx, by]() {
    blast(bx, by, 24, 18, {true, false});
    popup("WHOOMPH!", bx, by - 14, 18, true, true);
    shake = std::min(14.0, shake + 8);
  }});
}

void Game::killTank(Tank& t) {
  t.alive = false;
  if (t.team) kills++;
  bool big = t.cookoff;
  blast(t.x, t.y, big ? 24 + t.hw * 0.4 : 16 + t.hw * 0.3, big ? 20 : 14);
  stampWreck(t);
  wrecks.push_back({t.x, t.y, 900, 900});
  // spare parts thrown out of the wreck (yours too: salvage your fallen)
  int n = (t.team ? 4 : 2) + (int)std::floor(t.hw / 3);
  for (int k = 0; k < n; k++) {
    double a = rnd() * 6.28;
    double v = 1.5 + rnd() * 2.5;
    scrap.push_back({t.x, t.y, std::cos(a) * v, std::sin(a) * v, 1800});
  }
  if (!t.team && !t.isPlayer) popup("ALLY LOST!", t.x, t.y - t.hw - 24, 14, true);
  popup(big ? "KA-BOOM!" : "BLAM!", t.x, t.y - t.hw - 8, big ? 22 : 18, false, true);
  shake = std::min(14.0, shake + (big ? 10 : 6));
  if (t.team && player->alive) { // LOADER RUSH: momentum after a kill
    rushT = RUSH_TICKS;
    popup("LOADER RUSH!", player->x, player->y - player->hw - 14, 11, true);
  }
}

// The dead tank becomes part of the terrain: destructible metal cover.
void Game::stampWreck(Tank& t) {
  Grid& g = grid;
  double c = std::cos(t.a), s = std::sin(t.a);
  int R = (int)std::ceil(t.bound);
  std::vector<Tank*> others;
  for (Tank* o : tanks) if (o->alive && o != &t) others.push_back(o);
  for (int y = (int)std::floor(t.y - R); y <= t.y + R; y++) {
    for (int x = (int)std::floor(t.x - R); x <= t.x + R; x++) {
      if (!g.inBounds(x, y)) continue;
      double dx = x + 0.5 - t.x, dy = y + 0.5 - t.y;
      double u = dx * c + dy * s, v = -dx * s + dy * c;
      if (std::abs(u) > t.hl - 1 || std::abs(v) > t.hw - 1) continue;
      if (rnd() > 0.88) continue; // ragged, holed wreck
      int i = y * g.w + x;
      if (g.mat[i] != M::EMPTY && g.mat[i] != M::RUBBLE && g.mat[i] != M::GRASS) continue;
      bool blocked = false;
      for (Tank* o : others) if (sq(o->x - x) + sq(o->y - y) < sq(o->hw + 2)) { blocked = true; break; }
      if (blocked) continue;
      double du = u - t.turretOff;
      uint8_t d = du * du + v * v < t.turretR * t.turretR ? 3 : std::abs(v) > t.hw - t.trackW ? 2 : 1;
      g.setCell(x, y, M::WRECK, d);
    }
  }
}

// Survivors go back into the roster (damage carried over).
void Game::saveRoster() {
  std::vector<std::unique_ptr<RosterEntry>> next;
  for (Tank* t : allies) {
    if (!t->alive) continue;
    auto r = std::make_unique<RosterEntry>();
    r->type = t->type;
    r->hasHp = true;
    for (int k = 0; k < NPARTS; k++) r->hp[k] = t->parts[k].hp;
    r->squad = t->squad->id;
    next.push_back(std::move(r));
  }
  // allies still point at the old entries until the next battle: keep them alive
  for (Tank* t : allies) t->rosterRef = nullptr;
  roster = std::move(next);
}

// Recruits join the smallest squad with room (3 tanks max), else open a new
// squad, else the smallest one.
void Game::addRecruit(const std::string& type) {
  int n[MAX_SQUADS] = {0, 0, 0, 0};
  for (auto& r : roster) if (r->squad >= 0 && r->squad < MAX_SQUADS) n[r->squad]++;
  int pick = -1;
  for (int i = 0; i < MAX_SQUADS; i++) if (n[i] > 0 && n[i] < 3 && (pick < 0 || n[i] < n[pick])) pick = i;
  if (pick < 0) for (int i = 0; i < MAX_SQUADS; i++) if (n[i] == 0) { pick = i; break; }
  if (pick < 0) { pick = 0; for (int i = 1; i < MAX_SQUADS; i++) if (n[i] < n[pick]) pick = i; }
  auto r = std::make_unique<RosterEntry>();
  r->type = type;
  r->squad = pick;
  roster.push_back(std::move(r));
}

// ---------------------------------------------------------------- squads

Squad* Game::squad(int id) {
  for (auto& q : squads) if (q->id == id) return q.get();
  return nullptr;
}

void Game::orderSquad(int id, const std::string& order, bool hasPoint, double x, double y) {
  if (Squad* sq = squad(id)) ::orderSquad(*this, *sq, order, hasPoint, x, y);
}

void Game::toggleStance(int id) {
  Squad* sq = squad(id);
  if (!sq) return;
  ::toggleStance(*sq);
  stances[id] = sq->stance;
}

bool Game::threatNear(double x, double y, int team, Pt& out) const {
  double bd = 1e300;
  if (team == 0) {
    for (const Known& k : vision.known) {
      double d = sq(k.x - x) + sq(k.y - y);
      if (d < bd) { bd = d; out = {k.x, k.y}; }
    }
  } else {
    for (Tank* t : friendlies) {
      if (!t->alive) continue;
      double d = sq(t->x - x) + sq(t->y - y);
      if (d < bd) { bd = d; out = {t->x, t->y}; }
    }
  }
  return bd < 1e300;
}

void Game::chooseReward(int i) {
  if (state != "reward" || i < 0 || i >= (int)choices.size()) return;
  const Card& r = *choices[i].card;
  r.apply(*player, *this);
  build.push_back(r.id);
  for (auto& tag : r.tags) tagCount[tag]++;
  // patch-up between battles: +40%, and wrecked parts come back at 40%
  // (battles are long since B3: more damage to carry)
  auto patch = [](std::array<PartHp, NPARTS>& parts, bool full) {
    for (auto& p : parts) {
      double mx = p.max;
      p.hp = full ? mx : p.hp <= 0 ? mx * 0.4 : std::min(mx, p.hp + mx * 0.4);
    }
  };
  patch(player->parts, false);
  spares = std::min(99.0, spares + 20); // resupply: the crew never starts a battle empty-handed
  for (auto& r2 : roster) {
    if (!r2->hasHp) continue;
    Tank tmp(r2->type, 0, 0, 0, 0);
    for (int k = 0; k < NPARTS; k++) tmp.parts[k].hp = r2->hp[k];
    patch(tmp.parts, player->mods.fieldWorkshop);
    for (int k = 0; k < NPARTS; k++) r2->hp[k] = tmp.parts[k].hp;
  }
  level++;
  startBattle();
}

// ---------------------------------------------------------------- update

namespace {
using Clock = std::chrono::steady_clock;
// exponential moving average of a section's time, in ms
inline void lap(double& slot, Clock::time_point& t) {
  auto now = Clock::now();
  slot += (std::chrono::duration<double, std::milli>(now - t).count() - slot) * 0.05;
  t = now;
}
}

void Game::update(const Input& inp) {
  auto pt = Clock::now();
  tick++;
  Tank& p = *player;
  bool playing = state == "play" || state == "cleared";

  if (playing && p.alive) {
    p.throttle = inp.throttle;
    p.turn = inp.turn;
    p.aimAt(std::atan2(inp.aimY - p.y, inp.aimX - p.x));
    if (inp.fire) fire(p);
    if (inp.mg) fireMG(p);
    updateCrew();
  } else { p.throttle = 0; p.turn = 0; }
  if (smokeCd > 0) smokeCd--;

  if (playing) {
    vision.update(*this, friendlies, enemies);
    if (state == "play") updateWaves();
    updateSquads(*this);
  }
  for (Tank* t : tanks) {
    if (!t->alive || t->isPlayer) continue;
    if (playing) updateAI(*t, *this);
    else { t->throttle = 0; t->turn = 0; }
  }

  lap(prof.ai, pt);
  for (Tank* t : tanks) t->update(grid, debris);
  collideTanks();
  lap(prof.tanks, pt);
  updateProjectiles();
  lap(prof.proj, pt);

  for (int i = (int)pending.size() - 1; i >= 0; i--) {
    if (i >= (int)pending.size()) continue;
    if (--pending[i].t <= 0) {
      auto fn = pending[i].fn;
      pending.erase(pending.begin() + i);
      fn();
    }
  }

  emitters();
  updateScrap();
  if (rushT > 0) rushT--;
  p.reloadBoost = rushT > 0 ? 2 : 1;
  flames.step(grid, gas, hooks.onBarrel);
  lap(prof.fire, pt);

  // gas window follows the camera; re-sync obstacles when it moves or walls change
  bool moved = gas.follow(cam.x + VIEW_W / 2.0, cam.y + VIEW_H / 2.0);
  if (moved || (grid.version != gasVersion && tick % 4 == 0)) {
    gas.syncSolid(grid);
    gasVersion = grid.version;
  }
  lap(prof.gasSync, pt);
  gas.step();
  lap(prof.gas, pt);

  // standing in fire hurts (engine first)
  for (Tank* t : tanks) {
    if (!t->alive || t->burning > 0) continue;
    double h = gas.heatAt(t->x, t->y);
    if (h > 0.5) { t->damagePart(HULL, (h - 0.5) * 0.4); t->damagePart(ENGINE, (h - 0.5) * 0.3); }
  }

  debris.update(grid, cam.x - ACTIVE_MARGIN, cam.y - ACTIVE_MARGIN,
                cam.x + VIEW_W + ACTIVE_MARGIN, cam.y + VIEW_H + ACTIVE_MARGIN, &hooks);
  lap(prof.debris, pt);

  // pathfinding catches up with destroyed hedges / walls / new wrecks
  if (grid.hasNavBox && tick % 15 == 0) {
    nav.rebuildRegion(grid, grid.navBox[0] - 24, grid.navBox[1] - 24, grid.navBox[2] + 24, grid.navBox[3] + 24);
    grid.hasNavBox = false;
  }

  for (Tank* t : tanks) {
    for (Part e : t->events) {
      const char* text = breakText(e);
      if (!text && e == AMMO && !t->team) text = "AMMO HIT!";
      if (text) popup(text, t->x, t->y - t->hw - 10, 12, t == &p);
      if (e == ENGINE) gas.addSteam(t->x, t->y, 1.5);
    }
    t->events.clear();
  }
  missionKills();
  for (Tank* t : tanks) if (t->alive && t->parts[HULL].hp <= 0) killTank(*t);

  for (int i = (int)flashes.size() - 1; i >= 0; i--) if (++flashes[i].t >= 10) flashes.erase(flashes.begin() + i);
  for (int i = (int)popups.size() - 1; i >= 0; i--) if (++popups[i].t >= popups[i].life) popups.erase(popups.begin() + i);
  shake *= 0.85;

  if (state == "play") updateFlag();
  updateState();
  updateCamera(&inp);
  lap(prof.other, pt);
}

void Game::updateProjectiles() {
  for (int i = (int)projectiles.size() - 1; i >= 0; i--) {
    if (i >= (int)projectiles.size()) continue;
    Projectile p = projectiles[i]; // copy: hits may push new projectiles (cluster)
    int steps = std::max(1, (int)std::ceil(std::hypot(p.vx, p.vy)));
    bool dead = false;
    for (int k = 0; k < steps && !dead; k++) {
      double sx = p.vx / steps, sy = p.vy / steps;
      p.x += sx; p.y += sy;

      if (p.kind != PK_SMOKE) {
        for (Tank* t : tanks) {
          if (!t->alive || t == p.owner || t == p.ignore) continue;
          Part zone = t->hitTest(p.x, p.y);
          if (zone == NO_PART) continue;
          // barrels are thin: half the shots down the barrel's axis slip past it
          if (zone == CANNON && rnd() < 0.5) { p.ignore = t; continue; }
          HitResult res = p.kind == PK_MG ? onBulletHit(*t, zone, p) : onTankHit(*t, zone, p);
          if (res.ricochet) {
            // reflect about the struck face and keep flying (can hit the shooter!)
            double d = p.vx * res.nx + p.vy * res.ny;
            p.vx = (p.vx - 2 * d * res.nx) * 0.75;
            p.vy = (p.vy - 2 * d * res.ny) * 0.75;
            p.dmg *= 0.5;
            p.ignore = t; p.owner = nullptr;
            p.x += res.nx * 1.5; p.y += res.ny * 1.5;
          } else dead = true;
          break;
        }
        if (dead) break;
      }

      if (grid.isSolid((int)std::floor(p.x), (int)std::floor(p.y))) {
        if (p.kind == PK_SHELL && p.bounces > 0) {
          // RICOCHET ROUNDS: find which axis hit the wall and mirror it
          double px = p.x - sx, py = p.y - sy;
          if (grid.isSolid((int)std::floor(p.x), (int)std::floor(py))) p.vx = -p.vx;
          if (grid.isSolid((int)std::floor(px), (int)std::floor(p.y))) p.vy = -p.vy;
          p.x = px; p.y = py;
          p.bounces--;
          p.owner = nullptr; p.life += 20;
          chip(p.x, p.y);
          break;
        }
        if (p.kind == PK_SHELL) {
          blast(p.x, p.y, p.r, p.power, {false, false});
          impact(p, p.x - sx, p.y - sy);
        } else if (p.kind == PK_MG) chip(p.x, p.y);
        else deploySmoke(p.x - sx, p.y - sy);
        dead = true;
      }
    }
    if (!dead && --p.life <= 0) {
      if (p.kind == PK_SMOKE) deploySmoke(p.x, p.y);
      else if (p.kind == PK_SHELL) gas.addSmoke(p.x, p.y, 0.3);
      dead = true;
    }
    if (dead) { projectiles[i] = projectiles.back(); projectiles.pop_back(); }
    else projectiles[i] = p;
  }
}

// Capture fills while friendlies (and no enemies) are in the zone; more
// friendlies capture faster. Contested = slowly lost; empty = slow decay.
void Game::updateFlag() {
  Flag& f = flag;
  int friends = 0, foes = 0;
  for (Tank* t : tanks) {
    if (!t->alive || std::hypot(t->x - f.x, t->y - f.y) > f.r + t->hw * 0.5) continue;
    if (t->team) foes++; else friends++;
  }
  f.contested = friends > 0 && foes > 0;
  double rate = (1.0 / CAPTURE_TICKS) * player->mods.quickCapture;
  if (friends && !foes) f.progress = std::min(1.0, f.progress + rate * (1 + 0.3 * (friends - 1)));
  else if (!friends) f.progress = std::max(0.0, f.progress - rate * 0.25);
  else f.progress = std::max(0.0, f.progress - rate * 0.5); // contested: the defenders win it back
  if (f.progress >= 1) {
    state = "cleared"; stateT = 0;
    saveRoster();
    popup("FLAG CAPTURED!", f.x, f.y - 50, 24, true, true);
  }
}

// Mission kill: a tank with no gun and no way to move is abandoned by its
// crew and scuttled a couple of seconds later (yours too, except you).
void Game::missionKills() {
  for (Tank* t : tanks) {
    if (!t->alive || t->isPlayer) continue;
    auto& pt = t->parts;
    bool stuck = t->s.immobile || pt[ENGINE].hp <= 0 || (pt[TRACK_L].hp <= 0 && pt[TRACK_R].hp <= 0);
    if (!t->abandonT && pt[CANNON].hp <= 0 && stuck) {
      t->abandonT = ABANDON_TICKS;
      popup("ABANDONED!", t->x, t->y - t->hw - 12, 14, !t->team, true);
      gas.addSmoke(t->x, t->y, 1.5);
    }
    if (t->abandonT && --t->abandonT <= 0) t->parts[HULL].hp = 0;
  }
}

// Mechanics repair their assigned part, using spare parts; twice as fast
// when the tank holds still. Wrecked parts come back slowly.
void Game::updateCrew() {
  Tank& p = *player;
  bool still = std::hypot(p.vx, p.vy) < 0.2 && std::abs(p.av) < 0.01;
  for (Part k : crew) {
    if (k == NO_PART) continue;
    auto& pp = p.parts[k];
    if (pp.hp >= pp.max || spares <= 0) continue;
    double rate = pp.max * 0.0008 * (still ? 2 : 1) * (k == HULL ? 0.35 : 1) * (pp.hp <= 0 ? 0.5 : 1) * p.mods.crewRate;
    double add = std::min(rate, pp.max - pp.hp);
    double was = pp.hp;
    pp.hp += add;
    spares = std::max(0.0, spares - add / (k == HULL ? 4 : 8));
    if (was <= 0 && pp.hp > 0) popup(std::string(PART_LABEL[k]) + " FIXED!", p.x, p.y - p.hw - 10, 11, true);
  }
  if ((crew[0] == ENGINE || crew[1] == ENGINE) && p.burning > 0) p.burning = std::max(0.0, p.burning - 3); // put the fire out
}

void Game::updateScrap() {
  Tank& p = *player;
  for (int i = (int)scrap.size() - 1; i >= 0; i--) {
    Scrap& s = scrap[i];
    if (--s.t <= 0) { scrap.erase(scrap.begin() + i); continue; }
    if (p.alive) {
      double dx = p.x - s.x, dy = p.y - s.y, d = std::hypot(dx, dy);
      if (d == 0) d = 1;
      if (d < p.hw + 6) {
        spares = std::min(99.0, spares + 3);
        pickupAcc += 3;
        scrap.erase(scrap.begin() + i);
        continue;
      }
      if (d < 40) { s.vx += (dx / d) * 0.12; s.vy += (dy / d) * 0.12; } // magnet
    }
    s.vx *= 0.9; s.vy *= 0.9;
    double nx = s.x + s.vx, ny = s.y + s.vy;
    if (grid.isSolid((int)std::floor(nx), (int)std::floor(s.y))) s.vx *= -0.5; else s.x = nx;
    if (grid.isSolid((int)std::floor(s.x), (int)std::floor(ny))) s.vy *= -0.5; else s.y = ny;
  }
  if (pickupAcc && tick % 20 == 0) {
    popup("+" + std::to_string(pickupAcc) + " SPARES", p.x, p.y - p.hw - 10, 10);
    pickupAcc = 0;
  }
}

// smoke/fire/steam sources attached to entities
void Game::emitters() {
  for (int i = (int)smokeClouds.size() - 1; i >= 0; i--) {
    SmokeCloud& c = smokeClouds[i];
    if (--c.t <= 0) { smokeClouds.erase(smokeClouds.begin() + i); continue; }
    double k = std::min(1.0, c.t / 60.0);
    for (int n = 0; n < 3; n++) {
      double ox = (rnd() - 0.5) * 14;
      double oy = (rnd() - 0.5) * 14;
      gas.addSmoke(c.x + ox, c.y + oy, 0.3 * k);
    }
    if (c.t % 10 == 0) gas.addExpand(c.x, c.y, 0.15 * k);
  }
  for (Tank* t : tanks) {
    if (!t->alive) continue;
    double ex = t->x - std::cos(t->a) * t->hl * 0.7, ey = t->y - std::sin(t->a) * t->hl * 0.7;
    if (t->burning > 0) {
      gas.addHeat(ex, ey, 0.25);
      gas.addSmoke(ex, ey, 0.12);
    } else if (t->frac(ENGINE) < 0.5 && tick % 4 == 0) {
      gas.addSteam(ex, ey, 0.25 * (1 - t->frac(ENGINE))); // leaking radiator
    }
    if (t->frac(HULL) < 0.35 && tick % 6 == 0) gas.addSmoke(t->x, t->y, 0.08);
  }
  for (int i = (int)wrecks.size() - 1; i >= 0; i--) {
    Wreck& w = wrecks[i];
    if (--w.t <= 0) { wrecks.erase(wrecks.begin() + i); continue; }
    double k = (double)w.t / w.max;
    double ox = (rnd() - 0.5) * 8;
    double oy = (rnd() - 0.5) * 8;
    gas.addSmoke(w.x + ox, w.y + oy, 0.1 * k);
    if (w.t > w.max - 150) {
      double hx = (rnd() - 0.5) * 6;
      double hy = (rnd() - 0.5) * 6;
      gas.addHeat(w.x + hx, w.y + hy, 0.3);
    }
  }
}

void Game::collideTanks() {
  auto& ts = tanks;
  for (size_t i = 0; i < ts.size(); i++) {
    Tank& a = *ts[i];
    if (!a.alive) continue;
    for (size_t j = i + 1; j < ts.size(); j++) {
      Tank& b = *ts[j];
      if (!b.alive) continue;
      double lim = a.bound + b.bound;
      if (sq(b.x - a.x) + sq(b.y - a.y) > lim * lim) continue;
      for (auto pa : a.circles()) {
        for (auto pb : b.circles()) {
          double dx = pb.x - pa.x, dy = pb.y - pa.y, rr = pa.r + pb.r;
          double d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr) continue;
          double d = std::sqrt(d2);
          if (d == 0) d = 0.01;
          double nx = dx / d, ny = dy / d, o = rr - d;
          double wa = b.mass / (a.mass + b.mass), wb = 1 - wa;
          a.x -= nx * o * wa; a.y -= ny * o * wa;
          b.x += nx * o * wb; b.y += ny * o * wb;
          double rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rv < 0) {
            double j2 = -rv * 1.2;
            a.vx -= nx * j2 * wa; a.vy -= ny * j2 * wa;
            b.vx += nx * j2 * wb; b.vy += ny * j2 * wb;
            if (-rv > 0.6 && a.team != b.team) { // ramming damage (friends just bump)
              double dmg = -rv * 12;
              a.damagePart(HULL, dmg * wa); b.damagePart(HULL, dmg * wb);
            }
          }
        }
      }
    }
  }
}

void Game::updateState() {
  Tank& p = *player;
  if (state == "play") {
    if (!p.alive) { state = "dead"; stateT = 0; }
  } else if (state == "cleared") {
    if (!p.alive) { state = "dead"; stateT = 0; }
    else if (++stateT > 150) {
      if (level >= BATTLES) state = "win";
      else { state = "reward"; choices = pickRewards(rng, build, tagCount, level); }
    }
  } else stateT++;
}

void Game::updateCamera(const Input* inp) {
  Tank& p = *player;
  double tx = p.x - VIEW_W / 2.0, ty = p.y - VIEW_H / 2.0;
  if (p.alive && inp) { // look ahead toward the mouse
    tx += clamp((inp->aimX - p.x) * 0.25, -90, 90);
    ty += clamp((inp->aimY - p.y) * 0.25, -60, 60);
  }
  cam.x += (tx - cam.x) * 0.1;
  cam.y += (ty - cam.y) * 0.1;
  cam.x = clamp(cam.x, 0, ROOM_W - VIEW_W);
  cam.y = clamp(cam.y, 0, ROOM_H - VIEW_H);
}
