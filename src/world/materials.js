// Cell materials. Static solids only change on damage events.

export const M = {
  EMPTY: 0,   // bare floor
  BRICK: 1,
  STONE: 2,
  RUBBLE: 3,  // settled debris: walkable, tanks plow through it
  WOOD: 4,    // crates, flammable
  SPARK: 5,   // particle-only
  BARREL: 6,  // explosive, data = barrel id
  WRECK: 7,   // destroyed tank hull, becomes cover
  EMBER: 8,   // particle-only, burning, ignites what it touches
  OIL: 9,     // liquid on the floor, data = depth 1..8; flows, slows tanks, burns
  ICEBIT: 10, // particle-only, ice shard
  OILDROP: 11, // particle-only, lands as an oil cell
};

export const MAT_HP = new Uint8Array([0, 3, 8, 1, 4, 0, 2, 6, 0, 1, 0, 0]);
export const SOLID = new Uint8Array([0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 0, 0]);
export const FLAMMABLE = new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]);

// Chance that a destroyed cell of this material becomes a flying debris particle.
export const DEBRIS_CHANCE = new Float32Array([0, 0.55, 0.7, 0.25, 0.5, 0, 0.4, 0.6, 0, 0, 0, 0]);
