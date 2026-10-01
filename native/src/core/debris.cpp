#include <cmath>
#include "util.h"
#include "world.h"

static constexpr float DAMP = 0.93f;
static constexpr float SPARK_DAMP = 0.96f;
static constexpr float REST_SPEED2 = 0.02f;
static constexpr int NEIGHBORS[9][2] = {{0, 0}, {1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {-1, -1}, {1, -1}, {-1, 1}};

Debris::Debris(int max_) : max(max_), x(max_), y(max_), vx(max_), vy(max_), m(max_), life(max_) {}

bool Debris::spawn(double px, double py, double pvx, double pvy, uint8_t mi, int l) {
  if (n >= max) return false;
  int i = n++;
  x[i] = (float)px; y[i] = (float)py;
  vx[i] = (float)pvx; vy[i] = (float)pvy;
  m[i] = mi; life[i] = (int16_t)l;
  return true;
}

void Debris::remove(int i) {
  int l = --n;
  if (i != l) {
    x[i] = x[l]; y[i] = y[l];
    vx[i] = vx[l]; vy[i] = vy[l];
    m[i] = m[l]; life[i] = life[l];
  }
}

void Debris::settle(Grid& grid, int i) {
  int cx = (int)std::floor(x[i]), cy = (int)std::floor(y[i]);
  for (auto& o : NEIGHBORS) {
    int px = cx + o[0], py = cy + o[1];
    if (grid.inBounds(px, py) && grid.mat[py * grid.w + px] == M::EMPTY) {
      grid.setCell(px, py, M::RUBBLE, (uint8_t)(hash(px, py) % 3));
      return;
    }
  }
}

// Particles outside the active rect are fast-forwarded (settled in place),
// so far-away explosions cost almost nothing.
void Debris::update(Grid& grid, double ax0, double ay0, double ax1, double ay1, const Hooks* hooks) {
  auto flammableAt = [&](int cx, int cy) { return grid.inBounds(cx, cy) && FLAMMABLE[grid.mat[cy * grid.w + cx]]; };
  for (int i = n - 1; i >= 0; i--) {
    float px = x[i], py = y[i];
    uint8_t mi = m[i];
    bool outside = px < ax0 || px > ax1 || py < ay0 || py > ay1;

    if (mi == M::SPARK) {
      if (--life[i] <= 0 || outside) { remove(i); continue; }
      vx[i] *= SPARK_DAMP; vy[i] *= SPARK_DAMP;
      x[i] = px + vx[i]; y[i] = py + vy[i];
      continue;
    }

    if (outside) {
      if (mi != M::EMBER) settle(grid, i);
      remove(i);
      continue;
    }

    float dx = vx[i] * DAMP, dy = vy[i] * DAMP;
    float nx = px + dx, ny = py + dy;
    int cx = (int)std::floor(nx), cy = (int)std::floor(py);
    if (grid.isSolid(cx, cy)) {
      if (mi == M::EMBER && hooks && flammableAt(cx, cy)) hooks->ignite(cx, cy);
      dx = -dx * 0.4f; nx = px;
    }
    cx = (int)std::floor(nx); cy = (int)std::floor(ny);
    if (grid.isSolid(cx, cy)) {
      if (mi == M::EMBER && hooks && flammableAt(cx, cy)) hooks->ignite(cx, cy);
      dy = -dy * 0.4f; ny = py;
    }
    vx[i] = dx; vy[i] = dy;
    x[i] = nx; y[i] = ny;

    if (mi == M::EMBER) {
      // embers light up the grass they fly over
      int ex = (int)std::floor(nx), ey = (int)std::floor(ny);
      if (hooks && grid.inBounds(ex, ey) && grid.mat[ey * grid.w + ex] == M::GRASS && (i & 3) == 0) hooks->ignite(ex, ey);
      if (--life[i] <= 0) remove(i);
      continue;
    }
    if (dx * dx + dy * dy < REST_SPEED2) {
      settle(grid, i);
      remove(i);
    }
  }
}

// Carve a crater: damage cells by distance falloff, turn destroyed cells into
// debris particles, scorch the floor, emit sparks.
int explode(Grid& grid, Debris& debris, double x, double y, double r, double power, const Hooks* hooks) {
  const int w = grid.w, h = grid.h;
  auto& mat = grid.mat; auto& hp = grid.hp; auto& data = grid.data; auto& scorch = grid.scorch;
  double r2 = r * r;
  int x0 = std::max(0, (int)std::floor(x - r)), x1 = std::min(w - 1, (int)std::ceil(x + r));
  int y0 = std::max(0, (int)std::floor(y - r)), y1 = std::min(h - 1, (int)std::ceil(y + r));
  int destroyed = 0;

  for (int yy = y0; yy <= y1; yy++) {
    for (int xx = x0; xx <= x1; xx++) {
      double dx = xx + 0.5 - x, dy = yy + 0.5 - y;
      double d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      int i = yy * w + xx;
      uint8_t m = mat[i];
      if (m == M::EMPTY) continue;

      double d = std::sqrt(d2);
      double f = 1 - d / r;
      double dmg = power * f * (0.75 + rnd() * 0.5);

      if (dmg >= hp[i]) {
        if (m == M::BARREL && hooks) hooks->onBarrel(data[i]);
        mat[i] = M::EMPTY; hp[i] = 0; data[i] = 0;
        grid.markDirty(xx, yy);
        grid.navTouch(xx, yy);
        destroyed++;
        double ux, uy;
        if (d < 0.5) { double a = rnd() * 6.2832; ux = std::cos(a); uy = std::sin(a); }
        else { ux = dx / d; uy = dy / d; }
        double speed = (0.5 + f * 2.2) * (0.6 + rnd() * 0.8);
        if (rnd() < DEBRIS_CHANCE[m]) {
          double jx = (rnd() - 0.5) * 0.4;
          double jy = (rnd() - 0.5) * 0.4;
          debris.spawn(xx + 0.5, yy + 0.5, ux * speed + jx, uy * speed + jy, m);
        }
        if (m == M::WOOD && rnd() < 0.3) {
          debris.spawn(xx + 0.5, yy + 0.5, ux * speed * 1.3, uy * speed * 1.3, M::EMBER, 40 + (int)(rnd() * 50));
        }
      } else if (dmg >= 1) {
        hp[i] -= (uint8_t)(int)dmg;
        grid.markDirty(xx, yy);
        if (m == M::WOOD && hooks && rnd() < 0.35) hooks->ignite(xx, yy);
      }
    }
  }
  if (destroyed) grid.version++;

  // Floor scorch on bare cells (dithered, ragged falloff)
  double sr = r * 1.15, sr2 = sr * sr;
  int sx0 = std::max(0, (int)std::floor(x - sr)), sx1 = std::min(w - 1, (int)std::ceil(x + sr));
  int sy0 = std::max(0, (int)std::floor(y - sr)), sy1 = std::min(h - 1, (int)std::ceil(y + sr));
  for (int yy = sy0; yy <= sy1; yy++) {
    for (int xx = sx0; xx <= sx1; xx++) {
      double dx = xx + 0.5 - x, dy = yy + 0.5 - y;
      double d2 = dx * dx + dy * dy;
      if (d2 > sr2) continue;
      int i = yy * w + xx;
      if (mat[i] != M::EMPTY) continue;
      double nn = 1 - std::sqrt(d2) / sr + (rnd() - 0.5) * 0.45;
      uint8_t lvl = nn > 0.5 ? 2 : nn > 0.12 ? 1 : 0;
      if (lvl > scorch[i]) { scorch[i] = lvl; grid.markDirty(xx, yy); }
    }
  }

  // Sparks
  int sparks = (int)(r * 1.2);
  for (int k = 0; k < sparks; k++) {
    double a = rnd() * 6.2832;
    double s = 1 + rnd() * 3.5;
    debris.spawn(x, y, std::cos(a) * s, std::sin(a) * s, M::SPARK, 15 + (int)(rnd() * 25));
  }
  return destroyed;
}
