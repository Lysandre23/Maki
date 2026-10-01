#pragma once
#include <cstdint>
#include <vector>
#include "config.h"
#include "materials.h"

// Chunked cell grid, stored as flat arrays (struct-of-arrays).
struct Grid {
  int w, h, cw, ch;
  std::vector<uint8_t> mat;     // material id
  std::vector<uint8_t> hp;      // remaining durability
  std::vector<uint8_t> data;    // visual variant / barrel id
  std::vector<uint8_t> floor;   // floor pattern id (tiles, cracks, track marks)
  std::vector<uint8_t> scorch;  // 0 none, 1 light, 2 dark
  std::vector<uint8_t> burn;    // fire life per burning cell
  std::vector<uint8_t> light;   // baked lighting, 0..255
  // bounding box of solidity changes since the nav grid last caught up
  bool hasNavBox = false;
  int navBox[4] = {0, 0, 0, 0};
  std::vector<uint16_t> structId;   // masonry structure id (wall segment, pillar)
  std::vector<int32_t> structSize;  // original cell count per structure id
  std::vector<uint8_t> dirty;       // chunk needs full redraw
  std::vector<int> touched;         // single cells to recolor (no shadow change)
  uint32_t version = 0;             // bumps whenever solidity changes (nav, gas)

  Grid(int w, int h);

  void markDirty(int x, int y);
  void navTouch(int x, int y);
  void touch(int x, int y);
  bool inBounds(int x, int y) const { return x >= 0 && y >= 0 && x < w && y < h; }
  // Out-of-bounds counts as solid so nothing leaves the world.
  bool isSolid(int x, int y) const {
    if (x < 0 || y < 0 || x >= w || y >= h) return true;
    return SOLID[mat[y * w + x]] == 1;
  }
  void setCell(int x, int y, uint8_t m, uint8_t d = 0);
};
