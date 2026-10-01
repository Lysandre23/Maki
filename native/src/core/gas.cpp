#include <algorithm>
#include <cmath>
#include "util.h"
#include "world.h"

static constexpr int ITER = 6;        // pressure solver iterations (warm-started, over-relaxed)
static constexpr double SOR = 1.6;
static constexpr double VORT = 0.22;  // vorticity confinement strength (swirl)

// Smoke, heat (fire) and steam carried by a 2D incompressible velocity field
// (Stam-style stable fluids) on a coarse grid. Walls from the cell grid are
// obstacles, so blasts push smoke around corners and through fresh holes.
// Explosions are modelled as a divergence source (the gas expands outward).
// The solver only covers a window (winW x winH world cells) that follows the
// camera; ox/oy is the window origin in gas cells. Outside it, fires still
// burn but produce no smoke, and gas scrolls away when the window moves.
Gas::Gas(int worldW, int worldH, int scale, int winW, int winH) : s(scale) {
  w = (int)std::ceil(std::min(winW, worldW) / (double)scale);
  h = (int)std::ceil(std::min(winH, worldH) / (double)scale);
  maxOx = (int)std::ceil(worldW / (double)scale) - w;
  maxOy = (int)std::ceil(worldH / (double)scale) - h;
  size_t n = (size_t)w * h;
  for (auto* f : {&u, &v, &u0, &v0, &p, &div, &curl, &expand, &tmp, &smoke, &heat, &steam}) f->assign(n, 0.0);
  solid.assign(n, 0);
  open.assign(n, 0.0);
  inv.assign(n, 0.0);
}

void Gas::clear() {
  for (auto* f : {&u, &v, &u0, &v0, &p, &div, &curl, &expand, &smoke, &heat, &steam}) std::fill(f->begin(), f->end(), 0.0);
  active = 0;
}

// Keep the window centred on (cx, cy); scroll the fields when it moves.
// Returns true if the window moved (caller must re-sync solids).
bool Gas::follow(double cx, double cy) {
  int tx = (int)std::max(0.0, std::min((double)maxOx, jsround(cx / s - w / 2.0)));
  int ty = (int)std::max(0.0, std::min((double)maxOy, jsround(cy / s - h / 2.0)));
  int dx = tx - ox, dy = ty - oy;
  if (std::abs(dx) < 12 && std::abs(dy) < 12) return false;
  for (auto* f : {&u, &v, &p, &expand, &smoke, &heat, &steam}) {
    std::fill(tmp.begin(), tmp.end(), 0.0);
    for (int j = 0; j < h; j++) {
      int sj = j + dy;
      if (sj < 0 || sj >= h) continue;
      for (int i = 0; i < w; i++) {
        int si = i + dx;
        if (si >= 0 && si < w) tmp[j * w + i] = (*f)[sj * w + si];
      }
    }
    *f = tmp;
  }
  ox = tx; oy = ty;
  return true;
}

void Gas::syncSolid(const Grid& grid) {
  int half = s >> 1;
  for (int j = 0; j < h; j++) {
    for (int i = 0; i < w; i++) {
      int k = j * w + i;
      if (i == 0 || j == 0 || i == w - 1 || j == h - 1) { solid[k] = 1; continue; }
      int wx = std::min(grid.w - 1, (i + ox) * s + half), wy = std::min(grid.h - 1, (j + oy) * s + half);
      solid[k] = SOLID[grid.mat[wy * grid.w + wx]];
      if (solid[k]) { smoke[k] = 0; heat[k] = 0; steam[k] = 0; u[k] = 0; v[k] = 0; }
    }
  }
  for (size_t k = 0; k < solid.size(); k++) open[k] = 1.0 - solid[k];
  for (int j = 1; j < h - 1; j++) {
    for (int i = 1, k = j * w + 1; i < w - 1; i++, k++) {
      double nc = open[k - 1] + open[k + 1] + open[k - w] + open[k + w];
      inv[k] = solid[k] || nc == 0 ? 0 : 1 / nc;
    }
  }
}

