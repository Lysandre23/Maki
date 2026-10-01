#pragma once
// Global constants. Everything is in "cells" (1 cell = 1 internal pixel).

// View size in cells. Set by the app from the window size (integer pixel
// scale, no black bars), so never cache them.
extern int VIEW_W;
extern int VIEW_H;
// The view must stay inside the gas window (GAS_WIN_*) with some slack.
constexpr int VIEW_MAX_W = 896;
constexpr int VIEW_MAX_H = 544;
inline void setView(int w, int h) { VIEW_W = w; VIEW_H = h; }

constexpr int CHUNK_SHIFT = 6;
constexpr int CHUNK = 1 << CHUNK_SHIFT; // 64x64 cells per chunk

// Battlefield size, must be multiples of CHUNK. Wide: you push left to right.
constexpr int ROOM_W = 2560;
constexpr int ROOM_H = 896;

constexpr int BATTLES = 7;

constexpr double TICK = 1.0 / 60;
constexpr int MAX_DEBRIS = 8000;

// Debris outside camera rect + this margin settles instantly instead of simulating.
constexpr int ACTIVE_MARGIN = 96;

// Gas (smoke/fire/steam) solver runs at 1/GAS_SCALE resolution, only inside a
// window that follows the camera (the whole battlefield would be too costly).
constexpr int GAS_SCALE = 4;
constexpr int GAS_WIN_W = 1024;
constexpr int GAS_WIN_H = 640;

// 3/4 view: rows of front face shown at the foot of each wall, and how far
// walls cast their shadow. Both affect neighbouring chunks when walls change.
constexpr int WALL_FACE = 5;
constexpr int SHADOW_LEN = 8;
