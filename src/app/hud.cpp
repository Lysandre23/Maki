#include "hud.h"
#include <algorithm>
#include <cmath>
#include <map>
#include "draw.h"
#include "rlgl.h"

using namespace draw;

static const Color HUD_YELLOW = hex(0xffd21e), HUD_ALLY = hex(0x3c8cff), HUD_FIRE = hex(0xff8a1c), CARD_GOLD = hex(0xf5c542);
static const char* PART_NAMES[NPARTS] = {"HULL", "TRACK L", "TRACK R", "TURRET", "CANNON", "ENGINE", "AMMO"};

// HUD text: yellow comic lettering with an ink shadow, like the CSS text-shadow.
static void hudText(const std::string& s, float x, float y, float size, Color c, float k, Align al = LEFT) {
  text(s, x + 2 * k, y + 2 * k, size, BLACK, al);
  text(s, x, y, size, c, al, TOP, 1 * k, BLACK);
}

static std::string upper(std::string s) { for (auto& c : s) c = (char)toupper(c); return s; }

void Hud::draw(Game& game, const PerfStats& perf, double time) {
  topBar(game);
  squadPanel(game);
  partsPanel(game, time);
  helpBox();
  if (showPerf) perfBox(game, perf);
  hoverCard = -1;
  if (game.state == "reward") rewardScreen(game, time);
  else if (game.state == "dead")
    endScreen("TANK DESTROYED", HUD_FIRE, "FELL IN BATTLE " + std::to_string(game.level) + " / " + std::to_string(BATTLES) + " - " + std::to_string(game.kills) + " KILLS", "PRESS R FOR A NEW RUN");
  else if (game.state == "win")
    endScreen("VICTORY!", WHITE, "ALL " + std::to_string(BATTLES) + " BATTLES WON - " + std::to_string(game.kills) + " KILLS", "PRESS R FOR A NEW RUN");
}

void Hud::topBar(Game& game) {
  int alive = 0, allies = 0;
  for (Tank* e : game.enemies) alive += e->alive;
  for (Tank* a : game.allies) allies += a->alive;
  const Flag& f = game.flag;
  std::string flagTxt = f.contested ? "CONTESTED!" : std::to_string((int)jsround(f.progress * 100)) + "%";
  std::string s = "BATTLE " + std::to_string(game.level) + " / " + std::to_string(BATTLES) + "    ALLIES : " + std::to_string(allies) +
                  "    ENEMIES : " + std::to_string(alive) + "    KILLS : " + std::to_string(game.kills) + "    FLAG : " + flagTxt;
  int w = game.waveIn();
  if (w >= 0) {
    int sec = (w + 59) / 60;
    char buf[32];
    std::snprintf(buf, sizeof buf, "    NEXT WAVE : %d:%02d", sec / 60, sec % 60);
    s += buf;
  }
  hudText(s, o.x + 14 * k, o.y + 10 * k, 26 * k, HUD_YELLOW, k);
}

void Hud::squadPanel(Game& game) {
  float y = o.y + 42 * k;
  for (auto& q : game.squads) {
    float x = o.x + 14 * k, rowH = 19 * k;
    DrawRectangleRec({x, y + 1 * k, 15 * k, rowH - 2 * k}, HUD_ALLY);
    text(std::to_string(q->id + 1), x + 7.5f * k, y + rowH / 2, 15 * k, WHITE, CENTER, MIDDLE);
    x += 21 * k;
    for (Tank* t : q->tanks) {
      Color c = !t->alive ? hex(0x333333) : t->frac(HULL) < 0.4 ? HUD_FIRE : HUD_ALLY;
      DrawRectangleRec({x, y + rowH / 2 - 4 * k, 8 * k, 8 * k}, c);
      rectOutline(x, y + rowH / 2 - 4 * k, 8 * k, 8 * k, 1 * k, BLACK);
      x += 11 * k;
    }
    x += 5 * k;
    bool any = !q->alive().empty();
    std::string order = any ? upper(q->order) + (q->stance == "cautious" ? " \u00B7 CAUTIOUS" : "") : "WIPED OUT";
    hudText(order, x, y + 1 * k, 15 * k, WHITE, k);
    y += rowH;
  }
}

