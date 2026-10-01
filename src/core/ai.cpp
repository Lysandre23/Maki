#include <algorithm>
#include <cmath>
#include "game.h"

// ticks between "about to fire" warning and the shot
static int chargeOf(const std::string& type) {
  if (type == "scout") return 22;
  if (type == "gunner") return 32;
  if (type == "heavy") return 42;
  if (type == "boss") return 28;
  return 30;
}
static constexpr double LEASH = 240;   // how far a defender strays from its post while fighting
static constexpr double MOVE_ENGAGE = 200;

// Orders:
//   follow: keep a formation slot around the player's tank
//   hold:   stay near `post`, fight whatever comes in range
//   attack: push to `goal`, fighting on the way
//   move:   go to `goal`, only fight when hit or a foe is within MOVE_ENGAGE
// Allies get theirs from their squad (squads.cpp).
void initAI(Tank& t, int idx, const std::string& order) {
  AIState ai;
  ai.phase = idx * 5;
  ai.order = order;
  ai.post = {t.x, t.y};
  ai.strafe = rnd() < 0.5 ? 1 : -1;
  ai.strafeT = 60 + rnd() * 120;
  ai.wake = 40 + idx * 12;
  t.ai = ai;
}

// Line of sight through the cell grid; thick smoke also blocks it.
bool lineOfSight(Game& game, double x0, double y0, double x1, double y1) {
  double dx = x1 - x0, dy = y1 - y0;
  int n = (int)std::ceil(std::hypot(dx, dy) / 3);
  double smoke = 0;
  for (int k = 1; k < n; k++) {
    double x = x0 + (dx * k) / n, y = y0 + (dy * k) / n;
    if (game.grid.isSolid((int)std::floor(x), (int)std::floor(y))) return false;
    smoke += game.gas.smokeAt(x, y);
    if (smoke > 5) return false;
  }
  return true;
}

// Nearest hostile we can actually see (checks at most 3 candidates).
static Tank* pickTarget(Tank& t, Game& game) {
  const auto& foes = t.team ? game.friendlies : game.enemies;
  std::vector<std::pair<double, Tank*>> cands;
  for (Tank* f : foes) {
    if (!f->alive) continue;
    double d = std::hypot(f->x - t.x, f->y - t.y);
    if (d < t.s.sight) cands.push_back({d, f});
  }
  std::stable_sort(cands.begin(), cands.end(), [](auto& a, auto& b) { return a.first < b.first; });
  for (size_t i = 0; i < std::min<size_t>(3, cands.size()); i++) {
    Tank* f = cands[i].second;
    if (lineOfSight(game, t.x, t.y, f->x, f->y)) return f;
  }
  return nullptr;
}

// Would a shot along `ang` pass through a friendly tank before `range`?
static bool friendlyInLine(Tank& t, Game& game, double ang, double range) {
  const auto& mates = t.team ? game.enemies : game.friendlies;
  double c = std::cos(ang), s = std::sin(ang);
  for (Tank* m : mates) {
    if (m == &t || !m->alive) continue;
    double dx = m->x - t.x, dy = m->y - t.y;
    double along = dx * c + dy * s;
    if (along < 0 || along > range) continue;
    if (std::abs(-dx * s + dy * c) < m->hw + 6) return true;
  }
  return false;
}

static double navDir(Game& game, Tank& t, double gx, double gy, double fallback) {
  double d;
  const auto& f = game.nav.field(gx, gy);
  return game.nav.dirAt(f, t.x, t.y, d) ? d : fallback;
}

// Turn toward `desired`; drive in reverse if it's behind us.
static void steer(Tank& t, double desired, double speed) {
  double d = angDiff(desired, t.a);
  if (std::abs(d) > 2.3) {
    double r = angDiff(desired + kPI, t.a);
    t.turn = clamp(r * 2.5, -1, 1);
    t.throttle = std::abs(r) < 0.6 ? -speed : 0;
  } else {
    t.turn = clamp(d * 2.5, -1, 1);
    t.throttle = std::abs(d) < 0.7 ? speed : 0.1;
  }
}

// Where the order wants this tank to be right now. Allies take the order from
// their squad, which also plans `ai.dest`; enemies use their own.
// passive = don't stop to fight unless hit or a foe gets close (Move order);
// chase = close in on targets beyond gun range.
struct Goal { double x, y, leash; bool hasAnchor; Pt anchor; bool passive = false, chase = false, follow = false; };

static Goal orderGoal(Tank& t, Game& game) {
  auto& ai = t.ai;
  Tank* p = game.player;
  const std::string& order = t.squad ? t.squad->order : ai.order;
  if (ai.retreat) {
    Pt at = p->alive ? Pt{p->x - std::cos(p->a) * 70, p->y - std::sin(p->a) * 70} : ai.post;
    Goal g{at.x, at.y, 120, true, p->alive ? Pt{p->x, p->y} : ai.post};
    g.passive = true;
    return g;
  }
  if (order == "follow" && p->alive) {
    double c = std::cos(p->a), s = std::sin(p->a);
    Pt sl = ai.hasSlot ? ai.slot : Pt{-60, 0};
    Goal g{p->x + sl.x * c - sl.y * s, p->y + sl.x * s + sl.y * c, 200, true, {p->x, p->y}};
    g.chase = true; g.follow = true;
    return g;
  }
  bool hasDest = t.squad ? ai.hasDest : ai.hasGoal;
  Pt dest = t.squad ? ai.dest : ai.goal;
  if (order == "move" && hasDest) { Goal g{dest.x, dest.y, 1e9, false, {}}; g.passive = true; return g; }
  if (order == "attack" && hasDest) { Goal g{dest.x, dest.y, 1e9, false, {}}; g.chase = true; return g; }
  Pt post = (t.squad && ai.hasDest) ? ai.dest : ai.post;
  return Goal{post.x, post.y, LEASH, true, post};
}

