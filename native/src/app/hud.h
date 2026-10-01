#pragma once
#include <string>
#include "game.h"
#include "raylib.h"

// Screen-space HUD and full-screen overlays (reward cards, defeat, victory),
// in screen pixels scaled by `k` (1 = the browser version's CSS pixel).
struct PerfStats { double fps, avg, max, update, render; };

struct Hud {
  float k = 1;            // ui scale
  float W = 0, H = 0;     // stage size in pixels
  Vector2 o{0, 0};        // stage origin on screen
  bool showPerf = true;
  Rectangle partRows[NPARTS]{};
  Rectangle cardRects[3]{};
  int hoverCard = -1;

  void draw(Game& game, const PerfStats& perf, double time);
  // Returns the part whose HUD row is under the mouse, or NO_PART.
  Part partAt(Vector2 m) const;
  int cardAt(Vector2 m) const;

 private:
  void topBar(Game& game);
  void squadPanel(Game& game);
  void partsPanel(Game& game, double time);
  void helpBox();
  void perfBox(Game& game, const PerfStats& perf);
  void rewardScreen(Game& game, double time);
  void endScreen(const std::string& title, Color c, const std::string& l1, const std::string& l2);
  void buildChips(Game& game, float y);
};
