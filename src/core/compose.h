#pragma once
#include <cstdint>
#include <vector>
#include "game.h"

// Colors are packed as little-endian ABGR uint32 (RGBA8 bytes in memory).
constexpr uint32_t g(uint32_t v) { return (255u << 24) | (v << 16) | (v << 8) | v; }
constexpr uint32_t rgb(uint32_t r, uint32_t gg, uint32_t b) { return (255u << 24) | (b << 16) | (gg << 8) | r; }
constexpr uint32_t C_BLACK = g(0);
constexpr uint32_t C_WHITE = g(255);

// The world is black and white. Color only carries meaning:
constexpr uint32_t C_RED = rgb(0xff, 0x30, 0x30);       // enemies
constexpr uint32_t C_ALLY = rgb(0x3c, 0x8c, 0xff);      // allies
constexpr uint32_t C_PLAYER = rgb(0x50, 0xc8, 0xff);    // the player's tank outline
constexpr uint32_t C_YELLOW = rgb(0xff, 0xd2, 0x1e);    // HUD / player pennant
constexpr uint32_t C_ORANGE = rgb(0xff, 0x8a, 0x1c);    // fire
constexpr uint32_t C_FLAME_HOT = rgb(0xff, 0xe6, 0x9a); // white-hot flame tongues

uint32_t cellColor(const Grid& grid, int x, int y);

// Builds a full frame into a uint32 buffer (VIEW_W x VIEW_H). raylib-free.
struct Composer {
  const Grid* grid;
  std::vector<std::vector<uint32_t>> chunks; // cached terrain bitmaps
  int redraws = 0;
  int tick = 0;

  explicit Composer(const Grid& grid);
  void compose(Game& game, uint32_t* frame, int camX, int camY);

 private:
  void renderChunk(int ci, int cx, int cy);
  void applyTouched(Grid& grid);
  void terrain(Grid& grid, uint32_t* frame, int camX, int camY);
  void drawFire(Game& game, uint32_t* frame, int camX, int camY);
  void drawDebris(const Debris& d, uint32_t* frame, int camX, int camY, int tick);
  void drawFlag(const Flag& f, uint32_t* frame, int camX, int camY, int tick);
  void drawScrap(Game& game, uint32_t* frame, int camX, int camY);
  void drawProjectiles(Game& game, uint32_t* frame, int camX, int camY);
  void drawGas(const Gas& gas, uint32_t* frame, int camX, int camY);
  void drawFlash(uint32_t* frame, const Flash& f, int camX, int camY);
};

void drawTank(uint32_t* frame, int camX, int camY, const Tank& t, int tick);
