#include "tank.h"
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include "util.h"

// Armor tuning: the front is a wall, flanks and rear are where fights are won.
static constexpr double SIDE_MULT = 0.9;
static constexpr double REAR_MULT = 1.6;
static constexpr double PEN_MULT = 1.5;      // square hit on a flank / the rear
static constexpr double PART_TO_HULL = 0.6;  // share of a part hit that also hits the hull

static std::array<double, NPARTS> hpOf(double hull, double track, double turret, double cannon, double engine, double ammo) {
  return {hull, track, track, turret, cannon, engine, ammo};
}

const TankStats& tankType(const std::string& type) {
  static const TankStats player{40, 26, 1.5, 0.05, 0.09, 36, 0.5, hpOf(300, 80, 80, 70, 80, 60), {8, 55, 12, 13}, 0xec, 0xfc, 0};
  static const TankStats scout{32, 20, 1.6, 0.065, 0.08, 60, 0.8, hpOf(55, 25, 25, 20, 25, 20), {6.5, 18, 8, 9}, 0xb4, 0xc8, 140};
  static const TankStats gunner{40, 26, 1.0, 0.045, 0.05, 95, 0.55, hpOf(110, 45, 45, 40, 45, 35), {7, 33, 11, 12}, 0x8c, 0xa4, 230};
  static const TankStats heavy{48, 32, 0.65, 0.03, 0.035, 125, 0.2, hpOf(220, 80, 80, 70, 70, 60), {6.5, 48, 15, 15}, 0x64, 0x7c, 190};
  static const TankStats boss{64, 42, 0.5, 0.022, 0.04, 70, 0.2, hpOf(520, 140, 140, 120, 120, 100), {7, 45, 18, 17}, 0x4a, 0x60, 210};
  if (type == "player") return player;
  if (type == "scout") return scout;
  if (type == "gunner") return gunner;
  if (type == "heavy") return heavy;
  if (type == "boss") return boss;
  throw std::runtime_error("unknown tank type " + type);
}

Tank::Tank(const std::string& type_, double x_, double y_, double a_, int team_)
    : type(type_), team(team_), s(tankType(type_)), x(x_), y(y_), a(a_), ta(a_) {
  reloadMax = s.reload;
  isPlayer = type == "player";
  for (int k = 0; k < NPARTS; k++) parts[k] = {s.hp[k], s.hp[k]};
  setGeometry();
}

void Tank::setGeometry() {
  len = s.len; wid = s.wid;
  hl = len / 2; hw = wid / 2;
  trackW = std::max(3.0, jsround(wid * 0.22));
  turretR = wid * 0.34;
  barrelLen = len * 0.5;
  turretOff = -len * 0.06;
  engineLen = std::max(4.0, len * 0.18);
  ammoLen = std::max(3.0, len * 0.14);
  mass = len * wid;
  bound = std::hypot(hl, hw);
  double reach = std::max(bound, std::abs(turretOff) + turretR + barrelLen) + 1;
  bound2 = reach * reach;

  // Collision samples along the hull outline, with outward normals.
  samples.clear();
  double shl = hl - 0.5, shw = hw - 0.5, step = 2.5;
  int n = (int)std::ceil((2 * shl) / step);
  for (int i = 0; i <= n; i++) {
    double u = -shl + (2 * shl * i) / n;
    samples.push_back({u, -shw, 0, -1});
    samples.push_back({u, shw, 0, 1});
  }
  int m = (int)std::ceil((2 * shw) / step);
  for (int i = 1; i < m; i++) {
    double v = -shw + (2 * shw * i) / m;
    samples.push_back({shl, v, 1, 0});
    samples.push_back({-shl, v, -1, 0});
  }
}

void Tank::aimAt(double target) {
  if (parts[TURRET].hp <= 0) { ta = a + turretLock; return; }
  // while an AI is "charging" a shot the turret nearly locks: dodge window
  double mx = s.turretRate * turretFactor() * power.turret * (charge > 0 ? 0.25 : 1);
  ta += clamp(angDiff(target, ta), -mx, mx);
}

