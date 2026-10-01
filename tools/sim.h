#pragma once
// Shared headless driver: a scripted "bot" plays the player tank.
#include <cmath>
#include "../src/core/game.h"

// Push toward the flag along the nav flow field, shoot the nearest enemy in range.
inline Input botInput(Game& game) {
  Tank& p = *game.player;
  Tank* best = nullptr;
  double bd = 1e300;
  for (Tank* e : game.enemies) {
    if (!e->alive) continue;
    double d = sq(e->x - p.x) + sq(e->y - p.y);
    if (d < bd) { bd = d; best = e; }
  }
  const Flag& f = game.flag;
  double want = std::atan2(f.y - p.y, f.x - p.x);
  double dir;
  if (game.nav.dirAt(game.nav.field(f.x, f.y), p.x, p.y, dir)) want = dir;
  double d = want - p.a;
  while (d > kPI) d -= 2 * kPI;
  while (d < -kPI) d += 2 * kPI;
  bool atFlag = std::hypot(f.x - p.x, f.y - p.y) < f.r * 0.5;
  bool engage = best && bd < 380 * 380;
  Input in;
  in.throttle = !atFlag && std::abs(d) < 0.8 ? (engage && bd < 200 * 200 ? 0.3 : 1) : 0;
  in.turn = atFlag ? 0 : std::max(-1.0, std::min(1.0, d * 2));
  in.aimX = engage ? best->x : p.x + std::cos(p.a) * 100;
  in.aimY = engage ? best->y : p.y + std::sin(p.a) * 100;
  in.fire = engage;
  return in;
}

// A more careful player: stops to fight what it can see (instead of driving
// through it), backs off when too close, advances only when nothing is in
// sight, keeps its mechanics busy and pops smoke when badly hurt.
inline Input carefulBotInput(Game& game) {
  Tank& p = *game.player;
  Tank* best = nullptr;
  double bd = 1e300;
  for (Tank* e : game.enemies) {
    if (!e->alive) continue;
    double d = sq(e->x - p.x) + sq(e->y - p.y);
    if (d < bd && d < 440 * 440 && lineOfSight(game, p.x, p.y, e->x, e->y)) { bd = d; best = e; }
  }
  Input in;
  const Flag& f = game.flag;
  double want = std::atan2(f.y - p.y, f.x - p.x), dir;
  if (game.nav.dirAt(game.nav.field(f.x, f.y), p.x, p.y, dir)) want = dir;
  double d = angDiff(want, p.a);
  bool atFlag = std::hypot(f.x - p.x, f.y - p.y) < f.r * 0.5;
  if (best) {
    double dist = std::sqrt(bd);
    in.aimX = best->x; in.aimY = best->y;
    in.fire = true;
    in.mg = dist < 220;
    in.throttle = dist < 160 ? -0.6 : 0; // hold the line, keep some distance
    in.turn = 0;
  } else {
    in.aimX = p.x + std::cos(p.a) * 100; in.aimY = p.y + std::sin(p.a) * 100;
    in.throttle = !atFlag && std::abs(d) < 0.8 ? 1 : 0;
    in.turn = atFlag ? 0 : std::max(-1.0, std::min(1.0, d * 2));
  }
  // Stuck against something (a wreck in a gap, a hedge): shoot our way through,
  // like a player would. State is per game (reset when a battle starts).
  static const Game* who = nullptr;
  static double lastX, lastY;
  static int lastT, breachT;
  if (who != &game || game.tick < lastT) { who = &game; lastX = p.x; lastY = p.y; lastT = game.tick; breachT = 0; }
  if (game.tick - lastT >= 180) {
    bool stuck = in.throttle > 0.5 && std::hypot(p.x - lastX, p.y - lastY) < 6;
    if (stuck) breachT = 150;
    lastX = p.x; lastY = p.y; lastT = game.tick;
  }
  if (breachT > 0 && !best) {
    breachT--;
    in.aimX = p.x + std::cos(p.a) * 45; in.aimY = p.y + std::sin(p.a) * 45;
    in.fire = true;
    in.throttle = breachT > 100 ? -0.6 : 0; // back off a little so the blast doesn't hit us
  }
  return in;
}

// Out-of-input actions for the careful bot: repairs and smoke.
inline void carefulBotManage(Game& game) {
  Tank& p = *game.player;
  if (!p.alive || game.tick % 30) return;
  static const Part watch[5] = {ENGINE, TRACK_L, TRACK_R, CANNON, HULL};
  for (Part k : watch) if (p.parts[k].hp <= 0 && k != HULL) { game.emergencyRepair(); break; }
  Part worst = HULL;
  for (Part k : watch) if (p.frac(k) < p.frac(worst)) worst = k;
  if (p.frac(worst) < 0.85 && game.crew[0] != worst && game.crew[1] != worst) game.assignCrew(worst);
  if (p.frac(HULL) < 0.4 && p.hurtT > 150) game.throwSmoke();
}