// Part-aware behaviour:
//  - no cannon  -> tries to ram its target
//  - no turret  -> turns the whole hull to aim (tank destroyer)
//  - stuck      -> backs off and blasts the wall in front
void updateAI(Tank& t, Game& game) {
  auto& ai = t.ai;
  t.throttle = 0; t.turn = 0;
  if (ai.wake > 0) { ai.wake--; return; }

  if ((game.tick + ai.phase) % 12 == 0) {
    ai.target = pickTarget(t, game);
    ai.los = ai.target != nullptr;
    if (ai.target) { ai.lastSeen = {ai.target->x, ai.target->y}; ai.hasLastSeen = true; ai.lastSeenT = game.tick; }
  }
  Tank* tg = ai.target && ai.target->alive ? ai.target : nullptr;
  if (!tg) ai.los = false;
  if (ai.hasLastSeen && game.tick - ai.lastSeenT > 360) ai.hasLastSeen = false;

  Goal goal = orderGoal(t, game);

  // aim (lead the target a bit)
  double aim = t.a, dist = 1e300, toT = t.a;
  if (tg) {
    dist = std::hypot(tg->x - t.x, tg->y - t.y);
    toT = std::atan2(tg->y - t.y, tg->x - t.x);
  }
  if (ai.breach > 0) { ai.breach--; aim = t.a; }
  else if (tg && ai.los) {
    double tt = dist / t.s.shell.speed;
    aim = std::atan2(tg->y + tg->vy * tt * 0.8 - t.y, tg->x + tg->vx * tt * 0.8 - t.x);
  } else if (ai.hasLastSeen) aim = std::atan2(ai.lastSeen.y - t.y, ai.lastSeen.x - t.x);
  else if (t.team) aim = kPI; // defenders watch the west
  t.aimAt(aim);

  // Firing is telegraphed: the tank "charges" (laser line + muzzle glint,
  // turret nearly locked) before the shell leaves, so the player can dodge.
  if (t.charge > 0) {
    if (--t.charge == 0 && t.canFire() && !friendlyInLine(t, game, t.ta, std::min(dist, t.s.sight))) {
      game.fire(t);
      ai.breach = 0;
    }
  } else {
    bool aligned = std::abs(angDiff(aim, t.ta)) < 0.06;
    bool wantShot = (ai.los && dist < t.s.sight && rnd() < 0.05) || ai.breach > 0;
    if (aligned && t.canFire() && wantShot && !friendlyInLine(t, game, t.ta, std::min(dist, t.s.sight))) {
      t.charge = t.chargeMax = chargeOf(t.type);
    }
  }

  if (t.s.immobile) return; // towed gun: aims and fires, never drives

  if (ai.unstuck > 0) { ai.unstuck--; t.throttle = -0.8; t.turn = ai.unTurn; return; }

  // turret knocked out: rotate the hull to bring the gun on target
  if (t.parts[TURRET].hp <= 0 && t.parts[CANNON].hp > 0 && ai.los) {
    t.turn = clamp(angDiff(aim - t.turretLock, t.a) * 3, -1, 1);
    return;
  }

  double range = t.s.range;
  double fromAnchor = goal.hasAnchor ? std::hypot(t.x - goal.anchor.x, t.y - goal.anchor.y) : 0;
  double toGoal = std::hypot(goal.x - t.x, goal.y - t.y);
  bool hasDesired = false;
  double desired = 0, speed = 1;

  if (tg && t.parts[CANNON].hp <= 0) { desired = navDir(game, t, tg->x, tg->y, toT); hasDesired = true; } // ram
  else if (tg && ai.los && fromAnchor < goal.leash && (!goal.passive || dist < MOVE_ENGAGE || t.hurtT > 0)) {
    hasDesired = true;
    if (dist < range * 0.6) desired = toT + kPI + ai.strafe * 0.5;
    else if (dist > range * 1.2 && goal.chase) desired = navDir(game, t, tg->x, tg->y, toT);
    else {
      if (--ai.strafeT <= 0) { ai.strafe = -ai.strafe; ai.strafeT = 80 + rnd() * 140; }
      desired = toT + (ai.strafe * kPI) / 2;
      speed = 0.6;
    }
  } else if (toGoal > (goal.follow ? 30 : 24)) {
    hasDesired = true;
    desired = navDir(game, t, goal.x, goal.y, std::atan2(goal.y - t.y, goal.x - t.x));
    if (goal.follow) speed = clamp(toGoal / 80, 0.4, 1);
  }

  if (!hasDesired) { // idle: face the likely threat
    double face = ai.hasLastSeen ? std::atan2(ai.lastSeen.y - t.y, ai.lastSeen.x - t.x) : t.team ? kPI : game.player->a;
    double d = angDiff(face, t.a);
    if (std::abs(d) > 0.3) t.turn = clamp(d * 1.5, -0.6, 0.6);
    return;
  }
  steer(t, desired, speed);

  double v = std::hypot(t.vx, t.vy);
  bool canDrive = t.parts[TRACK_L].hp > 0 && t.parts[TRACK_R].hp > 0 && t.parts[ENGINE].hp > 0;
  if (canDrive && std::abs(t.throttle) > 0.5 && v < 0.08) {
    if (++ai.stuck > 50) {
      ai.stuck = 0;
      ai.unstuck = 35;
      ai.unTurn = rnd() < 0.5 ? -1 : 1;
      if (t.parts[CANNON].hp > 0 && t.team) ai.breach = 40; // enemies blast through; allies don't shoot hedges near you
    }
  } else ai.stuck = std::max(0, ai.stuck - 1);
}