void Hud::partsPanel(Game& game, double time) {
  Tank& p = *game.player;
  float rowH = 19.5f * k;
  float top = o.y + H - 12 * k - NPARTS * rowH;
  // resources box
  auto pips = [&](float x, float y, int n, int mx) {
    for (int i = 0; i < std::max(n, mx); i++) {
      Rectangle r{x + i * 9 * k, y + 3 * k, 7 * k, 7 * k};
      if (i < n) DrawRectangleRec(r, WHITE); else rectOutline(r.x, r.y, r.width, r.height, 1 * k, WHITE);
    }
    return x + std::max(n, mx) * 9 * k;
  };
  float fs = 16 * k, bx = o.x + 14 * k, by = top - 50 * k;
  std::string l1a = "SPARES " + std::to_string((int)game.spares) + "   EMERGENCY [E] ";
  std::string l2a = "SMOKE [SPACE] ";
  std::string l2b = "   POWER [C] " + std::string(POWER[game.powerMode].name);
  float w1 = textWidth(l1a, fs) + std::max(game.emergency, 2) * 9 * k;
  float w2 = textWidth(l2a, fs) + std::max(game.smokeCharges, 3) * 9 * k + textWidth(l2b, fs);
  DrawRectangleRec({bx, by, std::max(w1, w2) + 12 * k, 42 * k}, Color{0, 0, 0, 153});
  text(l1a, bx + 6 * k, by + 3 * k, fs, WHITE);
  pips(bx + 6 * k + textWidth(l1a, fs), by + 3 * k, game.emergency, 2);
  text(l2a, bx + 6 * k, by + 22 * k, fs, WHITE);
  float px = pips(bx + 6 * k + textWidth(l2a, fs), by + 22 * k, game.smokeCharges, 3);
  text(l2b, px, by + 22 * k, fs, WHITE);

  for (int i = 0; i < NPARTS; i++) {
    Part part = PARTS[i];
    float y = top + i * rowH, x = o.x + 14 * k;
    partRows[i] = {x, y, 260 * k, rowH};
    double f = p.frac(part);
    bool dead = f <= 0, low = f > 0 && f < 0.35;
    // key
    DrawRectangleRec({x, y + 2 * k, 16 * k, rowH - 4 * k}, WHITE);
    text(std::to_string(i + 1), x + 8 * k, y + rowH / 2, 14 * k, BLACK, CENTER, MIDDLE);
    // name
    float nx = x + 24 * k;
    hudText(PART_NAMES[i], nx, y + 1 * k, 17 * k, HUD_YELLOW, k);
    if (dead) DrawRectangleRec({nx, y + rowH / 2, textWidth(PART_NAMES[i], 17 * k), 2 * k}, HUD_YELLOW);
    // bar
    float barX = nx + 78 * k, barY = y + rowH / 2 - 4.5f * k;
    DrawRectangleRec({barX + 1 * k, barY + 1 * k, 120 * k, 9 * k}, BLACK);
    DrawRectangleRec({barX, barY, 120 * k, 9 * k}, BLACK);
    DrawRectangleRec({barX, barY, 120 * k * (float)f, 9 * k}, low ? HUD_FIRE : WHITE);
    rectOutline(barX, barY, 120 * k, 9 * k, 2 * k, dead ? HUD_FIRE : WHITE);
    // mechanics on this part
    float cx = barX + 128 * k;
    bool repairing = false;
    for (int c = 0; c < 2; c++) {
      if (game.crew[c] != part) continue;
      repairing = f < 1 && game.spares > 0;
      bool blink = repairing && std::fmod(time, 0.4) < 0.2;
      DrawRectangleRec({cx, y + 3 * k, 13 * k, rowH - 6 * k}, blink ? HUD_YELLOW : BLACK);
      rectOutline(cx, y + 3 * k, 13 * k, rowH - 6 * k, 1 * k, WHITE);
      text(c == 0 ? "A" : "B", cx + 6.5f * k, y + rowH / 2, 13 * k, blink ? BLACK : WHITE, CENTER, MIDDLE);
      cx += 16 * k;
    }
  }
}

