#include "overlay.h"
#include <algorithm>
#include <cmath>
#include "draw.h"

using namespace draw;

static const Color HUD_YELLOW = hex(0xffd21e), HUD_RED = hex(0xff2d2d), HUD_ALLY = hex(0x3c8cff), HUD_FIRE = hex(0xff8a1c);

void Overlay::draw(Game& game, Vector2 mouse, int camX, int camY) {
  captureZone(game.flag, camX, camY, game.tick);
  if (showOrders) orders(game, camX, camY);
  for (Tank* t : game.enemies) if (t->alive && t->charge > 0) telegraph(*t, game, camX, camY);
  for (const auto& p : game.popups) popup(p, camX, camY);
  offscreen(game, camX, camY);
  if (game.player->alive) {
    targetInfo(game, mouse, camX, camY);
    crosshair(*game.player, mouse);
  }
}

// Dashed ring around the flag, filled arc = capture progress.
void Overlay::captureZone(const Flag& flag, int camX, int camY, int tick) {
  float x = (float)(flag.x - camX), y = (float)(flag.y - camY), r = (float)flag.r;
  if (x < -r - 20 || y < -r - 20 || x > VIEW_W + r + 20 || y > VIEW_H + r + 20) return;
  dashedCircle({x, y}, r, 0.8f, 4, 3, -tick * 0.3f, flag.contested ? HUD_RED : HUD_YELLOW);
  if (flag.progress > 0) arc({x, y}, r, (float)-kPI / 2, (float)(-kPI / 2 + flag.progress * kPI * 2), 2.2f, HUD_ALLY);
}

// Faint blue arrow from each squad to its order point, numbered.
void Overlay::orders(Game& game, int camX, int camY) {
  Color c = alpha(HUD_ALLY, 0.45f);
  for (auto& q : game.squads) {
    auto live = q->alive();
    if (!q->hasGoal || live.empty()) continue;
    Pt ct = centroid(live);
    float gx = (float)(q->goal.x - camX), gy = (float)(q->goal.y - camY), sx = (float)(ct.x - camX), sy = (float)(ct.y - camY);
    float d = std::hypot(gx - sx, gy - sy);
    if (d < 30) continue;
    float a = std::atan2(gy - sy, gx - sx);
    dashedLine({sx + std::cos(a) * 16, sy + std::sin(a) * 16}, {gx, gy}, 0.8f, 4, 3, 0, c);
    fillPolygon({{gx, gy}, {gx - std::cos(a - 0.5f) * 6, gy - std::sin(a - 0.5f) * 6}, {gx - std::cos(a + 0.5f) * 6, gy - std::sin(a + 0.5f) * 6}},
                {gx - std::cos(a) * 3, gy - std::sin(a) * 3}, c);
    text(std::to_string(q->id + 1), gx + std::cos(a) * 8, gy + std::sin(a) * 8, 8, c, CENTER, MIDDLE);
  }
}

// Arrows on the screen edge toward the flag (yellow) and off-screen allies (blue).
void Overlay::offscreen(Game& game, int camX, int camY) {
  float cx = VIEW_W / 2.f, cy = VIEW_H / 2.f;
  auto arrow = [&](double wx, double wy, Color color, float size, const std::string& label) {
    float x = (float)(wx - camX), y = (float)(wy - camY);
    if (x >= 0 && y >= 0 && x < VIEW_W && y < VIEW_H) return;
    float a = std::atan2(y - cy, x - cx);
    float ca = std::abs(std::cos(a)), sa = std::abs(std::sin(a));
    float k = std::min((VIEW_W / 2.f - 14) / (ca > 1e-6f ? ca : 1e-6f), (VIEW_H / 2.f - 14) / (sa > 1e-6f ? sa : 1e-6f));
    float ex = cx + std::cos(a) * k, ey = cy + std::sin(a) * k;
    auto rot = [&](float px, float py) { return Vector2{ex + px * std::cos(a) - py * std::sin(a), ey + px * std::sin(a) + py * std::cos(a)}; };
    std::vector<Vector2> pts = {rot(size, 0), rot(-size * 0.7f, -size * 0.7f), rot(-size * 0.3f, 0), rot(-size * 0.7f, size * 0.7f)};
    fillPolygon(pts, rot(0, 0), color);
    strokePolygon(pts, 0.6f, BLACK);
    if (!label.empty()) {
      float lx = ex - std::cos(a) * 14, ly = ey - std::sin(a) * 10;
      text(label, lx, ly, 7, color, CENTER, MIDDLE, 0.8f, BLACK);
    }
  };
  Tank& p = *game.player;
  arrow(game.flag.x, game.flag.y, HUD_YELLOW, 6, "FLAG " + std::to_string((int)jsround(std::hypot(game.flag.x - p.x, game.flag.y - p.y) / 10)) + "m");
  for (Tank* t : game.allies) if (t->alive) arrow(t->x, t->y, HUD_ALLY, 3.5f, "");
}

// "About to fire" warning: dashed laser to the first wall + muzzle glint.
void Overlay::telegraph(const Tank& t, Game& game, int camX, int camY) {
  double c = std::cos(t.ta), s = std::sin(t.ta);
  double tip = t.turretR + t.barrelLen;
  double sx = t.x + t.turretOff * std::cos(t.a) + c * tip, sy = t.y + t.turretOff * std::sin(t.a) + s * tip;
  double x = sx, y = sy;
  for (int k = 0; k < 160; k++) {
    x += c * 2; y += s * 2;
    if (game.grid.isSolid((int)std::floor(x), (int)std::floor(y))) break;
  }
  float prog = 1 - (float)t.charge / t.chargeMax;
  Color red = alpha(HUD_RED, 0.3f + 0.7f * prog);
  dashedLine({(float)(sx - camX), (float)(sy - camY)}, {(float)(x - camX), (float)(y - camY)}, 0.4f + prog * 0.8f, 3, 2, -game.tick * 0.6f, red);
  float r = 1.5f + prog * 4;
  Vector2 o{(float)(sx - camX), (float)(sy - camY)};
  std::vector<Vector2> star;
  for (int i = 0; i < 8; i++) {
    float rr = i % 2 ? r * 0.3f : r;
    float a = (float)((i / 8.0) * kPI * 2 + game.tick * 0.2);
    star.push_back({o.x + std::cos(a) * rr, o.y + std::sin(a) * rr});
  }
  fillPolygon(star, o, WHITE);
  strokePolygon(star, 0.5f, BLACK);
}

