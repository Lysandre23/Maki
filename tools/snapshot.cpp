// Headless render of a game frame to PNG.
// Run: maki_snapshot out.png [ticks] [seed] [full | X Y]
//   full = whole battlefield at 1 px per cell; X Y = centre the view on that world cell
#include <cstdlib>
#include <string>
#include <vector>
#include "raylib.h"
#include "../src/core/compose.h"
#include "sim.h"

int main(int argc, char** argv) {
  const char* out = argc > 1 ? argv[1] : "snapshot.png";
  int TICKS = argc > 2 ? std::atoi(argv[2]) : 300;
  uint32_t seed = argc > 3 ? (uint32_t)std::atoll(argv[3]) : 12345;
  bool full = argc > 4 && std::string(argv[4]) == "full";
  bool at = !full && argc > 5;
  seedRnd(seed * 2654435761u);
  if (full) setView(ROOM_W, ROOM_H);
  enableFastFloats();
  Game game(seed);
  for (int i = 0; i < TICKS; i++) game.update(botInput(game));
  std::vector<uint32_t> frame((size_t)VIEW_W * VIEW_H);
  int camX = (int)jsround(game.cam.x), camY = (int)jsround(game.cam.y);
  if (at) {
    camX = (int)clamp(std::atoi(argv[4]) - VIEW_W / 2, 0, ROOM_W - VIEW_W);
    camY = (int)clamp(std::atoi(argv[5]) - VIEW_H / 2, 0, ROOM_H - VIEW_H);
  }
  Composer(game.grid).compose(game, frame.data(), camX, camY);
  Image img{frame.data(), VIEW_W, VIEW_H, 1, PIXELFORMAT_UNCOMPRESSED_R8G8B8A8};
  Image big = ImageCopy(img);
  if (!full) ImageResizeNN(&big, VIEW_W * 2, VIEW_H * 2);
  ExportImage(big, out);
  UnloadImage(big);
}
