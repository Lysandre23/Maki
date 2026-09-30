// Global constants. Everything is in "cells" (1 cell = 1 internal pixel).

export const VIEW_W = 640;
export const VIEW_H = 360;

export const CHUNK_SHIFT = 6;
export const CHUNK = 1 << CHUNK_SHIFT; // 64x64 cells per chunk

// Room size, must be multiples of CHUNK. Camera scrolls inside it.
export const ROOM_W = 960;
export const ROOM_H = 576;

export const ROOMS = 10;

export const TICK = 1 / 60;
export const MAX_DEBRIS = 8000;

// Debris outside camera rect + this margin settles instantly instead of simulating.
export const ACTIVE_MARGIN = 96;

// Gas (smoke/fire/steam) solver runs at 1/GAS_SCALE resolution.
export const GAS_SCALE = 4;
