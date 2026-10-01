#pragma once
#include <map>
#include <string>
#include <vector>
#include "game.h"
#include "raylib.h"

// Tactical map: a paused, schematic view of the whole battlefield where the
// player selects squads and gives orders. Drawn in screen pixels over the
// stage; the simulation is frozen while it is open.
struct TacInput {
  Vector2 mouse;                 // screen pixels, relative to the stage
  std::vector<char> pressed;     // layout-aware one-shot keys this tick
  bool shift = false, ctrl = false;
  struct Click { int b; bool shift, ctrl; };
  std::vector<Click> clicks;
};

struct TacMap {
  bool open = false;
  int sel = -1;                  // selected squad id
  std::string flash;             // feedback line
  int flashT = 0;
  Vector2 mouse{0, 0};
  std::map<int, Vector2> tags;   // squad id -> tag centre, as last drawn (click target)
  float u = 1;                   // screen pixels per cell
  float W = 0, H = 0;            // stage size in pixels

  void unload();
  void resize(float w, float h, float scale) { W = w; H = h; u = scale; }
  void toggle(Game& game);
  void handleInput(Game& game, const TacInput& in);
  void draw(Game& game, Vector2 stageOrigin);

 private:
  Texture2D terrain{};
  Texture2D fog{};
  bool hasTex = false;
  struct Layout { float ms, x0, y0, mw, mh; };
  Layout layout() const;
  bool toWorld(float px, float py, double& wx, double& wy) const;
  void say(const std::string& t) { flash = t; flashT = 120; }
  const Squad* squadAt(Game& game, float px, float py);
  void buildTerrain(Game& game);
  void buildFog(Game& game);
  void drawPath(Game& game, const Squad& q, const Layout& L, Vector2 o);
  void drawSquadTag(const Squad& q, const Layout& L, Vector2 o, std::vector<Rectangle>& placed);
  void drawFlag(const Flag& f, const Layout& L, Vector2 o, int tick);
  void tankIcon(float x, float y, double a, float r, const Color* fill, Color stroke);
  void drawPanel(Game& game, Vector2 o);
};