Part Hud::partAt(Vector2 m) const {
  for (int i = 0; i < NPARTS; i++) if (CheckCollisionPointRec(m, partRows[i])) return PARTS[i];
  return NO_PART;
}

void Hud::helpBox() {
  const char* lines[3] = {
    "LMB CANNON \u00B7 RMB MACHINE GUN \u00B7 SPACE SMOKE",
    "1-7 SEND MECHANIC \u00B7 E EMERGENCY PATCH \u00B7 C POWER MODE",
    "TAB TACTICAL MAP \u00B7 O SHOW ORDERS \u00B7 F11 FULLSCREEN \u00B7 TAKE THE FLAG",
  };
  float fs = 14 * k, w = 0;
  for (auto l : lines) w = std::max(w, textWidth(l, fs));
  float x = o.x + W - 12 * k, y = o.y + H - 10 * k - 3 * 18 * k - 6 * k;
  DrawRectangleRec({x - w - 16 * k, y, w + 16 * k, 3 * 18 * k + 6 * k}, Color{0, 0, 0, 153});
  for (int i = 0; i < 3; i++) text(lines[i], x - 8 * k, y + 3 * k + i * 18 * k, fs, WHITE, RIGHT);
}

void Hud::perfBox(Game& game, const PerfStats& s) {
  char buf[3][128];
  std::snprintf(buf[0], 128, "FPS %.0f  frame %.1fms (worst %.1f)", s.fps, s.avg, s.max);
  std::snprintf(buf[1], 128, "update %.2fms  render %.2fms  gas %.2fms", s.update, s.render, game.prof.gas);
  std::snprintf(buf[2], 128, "debris %d  fire %d  F3 hide", game.debris.n, (int)game.flames.list.size());
  int fs = std::max(10, (int)(12 * k));
  int w = 0;
  for (auto& b : buf) w = std::max(w, MeasureText(b, fs));
  float x = o.x + W - 12 * k, y = o.y + 10 * k;
  DrawRectangleRec({x - w - 12 * k, y, w + 12 * k, 3 * (fs + 3) + 6 * k}, Color{0, 0, 0, 166});
  for (int i = 0; i < 3; i++) DrawText(buf[i], (int)(x - 6 * k - MeasureText(buf[i], fs)), (int)(y + 3 * k + i * (fs + 3)), fs, hex(0xdddddd));
}

// ------------------------------------------------------------------ overlays

static Font g_comic;
static bool g_comicTried = false;
static const Font& comic() {
  if (!g_comicTried) {
    g_comicTried = true;
    const char* path = "C:/Windows/Fonts/comic.ttf";
    if (FileExists(path)) { g_comic = LoadFontEx(path, 48, nullptr, 0); SetTextureFilter(g_comic.texture, TEXTURE_FILTER_BILINEAR); }
    else g_comic = font();
  }
  return g_comic;
}

// Greedy word wrap.
static std::vector<std::string> wrap(const Font& f, const std::string& s, float size, float maxW) {
  std::vector<std::string> lines;
  std::string cur, word;
  auto width = [&](const std::string& t) { return MeasureTextEx(f, t.c_str(), size, 0).x; };
  auto flush = [&]() {
    if (word.empty()) return;
    std::string tryLine = cur.empty() ? word : cur + " " + word;
    if (!cur.empty() && width(tryLine) > maxW) { lines.push_back(cur); cur = word; }
    else cur = tryLine;
    word.clear();
  };
  for (char c : s) { if (c == ' ') flush(); else word += c; }
  flush();
  if (!cur.empty()) lines.push_back(cur);
  return lines;
}

