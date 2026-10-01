#pragma once
#include <cstdint>

// Cell materials. Static solids only change on damage events.
namespace M {
enum : uint8_t {
  EMPTY = 0,   // bare ground
  BRICK = 1,
  STONE = 2,
  RUBBLE = 3,  // settled debris: walkable, tanks plow through it
  WOOD = 4,    // crates, flammable
  SPARK = 5,   // particle-only
  BARREL = 6,  // explosive fuel drum, data = barrel id
  WRECK = 7,   // destroyed tank hull, becomes cover
  EMBER = 8,   // particle-only, burning, ignites what it touches
  GRASS = 9,   // tall grass: walkable, crushed by tanks, burns in racing fronts
  HEDGE = 10,  // hedgerows, bushes, tree canopies: solid foliage, flammable
  HAY = 11,    // hay bales: solid, very flammable
  SAND = 12,   // sandbags: solid, soft, soak up blasts, spill into rubble
};
}

inline constexpr uint8_t MAT_HP[13] = {0, 3, 8, 1, 4, 0, 2, 6, 0, 1, 2, 2, 5};
inline constexpr uint8_t SOLID[13] = {0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 1};
inline constexpr uint8_t FLAMMABLE[13] = {0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 0};

// Chance that a destroyed cell of this material becomes a flying debris particle.
inline constexpr float DEBRIS_CHANCE[13] = {0, 0.55f, 0.7f, 0.25f, 0.5f, 0, 0.4f, 0.6f, 0, 0, 0.3f, 0.4f, 0.2f};

// Floor ids (colored by palette). Tile ids are for indoor biomes.
namespace F {
enum : uint8_t {
  TILE_A = 0, TILE_B, LINE, DOT, CRACK, TRACK,
  GROUND, GROUND2, FURROW, ROAD, RUT, FLAT, PEBBLE,
};
}
