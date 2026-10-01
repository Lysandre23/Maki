#include "tacmap.h"
#include <algorithm>
#include <cmath>
#include "draw.h"

using namespace draw;

static constexpr int DS = 4; // world cells per schematic pixel
static const Color YELLOW_C = hex(0xffd21e), ALLY_C = hex(0x3c8cff), RED_C = hex(0xff2d2d), INK = BLACK;

static const char* orderName(const std::string& o) {
  if (o == "follow") return "FOLLOW";
  if (o == "move") return "MOVE";
  if (o == "attack") return "ATTACK";
  return "HOLD";
}

static std::string upper(std::string s) { for (auto& c : s) c = (char)toupper(c); return s; }

static Color tone(uint8_t m) {
  switch (m) {
    case M::RUBBLE: return {0xb3, 0xab, 0x99, 255};
    case M::GRASS: return {0xbf, 0xcb, 0x9e, 255};
    case M::HEDGE: return {0x5b, 0x77, 0x47, 255};
    case M::HAY: return {0xd9, 0xbf, 0x66, 255};
    case M::WOOD: return {0x9c, 0x7a, 0x52, 255};
    case M::BRICK: return {0x5a, 0x4c, 0x48, 255};
    case M::STONE: return {0x4a, 0x4a, 0x4a, 255};
    case M::WRECK: return {0x2a, 0x2a, 0x2a, 255};
    case M::BARREL: return {0x8a, 0x5a, 0x30, 255};
    default: return {0xdb, 0xd5, 0xc3, 255};
  }
}
// what wins a 4x4 block: solids first, so thin hedgerows and walls survive the downscale
static const uint8_t SOLID_FIRST[7] = {M::STONE, M::BRICK, M::WRECK, M::WOOD, M::BARREL, M::HAY, M::HEDGE};

void TacMap::unload() {
  if (hasTex) { UnloadTexture(terrain); UnloadTexture(fog); hasTex = false; }
}

void TacMap::toggle(Game& game) {
  open = !open;
  if (!open) return;
  buildTerrain(game);
  buildFog(game);
  if (!game.squad(sel)) {
    sel = -1;
    for (auto& q : game.squads) if (!q->alive().empty()) { sel = q->id; break; }
  }
}

// Flat-tone schematic; fires are baked in (sim is paused).
void TacMap::buildTerrain(Game& game) {
  const Grid& grid = game.grid;
  int w = (ROOM_W + DS - 1) / DS, h = (ROOM_H + DS - 1) / DS;
  Image img = GenImageColor(w, h, BLANK);
  Color* px = (Color*)img.data;
  std::vector<uint8_t> burning((size_t)w * h, 0);
  for (int i : game.flames.list) {
    int x = i % grid.w, y = i / grid.w;
    burning[(y / DS) * w + (x / DS)] = 1;
  }
  for (int j = 0; j < h; j++) {
    for (int i = 0; i < w; i++) {
      int best = -1, rank = 99, grass = 0, rubble = 0;
      for (int y = j * DS; y < j * DS + DS && y < grid.h; y++) {
        for (int x = i * DS; x < i * DS + DS && x < grid.w; x++) {
          uint8_t m = grid.mat[y * grid.w + x];
          int r = (int)(std::find(SOLID_FIRST, SOLID_FIRST + 7, m) - SOLID_FIRST);
          if (r < 7 && r < rank) { rank = r; best = m; }
          else if (m == M::GRASS) grass++;
          else if (m == M::RUBBLE) rubble++;
        }
      }
      if (best < 0) best = grass >= 6 ? M::GRASS : rubble >= 6 ? M::RUBBLE : M::EMPTY;
      px[j * w + i] = burning[j * w + i] ? Color{0xff, 0x8a, 0x1c, 255} : tone((uint8_t)best);
    }
  }
  if (hasTex) UnloadTexture(terrain);
  terrain = LoadTextureFromImage(img);
  SetTextureFilter(terrain, TEXTURE_FILTER_POINT);
  UnloadImage(img);
}