static const char* tagLabel(const std::string& t) {
  if (t == "gun") return "CANNON";
  if (t == "armor") return "ARMOR";
  if (t == "move") return "MOBILITY";
  if (t == "crew") return "CREW";
  if (t == "cover") return "COVER";
  if (t == "squad") return "SQUAD";
  if (t == "objective") return "OBJECTIVE";
  return t.c_str();
}

static void title(const std::string& s, float cx, float y, float size, Color c, float k) {
  text(s, cx + 4 * k, y + 4 * k, size, BLACK, CENTER);
  text(s, cx, y, size, c, CENTER, TOP, 2 * k, BLACK);
}

void Hud::endScreen(const std::string& t, Color c, const std::string& l1, const std::string& l2) {
  DrawRectangleRec({o.x, o.y, W, H}, Color{0, 0, 0, 140});
  float cx = o.x + W / 2, cy = o.y + H / 2;
  title(t, cx, cy - 70 * k, 64 * k, c, k);
  text(l1, cx, cy + 12 * k, 22 * k, WHITE, CENTER);
  text(l2, cx, cy + 46 * k, 22 * k, WHITE, CENTER);
}

int Hud::cardAt(Vector2 m) const {
  for (int i = 0; i < 3; i++) if (cardRects[i].width > 0 && CheckCollisionPointRec(m, cardRects[i])) return i;
  return -1;
}

