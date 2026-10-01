// Headless render of a game frame to PNG.
// Run: maki_snapshot out.png [ticks] [seed]
#include <cstdlib>
#include <vector>
#include "raylib.h"
#include "../src/core/compose.h"
#include "sim.h"

int main(int argc, char** argv) {
  const char* out = argc > 1 ? argv[1] : "snapshot.png";
  int TICKS = argc > 2 ? std::atoi(argv[2]) : 300;
  uint32_t seed = argc > 3 ? (uint32_t)std::atoll(argv[3]) : 12345;
  seedRnd(seed * 2654435761u);
  enableFastFloats();
  Game game(seed);
  for (int i = 0; i < TICKS; i++) game.update(botInput(game));
  std::vector<uint32_t> frame((size_t)VIEW_W * VIEW_H);
  Composer(game.grid).compose(game, frame.data(), (int)jsround(game.cam.x), (int)jsround(game.cam.y));
  Image img{frame.data(), VIEW_W, VIEW_H, 1, PIXELFORMAT_UNCOMPRESSED_R8G8B8A8};
  Image big = ImageCopy(img);
  ImageResizeNN(&big, VIEW_W * 2, VIEW_H * 2);
  ExportImage(big, out);
  UnloadImage(big);
}