std::array<Tank::Circle, 2> Tank::circles() const {
  double c = std::cos(a) * hl * 0.5, sn = std::sin(a) * hl * 0.5, r = hw + 0.5;
  return {Circle{x + c, y + sn, r}, Circle{x - c, y - sn, r}};
}

// Returns false if clear, else true with the summed push-out direction.
bool Tank::collide(const Grid& grid, double cx, double cy, double ca, double& px, double& py) const {
  double c = std::cos(ca), sn = std::sin(ca);
  int n = 0;
  px = 0; py = 0;
  for (const auto& p : samples) {
    double wx = cx + p.u * c - p.v * sn, wy = cy + p.u * sn + p.v * c;
    if (grid.isSolid((int)std::floor(wx), (int)std::floor(wy))) {
      n++;
      px -= p.nu * c - p.nv * sn;
      py -= p.nu * sn + p.nv * c;
    }
  }
  return n > 0;
}

void Tank::update(Grid& grid, Debris& debris) {
  if (!alive) return;
  if (reload > 0) reload -= power.reload * reloadBoost;
  if (mgCd > 0) mgCd--;
  mgHeat = std::max(0.0, mgHeat - 0.35);
  if (overheat && mgHeat < 10) overheat = false;
  if (flashT > 0) flashT--;
  if (hitT > 0) hitT--;
  if (hurtT > 0) hurtT--;
  if (burning > 0) {
    burning--;
    parts[HULL].hp -= team == 0 ? 0.12 * mods.fireDmg * dmgTaken : 0.45;
  }

  double eng = engineFactor() * power.move;
  double L = clamp(throttle + turn, -1, 1) * trackFactor(TRACK_L);
  double R = clamp(throttle - turn, -1, 1) * trackFactor(TRACK_R);
  double targetF = (L + R) * 0.5 * s.speed * eng;
  double targetW = (L - R) * 0.5 * s.turn * eng;

  double c = std::cos(a), sn = std::sin(a);
  double fs = vx * c + vy * sn;   // forward speed
  double ls = -vx * sn + vy * c;  // sideways slip (tracks resist it)
  fs += (targetF - fs) * 0.08;
  ls *= 0.75;
  fs *= drag;
  av += (targetW - av) * 0.2;
  vx = fs * c - ls * sn;
  vy = fs * sn + ls * c;
  treadL += fs + av * hw;
  treadR += fs - av * hw;

  move(grid);
  plow(grid, debris);
  stampTracks(grid, fs);
}

void Tank::move(const Grid& grid) {
  double nx = x + vx, ny = y + vy, na = a + av;
  double hx, hy;
  bool hit = collide(grid, nx, ny, na, hx, hy);
  if (!hit) { x = nx; y = ny; a = na; return; }

  // push out of the wall along the contact normals
  double tx = nx, ty = ny;
  for (int k = 0; k < 4 && hit; k++) {
    double l = std::hypot(hx, hy);
    if (l == 0) l = 1;
    tx += (hx / l) * 0.5; ty += (hy / l) * 0.5;
    hit = collide(grid, tx, ty, na, hx, hy);
  }
  if (!hit) {
    double dx = tx - nx, dy = ty - ny, l = std::hypot(dx, dy);
    if (l == 0) l = 1;
    double ux = dx / l, uy = dy / l;
    double d = vx * ux + vy * uy;
    if (d < 0) { vx -= ux * d; vy -= uy * d; }
    x = tx; y = ty; a = na;
    return;
  }
  // blocked: try translation only, then rotation only
  double dummyX, dummyY;
  if (!collide(grid, nx, ny, a, dummyX, dummyY)) { x = nx; y = ny; av = 0; }
  else if (!collide(grid, x, y, na, dummyX, dummyY)) { a = na; vx *= 0.2; vy *= 0.2; }
  else {
    vx *= 0.2; vy *= 0.2; av = 0;
    double cx, cy;
    if (collide(grid, x, y, a, cx, cy)) { // already overlapping: squeeze out
      double l = std::hypot(cx, cy);
      if (l == 0) l = 1;
      x += (cx / l) * 0.5; y += (cy / l) * 0.5;
    }
  }
}

