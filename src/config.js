// Global constants. Everything is in "cells" (1 cell = 1 internal pixel).

// View size in cells. Live bindings: main.js picks them from the window size
// (integer pixel scale, no black bars), so never cache them at module load.
export let VIEW_W = 640;
export let VIEW_H = 360;
// The view must stay inside the gas window (GAS_WIN_*) with some slack.
export const VIEW_MAX_W = 896;
export const VIEW_MAX_H = 544;
export function setView(w, h) { VIEW_W = w; VIEW_H = h; }

export const CHUNK_SHIFT = 6;
export const CHUNK = 1 << CHUNK_SHIFT; // 64x64 cells per chunk

// Battlefield size, must be multiples of CHUNK. Wide: you push left to right.
export const ROOM_W = 2560;
export const ROOM_H = 896;

export const BATTLES = 7;

export const TICK = 1 / 60;
export const MAX_DEBRIS = 8000;

// Debris outside camera rect + this margin settles instantly instead of simulating.
export const ACTIVE_MARGIN = 96;

// Gas (smoke/fire/steam) solver runs at 1/GAS_SCALE resolution, only inside a
// window that follows the camera (the whole battlefield would be too costly).
export const GAS_SCALE = 4;
export const GAS_WIN_W = 1024;
export const GAS_WIN_H = 640;

// 3/4 view: rows of front face shown at the foot of each wall, and how far
// walls cast their shadow. Both affect neighbouring chunks when walls change.
export const WALL_FACE = 5;
export const SHADOW_LEN = 8;
