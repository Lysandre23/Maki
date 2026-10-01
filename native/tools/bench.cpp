// Headless performance run of the full game loop + frame composition (no window).
// Run: maki_bench [ticks] [seed]
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <vector>
#include "../src/core/compose.h"
#include "sim.h"

int main(int argc, char** argv) {
  int TICKS = argc > 1 ? std::atoi(argv[1]) : 1800;
  uint32_t seed = argc > 2 ? (uint32_t)std::atoll(argv[2]) : 777;
  seedRnd(seed * 2654435761u);
  enableFastFloats();
  using clk = std::chrono::steady_clock;
  auto t0 = clk::now();
  Game game(seed);
  double genMs = std::chrono::duration<double, std::milli>(clk::now() - t0).count();
  Composer composer(game.grid);
  std::vector<uint32_t> frame((size_t)VIEW_W * VIEW_H);
  double upd = 0, updMax = 0, comp = 0, compMax = 0;
  int rooms = 1, firstWin = -1;
  for (int i = 0; i < TICKS; i++) {
    if (game.state == "reward") { if (firstWin < 0) firstWin = i; game.chooseReward(0); rooms++; }
    if (game.state == "dead") { std::printf("player died at tick %d in room %d\n", i, game.level); game.newRun(); }
    auto a = clk::now();
    game.update(botInput(game));
    double dt = std::chrono::duration<double, std::milli>(clk::now() - a).count();
    upd += dt; if (dt > updMax) updMax = dt;
    a = clk::now();
    composer.compose(game, frame.data(), (int)jsround(game.cam.x), (int)jsround(game.cam.y));
    dt = std::chrono::duration<double, std::milli>(clk::now() - a).count();
    comp += dt; if (dt > compMax) compMax = dt;
  }
  std::printf("ticks %d, rooms visited %d, kills %d, first reward at tick %d\n", TICKS, rooms, game.kills, firstWin);
  auto& P = game.prof;
  std::printf("last tick: ai %.2f tanks %.2f proj %.2f fire %.2f sync %.2f gas %.2f debris %.2f other %.2f ms\n", P.ai, P.tanks, P.proj, P.fire, P.gasSync, P.gas, P.debris, P.other);
  std::printf("battle generation %.1f ms\n", genMs);
  std::printf("update  avg %.2f ms  worst %.2f ms\n", upd / TICKS, updMax);
  std::printf("compose avg %.2f ms  worst %.2f ms   (budget 16.6 ms/frame)\n", comp / TICKS, compMax);
}
