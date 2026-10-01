#include "draw.h"
#include <cmath>
#include "rlgl.h"

namespace draw {

static Font g_font;
static bool g_loaded = false;
static constexpr int FONT_BASE = 96; // atlas size; scaled down when drawn

Color hex(unsigned rgb, float a) {
  return Color{(unsigned char)((rgb >> 16) & 255), (unsigned char)((rgb >> 8) & 255), (unsigned char)(rgb & 255), (unsigned char)(a * 255)};
}
Color alpha(Color c, float a) { c.a = (unsigned char)(c.a * (a < 0 ? 0 : a > 1 ? 1 : a)); return c; }

void loadFonts() {
  std::vector<int> cps;
  for (int c = 32; c < 127; c++) cps.push_back(c);
  cps.push_back(0xB7); // middle dot
  const char* paths[] = {"assets/Bangers-Regular.ttf",
#ifdef MAKI_ASSETS
                         MAKI_ASSETS "/Bangers-Regular.ttf",
#endif
  };
  for (const char* p : paths) {
    if (FileExists(p)) { g_font = LoadFontEx(p, FONT_BASE, cps.data(), (int)cps.size()); g_loaded = true; break; }
  }
  if (!g_loaded) g_font = GetFontDefault();
  SetTextureFilter(g_font.texture, TEXTURE_FILTER_BILINEAR);
}

void unloadFonts() { if (g_loaded) UnloadFont(g_font); }
const Font& font() { return g_font; }

static float spacing(float size) { return size * 0.02f; }

float textWidth(const std::string& s, float size) { return MeasureTextEx(g_font, s.c_str(), size, spacing(size)).x; }

void text(const std::string& s, float x, float y, float size, Color fill, Align al, Baseline bl, float stroke, Color strokeColor) {
  Vector2 m = MeasureTextEx(g_font, s.c_str(), size, spacing(size));
  float px = al == LEFT ? x : al == CENTER ? x - m.x / 2 : x - m.x;
  float py = bl == TOP ? y : bl == MIDDLE ? y - size / 2 : y - size;
  if (stroke > 0) {
    // ink outline: the fill stamped around a circle of radius `stroke`
    int n = stroke > 2 ? 12 : 8;
    for (int k = 0; k < n; k++) {
      float a = k * 6.2831853f / n;
      DrawTextEx(g_font, s.c_str(), {px + std::cos(a) * stroke, py + std::sin(a) * stroke}, size, spacing(size), strokeColor);
    }
  }
  DrawTextEx(g_font, s.c_str(), {px, py}, size, spacing(size), fill);
}

void textRotated(const std::string& s, float x, float y, float size, float rotDeg, Color fill, float stroke, Color strokeColor) {
  Vector2 m = MeasureTextEx(g_font, s.c_str(), size, spacing(size));
  Vector2 origin{m.x / 2, size / 2};
  if (stroke > 0) {
    for (int k = 0; k < 12; k++) {
      float a = k * 6.2831853f / 12;
      DrawTextPro(g_font, s.c_str(), {x + std::cos(a) * stroke, y + std::sin(a) * stroke}, origin, rotDeg, size, spacing(size), strokeColor);
    }
  }
  DrawTextPro(g_font, s.c_str(), {x, y}, origin, rotDeg, size, spacing(size), fill);
}

void line(Vector2 a, Vector2 b, float w, Color c) { DrawLineEx(a, b, w, c); }

void dashedLine(Vector2 a, Vector2 b, float w, float dash, float gap, float offset, Color c) {
  float dx = b.x - a.x, dy = b.y - a.y, len = std::sqrt(dx * dx + dy * dy);
  if (len <= 0) return;
  float ux = dx / len, uy = dy / len, period = dash + gap;
  float t = -std::fmod(std::fmod(offset, period) + period, period);
  for (; t < len; t += period) {
    float s0 = t < 0 ? 0 : t, s1 = std::fmin(len, t + dash);
    if (s1 > s0) DrawLineEx({a.x + ux * s0, a.y + uy * s0}, {a.x + ux * s1, a.y + uy * s1}, w, c);
  }
}

void arc(Vector2 c, float r, float a0, float a1, float w, Color col) {
  if (a1 < a0) std::swap(a0, a1);
  float span = a1 - a0;
  int segs = (int)std::fmax(6, std::fmin(96, span * r * 0.5f));
  DrawRing(c, r - w / 2, r + w / 2, a0 * RAD2DEG, a1 * RAD2DEG, segs, col);
}

void dashedCircle(Vector2 c, float r, float w, float dash, float gap, float offset, Color col) {
  if (r <= 0) return;
  float circ = 6.2831853f * r, period = dash + gap;
  float t = -std::fmod(std::fmod(offset, period) + period, period);
  for (; t < circ; t += period) {
    float s0 = t < 0 ? 0 : t, s1 = std::fmin(circ, t + dash);
    if (s1 > s0) arc(c, r, s0 / r, s1 / r, w, col);
  }
}

void polyline(const std::vector<Vector2>& pts, float w, Color c) {
  for (size_t i = 1; i < pts.size(); i++) DrawLineEx(pts[i - 1], pts[i], w, c);
  for (size_t i = 1; i + 1 < pts.size(); i++) DrawCircleV(pts[i], w / 2, c); // round joins
}

void dashedPolyline(const std::vector<Vector2>& pts, float w, float dash, float gap, Color c) {
  // dashes continue across vertices
  float period = dash + gap, along = 0;
  for (size_t i = 1; i < pts.size(); i++) {
    Vector2 a = pts[i - 1], b = pts[i];
    float dx = b.x - a.x, dy = b.y - a.y, len = std::sqrt(dx * dx + dy * dy);
    if (len <= 0) continue;
    float ux = dx / len, uy = dy / len;
    float t = -std::fmod(along, period);
    for (; t < len; t += period) {
      float s0 = t < 0 ? 0 : t, s1 = std::fmin(len, t + dash);
      if (s1 > s0) DrawLineEx({a.x + ux * s0, a.y + uy * s0}, {a.x + ux * s1, a.y + uy * s1}, w, c);
    }
    along += len;
  }
}

void fillPolygon(const std::vector<Vector2>& pts, Vector2 center, Color c) {
  rlDisableBackfaceCulling();
  for (size_t i = 0; i < pts.size(); i++) DrawTriangle(center, pts[i], pts[(i + 1) % pts.size()], c);
  rlEnableBackfaceCulling();
}

void strokePolygon(const std::vector<Vector2>& pts, float w, Color c) {
  for (size_t i = 0; i < pts.size(); i++) DrawLineEx(pts[i], pts[(i + 1) % pts.size()], w, c);
  for (auto& p : pts) DrawCircleV(p, w / 2, c);
}

void rectOutline(float x, float y, float w, float h, float lw, Color c) {
  DrawRectangleLinesEx({x - lw / 2, y - lw / 2, w + lw, h + lw}, lw, c);
}

} // namespace draw
