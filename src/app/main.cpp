// MAKI: native window, fixed-step loop, input, and presentation.
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <string>
#include <vector>
#include "compose.h"
#include "draw.h"
#include "game.h"
#include "hud.h"
#include "overlay.h"
#include "raylib.h"
#include "tacmap.h"
#include "../../tools/sim.h"

// raylib bundles GLFW; its key names follow the active keyboard layout, so
// letter shortcuts work on AZERTY and QWERTY alike (raylib KEY_* == GLFW keys).
extern "C" const char* glfwGetKeyName(int key, int scancode);

namespace {

// Rolling performance stats shown in the HUD.
struct Perf {
  static constexpr int N = 120;
  float frames[N] = {};
  int i = 0;
  double update = 0, render = 0;
  void record(double frameMs, double updateMs, double renderMs) {
    frames[i++ % N] = (float)frameMs;
    update += (updateMs - update) * 0.1;
    render += (renderMs - render) * 0.1;
  }
  PerfStats summary() const {
    double sum = 0, mx = 0;
    for (float f : frames) { sum += f; mx = std::max(mx, (double)f); }
    double avg = sum / N;
    return {avg > 0 ? 1000 / avg : 0, avg, mx, update, render};
  }
};

// Letter keys by what they type in the current layout (AZERTY 'm' is the
// QWERTY ';' key). Movement stays positional: WASD = ZQSD physically.
struct Keys {
  std::vector<std::pair<int, char>> letters; // raylib key -> typed char
  void init() {
    std::vector<int> printable = {KEY_APOSTROPHE, KEY_COMMA, KEY_MINUS, KEY_PERIOD, KEY_SLASH, KEY_SEMICOLON, KEY_EQUAL,
                                  KEY_LEFT_BRACKET, KEY_BACKSLASH, KEY_RIGHT_BRACKET, KEY_GRAVE};
    for (int k = KEY_A; k <= KEY_Z; k++) printable.push_back(k);
    for (int k : printable) {
      const char* n = glfwGetKeyName(k, 0);
      if (n && n[0] && !n[1]) letters.push_back({k, (char)std::tolower((unsigned char)n[0])});
    }
  }
  // One-shot presses this frame, as typed chars (no key repeat).
  void collect(std::vector<char>& out) const {
    for (auto& [k, c] : letters) if (IsKeyPressed(k)) out.push_back(c);
    for (int d = 0; d < 9; d++) if (IsKeyPressed(KEY_ONE + d) || IsKeyPressed(KEY_KP_1 + d)) out.push_back((char)('1' + d));
  }
};

struct App {
  Game game;
  Composer composer{game.grid};
  Overlay overlay;
  Hud hud;
  TacMap tac;
  Keys keys;
  Perf perf;
  std::vector<uint32_t> frame;
  Texture2D tex{};
  bool hasTex = false;
  int scale = 1;
  Vector2 origin{0, 0};      // stage top-left on screen (may be slightly negative)
  bool paused = false;
  // input gathered between ticks
  std::vector<char> pressed;
  bool spacePressed = false, tabPressed = false, escPressed = false, f3Pressed = false;
  std::vector<TacInput::Click> clicks;
  bool lmbBlocked = false;   // press started on a HUD row: don't fire
  int lastW = 0, lastH = 0;
  explicit App(uint32_t seed) : game(seed) {}
  // --autotest: the bot plays, the script opens the map, gives orders and
  // takes screenshots (dev check without a human at the keyboard)
  bool autotest = false;
  int frameNo = 0;

  // Integer pixel scale, and a view that follows the window so the game
  // fills it: about 400 rows tall, capped so the view stays inside the gas
  // window. The stage may overhang the window by less than one cell.
  void resize() {
    int dw = GetRenderWidth(), dh = GetRenderHeight();
    if (dw == lastW && dh == lastH) return;
    lastW = dw; lastH = dh;
    int s = std::max(1, (int)jsround(dh / 400.0));
    while ((dw + s - 1) / s > VIEW_MAX_W || (dh + s - 1) / s > VIEW_MAX_H) s++;
    int w = (dw + s - 1) / s, h = (dh + s - 1) / s;
    setView(w, h);
    scale = s;
    origin = {(dw - w * s) / 2.f, (dh - h * s) / 2.f};
    frame.assign((size_t)w * h, 0);
    if (hasTex) UnloadTexture(tex);
    Image img{frame.data(), w, h, 1, PIXELFORMAT_UNCOMPRESSED_R8G8B8A8};
    tex = LoadTextureFromImage(img);
    SetTextureFilter(tex, TEXTURE_FILTER_POINT);
    hasTex = true;
    tac.resize((float)(w * s), (float)(h * s), (float)s);
    hud.W = (float)(w * s); hud.H = (float)(h * s);
    hud.o = origin;
    hud.k = std::max(0.75f, std::min(3.f, dh / 860.f));
  }