void Hud::rewardScreen(Game& game, double time) {
  DrawRectangleRec({o.x, o.y, W, H}, Color{0, 0, 0, 140});
  int n = (int)game.choices.size();
  float cw = 230 * k, gap = 24 * k, pad = 16 * k;
  // measure every card, then stretch them to the tallest (CSS align-items: stretch)
  struct Lay { std::vector<std::string> nameL, descL; float h; };
  std::vector<Lay> lays;
  float maxH = 0;
  for (auto& r : game.choices) {
    Lay L;
    L.nameL = wrap(font(), r.card->name, 30 * k, cw - 2 * pad);
    L.descL = wrap(comic(), r.card->desc, 15 * k, cw - 2 * pad);
    float h = 30 * k + 26 * k + L.nameL.size() * 31 * k + 8 * k + L.descL.size() * 19 * k + 10 * k + 22 * k + pad;
    if (!r.synergy.empty()) h += 30 * k;
    L.h = h;
    maxH = std::max(maxH, h);
    lays.push_back(L);
  }
  float totalW = n * cw + (n - 1) * gap;
  float buildH = game.build.empty() ? 30 * k : 64 * k;
  float blockH = 64 * k + 18 * k + 34 * k + maxH + 18 * k + buildH;
  float y0 = o.y + (H - blockH) / 2;
  float cx = o.x + W / 2;
  title("BATTLE " + std::to_string(game.level) + " WON!", cx, y0, 64 * k, WHITE, k);
  text("PICK YOUR REWARD", cx, y0 + 82 * k, 22 * k, WHITE, CENTER);
  float cy = y0 + 116 * k;
  Vector2 m = GetMousePosition();
  for (int i = 0; i < n; i++) {
    const Reward& r = game.choices[i];
    const Card& c = *r.card;
    float x = cx - totalW / 2 + i * (cw + gap);
    Rectangle rect{x, cy, cw, maxH};
    cardRects[i] = rect;
    bool hover = CheckCollisionPointRec(m, rect);
    if (hover) hoverCard = i;
    float rot = hover ? 0 : i == 1 ? 1.f : -1.5f, sc = hover ? 1.06f : 1;
    rlPushMatrix();
    rlTranslatef(x + cw / 2, cy + maxH / 2, 0);
    rlRotatef(rot, 0, 0, 1);
    rlScalef(sc, sc, 1);
    rlTranslatef(-cw / 2, -maxH / 2, 0);
    // frame by rarity
    bool epic = c.rarity == "epic", legendary = c.rarity == "legendary", rare = c.rarity == "rare";
    Color bg = epic ? hex(0x111111) : legendary ? BLACK : WHITE;
    Color ink = epic || legendary ? WHITE : BLACK;
    Color border = epic ? WHITE : legendary ? CARD_GOLD : BLACK;
    if (legendary) {
      float pulse = 22 + 12 * (0.5f + 0.5f * std::sin((float)time * 3.9f));
      for (int g = 0; g < 6; g++) DrawRectangleRec({-pulse * g / 6 * k, -pulse * g / 6 * k, cw + 2 * pulse * g / 6 * k, maxH + 2 * pulse * g / 6 * k}, alpha(CARD_GOLD, 0.08f));
    }
    DrawRectangleRec({8 * k, 8 * k, cw, maxH}, BLACK); // offset shadow
    DrawRectangleRec({-3 * k - 4 * k, -3 * k - 4 * k, cw + 14 * k, maxH + 14 * k}, epic ? BLACK : legendary ? BLACK : WHITE);
    if (epic) rectOutline(-8 * k, -8 * k, cw + 16 * k, maxH + 16 * k, 3 * k, WHITE);
    DrawRectangleRec({0, 0, cw, maxH}, bg);
    if (epic || legendary) { // halftone dots
      Color dot = epic ? hex(0x444444) : hex(0x3a2e00);
      float step = (epic ? 6 : 5) * k;
      for (float yy = step / 2; yy < maxH; yy += step) for (float xx = step / 2; xx < cw; xx += step) DrawCircleV({xx, yy}, 1 * k, dot);
    }
    if (rare) { rectOutline(-1 * k, -1 * k, cw + 2 * k, maxH + 2 * k, 2.5f * k, BLACK); rectOutline(4 * k, 4 * k, cw - 8 * k, maxH - 8 * k, 2.5f * k, BLACK); }
    else rectOutline(-2 * k, -2 * k, cw + 4 * k, maxH + 4 * k, 4 * k, border);
    // band
    bool team = c.fam == "team";
    DrawRectangleRec({0, 0, cw, 26 * k}, team ? HUD_ALLY : HUD_YELLOW);
    Color bandInk = team ? WHITE : BLACK;
    text(team ? "TEAM" : "YOUR TANK", 10 * k + 14 * k, 13 * k, 18 * k, bandInk, LEFT, MIDDLE);
    if (team) { // little flag
      DrawRectangleRec({10 * k, 6 * k, 1.5f * k, 14 * k}, bandInk);
      DrawTriangle({11.5f * k, 6 * k}, {11.5f * k, 12 * k}, {20 * k, 9 * k}, bandInk);
    } else { // diamond
      fillPolygon({{15 * k, 6 * k}, {20 * k, 13 * k}, {15 * k, 20 * k}, {10 * k, 13 * k}}, {15 * k, 13 * k}, bandInk);
    }
    text(upper(c.rarity), cw - 10 * k, 13 * k, 14 * k, team ? WHITE : BLACK, RIGHT, MIDDLE);
    // key
    float y = 36 * k;
    Color keyBg = epic ? WHITE : legendary ? CARD_GOLD : BLACK, keyInk = epic || legendary ? BLACK : WHITE;
    DrawRectangleRec({pad, y, 24 * k, 22 * k}, keyBg);
    text(std::to_string(i + 1), pad + 12 * k, y + 11 * k, 20 * k, keyInk, CENTER, MIDDLE);
    y += 30 * k;
    Color nameC = legendary ? CARD_GOLD : ink;
    for (auto& l : lays[i].nameL) { text(l, pad, y, 30 * k, nameC); y += 31 * k; }
    y += 6 * k;
    for (auto& l : lays[i].descL) { DrawTextEx(comic(), l.c_str(), {pad, y}, 15 * k, 0, ink); y += 19 * k; }
    // tags at the bottom
    float ty = maxH - pad - 20 * k - (r.synergy.empty() ? 0 : 30 * k);
    float tx = pad;
    Color tagC = epic ? WHITE : legendary ? CARD_GOLD : BLACK;
    for (auto& t : c.tags) {
      std::string lbl = tagLabel(t);
      float tw = textWidth(lbl, 13 * k) + 10 * k;
      rectOutline(tx, ty, tw, 18 * k, 2 * k, tagC);
      text(lbl, tx + 5 * k, ty + 9 * k, 13 * k, tagC, LEFT, MIDDLE);
      tx += tw + 6 * k;
    }
    if (!r.synergy.empty()) {
      std::string syn = "SYNERGY: ";
      for (size_t s = 0; s < r.synergy.size(); s++) syn += (s ? " + " : "") + std::string(tagLabel(r.synergy[s]));
      float sy = maxH - pad - 24 * k;
      DrawRectangleRec({pad, sy, cw - 2 * pad, 24 * k}, BLACK);
      bool blink = std::fmod(time, 0.8) < 0.4;
      text(syn, pad + 6 * k, sy + 12 * k, 16 * k, blink ? HUD_YELLOW : WHITE, LEFT, MIDDLE);
    }
    rlPopMatrix();
  }
  for (int i = n; i < 3; i++) cardRects[i] = {0, 0, 0, 0};
  buildChips(game, cy + maxH + 18 * k);
}

