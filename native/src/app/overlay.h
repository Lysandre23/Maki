#pragma once
#include "game.h"
#include "raylib.h"

// Crisp vector layer drawn over the pixel frame, in view-cell units (the
// caller sets a Camera2D that scales cells to screen pixels).
struct Overlay {
  bool showOrders = true; // faint squad order arrows in-game (O)
  void draw(Game& game, Vector2 mouse, int camX, int camY);

 private:
  void captureZone(const Flag& flag, int camX, int camY, int tick);
  void orders(Game& game, int camX, int camY);
  void offscreen(Game& game, int camX, int camY);
  void telegraph(const Tank& t, Game& game, int camX, int camY);
  void targetInfo(Game& game, Vector2 m, int camX, int camY);
  void popup(const Popup& p, int camX, int camY);
  void crosshair(const Tank& player, Vector2 m);
};