// Fog: clear where we see now, light veil where explored, dark elsewhere.
void TacMap::buildFog(Game& game) {
  const Vision& v = game.vision;
  Image img = GenImageColor(v.w, v.h, BLANK);
  Color* px = (Color*)img.data;
  for (int n = 0; n < v.w * v.h; n++) {
    bool vis = v.tick - v.seen[n] <= 12;
    px[n] = Color{0, 0, 0, (unsigned char)(vis ? 0 : v.ever[n] ? 60 : 130)};
  }
  if (hasTex) UnloadTexture(fog);
  fog = LoadTextureFromImage(img);
  SetTextureFilter(fog, TEXTURE_FILTER_BILINEAR);
  UnloadImage(img);
  hasTex = true;
}

TacMap::Layout TacMap::layout() const {
  float top = 30 * u, bottom = 70 * u, side = 14 * u;
  float ms = std::min((W - side * 2) / ROOM_W, (H - top - bottom) / ROOM_H);
  float mw = ROOM_W * ms, mh = ROOM_H * ms;
  return {ms, (W - mw) / 2, top + (H - top - bottom - mh) / 2, mw, mh};
}

bool TacMap::toWorld(float px, float py, double& wx, double& wy) const {
  Layout L = layout();
  wx = (px - L.x0) / L.ms; wy = (py - L.y0) / L.ms;
  return wx >= 0 && wy >= 0 && wx < ROOM_W && wy < ROOM_H;
}

void TacMap::handleInput(Game& game, const TacInput& in) {
  mouse = in.mouse;
  auto pressed = [&](char c) { return std::find(in.pressed.begin(), in.pressed.end(), c) != in.pressed.end(); };
  for (int k = 1; k <= 4; k++) if (pressed((char)('0' + k)) && game.squad(k - 1)) sel = k - 1;
  Squad* sq = game.squad(sel);
  double wx, wy;
  bool onMap = toWorld(mouse.x, mouse.y, wx, wy);
  for (const auto& c : in.clicks) {
    if (c.b == 0) { if (const Squad* hit = squadAt(game, mouse.x, mouse.y)) sel = hit->id; }
    else if (c.b == 1 && sq && onMap) {
      std::string order = c.ctrl || in.ctrl ? "hold" : c.shift || in.shift ? "attack" : "move";
      game.orderSquad(sq->id, order, true, wx, wy);
      say("SQUAD " + std::to_string(sq->id + 1) + ": " + orderName(order));
    }
  }
  sq = game.squad(sel);
  if (!sq) return;
  if (pressed('h')) { game.orderSquad(sq->id, "hold"); say("SQUAD " + std::to_string(sq->id + 1) + ": HOLD HERE"); }
  if (pressed('f')) { game.orderSquad(sq->id, "follow"); say("SQUAD " + std::to_string(sq->id + 1) + ": FOLLOW ME"); }
  if (pressed('s')) { game.toggleStance(sq->id); say("SQUAD " + std::to_string(sq->id + 1) + ": " + upper(sq->stance)); }
}

const Squad* TacMap::squadAt(Game& game, float px, float py) {
  Layout L = layout();
  const Squad* best = nullptr;
  float bd = 16 * u;
  for (auto& q : game.squads) {
    auto live = q->alive();
    for (Tank* t : live) {
      float d = std::hypot(L.x0 + (float)t->x * L.ms - px, L.y0 + (float)t->y * L.ms - py);
      if (d < bd) { bd = d; best = q.get(); }
    }
    auto it = tags.find(q->id);
    if (it == tags.end() || live.empty()) continue;
    float d = std::hypot(it->second.x - px, it->second.y - py); // its tag, as last drawn
    if (d < bd) { bd = d; best = q.get(); }
  }
  return best;
}

// ---------------------------------------------------------------- draw