// Owned cards and the team, under the reward cards.
void Hud::buildChips(Game& game, float y) {
  if (game.build.empty()) return;
  std::map<std::string, int> counts;
  std::vector<std::string> order;
  for (auto& id : game.build) { if (!counts[id]++) order.push_back(id); }
  struct Chip { std::string label; Color bg, ink; bool team; };
  std::vector<Chip> chips;
  for (auto& id : order) {
    const Card* c = nullptr;
    for (auto& cc : cards()) if (cc.id == id) c = &cc;
    if (!c) continue;
    std::string l = c->name + (counts[id] > 1 ? " x" + std::to_string(counts[id]) : "");
    bool team = c->fam == "team";
    chips.push_back({l, team ? HUD_ALLY : WHITE, team ? WHITE : BLACK, team});
  }
  float fs = 13 * k, maxW = 820 * k, cx = o.x + W / 2;
  auto row = [&](const std::string& label, const std::vector<Chip>& cs, float yy) {
    // centre the row (wrapping is rare at 820 px)
    float w = textWidth(label, 18 * k) + 12 * k;
    for (auto& c : cs) w += textWidth(c.label, fs) + 16 * k + 6 * k;
    float x = cx - std::min(w, maxW) / 2;
    text(label, x, yy + 9 * k, 18 * k, HUD_YELLOW, LEFT, MIDDLE);
    x += textWidth(label, 18 * k) + 12 * k;
    for (auto& c : cs) {
      float cw = textWidth(c.label, fs) + 16 * k;
      DrawRectangleRec({x, yy, cw, 20 * k}, c.bg);
      rectOutline(x, yy, cw, 20 * k, 2 * k, BLACK);
      text(c.label, x + 8 * k, yy + 10 * k, fs, c.ink, LEFT, MIDDLE);
      x += cw + 6 * k;
    }
  };
  row("YOUR BUILD", chips, y);
  std::string team;
  for (auto& r : game.roster) team += (team.empty() ? "" : " \u00B7 ") + upper(r->type);
  if (team.empty()) team = "NO ALLIES LEFT";
  row("YOUR TEAM", {{team, HUD_ALLY, WHITE, true}}, y + 30 * k);
}
