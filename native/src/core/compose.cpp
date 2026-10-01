#include "compose.h"
#include <algorithm>
#include <cmath>
#include <cstring>

namespace {
// 4x4 ordered dither thresholds: gives the gas a comic halftone look.
const float BAYER[16] = {
  (0 + 0.5f) / 16, (8 + 0.5f) / 16, (2 + 0.5f) / 16, (10 + 0.5f) / 16,
  (12 + 0.5f) / 16, (4 + 0.5f) / 16, (14 + 0.5f) / 16, (6 + 0.5f) / 16,
  (3 + 0.5f) / 16, (11 + 0.5f) / 16, (1 + 0.5f) / 16, (9 + 0.5f) / 16,
  (15 + 0.5f) / 16, (7 + 0.5f) / 16, (13 + 0.5f) / 16, (5 + 0.5f) / 16,
};
constexpr uint32_t SMOKE = g(0x2e), SMOKE_ON_DARK = g(0x74), SOOT = g(0x10);
constexpr uint32_t STEAM_ON_LIGHT = g(0xa8);
constexpr uint32_t TRAIL = g(0x78);
constexpr uint32_t FIRE_CYCLE[4] = {C_ORANGE, C_FLAME_HOT, C_ORANGE, g(0x18)};
constexpr uint32_t DEBRIS_COLOR[12] = {0, g(0x20), g(0x48), g(0x50), g(0x6a), C_ORANGE, g(0x10), g(0x30), C_ORANGE, g(0x50), g(0x22), g(0xb0)};

inline bool inView(int x, int y) { return x >= 0 && y >= 0 && x < VIEW_W && y < VIEW_H; }
} // namespace

Composer::Composer(const Grid& g_) : grid(&g_), chunks((size_t)g_.cw * g_.ch) {}

void Composer::renderChunk(int ci, int cx, int cy) {
  auto& px = chunks[ci];
  if (px.empty()) px.resize(CHUNK * CHUNK);
  int bx = cx * CHUNK, by = cy * CHUNK;
  for (int ly = 0; ly < CHUNK; ly++) {
    for (int lx = 0; lx < CHUNK; lx++) px[ly * CHUNK + lx] = cellColor(*grid, bx + lx, by + ly);
  }
  redraws++;
}

void Composer::applyTouched(Grid& g) {
  for (int i : g.touched) {
    int x = i % g.w, y = i / g.w;
    int ci = (y >> CHUNK_SHIFT) * g.cw + (x >> CHUNK_SHIFT);
    auto& c = chunks[ci];
    if (!c.empty() && !g.dirty[ci]) c[(y & (CHUNK - 1)) * CHUNK + (x & (CHUNK - 1))] = cellColor(g, x, y);
  }
  g.touched.clear();
}

void Composer::terrain(Grid& g, uint32_t* frame, int camX, int camY) {
  int cx0 = camX >> CHUNK_SHIFT, cx1 = (camX + VIEW_W - 1) >> CHUNK_SHIFT;
  int cy0 = camY >> CHUNK_SHIFT, cy1 = (camY + VIEW_H - 1) >> CHUNK_SHIFT;
  cx1 = std::min(cx1, g.cw - 1); cy1 = std::min(cy1, g.ch - 1);
  for (int cy = cy0; cy <= cy1; cy++) {
    for (int cx = cx0; cx <= cx1; cx++) {
      int ci = cy * g.cw + cx;
      if (g.dirty[ci] || chunks[ci].empty()) { renderChunk(ci, cx, cy); g.dirty[ci] = 0; }
      const auto& px = chunks[ci];
      int bx = cx * CHUNK - camX, by = cy * CHUNK - camY;
      int xa = std::max(0, bx), xb = std::min(VIEW_W, bx + CHUNK);
      if (xb <= xa) continue;
      for (int ly = 0; ly < CHUNK; ly++) {
        int sy = by + ly;
        if (sy < 0 || sy >= VIEW_H) continue;
        std::memcpy(frame + sy * VIEW_W + xa, px.data() + ly * CHUNK + (xa - bx), (xb - xa) * sizeof(uint32_t));
      }
    }
  }
}