// Tanks shove rubble aside: rubble under the hull edge is kicked up as debris.
void Tank::plow(Grid& grid, Debris& debris) {
  double c = std::cos(a), sn = std::sin(a);
  double speed = std::hypot(vx, vy);
  int n = 0;
  for (const auto& p : samples) {
    int wx = (int)std::floor(x + p.u * c - p.v * sn), wy = (int)std::floor(y + p.u * sn + p.v * c);
    if (!grid.inBounds(wx, wy)) continue;
    int i = wy * grid.w + wx;
    if (grid.mat[i] == M::GRASS) { // tall grass is crushed flat under the tracks
      grid.mat[i] = M::EMPTY; grid.hp[i] = 0;
      grid.floor[i] = F::FLAT;
      grid.touch(wx, wy);
      continue;
    }
    if (grid.mat[i] != M::RUBBLE) continue;
    n++;
    if (speed > 0.15 && n <= 12) {
      grid.setCell(wx, wy, M::EMPTY);
      double nx = p.nu * c - p.nv * sn, ny = p.nu * sn + p.nv * c;
      double jx = (rnd() - 0.5) * 0.4;
      double jy = (rnd() - 0.5) * 0.4;
      debris.spawn(wx + 0.5, wy + 0.5, vx * 1.3 + nx * 0.5 + jx, vy * 1.3 + ny * 0.5 + jy, M::RUBBLE);
    }
  }
  drag = 1 - std::min(0.25, n * 0.02);
}

void Tank::stampTracks(Grid& grid, double fs) {
  if (std::abs(fs) < 0.05 && std::abs(av) < 0.005) return;
  double c = std::cos(a), sn = std::sin(a);
  double u = -hl + 1.5;
  for (int side : {-1, 1}) {
    double phase = side < 0 ? treadL : treadR;
    long long fl = (long long)std::floor(phase);
    if (((fl % 3) + 3) % 3 == 0) continue;
    for (int o = -1; o <= 1; o++) {
      double v = side * (hw - trackW / 2) + o;
      int wx = (int)std::floor(x + u * c - v * sn), wy = (int)std::floor(y + u * sn + v * c);
      if (!grid.inBounds(wx, wy)) continue;
      int i = wy * grid.w + wx;
      if (grid.mat[i] != M::EMPTY || grid.scorch[i] || grid.floor[i] == F::TRACK || grid.floor[i] == F::DOT) continue;
      grid.floor[i] = F::TRACK;
      grid.touch(wx, wy);
    }
  }
}

// Which part does world point (px, py) land on? NO_PART = miss.
Part Tank::hitTest(double px, double py) const {
  double dx = px - x, dy = py - y;
  if (dx * dx + dy * dy > bound2) return NO_PART;
  double c = std::cos(a), sn = std::sin(a);
  double ex = px - (x + turretOff * c), ey = py - (y + turretOff * sn);
  double tc = std::cos(ta), ts = std::sin(ta);
  double tu = ex * tc + ey * ts, tv = -ex * ts + ey * tc;
  double BL = parts[CANNON].hp > 0 ? barrelLen : barrelLen * 0.45;
  if (tu > turretR - 1 && tu <= turretR + BL && std::abs(tv) <= 1.6) return CANNON;
  if (tu * tu + tv * tv <= turretR * turretR) return TURRET;
  double u = dx * c + dy * sn, v = -dx * sn + dy * c;
  if (std::abs(u) > hl || std::abs(v) > hw) return NO_PART;
  if (std::abs(v) > hw - trackW) return v < 0 ? TRACK_L : TRACK_R;
  double eu = u + hl;
  if (eu < engineLen) return ENGINE;
  if (eu < engineLen + ammoLen) return AMMO;
  return HULL;
}