  Vector2 mouseView() const { // mouse in view cells
    Vector2 m = GetMousePosition();
    return {(m.x - origin.x) / scale, (m.y - origin.y) / scale};
  }
  bool has(char c) const { return std::find(pressed.begin(), pressed.end(), c) != pressed.end(); }

  void gatherInput() {
    keys.collect(pressed);
    spacePressed |= IsKeyPressed(KEY_SPACE);
    tabPressed |= IsKeyPressed(KEY_TAB);
    escPressed |= IsKeyPressed(KEY_ESCAPE);
    f3Pressed |= IsKeyPressed(KEY_F3);
    bool shift = IsKeyDown(KEY_LEFT_SHIFT) || IsKeyDown(KEY_RIGHT_SHIFT);
    bool ctrl = IsKeyDown(KEY_LEFT_CONTROL) || IsKeyDown(KEY_RIGHT_CONTROL);
    for (int b : {MOUSE_BUTTON_LEFT, MOUSE_BUTTON_RIGHT}) {
      if (!IsMouseButtonPressed(b)) continue;
      // HUD: click a part to send a mechanic, click a reward card to take it
      if (b == MOUSE_BUTTON_LEFT && !tac.open) {
        if (game.state == "reward") { int c = hud.cardAt(GetMousePosition()); if (c >= 0) game.chooseReward(c); continue; }
        Part p = hud.partAt(GetMousePosition());
        if (p != NO_PART) { game.assignCrew(p); lmbBlocked = true; continue; }
      }
      clicks.push_back({b, shift, ctrl});
    }
    if (IsMouseButtonReleased(MOUSE_BUTTON_LEFT)) lmbBlocked = false;
    if (IsKeyPressed(KEY_F11) || ((IsKeyDown(KEY_LEFT_ALT) || IsKeyDown(KEY_RIGHT_ALT)) && IsKeyPressed(KEY_ENTER))) ToggleBorderlessWindowed();
  }

  void clearInput() {
    pressed.clear();
    clicks.clear();
    spacePressed = tabPressed = escPressed = f3Pressed = false;
  }

  void tick() {
    // Tactical map: freezes the battle and takes over the keyboard and mouse.
    bool mapKey = tabPressed || has('m');
    bool closing = tac.open && (mapKey || escPressed || game.state != "play");
    if (closing || (!tac.open && mapKey && game.state == "play" && !paused)) tac.toggle(game);
    if (tac.open || closing) {
      if (tac.open) {
        TacInput in;
        Vector2 m = GetMousePosition();
        in.mouse = {m.x - origin.x, m.y - origin.y};
        in.pressed = pressed;
        in.shift = IsKeyDown(KEY_LEFT_SHIFT) || IsKeyDown(KEY_RIGHT_SHIFT);
        in.ctrl = IsKeyDown(KEY_LEFT_CONTROL) || IsKeyDown(KEY_RIGHT_CONTROL);
        in.clicks = clicks;
        tac.handleInput(game, in);
      }
      clearInput();
      return;
    }
    if (has('p') || escPressed) paused = !paused;
    if (f3Pressed) hud.showPerf = !hud.showPerf;
    if (has('o')) overlay.showOrders = !overlay.showOrders;
    if (has('r') && (game.state == "dead" || game.state == "win")) game.newRun();
    if (game.state == "reward") {
      for (int n = 0; n < 3; n++) if (has((char)('1' + n))) game.chooseReward(n);
    } else if (!paused) {
      for (int i = 0; i < NPARTS; i++) if (has((char)('1' + i))) game.assignCrew(PARTS[i]);
      if (has('e')) game.emergencyRepair();
      if (has('c')) game.cyclePower();
      if (spacePressed) game.throwSmoke();
    }
    clearInput();
    if (paused) return;

    if (autotest) { game.update(botInput(game)); return; }
    auto down = [](std::initializer_list<int> ks) { for (int k : ks) if (IsKeyDown(k)) return true; return false; };
    Vector2 m = mouseView();
    Input in;
    in.throttle = (down({KEY_W, KEY_UP}) ? 1 : 0) - (down({KEY_S, KEY_DOWN}) ? 1 : 0);
    in.turn = (down({KEY_D, KEY_RIGHT}) ? 1 : 0) - (down({KEY_A, KEY_LEFT}) ? 1 : 0);
    in.aimX = game.cam.x + m.x;
    in.aimY = game.cam.y + m.y;
    in.fire = IsMouseButtonDown(MOUSE_BUTTON_LEFT) && !lmbBlocked;
    in.mg = IsMouseButtonDown(MOUSE_BUTTON_RIGHT);
    game.update(in);
  }