void Composer::compose(Game& game, uint32_t* frame, int camX, int camY) {
  tick = game.tick;
  redraws = 0;
  applyTouched(game.grid);
  terrain(game.grid, frame, camX, camY);
  drawFire(game, frame, camX, camY);
  drawDebris(game.debris, frame, camX, camY, game.tick);
  drawScrap(game, frame, camX, camY);
  drawFlag(game.flag, frame, camX, camY, game.tick);
  for (Tank* t : game.tanks) if (t->alive) drawTank(frame, camX, camY, *t, game.tick);
  drawProjectiles(game, frame, camX, camY);
  drawGas(game.gas, frame, camX, camY);
  for (const auto& f : game.flashes) drawFlash(frame, f, camX, camY);
}

void Composer::drawFire(Game& game, uint32_t* frame, int camX, int camY) {
  int w = game.grid.w, tk = game.tick >> 2;
  for (int i : game.flames.list) {
    int x = (i % w) - camX, y = (i / w) - camY;
    if (!inView(x, y)) continue;
    frame[y * VIEW_W + x] = FIRE_CYCLE[hash(i, tk) & 3];
  }
}

void Composer::drawDebris(const Debris& d, uint32_t* frame, int camX, int camY, int tk) {
  for (int i = 0; i < d.n; i++) {
    int px = (int)std::floor(d.x[i]) - camX, py = (int)std::floor(d.y[i]) - camY;
    if (!inView(px, py)) continue;
    uint8_t m = d.m[i];
    frame[py * VIEW_W + px] = m == M::EMBER || m == M::SPARK ? (((i + tk) & 2) ? C_ORANGE : C_FLAME_HOT) : DEBRIS_COLOR[m];
  }
}

// The objective: a pole with a waving cloth, red while the enemy holds it,
// turning blue from the bottom up as it is captured.
void Composer::drawFlag(const Flag& f, uint32_t* frame, int camX, int camY, int tk) {
  int bx = (int)jsround(f.x) - camX, by = (int)jsround(f.y) - camY;
  auto put = [&](int x, int y, uint32_t c) { if (inView(x, y)) frame[y * VIEW_W + x] = c; };
  for (int dy = -4; dy <= 4; dy++) for (int dx = -4; dx <= 4; dx++) if (dx * dx + dy * dy <= 16) put(bx + dx, by + dy, dx * dx + dy * dy >= 9 ? C_BLACK : g(0x60)); // base
  for (int y = 0; y < 34; y++) { put(bx, by - y, C_BLACK); put(bx + 1, by - y, g(0x50)); } // pole
  int fill = (int)jsround(f.progress * 12);
  for (int y = 0; y < 12; y++) {
    for (int x = 0; x < 20; x++) {
      int wave = (int)jsround(std::sin(x * 0.45 - tk * 0.15) * 1.5 * (x / 20.0));
      int yy = by - 33 + y + wave;
      bool edge = y == 0 || y == 11 || x == 19;
      put(bx + 2 + x, yy, edge ? C_BLACK : 11 - y < fill ? C_ALLY : C_RED);
    }
  }
  put(bx, by - 35, C_YELLOW); put(bx + 1, by - 35, C_YELLOW);
}

// Spare-part pickups: a little bolt, blinks before vanishing.
void Composer::drawScrap(Game& game, uint32_t* frame, int camX, int camY) {
  for (const auto& s : game.scrap) {
    if (s.t < 180 && ((game.tick >> 3) & 1)) continue;
    int cx = (int)std::floor(s.x) - camX, cy = (int)std::floor(s.y) - camY;
    for (int oy = -1; oy <= 1; oy++) {
      for (int ox = -1; ox <= 1; ox++) {
        int px = cx + ox, py = cy + oy;
        if (!inView(px, py)) continue;
        frame[py * VIEW_W + px] = (ox == 0) != (oy == 0) ? C_WHITE : C_BLACK;
      }
    }
  }
}