int Gas::cell(double x, double y) const {
  int i = (int)std::floor(x / s) - ox, j = (int)std::floor(y / s) - oy;
  if (i < 0 || j < 0 || i >= w || j >= h) return -1;
  int k = j * w + i;
  return solid[k] ? -1 : k;
}

void Gas::addSmoke(double x, double y, double a) { int k = cell(x, y); if (k >= 0) { smoke[k] = std::min(3.0, smoke[k] + a); active = 600; } }
void Gas::addHeat(double x, double y, double a) { int k = cell(x, y); if (k >= 0) { heat[k] = std::min(2.0, heat[k] + a); active = 600; } }
void Gas::addSteam(double x, double y, double a) { int k = cell(x, y); if (k >= 0) { steam[k] = std::min(3.0, steam[k] + a); active = 600; } }
void Gas::addExpand(double x, double y, double a) { int k = cell(x, y); if (k >= 0) { expand[k] += a; active = 600; } }
// velocity in world cells per tick
void Gas::addVel(double x, double y, double vx, double vy) {
  int k = cell(x, y);
  if (k >= 0) { u[k] += vx / s; v[k] += vy / s; active = 600; }
}

void Gas::blast(double x, double y, double r, double power, double heatMul) {
  double gx = x / s - 0.5 - ox, gy = y / s - 0.5 - oy;
  double gr = std::max(1.5, (r * 1.3) / s);
  int j0 = std::max(1, (int)std::floor(gy - gr)), j1 = std::min(h - 2, (int)std::ceil(gy + gr));
  int i0 = std::max(1, (int)std::floor(gx - gr)), i1 = std::min(w - 2, (int)std::ceil(gx + gr));
  for (int j = j0; j <= j1; j++) {
    for (int i = i0; i <= i1; i++) {
      int k = j * w + i;
      if (solid[k]) continue;
      double dx = i - gx, dy = j - gy;
      double d = std::hypot(dx, dy);
      double f = 1 - d / gr;
      if (f <= 0) continue;
      expand[k] += power * 0.04 * f;
      smoke[k] = std::min(3.0, smoke[k] + f * power * 0.05);
      heat[k] = std::min(2.0, heat[k] + f * power * 0.09 * heatMul);
      if (d > 0.2) {
        u[k] += (dx / d) * f * power * 0.04;
        v[k] += (dy / d) * f * power * 0.04;
      }
    }
  }
  active = 600;
}

void Gas::step() {
  if (active <= 0) return;
  active--;
  const int n = (int)u.size();

  vorticity();
  if (windX != 0 || windY != 0) {
    double* __restrict U = u.data();
    double* __restrict V = v.data();
    for (int k = 0; k < n; k++) { U[k] += windX; V[k] += windY; }
  }

  std::copy(u.begin(), u.end(), u0.begin());
  std::copy(v.begin(), v.end(), v0.begin());
  advect(u, u0, u0, v0);
  advect(v, v0, u0, v0);
  project();

  std::copy(smoke.begin(), smoke.end(), tmp.begin()); advect(smoke, tmp, u, v);
  std::copy(heat.begin(), heat.end(), tmp.begin()); advect(heat, tmp, u, v);
  std::copy(steam.begin(), steam.end(), tmp.begin()); advect(steam, tmp, u, v);

  double* __restrict U = u.data();
  double* __restrict V = v.data();
  double* __restrict E = expand.data();
  double* __restrict H = heat.data();
  double* __restrict S = smoke.data();
  double* __restrict T = steam.data();
  for (int k = 0; k < n; k++) {
    U[k] *= 0.96; V[k] *= 0.96;
    E[k] *= 0.3;
    double hk = H[k];
    if (hk > 0.01) {
      S[k] = std::min(3.0, S[k] + hk * 0.025); // fire turns into smoke as it cools
      H[k] = hk * 0.93;
    } else H[k] = 0;
    double sk = S[k] * 0.996;
    S[k] = sk < 0.004 ? 0 : sk;
    T[k] *= 0.975;
  }
}

