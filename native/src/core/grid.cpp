#include "grid.h"

static constexpr size_t MAX_TOUCHED = 20000;

Grid::Grid(int w_, int h_) : w(w_), h(h_) {
  cw = (w + CHUNK - 1) / CHUNK;
  ch = (h + CHUNK - 1) / CHUNK;
  size_t n = (size_t)w * h;
  mat.assign(n, 0); hp.assign(n, 0); data.assign(n, 0); floor.assign(n, 0);
  scorch.assign(n, 0); burn.assign(n, 0); light.assign(n, 0);
  structId.assign(n, 0);
  structSize.assign(1, 0);
  dirty.assign((size_t)cw * ch, 1);
}

// A solidity change also re-colors cells around it (see palette): shadows
// are cast down-right, and a wall's front face depends on the floor below
// it. Near a chunk edge, the neighbouring chunks are invalidated too.
void Grid::markDirty(int x, int y) {
  int cx = x >> CHUNK_SHIFT, cy = y >> CHUNK_SHIFT;
  int i = cy * cw + cx;
  dirty[i] = 1;
  bool right = (x & (CHUNK - 1)) >= CHUNK - SHADOW_LEN && cx + 1 < cw;
  bool down = (y & (CHUNK - 1)) >= CHUNK - SHADOW_LEN && cy + 1 < ch;
  bool up = (y & (CHUNK - 1)) < WALL_FACE && cy > 0;
  if (right) dirty[i + 1] = 1;
  if (down) dirty[i + cw] = 1;
  if (right && down) dirty[i + cw + 1] = 1;
  if (up) dirty[i - cw] = 1;
}

void Grid::navTouch(int x, int y) {
  if (!hasNavBox) { hasNavBox = true; navBox[0] = navBox[2] = x; navBox[1] = navBox[3] = y; return; }
  if (x < navBox[0]) navBox[0] = x;
  if (y < navBox[1]) navBox[1] = y;
  if (x > navBox[2]) navBox[2] = x;
  if (y > navBox[3]) navBox[3] = y;
}

// Cheap invalidation for a single cell whose change can't affect shadows.
void Grid::touch(int x, int y) {
  if (touched.size() < MAX_TOUCHED) touched.push_back(y * w + x);
  else markDirty(x, y);
}

void Grid::setCell(int x, int y, uint8_t m, uint8_t d) {
  int i = y * w + x;
  uint8_t old = mat[i];
  mat[i] = m;
  hp[i] = MAT_HP[m];
  data[i] = d;
  if (SOLID[old] != SOLID[m]) { markDirty(x, y); version++; navTouch(x, y); }
  else touch(x, y);
}