void Composer::drawProjectiles(Game& game, uint32_t* frame, int camX, int camY) {
  for (const auto& p : game.projectiles) {
    if (p.kind == PK_SMOKE) { // canister
      int cx = (int)std::floor(p.x) - camX, cy = (int)std::floor(p.y) - camY;
      for (int oy = -1; oy <= 1; oy++) {
        for (int ox = -1; ox <= 1; ox++) {
          int px = cx + ox, py = cy + oy;
          if (!inView(px, py)) continue;
          frame[py * VIEW_W + px] = ox || oy ? C_BLACK : g(0x90);
        }
      }
      continue;
    }
    double sp = std::hypot(p.vx, p.vy);
    if (sp == 0) sp = 1;
    double dx = p.vx / sp, dy = p.vy / sp;
    uint32_t head = p.team != 0 ? C_RED : p.fromPlayer ? C_BLACK : C_ALLY; // shells carry their team's colour
    if (p.kind == PK_MG) { // short tracer
      for (int k = 0; k < 4; k++) {
        int px = (int)std::floor(p.x - dx * k) - camX, py = (int)std::floor(p.y - dy * k) - camY;
        if (!inView(px, py)) continue;
        frame[py * VIEW_W + px] = k == 0 ? C_ORANGE : head;
      }
      continue;
    }
    for (int k = 0; k < 10; k++) {
      int px = (int)std::floor(p.x - dx * k) - camX, py = (int)std::floor(p.y - dy * k) - camY;
      if (!inView(px, py)) continue;
      if (k < 3) frame[py * VIEW_W + px] = head;
      else if (k % 2 == 1) frame[py * VIEW_W + px] = TRAIL;
    }
    // 2px thick head
    int hx = (int)std::floor(p.x - dy) - camX, hy = (int)std::floor(p.y + dx) - camY;
    if (inView(hx, hy)) frame[hy * VIEW_W + hx] = head;
  }
}

// Bilinear-sampled gas, thresholded with the Bayer matrix.
void Composer::drawGas(const Gas& gas, uint32_t* frame, int camX, int camY) {
  if (gas.active <= 0) return;
  const int s = gas.s, w = gas.w, h = gas.h, gox = gas.ox, goy = gas.oy;
  const double* smoke = gas.smoke.data();
  const double* heat = gas.heat.data();
  const double* steam = gas.steam.data();
  // i, j are window cells; world position is (i + ox, j + oy) * s
  int i0 = std::max(0, (int)std::floor(camX / (double)s) - gox - 1), i1 = std::min(w - 2, (int)std::floor((camX + VIEW_W) / (double)s) - gox + 1);
  int j0 = std::max(0, (int)std::floor(camY / (double)s) - goy - 1), j1 = std::min(h - 2, (int)std::floor((camY + VIEW_H) / (double)s) - goy + 1);
  for (int j = j0; j <= j1; j++) {
    for (int i = i0; i <= i1; i++) {
      int k = j * w + i, k1 = k + 1, k2 = k + w, k3 = k + w + 1;
      double s0 = smoke[k], s1 = smoke[k1], s2 = smoke[k2], s3 = smoke[k3];
      double h0 = heat[k], h1 = heat[k1], h2 = heat[k2], h3 = heat[k3];
      double t0 = steam[k], t1 = steam[k1], t2 = steam[k2], t3 = steam[k3];
      if (s0 + s1 + s2 + s3 < 0.05 && h0 + h1 + h2 + h3 < 0.15 && t0 + t1 + t2 + t3 < 0.05) continue;
      int wx0 = (int)((i + gox + 0.5) * s), wy0 = (int)((j + goy + 0.5) * s);
      for (int oy = 0; oy < s; oy++) {
        int py = wy0 + oy - camY;
        if (py < 0 || py >= VIEW_H) continue;
        double fy = (oy + 0.5) / s;
        for (int ox = 0; ox < s; ox++) {
          int px = wx0 + ox - camX;
          if (px < 0 || px >= VIEW_W) continue;
          double fx = (ox + 0.5) / s;
          double a = (1 - fx) * (1 - fy), b = fx * (1 - fy), c = (1 - fx) * fy, d = fx * fy;
          double ht = h0 * a + h1 * b + h2 * c + h3 * d;
          double th = BAYER[((py & 3) << 2) | (px & 3)];
          int idx = py * VIEW_W + px;
          if (ht > 0.2 + th * 0.7) {
            // flame body is orange; only the hottest dithered tongues go
            // pale yellow, with soot flecks licking through
            uint32_t flick = hash(px + (tick >> 2) * 7, py - (tick >> 2) * 13) & 7;
            frame[idx] = flick == 0 ? SOOT : ht > 1.1 + th * 0.9 && flick > 3 ? C_FLAME_HOT : C_ORANGE;
            continue;
          }
          double sm = s0 * a + s1 * b + s2 * c + s3 * d;
          if (sm > 0.05 + th * 1.1) {
            uint32_t L = frame[idx] & 255;
            frame[idx] = sm > 1 && ((px ^ py) & 1) ? SOOT : L < 0x60 ? SMOKE_ON_DARK : SMOKE;
            continue;
          }
          double st = t0 * a + t1 * b + t2 * c + t3 * d;
          if (st > 0.04 + th * 0.7) frame[idx] = (frame[idx] & 255) > 0x90 ? STEAM_ON_LIGHT : C_WHITE;
        }
      }
    }
  }
}