// Hovering an enemy shows its part status, and names the zone under the
// crosshair (weak spots flagged).
void Overlay::targetInfo(Game& game, Vector2 m, int camX, int camY) {
  double wx = camX + m.x, wy = camY + m.y;
  Tank* best = nullptr;
  double bd = 1e300;
  for (Tank* e : game.enemies) {
    if (!e->alive) continue;
    double d = std::hypot(e->x - wx, e->y - wy);
    if (d < e->bound + 8 && d < bd) { bd = d; best = e; }
  }
  if (!best) return;
  static const std::pair<const char*, Part> rows[7] = {{"HUL", HULL}, {"TRK", TRACK_L}, {"TRK", TRACK_R}, {"TUR", TURRET}, {"GUN", CANNON}, {"ENG", ENGINE}, {"AMO", AMMO}};
  float px = (float)(best->x - camX + best->bound + 6), py = (float)(best->y - camY - 22);
  if (px + 34 > VIEW_W) px = (float)(best->x - camX - best->bound - 40);
  py = std::max(2.f, std::min((float)VIEW_H - 40, py));
  DrawRectangleRec({px, py, 34, 37}, Color{0, 0, 0, 204});
  rectOutline(px, py, 34, 37, 0.6f, WHITE);
  for (int i = 0; i < 7; i++) {
    float y = py + 4 + i * 5;
    float fr = (float)best->frac(rows[i].second);
    Color c = fr <= 0 ? HUD_RED : WHITE;
    text(rows[i].first, px + 2, y + 0.3f, 5, c, LEFT, MIDDLE);
    rectOutline(px + 13, y - 1.5f, 19, 3, 0.4f, c);
    DrawRectangleRec({px + 13, y - 1.5f, 19 * fr, 3}, fr < 0.35f ? HUD_RED : WHITE);
  }
  Part zone = best->hitTest(wx, wy);
  if (zone != NO_PART) {
    bool weak = zone == AMMO || zone == ENGINE;
    std::string t = std::string(PART_LABEL[zone]) + (weak ? " - WEAK SPOT" : "");
    text(t, m.x + 10, m.y - 9, 7, weak ? HUD_RED : WHITE, LEFT, MIDDLE, 0.8f, BLACK);
  }
}

void Overlay::popup(const Popup& p, int camX, int camY) {
  float grow = std::min(1.f, p.t / 6.f);
  float fade = p.t > p.life - 15 ? (p.life - p.t) / 15.f : 1.f;
  if (fade <= 0) return;
  float x = (float)(p.x - camX), y = (float)(p.y - camY - p.t * 0.15);
  float sc = 0.5f + 0.5f * grow + (p.t < 6 ? 0.25f * grow : 0);
  float size = (float)p.size * sc;
  float rot = (float)p.rot;
  if (p.burst) {
    float r = textWidth(p.text, size) * 0.62f + size * 0.3f;
    std::vector<Vector2> pts;
    const int n = 14;
    for (int i = 0; i < n * 2; i++) {
      float a = (float)i / (n * 2) * 6.2831853f;
      float rr = i % 2 ? r * 0.72f : r * (1 + ((i * 7) % 5) * 0.06f);
      float lx = std::cos(a) * rr, ly = std::sin(a) * rr * 0.62f;
      pts.push_back({x + lx * std::cos(rot) - ly * std::sin(rot), y + lx * std::sin(rot) + ly * std::cos(rot)});
    }
    fillPolygon(pts, {x, y}, alpha(WHITE, fade));
    strokePolygon(pts, 1.2f * sc, alpha(BLACK, fade));
  }
  textRotated(p.text, x, y, size, rot * RAD2DEG, alpha(p.accent ? HUD_YELLOW : WHITE, fade), size * 0.1f, alpha(BLACK, fade));
}

void Overlay::crosshair(const Tank& player, Vector2 m) {
  double ready = 1 - std::max(0.0, player.reload) / (player.reloadMax ? player.reloadMax : 1);
  arc(m, 5, 0, 6.2831853f, 0.7f, HUD_YELLOW);
  line({m.x - 8, m.y}, {m.x - 3, m.y}, 0.7f, HUD_YELLOW);
  line({m.x + 3, m.y}, {m.x + 8, m.y}, 0.7f, HUD_YELLOW);
  line({m.x, m.y - 8}, {m.x, m.y - 3}, 0.7f, HUD_YELLOW);
  line({m.x, m.y + 3}, {m.x, m.y + 8}, 0.7f, HUD_YELLOW);
  if (ready < 1) arc(m, 7, (float)-kPI / 2, (float)(-kPI / 2 + ready * kPI * 2), 1.2f, HUD_YELLOW);
  double heat = std::min(1.0, player.mgHeat / 60); // machine gun heat, lower arc
  if (heat > 0.02) arc(m, 10, (float)(kPI * 0.75 - heat * kPI * 0.5), (float)(kPI * 0.75), 1.f, player.overheat ? HUD_FIRE : WHITE);
}
