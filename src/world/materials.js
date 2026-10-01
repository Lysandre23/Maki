// Cell materials. Static solids only change on damage events.

export const M = {
  EMPTY: 0,   // bare ground
  BRICK: 1,
  STONE: 2,
  RUBBLE: 3,  // settled debris: walkable, tanks plow through it
  WOOD: 4,    // crates, flammable
  SPARK: 5,   // particle-only
  BARREL: 6,  // explosive fuel drum, data = barrel id
  WRECK: 7,   // destroyed tank hull, becomes cover
  EMBER: 8,   // particle-only, burning, ignites what it touches
  GRASS: 9,   // tall grass: walkable, crushed by tanks, burns in racing fronts
  HEDGE: 10,  // hedgerows, bushes, tree canopies: solid foliage, flammable
  HAY: 11,    // hay bales: solid, very flammable
};

export const MAT_HP = new Uint8Array([0, 3, 8, 1, 4, 0, 2, 6, 0, 1, 2, 2]);
export const SOLID = new Uint8Array([0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1]);
export const FLAMMABLE = new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1]);

// Chance that a destroyed cell of this material becomes a flying debris particle.
export const DEBRIS_CHANCE = new Float32Array([0, 0.55, 0.7, 0.25, 0.5, 0, 0.4, 0.6, 0, 0, 0.3, 0.4]);