// Comic "burst" star: white fill with a black outline, grows then hollows out.
void Composer::drawFlash(uint32_t* frame, const Flash& f, int camX, int camY) {
  int t = f.t;
  if (t >= 10) return;
  double R = std::min(40.0, f.r * 0.9) * (0.5 + 0.5 * std::min(1.0, t / 4.0));
  bool fill = t < 6;
  double cx = f.x - camX, cy = f.y - camY;
  int x0 = std::max(0, (int)std::floor(cx - R)), x1 = std::min(VIEW_W - 1, (int)std::ceil(cx + R));
  int y0 = std::max(0, (int)std::floor(cy - R)), y1 = std::min(VIEW_H - 1, (int)std::ceil(cy + R));
  for (int y = y0; y <= y1; y++) {
    for (int x = x0; x <= x1; x++) {
      double dx = x - cx, dy = y - cy;
      double d2 = dx * dx + dy * dy;
      if (d2 > R * R) continue;
      double spike = std::abs(std::sin(std::atan2(dy, dx) * 3.5 + f.spin));
      double lim = R * (0.55 + 0.45 * spike);
      double d = std::sqrt(d2);
      if (d >= lim) continue;
      if (d > lim - 2) frame[y * VIEW_W + x] = C_BLACK;
      else if (fill) frame[y * VIEW_W + x] = C_WHITE;
    }
  }
}

// ------------------------------------------------------------------ tanks

static constexpr uint32_t TREAD = g(0x5a);
static constexpr uint32_t SHADOW = g(0x60);
static constexpr uint32_t CHAR = g(0x38);

// Small yellow pennant on a whip antenna at the rear-left of the hull.
static void drawPennant(uint32_t* frame, int camX, int camY, const Tank& t, int tk) {
  double c = std::cos(t.a), s = std::sin(t.a);
  double u = -t.hl + 4, v = -t.hw + 4;
  int bx = (int)jsround(t.x + u * c - v * s - camX), by = (int)jsround(t.y + u * s + v * c - camY);
  auto put = [&](int x, int y, uint32_t col) { if (inView(x, y)) frame[y * VIEW_W + x] = col; };
  for (int k = 0; k < 9; k++) put(bx, by - k, C_BLACK);
  for (int yy = 0; yy < 4; yy++) {
    for (int xx = 1; xx <= 6 - yy; xx++) {
      int wave = (int)jsround(std::sin(xx * 0.8 - tk * 0.25) * 0.8);
      put(bx + xx, by - 9 + yy + wave, xx == 6 - yy || yy == 3 ? C_BLACK : C_YELLOW);
    }
  }
}

