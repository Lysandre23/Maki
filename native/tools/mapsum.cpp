// Prints a checksum of freshly generated battlefields (parity check vs the JS version).
#include <cstdio>
#include <string>
#include "../src/core/game.h"

static unsigned fnv(const std::vector<uint8_t>& a) {
  unsigned h = 2166136261u;
  for (uint8_t v : a) { h ^= v; h *= 16777619u; }
  return h;
}

int main() {
  for (uint32_t seed : {777u, 12345u, 4242u}) {
    Game g(seed);
    std::string en;
    for (Tank* e : g.enemies) en += std::string(1, e->type[0]) + std::to_string((int)e->x) + "," + std::to_string((int)e->y) + " ";
    std::printf("%u mat %x floor %x light %x flag %g %g spawn %g %g enemies %s wind %.8f\n", seed, fnv(g.grid.mat), fnv(g.grid.floor),
                fnv(g.grid.light), g.flag.x, g.flag.y, g.player->x, g.player->y, en.c_str(), g.gas.windX);
  }
}