void TacMap::tankIcon(float x, float y, double a, float r, const Color* fill, Color stroke) {
  float c = (float)std::cos(a), s = (float)std::sin(a);
  auto P = [&](float px, float py) { return Vector2{x + px * c - py * s, y + px * s + py * c}; };
  std::vector<Vector2> pts = {P(r * 1.3f, 0), P(-r, -r * 0.85f), P(-r * 0.55f, 0), P(-r, r * 0.85f)};
  if (fill) fillPolygon(pts, P(0, 0), *fill);
  strokePolygon(pts, 0.8f * u, stroke);
}

void TacMap::drawFlag(const Flag& f, const Layout& L, Vector2 o, int tick) {
  float x = o.x + L.x0 + (float)f.x * L.ms, y = o.y + L.y0 + (float)f.y * L.ms, r = (float)f.r * L.ms;
  dashedCircle({x, y}, r, 0.8f * u, 3 * u, 2 * u, -tick * 0.3f, f.contested ? RED_C : YELLOW_C);
  if (f.progress > 0) arc({x, y}, r, (float)-kPI / 2, (float)(-kPI / 2 + f.progress * kPI * 2), 2 * u, ALLY_C);
  // pennant
  line({x, y + 5 * u}, {x, y - 9 * u}, 1 * u, INK);
  std::vector<Vector2> pen = {{x, y - 9 * u}, {x + 8 * u, y - 6 * u}, {x, y - 3 * u}};
  fillPolygon(pen, {x + 2.5f * u, y - 6 * u}, YELLOW_C);
  strokePolygon(pen, 0.6f * u, INK);
}

// Route the squad will take, sampled from the nav flow field toward its goal.
void TacMap::drawPath(Game& game, const Squad& q, const Layout& L, Vector2 o) {
  auto live = q.alive();
  if (!q.hasGoal || live.empty()) return;
  Nav& nav = game.nav;
  const auto& field = nav.field(q.goal.x, q.goal.y);
  Pt c = centroid(live);
  double x = c.x, y = c.y;
  std::vector<Pt> pts = {{x, y}};
  for (int k = 0; k < 400; k++) {
    if (std::hypot(q.goal.x - x, q.goal.y - y) < 18) break;
    double d;
    if (!nav.dirAt(field, x, y, d)) break;
    x += std::cos(d) * nav.c; y += std::sin(d) * nav.c;
    if (k % 2) pts.push_back({x, y});
  }
  pts.push_back(q.goal);
  auto X = [&](double wx) { return o.x + L.x0 + (float)wx * L.ms; };
  auto Y = [&](double wy) { return o.y + L.y0 + (float)wy * L.ms; };
  bool sel_ = q.id == sel;
  Color col = alpha(ALLY_C, sel_ ? 1.f : 0.6f);
  std::vector<Vector2> sp;
  for (auto& p : pts) sp.push_back({X(p.x), Y(p.y)});
  dashedPolyline(sp, (sel_ ? 1.6f : 1.f) * u, 4 * u, 2.5f * u, col);
  // arrow head along the last segment, then the order marker
  Vector2 g = sp.back(), a0 = sp[sp.size() >= 2 ? sp.size() - 2 : 0];
  float a = std::atan2(g.y - a0.y, g.x - a0.x), r = 5 * u;
  fillPolygon({g, {g.x - std::cos(a - 0.5f) * r, g.y - std::sin(a - 0.5f) * r}, {g.x - std::cos(a + 0.5f) * r, g.y - std::sin(a + 0.5f) * r}},
              {g.x - std::cos(a) * r * 0.5f, g.y - std::sin(a) * r * 0.5f}, col);
  float lw = 1.2f * u, q4 = 4 * u;
  if (q.order == "hold") rectOutline(g.x - q4, g.y - q4, 2 * q4, 2 * q4, lw, col);
  else if (q.order == "attack") {
    line({g.x - q4, g.y - q4}, {g.x + q4, g.y + q4}, lw, RED_C);
    line({g.x + q4, g.y - q4}, {g.x - q4, g.y + q4}, lw, RED_C);
  } else arc(g, q4, 0, 6.2831853f, lw, col);
}