// Rasterizes a tank straight into the frame buffer (pixel-art rotation by
// inverse mapping). Every part is drawn from the same geometry used for hit
// tests, and reflects its damage state. A colored stroke outside the ink
// outline tells the team at a glance: red enemy, blue ally, bright blue +
// yellow pennant for the player.
void drawTank(uint32_t* frame, int camX, int camY, const Tank& t, int tk) {
  double c = std::cos(t.a), s = std::sin(t.a);
  double tc = std::cos(t.ta), ts = std::sin(t.ta);
  const double hl = t.hl, hw = t.hw, trackW = t.trackW, turretR = t.turretR;
  double BL = t.parts[CANNON].hp > 0 ? t.barrelLen : t.barrelLen * 0.45;
  double tx0 = t.x + t.turretOff * c, ty0 = t.y + t.turretOff * s;
  double R = std::max(t.bound, std::abs(t.turretOff) + turretR + BL) + 4;

  uint32_t body = g(t.s.body), bodyDark = g(std::max(0, t.s.body - 0x2c)), top = g(t.s.top);
  bool flashAll = t.hitT > 0;
  Part fz = t.flashT > 0 && (tk & 2) ? t.flashZone : NO_PART;
  double hullFrac = t.frac(HULL);
  bool engDead = t.parts[ENGINE].hp <= 0;
  bool turretDead = t.parts[TURRET].hp <= 0;
  bool brokenL = t.parts[TRACK_L].hp <= 0, brokenR = t.parts[TRACK_R].hp <= 0;
  // parts under 50% get scorched hatching, so damage reads at a glance
  bool hurtTurret = t.frac(TURRET) < 0.5, hurtCannon = t.frac(CANNON) < 0.5;
  bool hurtL = t.frac(TRACK_L) < 0.5, hurtR = t.frac(TRACK_R) < 0.5;
  bool hurtEngine = t.frac(ENGINE) < 0.5;
  uint32_t stroke = t.isPlayer ? C_PLAYER : t.team ? C_RED : C_ALLY;
  double sw = t.isPlayer ? 2 : 1.2; // stroke width in cells
  uint32_t hitCol = t.team ? C_RED : C_ORANGE; // flashing hit zone: red is for enemies
  double tr2 = turretR * turretR, tri2 = (turretR - 1.2) * (turretR - 1.2);
  double hatchR = turretR * 0.26;

  int x0 = std::max(0, (int)std::floor(t.x - R - camX)), x1 = std::min(VIEW_W - 1, (int)std::ceil(t.x + R - camX));
  int y0 = std::max(0, (int)std::floor(t.y - R - camY)), y1 = std::min(VIEW_H - 1, (int)std::ceil(t.y + R - camY));

  for (int py = y0; py <= y1; py++) {
    for (int px = x0; px <= x1; px++) {
      double wx = px + camX + 0.5, wy = py + camY + 0.5;
      double dx = wx - t.x, dy = wy - t.y;
      double u = dx * c + dy * s, v = -dx * s + dy * c;
      double ex = wx - tx0, ey = wy - ty0;
      double tu = ex * tc + ey * ts, tv = -ex * ts + ey * tc;
      double d2 = tu * tu + tv * tv;
      int64_t col = -1;
      Part zone = NO_PART;
      bool outline = false;

      if (tu > 0 && tu <= turretR + BL && std::abs(tv) <= 1.6 && d2 > tri2) {
        zone = CANNON;
        if (std::abs(tv) > 0.85 || tu > turretR + BL - 1.2) { col = C_BLACK; outline = true; }
        else col = hurtCannon && ((px + py) & 1) ? CHAR : top;
      } else if (d2 <= tr2) {
        zone = TURRET;
        if (d2 > tri2) { col = C_BLACK; outline = true; }
        else {
          // two round hatches, like the reference art
          double hu = tu + turretR * 0.25, hv1 = tv - turretR * 0.38, hv2 = tv + turretR * 0.38;
          double h1 = std::sqrt(hu * hu + hv1 * hv1), h2 = std::sqrt(hu * hu + hv2 * hv2);
          if (std::abs(h1 - hatchR) < 0.55 || std::abs(h2 - hatchR) < 0.55) col = C_BLACK;
          else if (turretDead && ((px + py) & 1)) col = CHAR;
          else if (hurtTurret && (px + 2 * py) % 4 == 0) col = CHAR;
          else col = top;
        }
      } else if (std::abs(u) <= hl && std::abs(v) <= hw) {
        double au = std::abs(u), avv = std::abs(v);
        if (au > hl - 1 || avv > hw - 1) {
          col = C_BLACK; outline = true;
          if (avv > hw - trackW && (v < 0 ? brokenL : brokenR) && hash((int)std::floor(u + 64), v < 0 ? 1 : 2) % 3 == 0) col = -1;
        } else if (avv > hw - trackW) {
          zone = v < 0 ? TRACK_L : TRACK_R;
          bool broken = v < 0 ? brokenL : brokenR;
          if (avv < hw - trackW + 1) col = C_BLACK;
          else if (broken && hash((int)std::floor(u + 64), v < 0 ? 1 : 2) % 3 == 0) col = -1; // snapped links
          else {
            double phase = v < 0 ? t.treadL : t.treadR;
            long long fl = (long long)std::floor(u - phase);
            col = ((fl % 3) + 3) % 3 == 0 ? C_BLACK : TREAD;
            if ((v < 0 ? hurtL : hurtR) && (px + py) % 3 == 0) col = C_WHITE; // torn, shiny metal
          }
        } else {
          double eu = u + hl; // distance from the rear
          zone = eu < t.engineLen ? ENGINE : eu < t.engineLen + t.ammoLen ? AMMO : HULL;
          if (zone == ENGINE) {
            col = engDead ? (((px + py) & 1) ? C_BLACK : CHAR) : (((long long)std::floor(eu) & 1) ? bodyDark : body);
            if (hurtEngine && !engDead && (px + 2 * py) % 4 == 0) col = CHAR;
          } else if (u > hl - 3) col = bodyDark;
          else col = body;
          if (hullFrac < 0.5 && (px + 2 * py) % 5 == 0) col = g(0x40);
          if (hullFrac < 0.25 && (2 * px + py) % 5 == 0) col = CHAR;
        }
      }

      int k = py * VIEW_W + px;
      if (col == -1) {
        // team stroke hugging the silhouette (hull, turret, barrel)
        bool inHull = std::abs(u) <= hl + sw && std::abs(v) <= hw + sw;
        bool inTurret = d2 <= (turretR + sw) * (turretR + sw);
        bool inBarrel = tu > 0 && tu <= turretR + BL + sw && std::abs(tv) <= 1.6 + sw;
        if (inHull || inTurret || inBarrel) { frame[k] = stroke; continue; }
        // drop shadow, light from the top-left
        double sx = dx - 2.5, sy = dy - 2.5;
        double su = sx * c + sy * s, sv = -sx * s + sy * c;
        if (std::abs(su) <= hl && std::abs(sv) <= hw && ((px + py) & 1)) frame[k] = SHADOW;
        continue;
      }
      if (flashAll && !outline) col = C_WHITE;
      else if (fz != NO_PART && zone == fz && !outline) col = hitCol;
      frame[k] = (uint32_t)col;
    }
  }

  if (t.isPlayer) drawPennant(frame, camX, camY, t, tk);
}