// Returns true if the part just broke.
bool Tank::damagePart(Part name, double amount) {
  auto& p = parts[name];
  if (p.hp <= 0 || amount <= 0) return false;
  p.hp -= amount * dmgTaken;
  hurtT = 180;
  if (p.hp > 0) return false;
  p.hp = 0;
  events.push_back(name);
  if (name == TURRET) turretLock = angDiff(ta, a);
  else if (name == ENGINE) burning = team ? 1e9 : std::max(burning, 180.0);
  else if (name == AMMO) {
    if (team) { cookoff = true; parts[HULL].hp = 0; }
    else { parts[HULL].hp -= 50; burning = std::max(burning, 150.0); }
  }
  return true;
}

// Impact at world point (px, py) travelling along (dirx, diry).
// Armor = which face is struck (front/side/rear) x how square the hit is:
// the struck face's normal is found from the impact point, so angling the
// hull really deflects shots. Glancing hits ricochet: the caller reflects the
// projectile about the returned normal (nx, ny).
HitResult Tank::takeHit(Part zone, double dmg, double dirx, double diry, double px, double py, bool light) {
  double c = std::cos(a), sn = std::sin(a);
  int face;
  double nx, ny;
  if (zone == TURRET || zone == CANNON) {
    double tx = px - (x + turretOff * c), ty = py - (y + turretOff * sn);
    double l = std::hypot(tx, ty);
    if (l == 0) l = 1;
    nx = tx / l; ny = ty / l;
    double facing = nx * std::cos(ta) + ny * std::sin(ta);
    face = facing > 0.5 ? FACE_FRONT : facing < -0.5 ? FACE_REAR : FACE_SIDE;
  } else {
    double dx = px - x, dy = py - y;
    double u = dx * c + dy * sn, v = -dx * sn + dy * c;
    double nu = 0, nv = 0;
    if (std::abs(u) / hl > std::abs(v) / hw) { nu = u != 0 ? sign(u) : 1; face = u > 0 ? FACE_FRONT : FACE_REAR; }
    else { nv = v != 0 ? sign(v) : 1; face = FACE_SIDE; }
    nx = nu * c - nv * sn; ny = nu * sn + nv * c;
  }
  double cs = std::abs(dirx * nx + diry * ny); // 1 = square hit, 0 = grazing
  bool isTrack = zone == TRACK_L || zone == TRACK_R;
  double faceMult = face == FACE_FRONT ? s.armorFront : face == FACE_REAR ? REAR_MULT : SIDE_MULT;
  double mult = isTrack ? std::max(faceMult, 0.8) : faceMult;
  double eff = dmg * mult * (0.35 + 0.65 * cs) * (0.85 + rnd() * 0.3);
  // (the flanks are mostly track, so grazing track hits must deflect too)
  bool ricochet = false;
  if (face != FACE_REAR) {
    if (cs < 0.4 && rnd() < (isTrack ? 0.6 : 0.85)) ricochet = true;
    else if (!isTrack && mult < 0.35 && cs < 0.75 && rnd() < 0.5) ricochet = true;
  }
  if (ricochet) eff *= 0.15;
  // PENETRATION: a square hit on a flank or the rear goes straight through
  bool pen = !ricochet && face != FACE_FRONT && cs > 0.85;
  if (pen) eff *= PEN_MULT;

  flashZone = zone; flashT = light ? 4 : 12;
  if (!light) hitT = 3;
  // weak point: a clean hit on an enemy's ammo rack cooks it off
  if (team && zone == AMMO && !ricochet && eff >= parts[AMMO].max * 0.5) {
    damagePart(AMMO, parts[AMMO].hp + 1);
    return {ricochet, eff, nx, ny, face, pen};
  }
  damagePart(zone, eff);
  if (zone != HULL) damagePart(HULL, eff * PART_TO_HULL); // hits on parts still wreck the hull
  return {ricochet, eff, nx, ny, face, pen};
}
