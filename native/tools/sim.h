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
