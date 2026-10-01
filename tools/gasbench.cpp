// Times the gas solver alone, per stage.
#include <chrono>
#include <cstdio>
#include "../src/core/world.h"
#include "../src/core/util.h"

template <class F> static double timeIt(F f, int n = 300) {
  auto a = std::chrono::steady_clock::now();
  for (int i = 0; i < n; i++) f();
  return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - a).count() / n;
}

int main() {
  enableFastFloats();
  Grid grid(ROOM_W, ROOM_H);
  Gas gas(ROOM_W, ROOM_H, GAS_SCALE, GAS_WIN_W, GAS_WIN_H);
  gas.syncSolid(grid);
  gas.blast(500, 300, 20, 15);
  std::printf("gas window %dx%d\n", gas.w, gas.h);
  std::printf("step       %.3f ms\n", timeIt([&] { gas.active = 1000; gas.step(); }));
  std::printf("vorticity  %.3f ms\n", timeIt([&] { gas.vorticity(); }));
  std::printf("advect x1  %.3f ms\n", timeIt([&] { gas.advect(gas.tmp, gas.smoke, gas.u, gas.v); }));
  std::printf("project    %.3f ms\n", timeIt([&] { gas.project(); }));
}
