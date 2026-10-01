#pragma once
// Vector drawing helpers on top of raylib, standing in for the HTML canvas
// API the browser version used (dashed arcs, outlined comic text, polygons).
#include <string>
#include <vector>
#include "raylib.h"

namespace draw {

// Hex color, with optional alpha 0..1.
Color hex(unsigned rgb, float a = 1.f);
Color alpha(Color c, float a);

void loadFonts();
void unloadFonts();
const Font& font();

enum Align { LEFT, CENTER, RIGHT };
enum Baseline { TOP, MIDDLE, BOTTOM };

float textWidth(const std::string& s, float size);
// Comic text: optional ink outline of `stroke` thickness, then the fill.
void text(const std::string& s, float x, float y, float size, Color fill, Align al = LEFT, Baseline bl = TOP,
          float stroke = 0, Color strokeColor = BLACK);
// Rotated + scaled text around (x, y), centred.
void textRotated(const std::string& s, float x, float y, float size, float rotDeg, Color fill, float stroke, Color strokeColor);

void line(Vector2 a, Vector2 b, float w, Color c);
void dashedLine(Vector2 a, Vector2 b, float w, float dash, float gap, float offset, Color c);
void arc(Vector2 c, float r, float a0, float a1, float w, Color col);            // radians
void dashedCircle(Vector2 c, float r, float w, float dash, float gap, float offset, Color col);
void polyline(const std::vector<Vector2>& pts, float w, Color c);
void dashedPolyline(const std::vector<Vector2>& pts, float w, float dash, float gap, Color c);
void fillPolygon(const std::vector<Vector2>& pts, Vector2 center, Color c); // star-shaped around center
void strokePolygon(const std::vector<Vector2>& pts, float w, Color c);
void rectOutline(float x, float y, float w, float h, float lw, Color c);

} // namespace draw
