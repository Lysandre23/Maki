#include <algorithm>
#include <cmath>
#include <limits>
#include "game.h"

static constexpr double ROW = 40, SIDE = 28;  // formation spacing around a squad goal
static constexpr int COVER_R = 5;             // cover search radius, in nav nodes
static constexpr int REPLAN = 120;            // ticks between hold cover re-evaluations

std::vector<Tank*> Squad::alive() const {
  std::vector<Tank*> out;
  for (Tank* t : tanks) if (t->alive) out.push_back(t);
  return out;
}

Pt centroid(const std::vector<Tank*>& tanks) {
  double x = 0, y = 0;
  for (Tank* t : tanks) { x += t->x; y += t->y; }
  return {x / tanks.size(), y / tanks.size()};
}

// k-th member's slot around the goal, in rows of two facing `heading`.
static Pt slotAt(const Squad& sq, int k, int n) {
  int row = k >> 1;
  bool lone = n % 2 == 1 && k == n - 1;
  double dx = -row * ROW, dy = lone ? 0 : (k & 1 ? 1 : -1) * SIDE;
  double c = std::cos(sq.heading), s = std::sin(sq.heading);
  return {sq.goal.x + dx * c - dy * s, sq.goal.y + dx * s + dy * c};
}

// Nearest passable nav node centre to (x, y), searching outward.
Pt snapPassable(const Nav& nav, double x, double y, int maxR) {
  int ci = (int)std::floor(x / nav.c), cj = (int)std::floor(y / nav.c);
  for (int r = 0; r <= maxR; r++) {
    bool found = false;
    Pt best;
    double bd = std::numeric_limits<double>::infinity();
    for (int j = cj - r; j <= cj + r; j++) {
      for (int i = ci - r; i <= ci + r; i++) {
        if (std::max(std::abs(i - ci), std::abs(j - cj)) != r) continue;
        if (i < 0 || j < 0 || i >= nav.w || j >= nav.h || !nav.pass[j * nav.w + i]) continue;
        double px = (i + 0.5) * nav.c, py = (j + 0.5) * nav.c, d = sq(px - x) + sq(py - y);
        if (d < bd) { bd = d; best = {px, py}; found = true; }
      }
    }
    if (found) return best;
  }
  return {x, y};
}

// Is there something solid between (x, y) and the threat, close to us?
static bool covered(const Grid& grid, double x, double y, double tx, double ty) {
  double d = std::hypot(tx - x, ty - y);
  if (d < 60) return false;
  double ux = (tx - x) / d, uy = (ty - y) / d;
  for (int k = 14; k <= 46; k += 4) if (grid.isSolid((int)std::floor(x + ux * k), (int)std::floor(y + uy * k))) return true;
  return false;
}

// Best passable spot near `slot` with cover from `threat`, avoiding `taken`.
static Pt coverSpot(Game& game, Pt slot, const Known* threat, const std::vector<Pt>& taken) {
  const Nav& nav = game.nav;
  int ci = (int)std::floor(slot.x / nav.c), cj = (int)std::floor(slot.y / nav.c);
  bool found = false;
  Pt best;
  double bs = -std::numeric_limits<double>::infinity();
  for (int j = cj - COVER_R; j <= cj + COVER_R; j++) {
    for (int i = ci - COVER_R; i <= ci + COVER_R; i++) {
      if (i < 0 || j < 0 || i >= nav.w || j >= nav.h || !nav.pass[j * nav.w + i]) continue;
      double x = (i + 0.5) * nav.c, y = (j + 0.5) * nav.c;
      double dist = std::hypot(x - slot.x, y - slot.y);
      if (dist > COVER_R * nav.c) continue;
      double sc = -dist * 0.5;
      if (threat && covered(game.grid, x, y, threat->x, threat->y)) sc += 100;
      for (const Pt& o : taken) if (std::hypot(o.x - x, o.y - y) < 26) sc -= 80;
      if (sc > bs) { bs = sc; best = {x, y}; found = true; }
    }
  }
  return found ? best : snapPassable(nav, slot.x, slot.y);
}

// Give a squad a new order. Hold without a point holds where the squad stands.
void orderSquad(Game& game, Squad& sq, const std::string& order, bool hasPoint, double x, double y) {
  auto live = sq.alive();
  if (live.empty()) return;
  Pt c = centroid(live);
  if (order == "hold" && !hasPoint) { x = c.x; y = c.y; }
  sq.order = order;
  sq.hasGoal = order != "follow";
  if (sq.hasGoal) {
    sq.goal = {x, y};
    double h = std::atan2(y - c.y, x - c.x);
    // Hold in place: face the enemy side rather than an arbitrary direction
    sq.heading = std::hypot(x - c.x, y - c.y) > 40 ? h : 0;
  }
  sq.orderT = ++game.orderSeq;
  for (Tank* t : live) if (t->ai.retreat) { t->ai.retreat = false; t->ai.exempt = sq.orderT; }
  planSquad(game, sq);
}

void toggleStance(Squad& sq) {
  sq.stance = sq.stance == "aggressive" ? "cautious" : "aggressive";
  if (sq.stance == "aggressive") for (Tank* t : sq.tanks) t->ai.retreat = false;
}

