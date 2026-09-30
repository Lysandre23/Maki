import { SOLID } from './materials.js';

const ITER = 6;        // pressure solver iterations (warm-started, over-relaxed)
const SOR = 1.6;
const VORT = 0.22;     // vorticity confinement strength (swirl)

// Smoke, heat (fire) and steam carried by a 2D incompressible velocity field
// (Stam-style stable fluids) on a coarse grid. Walls from the cell grid are
// obstacles, so blasts push smoke around corners and through fresh holes.
// Explosions are modelled as a divergence source (the gas expands outward).
export class Gas {
  constructor(w, h, scale) {
    this.s = scale;
    this.w = Math.ceil(w / scale);
    this.h = Math.ceil(h / scale);
    const n = this.w * this.h;
    const f = () => new Float64Array(n); // f64: avoids f32<->f64 conversions in hot loops
    this.u = f(); this.v = f(); this.u0 = f(); this.v0 = f();
    this.p = f(); this.div = f(); this.curl = f(); this.expand = f(); this.tmp = f();
    this.smoke = f(); this.heat = f(); this.steam = f();
    this.solid = new Uint8Array(n);
    this.open = new Float64Array(n);  // 1 - solid, for branch-free stencils
    this.inv = new Float64Array(n);   // 1 / number of open neighbours
    this.windX = 0; this.windY = 0;
    this.active = 0;
  }

  clear() {
    for (const a of [this.u, this.v, this.u0, this.v0, this.p, this.div, this.curl, this.expand, this.smoke, this.heat, this.steam]) a.fill(0);
    this.active = 0;
  }