// Number + order + health bar floating above the squad.
void TacMap::drawSquadTag(const Squad& q, const Layout& L, Vector2 o, std::vector<Rectangle>& placed) {
  auto live = q.alive();
  if (live.empty()) return;
  Pt c = centroid(live);
  bool sel_ = q.id == sel;
  std::string label = std::to_string(q.id + 1) + " " + orderName(q.order) + (q.stance == "cautious" ? " (C)" : "");
  float fs = 8 * u;
  float w = textWidth(label, fs) + 8 * u, h = 11 * u;
  // kept inside the map frame
  float x = std::max(L.x0 + w / 2 + 2 * u, std::min(L.x0 + L.mw - w / 2 - 2 * u, L.x0 + (float)c.x * L.ms));
  float y = std::max(L.y0 + h / 2 + 2 * u, L.y0 + (float)c.y * L.ms - 14 * u);
  // squads standing together: stack their tags instead of overlapping
  auto overlaps = [&]() {
    for (auto& r : placed) if (std::abs(r.x - x) < (r.width + w) / 2 && std::abs(r.y - y) < h + 3 * u) return true;
    return false;
  };
  while (overlaps()) y += h + 4 * u;
  placed.push_back({x, y, w, h});
  tags[q.id] = {x, y};
  float sx = o.x + x, sy = o.y + y;
  DrawRectangleRec({sx - w / 2, sy - h / 2, w, h}, ALLY_C);
  rectOutline(sx - w / 2, sy - h / 2, w, h, (sel_ ? 2.f : 1.f) * u, sel_ ? YELLOW_C : INK);
  text(label, sx, sy + 0.5f * u, fs, WHITE, CENTER, MIDDLE);
  // health: mean hull of the living members
  double hp = 0;
  for (Tank* t : live) hp += t->frac(HULL);
  hp /= live.size();
  DrawRectangleRec({sx - w / 2, sy + h / 2, w, 3 * u}, INK);
  DrawRectangleRec({sx - w / 2, sy + h / 2, w * (float)hp, 3 * u}, hp < 0.4 ? hex(0xff8a1c) : WHITE);
}

// Squad cards + controls along the bottom.
void TacMap::drawPanel(Game& game, Vector2 o) {
  float y = o.y + H - 62 * u;
  float x = o.x + 14 * u;
  for (auto& q : game.squads) {
    auto live = q->alive();
    float w = 120 * u;
    bool sel_ = q->id == sel;
    DrawRectangleRec({x, y, w, 34 * u}, live.empty() ? hex(0x222222) : sel_ ? hex(0x1d3f73) : hex(0x14223a));
    rectOutline(x, y, w, 34 * u, (sel_ ? 2.f : 1.f) * u, sel_ ? YELLOW_C : ALLY_C);
    text("[" + std::to_string(q->id + 1) + "] SQUAD " + std::to_string(q->id + 1), x + 5 * u, y + 3 * u, 10 * u, sel_ ? YELLOW_C : WHITE);
    text(live.empty() ? "WIPED OUT" : std::string(orderName(q->order)) + " · " + upper(q->stance), x + 5 * u, y + 15 * u, 8 * u, hex(0xdddddd));
    for (size_t k = 0; k < q->tanks.size(); k++) {
      Tank* t = q->tanks[k];
      float bx = x + 5 * u + k * 28 * u, by = y + 26 * u;
      DrawRectangleRec({bx, by, 24 * u, 4 * u}, INK);
      Color c = !t->alive ? hex(0x555555) : t->frac(HULL) < 0.4 ? hex(0xff8a1c) : ALLY_C;
      DrawRectangleRec({bx, by, 24 * u * (float)(t->alive ? t->frac(HULL) : 1), 4 * u}, c);
    }
    x += w + 8 * u;
  }
  const char* lines[2] = {
    "1-4 / CLICK SELECT SQUAD · RIGHT CLICK MOVE · SHIFT+RIGHT ATTACK · CTRL+RIGHT HOLD THERE",
    "H HOLD HERE · F FOLLOW ME · S STANCE (AGGRESSIVE / CAUTIOUS) · TAB / M BACK TO BATTLE",
  };
  for (int i = 0; i < 2; i++) text(lines[i], o.x + W - 14 * u, y + 6 * u + i * 12 * u, 8 * u, WHITE, RIGHT);
}