void Gas::vorticity() {
  double* __restrict U = u.data();
  double* __restrict V = v.data();
  double* __restrict C = curl.data();
  const uint8_t* __restrict SO = solid.data();
  for (int j = 1; j < h - 1; j++) {
    for (int i = 1, k = j * w + 1; i < w - 1; i++, k++) {
      C[k] = 0.5 * ((V[k + 1] - V[k - 1]) - (U[k + w] - U[k - w]));
    }
  }
  for (int j = 2; j < h - 2; j++) {
    for (int i = 2, k = j * w + 2; i < w - 2; i++, k++) {
      if (SO[k]) continue;
      double c = C[k];
      if (c == 0) continue;
      double gx = 0.5 * (std::abs(C[k + 1]) - std::abs(C[k - 1]));
      double gy = 0.5 * (std::abs(C[k + w]) - std::abs(C[k - w]));
      double len = std::sqrt(gx * gx + gy * gy) + 1e-6;
      U[k] += VORT * (gy / len) * c;
      V[k] -= VORT * (gx / len) * c;
    }
  }
}

void Gas::advect(std::vector<double>& dstV, const std::vector<double>& srcV, const std::vector<double>& UV, const std::vector<double>& VV) {
  double* __restrict dst = dstV.data();
  const double* __restrict src = srcV.data();
  const double* __restrict U = UV.data();
  const double* __restrict V = VV.data();
  const uint8_t* __restrict SO = solid.data();
  const double maxX = w - 1.5, maxY = h - 1.5;
  for (int j = 1; j < h - 1; j++) {
    for (int i = 1, k = j * w + 1; i < w - 1; i++, k++) {
      if (SO[k]) { dst[k] = 0; continue; }
      double x = i - U[k], y = j - V[k];
      if (x < 0.5) x = 0.5; else if (x > maxX) x = maxX;
      if (y < 0.5) y = 0.5; else if (y > maxY) y = maxY;
      int i0 = (int)x, j0 = (int)y;
      double fx = x - i0, fy = y - j0;
      int q = j0 * w + i0;
      dst[k] = (src[q] * (1 - fx) + src[q + 1] * fx) * (1 - fy) +
               (src[q + w] * (1 - fx) + src[q + w + 1] * fx) * fy;
    }
  }
}

// Make the flow divergence-free except where `expand` asks for expansion.
// Solid neighbours use Neumann boundaries (no flow through walls).
void Gas::project() {
  double* __restrict U = u.data();
  double* __restrict V = v.data();
  double* __restrict P = p.data();
  double* __restrict D = div.data();
  const double* __restrict O = open.data();
  const double* __restrict I = inv.data();
  const double* __restrict E = expand.data();
  const int end = (h - 1) * w - 1;
  for (int k = w + 1; k < end; k++) {
    D[k] = O[k] * (0.5 * (U[k + 1] - U[k - 1] + V[k + w] - V[k - w]) - E[k]);
  }
  // Over-relaxed red-black Gauss-Seidel, warm-started from last tick's
  // pressure: cells of one colour only read the other colour, so a sweep has
  // no serial dependency (fast, and splittable across threads later).
  // Solid cells have inv = 0 so they stay at p = 0, and solid neighbours are
  // masked out by `open`. Border cells are walls (always solid).
  for (int it = 0; it < ITER; it++) {
    for (int color = 0; color < 2; color++) {
      for (int j = 1; j < h - 1; j++) {
        for (int k = j * w + 1 + ((j + color) & 1), kEnd = j * w + w - 1; k < kEnd; k += 2) {
          double gs = (P[k - 1] * O[k - 1] + P[k + 1] * O[k + 1] +
                       P[k - w] * O[k - w] + P[k + w] * O[k + w] - D[k]) * I[k];
          P[k] = (P[k] + SOR * (gs - P[k])) * O[k];
        }
      }
    }
  }
  for (int k = w + 1; k < end; k++) {
    double o = O[k], pc = P[k];
    double ol = O[k - 1], orr = O[k + 1], ou = O[k - w], od = O[k + w];
    double pl = P[k - 1] * ol + pc * (1 - ol), pr = P[k + 1] * orr + pc * (1 - orr);
    double pu = P[k - w] * ou + pc * (1 - ou), pd = P[k + w] * od + pc * (1 - od);
    U[k] = o * (U[k] - 0.5 * (pr - pl));
    V[k] = o * (V[k] - 0.5 * (pd - pu));
  }
}