// Recompute each member's destination for move / attack / hold.
void planSquad(Game& game, Squad& sq) {
  auto live = sq.alive();
  sq.planT = game.tick;
  sq.planN = (int)live.size();
  if (!sq.hasGoal) return;
  const Known* threat = sq.order == "hold" ? game.threatNear(sq.goal.x, sq.goal.y) : nullptr;
  std::vector<Pt> taken;
  for (int k = 0; k < (int)live.size(); k++) {
    Pt slot = slotAt(sq, k, (int)live.size());
    Pt d = sq.order == "hold" ? coverSpot(game, slot, threat, taken) : snapPassable(game.nav, slot.x, slot.y);
    taken.push_back(d);
    live[k]->ai.dest = d;
    live[k]->ai.hasDest = true;
  }
}

void updateSquads(Game& game) {
  for (auto& sqp : game.squads) {
    Squad& sq = *sqp;
    auto live = sq.alive();
    if (live.empty()) continue;
    // Hold re-checks cover as threats move; deaths reshuffle the formation.
    if (sq.hasGoal && (game.tick - sq.planT > (sq.order == "hold" ? REPLAN : 600) || (int)live.size() != sq.planN)) planSquad(game, sq);
    if (sq.stance != "cautious") continue;
    for (Tank* t : live) {
      if (!t->ai.retreat && t->ai.exempt != sq.orderT && t->frac(HULL) < RETREAT_HULL) {
        t->ai.retreat = true;
        game.popup("FALLING BACK!", t->x, t->y - 16, 10);
      }
    }
  }
}

// ------------------------------------------------------------------ vision
// Each tank casts RAYS rays out to SIGHT_R every REFRESH ticks (staggered per
// tank); walls stop a ray and thick smoke does too. A node counts as visible
// for a little longer than one refresh so it doesn't flicker between passes.
static constexpr double SIGHT_R = 360;
static constexpr int RAYS = 120;
static constexpr double STEP = 8;
static constexpr int REFRESH = 10;
static constexpr int GHOST_TICKS = 20 * 60; // last-seen ghosts fade out after 20 s

Vision::Vision(int worldW, int worldH) {
  w = (worldW + VISION_NODE - 1) / VISION_NODE;
  h = (worldH + VISION_NODE - 1) / VISION_NODE;
  seen.assign((size_t)w * h, -1000000000);
  ever.assign((size_t)w * h, 0);
}

bool Vision::visible(double x, double y) const {
  int i = (int)std::floor(x / VISION_NODE), j = (int)std::floor(y / VISION_NODE);
  if (i < 0 || j < 0 || i >= w || j >= h) return false;
  return tick - seen[j * w + i] <= REFRESH + 2;
}

void Vision::cast(Game& game, const Tank& t) {
  const Grid& grid = game.grid;
  const Gas& gas = game.gas;
  int n = (int)std::ceil(SIGHT_R / STEP);
  for (int r = 0; r < RAYS; r++) {
    double a = ((double)r / RAYS) * kPI * 2;
    double dx = std::cos(a) * STEP, dy = std::sin(a) * STEP;
    double x = t.x, y = t.y, smoke = 0;
    for (int k = 0; k <= n; k++) {
      int i = (int)std::floor(x / VISION_NODE), j = (int)std::floor(y / VISION_NODE);
      if (i < 0 || j < 0 || i >= w || j >= h) break;
      int ni = j * w + i;
      seen[ni] = tick; ever[ni] = 1;
      // the wall itself is seen, what's behind it isn't
      if (k > 1 && grid.isSolid((int)std::floor(x), (int)std::floor(y))) break;
      smoke += gas.smokeAt(x, y) * (STEP / 3);
      if (smoke > 5) break;
      x += dx; y += dy;
    }
  }
}

void Vision::update(Game& game, const std::vector<Tank*>& eyes, const std::vector<Tank*>& foes) {
  tick = game.tick;
  for (size_t k = 0; k < eyes.size(); k++) {
    if (eyes[k]->alive && (game.tick + (int)k * 3) % REFRESH == 0) cast(game, *eyes[k]);
  }
  if (game.tick % REFRESH != 0) return;
  for (Tank* e : foes) {
    auto it = std::find_if(known.begin(), known.end(), [e](const Known& k) { return k.tank == e; });
    if (!e->alive) { if (it != known.end()) known.erase(it); continue; }
    if (visible(e->x, e->y)) {
      Known k{e, e->x, e->y, e->a, game.tick, true};
      if (it != known.end()) *it = k; else known.push_back(k);
    } else {
      if (it == known.end()) continue;
      it->vis = false;
      if (game.tick - it->t > GHOST_TICKS) known.erase(it);
    }
  }
}

// 0..1 how faded a ghost is (0 = seen right now).
double Vision::fade(const Known& k) const { return k.vis ? 0 : std::min(1.0, (tick - k.t) / (double)GHOST_TICKS); }

void Vision::clear() {
  std::fill(seen.begin(), seen.end(), -1000000000);
  std::fill(ever.begin(), ever.end(), 0);
  known.clear();
}