  void render(double time) {
    double sh = game.shake;
    double jx = (rnd() - 0.5) * sh;
    double jy = (rnd() - 0.5) * sh;
    int camX = (int)jsround(clamp(game.cam.x + jx, 0, ROOM_W - VIEW_W));
    int camY = (int)jsround(clamp(game.cam.y + jy, 0, ROOM_H - VIEW_H));
    composer.compose(game, frame.data(), camX, camY);
    UpdateTexture(tex, frame.data());

    BeginDrawing();
    ClearBackground(BLACK);
    DrawTexturePro(tex, {0, 0, (float)VIEW_W, (float)VIEW_H}, {origin.x, origin.y, (float)(VIEW_W * scale), (float)(VIEW_H * scale)}, {0, 0}, 0, WHITE);
    Camera2D cam{};
    cam.offset = origin;
    cam.zoom = (float)scale;
    BeginMode2D(cam);
    overlay.draw(game, mouseView(), camX, camY);
    EndMode2D();
    hud.draw(game, perf.summary(), time);
    if (tac.open) tac.draw(game, origin);
    EndDrawing();

    // OS cursor only on the menus; in battle and on the map we draw our own
    bool menu = game.state == "reward" || game.state == "dead" || game.state == "win";
    if (menu && IsCursorHidden()) ShowCursor();
    else if (!menu && !IsCursorHidden()) HideCursor();
  }
};

} // namespace

// Scripted run for --autotest: returns false when done.
static bool autotestStep(App& app) {
  int f = ++app.frameNo;
  Game& g = app.game;
  auto shot = [](const char* name) { TakeScreenshot(name); };
  if (f == 90) shot("auto-1-battle.png");
  if (f == 100) app.tac.toggle(g);
  if (f == 102) {
    Tank& p = *g.player;
    g.orderSquad(0, "move", true, p.x + 500, p.y - 150);
    g.orderSquad(1, "attack", true, p.x + 700, p.y + 120);
    g.toggleStance(1);
    app.tac.sel = 1;
  }
  if (f == 110) shot("auto-2-map.png");
  if (f == 112) app.tac.toggle(g);
  if (f == 400) shot("auto-3-orders.png");
  if (f == 420) { g.orderSquad(0, "follow"); g.orderSquad(1, "follow"); }
  if (g.state == "dead") { TraceLog(LOG_WARNING, "AUTOTEST: player died at frame %d", f); shot("auto-4-dead.png"); return false; }
  if (g.state == "reward" && app.frameNo > 0) {
    static int seen = 0;
    if (++seen == 30) shot("auto-4-reward.png");
    if (seen == 32) return false;
  }
  if (f >= 20000) TraceLog(LOG_WARNING, "AUTOTEST: timeout, state %s", g.state.c_str());
  return f < 20000;
}

int main(int argc, char** argv) {
  bool autotest = false;
  int winW = 0, winH = 0;
  for (int i = 1; i < argc; i++) {
    if (!std::strcmp(argv[i], "--autotest")) autotest = true;
    else if (!std::strcmp(argv[i], "--size") && i + 1 < argc) std::sscanf(argv[++i], "%dx%d", &winW, &winH);
  }
  seedRnd(autotest ? 777u : (uint32_t)std::chrono::steady_clock::now().time_since_epoch().count());
  enableFastFloats();
  SetTraceLogLevel(LOG_WARNING);
  SetConfigFlags(FLAG_WINDOW_RESIZABLE | (autotest ? 0 : FLAG_VSYNC_HINT));
  InitWindow(1280, 720, "MAKI");
  SetExitKey(KEY_NULL);
  int mon = GetCurrentMonitor();
  int mw = GetMonitorWidth(mon), mh = GetMonitorHeight(mon);
  if (!winW) { winW = mw * 4 / 5; winH = mh * 4 / 5; }
  SetWindowSize(winW, winH);
  SetWindowPosition((mw - winW) / 2, (mh - winH) / 2);
  draw::loadFonts();

  {
    App app(autotest ? 777u : (uint32_t)std::time(nullptr) * 2654435761u);
    app.autotest = autotest;
    app.keys.init();
    app.resize();
    using clk = std::chrono::steady_clock;
    auto last = clk::now();
    double acc = 0;
    while (!WindowShouldClose()) {
      auto now = clk::now();
      double dtMs = std::chrono::duration<double, std::milli>(now - last).count();
      last = now;
      acc += std::min(dtMs, 100.0) / 1000;
      app.resize();
      app.gatherInput();

      auto u0 = clk::now();
      int steps = 0;
      if (app.autotest) acc = TICK; // one tick per frame, as fast as possible
      while (acc >= TICK && steps < 4) { app.tick(); acc -= TICK; steps++; }
      if (steps == 4) acc = 0;
      auto u1 = clk::now();
      app.render(GetTime());
      if (app.autotest && !autotestStep(app)) break;
      auto r1 = clk::now();
      app.perf.record(dtMs, std::chrono::duration<double, std::milli>(u1 - u0).count(),
                      std::chrono::duration<double, std::milli>(r1 - u1).count());
    }
    app.tac.unload();
    if (app.hasTex) UnloadTexture(app.tex);
  }
  draw::unloadFonts();
  CloseWindow();
  return 0;
}