void TacMap::draw(Game& game, Vector2 o) {
  Layout L = layout();
  DrawRectangleRec({o.x, o.y, W, H}, Color{8, 8, 8, 242});

  // terrain + fog
  if (hasTex) {
    DrawTexturePro(terrain, {0, 0, (float)terrain.width, (float)terrain.height}, {o.x + L.x0, o.y + L.y0, L.mw, L.mh}, {0, 0}, 0, WHITE);
    const Vision& v = game.vision;
    DrawTexturePro(fog, {0, 0, (float)fog.width, (float)fog.height},
                   {o.x + L.x0, o.y + L.y0, v.w * VISION_NODE * L.ms, v.h * VISION_NODE * L.ms}, {0, 0}, 0, WHITE);
  }
  rectOutline(o.x + L.x0, o.y + L.y0, L.mw, L.mh, u, WHITE);

  BeginScissorMode((int)(o.x + L.x0), (int)(o.y + L.y0), (int)L.mw, (int)L.mh);
  auto X = [&](double wx) { return o.x + L.x0 + (float)wx * L.ms; };
  auto Y = [&](double wy) { return o.y + L.y0 + (float)wy * L.ms; };
  drawFlag(game.flag, L, o, game.tick);
  for (auto& q : game.squads) drawPath(game, *q, L, o);
  // known enemies: solid = seen now, faded outline = last seen
  for (const Known& k : game.vision.known) {
    float fade = (float)game.vision.fade(k);
    Color stroke = alpha(RED_C, 1 - fade * 0.8f);
    Color fill = stroke;
    tankIcon(X(k.x), Y(k.y), k.a, 4 * u, k.vis ? &fill : nullptr, stroke);
  }
  for (auto& q : game.squads) for (Tank* t : q->alive()) tankIcon(X(t->x), Y(t->y), t->a, 3.6f * u, &ALLY_C, INK);
  std::vector<Rectangle> placed;
  tags.clear();
  for (auto& q : game.squads) drawSquadTag(*q, L, o, placed);
  Tank& p = *game.player; // on top of the tags so it's never hidden
  if (p.alive) tankIcon(X(p.x), Y(p.y), p.a, 5 * u, &YELLOW_C, INK);
  EndScissorMode();

  // header
  text("TACTICAL MAP - PAUSED", o.x + 14 * u, o.y + 15 * u, 16 * u, YELLOW_C, LEFT, MIDDLE);
  if (!flash.empty()) text(flash, o.x + W - 14 * u, o.y + 15 * u, 16 * u, WHITE, RIGHT, MIDDLE);
  drawPanel(game, o);

  // cursor
  float r = 6 * u;
  Vector2 m{o.x + mouse.x, o.y + mouse.y};
  line({m.x - r, m.y}, {m.x + r, m.y}, 2.4f * u, INK);
  line({m.x, m.y - r}, {m.x, m.y + r}, 2.4f * u, INK);
  line({m.x - r, m.y}, {m.x + r, m.y}, 1 * u, YELLOW_C);
  line({m.x, m.y - r}, {m.x, m.y + r}, 1 * u, YELLOW_C);
  if (!flash.empty() && --flashT <= 0) flash.clear();
}
