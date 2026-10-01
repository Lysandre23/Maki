// Enemy reinforcement waves and the enemy commander.
//
// Waves: a squad of 2-4 tanks rolls in from the east edge every WAVE_TICKS,
// bigger in later battles and as the battle drags on; they stop once the
// flag falls.
//
// Commander (every COMMAND_TICKS): the map is cut into three lanes (north,
// middle, south). Each lane is scored by the strength of the player's side
// seen in it (weighted by how far east it has pushed) against the enemy
// strength there. Then, for the wave squads:
//   - if the flag has fewer than two defenders nearby, the squad closest to
//     it holds the flag;
//   - the others go to the lane with the strongest push: they counter-attack
//     when clearly stronger there, otherwise they hold a line in front of it.
// The dug-in defenders placed at battle start keep their posts.
#include <algorithm>
#include <cmath>
#include "game.h"

static constexpr int WAVE_TICKS = 45 * 60;
static constexpr int FIRST_WAVE_TICKS = 20 * 60; // the first one comes early: the flag is never left alone
static constexpr int COMMAND_TICKS = 180;
static constexpr int MAX_ALIVE = 14;       // + battle number
static constexpr int LANES = 3;
static constexpr double COUNTER = 1.5;   // strength ratio needed to counter-attack
static constexpr double SPOT = 560;      // a friendly is "seen" within this range of an enemy

static double worth(const Tank& t) {
  const std::string& k = t.type;
  double v = k == "player" ? 3 : k == "scout" ? 1 : k == "gunner" ? 1.5 : k == "heavy" ? 2.5 : k == "boss" ? 5 : 1;
  return v * (0.3 + 0.7 * t.frac(HULL));
}

void Game::resetWaves() { waveNo = 0; waveT = WAVE_TICKS - FIRST_WAVE_TICKS; commandT = 0; }

int Game::waveIn() const { return state == "play" ? std::max(0, WAVE_TICKS - waveT) : -1; }

void Game::updateWaves() {
  if (++waveT >= WAVE_TICKS) { waveT = 0; spawnWave(); }
  if (++commandT >= COMMAND_TICKS) { commandT = 0; command(); }
}

void Game::spawnWave() {
  // no endless pile-up: a wave only comes while the enemy is short of tanks
  int alive = 0;
  for (Tank* e : enemies) alive += e->alive;
  if (alive >= MAX_ALIVE + level) return;
  waveNo++;
  // bigger in later battles and as the battle drags on
  int n = std::min(4, 2 + (level - 1) / 2 + waveNo / 3);
  int lane = (int)std::floor(rng() * LANES);
  double laneH = (double)ROOM_H / LANES;
  double cy = laneH * (lane + 0.5);
  auto sqp = std::make_unique<Squad>();
  sqp->team = 1;
  sqp->id = 100 + waveNo;
  for (int k = 0; k < n; k++) {
    double r = rng();
    const char* type = level <= 2 ? (r < 0.45 ? "scout" : r < 0.9 ? "gunner" : "heavy") : (r < 0.3 ? "scout" : r < 0.7 ? "gunner" : "heavy");
    Pt at = snapPassable(nav, ROOM_W - 40.0, cy + (k - (n - 1) / 2.0) * 44, 12);
    auto t = std::make_unique<Tank>(type, at.x, at.y, kPI, 1);
    t->ta = kPI;
    initAI(*t, (int)enemies.size(), "attack");
    t->ai.wake = 10 + k * 8;
    t->squad = sqp.get();
    sqp->tanks.push_back(t.get());
    enemies.push_back(t.get());
    tanks.push_back(t.get());
    battleTanks.push_back(std::move(t));
  }
  enemySquads.push_back(std::move(sqp));
  const char* where[LANES] = {"NORTH", "CENTER", "SOUTH"};
  popup(std::string("ENEMY REINFORCEMENTS - ") + where[lane] + "!", player->x, player->y - 60, 14, false, true);
  command(); // give the newcomers orders right away
}

void Game::command() {
  double laneH = (double)ROOM_H / LANES;
  auto laneOf = [&](double y) { return std::clamp((int)(y / laneH), 0, LANES - 1); };
  double fStr[LANES] = {}, fX[LANES] = {}, fY[LANES] = {}, eStr[LANES] = {};
  int fN[LANES] = {};
  // what the enemy can see of us
  for (Tank* f : friendlies) {
    if (!f->alive) continue;
    bool seen = false;
    for (Tank* e : enemies) if (e->alive && sq(e->x - f->x) + sq(e->y - f->y) < SPOT * SPOT) { seen = true; break; }
    if (!seen) continue;
    int L = laneOf(f->y);
    fStr[L] += worth(*f);
    fX[L] = std::max(fX[L], f->x);
    fY[L] += f->y; fN[L]++;
  }
  for (Tank* e : enemies) if (e->alive) eStr[laneOf(e->y)] += worth(*e);

  std::vector<Squad*> live;
  for (auto& q : enemySquads) if (!q->alive().empty()) live.push_back(q.get());
  if (live.empty()) return;

  auto order = [&](Squad& q, const std::string& o, double x, double y) {
    // only re-issue when it really changes, so squads don't re-plan forever
    if (q.order == o && q.hasGoal && std::hypot(q.goal.x - x, q.goal.y - y) < 80) return;
    bool counter = o == "attack" && q.order != "attack";
    ::orderSquad(*this, q, o, true, x, y);
    if (counter) { Pt c = centroid(q.alive()); popup("COUNTER-ATTACK!", c.x, c.y - 30, 13, false, true); }
  };

  // keep the flag held
  int guards = 0;
  for (Tank* e : enemies) if (e->alive && !e->squad && std::hypot(e->x - flag.x, e->y - flag.y) < 260) guards++;
  Squad* keeper = nullptr;
  if (guards < 2) {
    double bd = 1e300;
    for (Squad* q : live) {
      Pt c = centroid(q->alive());
      double d = std::hypot(c.x - flag.x, c.y - flag.y);
      if (d < bd) { bd = d; keeper = q; }
    }
    order(*keeper, "hold", flag.x - 40, flag.y);
  }

  // the lane we push hardest
  int T = -1;
  double best = 0;
  for (int L = 0; L < LANES; L++) {
    double push = fStr[L] * (0.5 + fX[L] / ROOM_W);
    if (push > best) { best = push; T = L; }
  }
  for (Squad* q : live) {
    if (q == keeper) continue;
    if (T < 0) { // nobody seen: wait in the middle of the enemy half, own lane
      Pt c = centroid(q->alive());
      order(*q, "hold", ROOM_W * 0.72, laneH * (laneOf(c.y) + 0.5));
      continue;
    }
    double fy = fN[T] ? fY[T] / fN[T] : laneH * (T + 0.5);
    if (eStr[T] >= COUNTER * fStr[T]) order(*q, "attack", fX[T], fy);
    else order(*q, "hold", std::clamp(fX[T] + 260, ROOM_W * 0.45, flag.x - 80), fy);
  }
}