  syncSolid(grid) {
    const { w, h, s, solid } = this;
    const half = s >> 1;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        if (i === 0 || j === 0 || i === w - 1 || j === h - 1) { solid[k] = 1; continue; }
        const wx = Math.min(grid.w - 1, i * s + half), wy = Math.min(grid.h - 1, j * s + half);
        solid[k] = SOLID[grid.mat[wy * grid.w + wx]];
        if (solid[k]) { this.smoke[k] = 0; this.heat[k] = 0; this.steam[k] = 0; this.u[k] = 0; this.v[k] = 0; }
      }
    }
    const { open, inv } = this;
    for (let k = 0; k < solid.length; k++) open[k] = 1 - solid[k];
    for (let j = 1; j < h - 1; j++) {
      for (let i = 1, k = j * w + 1; i < w - 1; i++, k++) {
        const nc = open[k - 1] + open[k + 1] + open[k - w] + open[k + w];
        inv[k] = solid[k] || nc === 0 ? 0 : 1 / nc;
      }
    }
  }

  cell(x, y) {
    const i = Math.floor(x / this.s), j = Math.floor(y / this.s);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    const k = j * this.w + i;
    return this.solid[k] ? -1 : k;
  }

  addSmoke(x, y, a) { const k = this.cell(x, y); if (k >= 0) { this.smoke[k] = Math.min(3, this.smoke[k] + a); this.active = 600; } }
  addHeat(x, y, a) { const k = this.cell(x, y); if (k >= 0) { this.heat[k] = Math.min(2, this.heat[k] + a); this.active = 600; } }
  addSteam(x, y, a) { const k = this.cell(x, y); if (k >= 0) { this.steam[k] = Math.min(3, this.steam[k] + a); this.active = 600; } }
  addExpand(x, y, a) { const k = this.cell(x, y); if (k >= 0) { this.expand[k] += a; this.active = 600; } }
  // velocity in world cells per tick
  addVel(x, y, vx, vy) { const k = this.cell(x, y); if (k >= 0) { this.u[k] += vx / this.s; this.v[k] += vy / this.s; this.active = 600; } }

  // Cold blast: heat vanishes, hot gas condenses into a burst of steam.
  chill(x, y, r) {
    const { w, h, s } = this;
    const gx = x / s, gy = y / s, gr = Math.max(1, r / s);
    for (let j = Math.max(1, Math.floor(gy - gr)); j <= Math.min(h - 2, gy + gr); j++) {
      for (let i = Math.max(1, Math.floor(gx - gr)); i <= Math.min(w - 2, gx + gr); i++) {
        if ((i - gx) ** 2 + (j - gy) ** 2 > gr * gr) continue;
        const k = j * w + i;
        if (this.heat[k] > 0.05) this.steam[k] = Math.min(3, this.steam[k] + this.heat[k] * 1.5);
        this.heat[k] = 0;
      }
    }
    this.active = 600;
  }

  smokeAt(x, y) { const k = this.cell(x, y); return k < 0 ? 0 : this.smoke[k]; }
  heatAt(x, y) { const k = this.cell(x, y); return k < 0 ? 0 : this.heat[k]; }

  blast(x, y, r, power, heatMul = 1) {
    const { w, h, s } = this;
    const gx = x / s - 0.5, gy = y / s - 0.5;
    const gr = Math.max(1.5, (r * 1.3) / s);
    const j0 = Math.max(1, Math.floor(gy - gr)), j1 = Math.min(h - 2, Math.ceil(gy + gr));
    const i0 = Math.max(1, Math.floor(gx - gr)), i1 = Math.min(w - 2, Math.ceil(gx + gr));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * w + i;
        if (this.solid[k]) continue;
        const dx = i - gx, dy = j - gy;
        const d = Math.hypot(dx, dy);
        const f = 1 - d / gr;
        if (f <= 0) continue;
        this.expand[k] += power * 0.04 * f;
        this.smoke[k] = Math.min(3, this.smoke[k] + f * power * 0.05);
        this.heat[k] = Math.min(2, this.heat[k] + f * power * 0.09 * heatMul);
        if (d > 0.2) {
          this.u[k] += (dx / d) * f * power * 0.04;
          this.v[k] += (dy / d) * f * power * 0.04;
        }
      }
    }
    this.active = 600;
  }

  step() {
    if (this.active <= 0) return;
    this.active--;
    const { u, v, u0, v0, tmp, smoke, heat, steam, expand } = this;
    const n = u.length;

    this.vorticity();
    if (this.windX || this.windY) {
      for (let k = 0; k < n; k++) { u[k] += this.windX; v[k] += this.windY; }
    }

    u0.set(u); v0.set(v);
    this.advect(u, u0, u0, v0);
    this.advect(v, v0, u0, v0);
    this.project();

    tmp.set(smoke); this.advect(smoke, tmp, u, v);
    tmp.set(heat); this.advect(heat, tmp, u, v);
    tmp.set(steam); this.advect(steam, tmp, u, v);

    for (let k = 0; k < n; k++) {
      u[k] *= 0.96; v[k] *= 0.96;
      expand[k] *= 0.3;
      const hk = heat[k];
      if (hk > 0.01) {
        smoke[k] = Math.min(3, smoke[k] + hk * 0.025); // fire turns into smoke as it cools
        heat[k] = hk * 0.93;
      } else heat[k] = 0;
      const sk = smoke[k] * 0.996;
      smoke[k] = sk < 0.004 ? 0 : sk;
      steam[k] *= 0.975;
    }
  }

  vorticity() {
    const { w, h, u, v, curl, solid } = this;
    for (let j = 1; j < h - 1; j++) {
      for (let i = 1, k = j * w + 1; i < w - 1; i++, k++) {
        curl[k] = 0.5 * ((v[k + 1] - v[k - 1]) - (u[k + w] - u[k - w]));
      }
    }
    for (let j = 2; j < h - 2; j++) {
      for (let i = 2, k = j * w + 2; i < w - 2; i++, k++) {
        if (solid[k]) continue;
        const c = curl[k];
        if (c === 0) continue;
        const gx = 0.5 * (Math.abs(curl[k + 1]) - Math.abs(curl[k - 1]));
        const gy = 0.5 * (Math.abs(curl[k + w]) - Math.abs(curl[k - w]));
        const len = Math.sqrt(gx * gx + gy * gy) + 1e-6;
        u[k] += VORT * (gy / len) * c;
        v[k] -= VORT * (gx / len) * c;
      }
    }
  }

  advect(dst, src, U, V) {
    const { w, h, solid } = this;
    const maxX = w - 1.5, maxY = h - 1.5;
    for (let j = 1; j < h - 1; j++) {
      for (let i = 1, k = j * w + 1; i < w - 1; i++, k++) {
        if (solid[k]) { dst[k] = 0; continue; }
        let x = i - U[k], y = j - V[k];
        if (x < 0.5) x = 0.5; else if (x > maxX) x = maxX;
        if (y < 0.5) y = 0.5; else if (y > maxY) y = maxY;
        const i0 = x | 0, j0 = y | 0, fx = x - i0, fy = y - j0;
        const q = j0 * w + i0;
        dst[k] = (src[q] * (1 - fx) + src[q + 1] * fx) * (1 - fy) +
                 (src[q + w] * (1 - fx) + src[q + w + 1] * fx) * fy;
      }
    }
  }

  // Make the flow divergence-free except where `expand` asks for expansion.
  // Solid neighbours use Neumann boundaries (no flow through walls).
  project() {
    const { w, h, u, v, p, div, open, inv, expand } = this;
    const end = (h - 1) * w - 1;
    for (let k = w + 1; k < end; k++) {
      div[k] = open[k] * (0.5 * (u[k + 1] - u[k - 1] + v[k + w] - v[k - w]) - expand[k]);
    }
    // Over-relaxed Gauss-Seidel, warm-started from last tick's pressure.
    // Solid cells have inv = 0 so they stay at p = 0, and solid neighbours are
    // masked out by `open` (Neumann boundary). Row-edge cells are border walls
    // (always solid), so a flat loop over k is safe.
    for (let it = 0; it < ITER; it++) {
      for (let k = w + 1; k < end; k++) {
        const gs = (p[k - 1] * open[k - 1] + p[k + 1] * open[k + 1] +
                    p[k - w] * open[k - w] + p[k + w] * open[k + w] - div[k]) * inv[k];
        p[k] = (p[k] + SOR * (gs - p[k])) * open[k];
      }
    }
    for (let k = w + 1; k < end; k++) {
      const o = open[k], pc = p[k];
      const ol = open[k - 1], or = open[k + 1], ou = open[k - w], od = open[k + w];
      const pl = p[k - 1] * ol + pc * (1 - ol), pr = p[k + 1] * or + pc * (1 - or);
      const pu = p[k - w] * ou + pc * (1 - ou), pd = p[k + w] * od + pc * (1 - od);
      u[k] = o * (u[k] - 0.5 * (pr - pl));
      v[k] = o * (v[k] - 0.5 * (pd - pu));
    }
  }
}
