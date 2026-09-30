import { VIEW_W, VIEW_H, CHUNK, CHUNK_SHIFT } from '../config.js';
import { cellColor, g, RED, WHITE, BLACK, DEBRIS_COLOR } from './palette.js';
import { M } from '../world/materials.js';
import { drawTank } from './tankdraw.js';
import { hash } from '../util/rng.js';

// 4x4 ordered dither thresholds: gives the gas a comic halftone look.
const BAYER = new Float32Array([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16));
const SMOKE = g(0x2e), SMOKE_ON_DARK = g(0x74), SOOT = g(0x10);
const STEAM_ON_LIGHT = g(0xa8);
const TRAIL = g(0x78);
const FIRE_CYCLE = [RED, WHITE, RED, g(0x18)];

// Builds a full frame into a Uint32 buffer (VIEW_W x VIEW_H). DOM-free.
export class Composer {
  constructor(grid) {
    this.grid = grid;
    this.chunks = new Array(grid.cw * grid.ch).fill(null); // cached terrain bitmaps
    this.redraws = 0;
  }

  renderChunk(ci, cx, cy) {
    let px = this.chunks[ci];
    if (!px) px = this.chunks[ci] = new Uint32Array(CHUNK * CHUNK);
    const bx = cx * CHUNK, by = cy * CHUNK, grid = this.grid;
    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) px[ly * CHUNK + lx] = cellColor(grid, bx + lx, by + ly);
    }
    this.redraws++;
  }

  applyTouched() {
    const grid = this.grid, list = grid.touched;
    for (let n = 0; n < list.length; n++) {
      const i = list[n];
      const x = i % grid.w, y = (i / grid.w) | 0;
      const ci = (y >> CHUNK_SHIFT) * grid.cw + (x >> CHUNK_SHIFT);
      const c = this.chunks[ci];
      if (c && !grid.dirty[ci]) c[(y & (CHUNK - 1)) * CHUNK + (x & (CHUNK - 1))] = cellColor(grid, x, y);
    }
    list.length = 0;
  }

  terrain(frame, camX, camY) {
    const grid = this.grid;
    const cx0 = camX >> CHUNK_SHIFT, cx1 = (camX + VIEW_W - 1) >> CHUNK_SHIFT;
    const cy0 = camY >> CHUNK_SHIFT, cy1 = (camY + VIEW_H - 1) >> CHUNK_SHIFT;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const ci = cy * grid.cw + cx;
        if (grid.dirty[ci] || !this.chunks[ci]) { this.renderChunk(ci, cx, cy); grid.dirty[ci] = 0; }
        const px = this.chunks[ci];
        const bx = cx * CHUNK - camX, by = cy * CHUNK - camY;
        const xa = Math.max(0, bx), xb = Math.min(VIEW_W, bx + CHUNK);
        if (xb <= xa) continue;
        for (let ly = 0; ly < CHUNK; ly++) {
          const sy = by + ly;
          if (sy < 0 || sy >= VIEW_H) continue;
          frame.set(px.subarray(ly * CHUNK + (xa - bx), ly * CHUNK + (xb - bx)), sy * VIEW_W + xa);
        }
      }
    }
  }

  compose(game, frame, camX, camY) {
    this.tick = game.tick;
    this.redraws = 0;
    this.applyTouched();
    this.terrain(frame, camX, camY);
    this.drawFire(game, frame, camX, camY);
    this.drawDebris(game.debris, frame, camX, camY, game.tick);
    this.drawScrap(game, frame, camX, camY);
    for (const t of game.tanks) if (t.alive) drawTank(frame, camX, camY, t, game.tick);
    this.drawProjectiles(game, frame, camX, camY);
    this.drawGas(game.gas, frame, camX, camY);
    for (const f of game.flashes) this.drawFlash(frame, f, camX, camY);
  }

  drawFire(game, frame, camX, camY) {
    const list = game.flames.list, w = this.grid.w, tk = game.tick >> 2;
    for (let n = 0; n < list.length; n++) {
      const i = list[n];
      const x = (i % w) - camX, y = ((i / w) | 0) - camY;
      if (x < 0 || y < 0 || x >= VIEW_W || y >= VIEW_H) continue;
      frame[y * VIEW_W + x] = FIRE_CYCLE[hash(i, tk) & 3];
    }
  }

  drawDebris(d, frame, camX, camY, tick) {
    for (let i = 0; i < d.n; i++) {
      const px = Math.floor(d.x[i]) - camX, py = Math.floor(d.y[i]) - camY;
      if (px < 0 || py < 0 || px >= VIEW_W || py >= VIEW_H) continue;
      const m = d.m[i];
      frame[py * VIEW_W + px] = m === M.EMBER || m === M.SPARK ? (((i + tick) & 2) ? RED : WHITE) : DEBRIS_COLOR[m];
    }
  }

  // Spare-part pickups: a little bolt, blinks before vanishing.
  drawScrap(game, frame, camX, camY) {
    for (const s of game.scrap) {
      if (s.t < 180 && (game.tick >> 3) & 1) continue;
      const cx = Math.floor(s.x) - camX, cy = Math.floor(s.y) - camY;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const px = cx + ox, py = cy + oy;
          if (px < 0 || py < 0 || px >= VIEW_W || py >= VIEW_H) continue;
          frame[py * VIEW_W + px] = (ox === 0) !== (oy === 0) ? WHITE : BLACK;
        }
      }
    }
  }

  drawProjectiles(game, frame, camX, camY) {
    for (const p of game.projectiles.list) {
      if (p.kind === 'smoke') { // canister
        const cx = Math.floor(p.x) - camX, cy = Math.floor(p.y) - camY;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const px = cx + ox, py = cy + oy;
            if (px < 0 || py < 0 || px >= VIEW_W || py >= VIEW_H) continue;
            frame[py * VIEW_W + px] = ox || oy ? BLACK : g(0x90);
          }
        }
        continue;
      }
      const sp = Math.hypot(p.vx, p.vy) || 1, dx = p.vx / sp, dy = p.vy / sp;
      const head = p.team === 0 ? BLACK : RED;
      if (p.kind === 'mg') { // short tracer
        for (let k = 0; k < 4; k++) {
          const px = Math.floor(p.x - dx * k) - camX, py = Math.floor(p.y - dy * k) - camY;
          if (px < 0 || py < 0 || px >= VIEW_W || py >= VIEW_H) continue;
          frame[py * VIEW_W + px] = k === 0 ? RED : head;
        }
        continue;
      }
      for (let k = 0; k < 10; k++) {
        const px = Math.floor(p.x - dx * k) - camX, py = Math.floor(p.y - dy * k) - camY;
        if (px < 0 || py < 0 || px >= VIEW_W || py >= VIEW_H) continue;
        if (k < 3) frame[py * VIEW_W + px] = head;
        else if (k % 2 === 1) frame[py * VIEW_W + px] = TRAIL;
      }
      // 2px thick head
      const hx = Math.floor(p.x - dy) - camX, hy = Math.floor(p.y + dx) - camY;
      if (hx >= 0 && hy >= 0 && hx < VIEW_W && hy < VIEW_H) frame[hy * VIEW_W + hx] = head;
    }
  }

  // Bilinear-sampled gas, thresholded with the Bayer matrix.
  drawGas(gas, frame, camX, camY) {
    if (gas.active <= 0) return;
    const { s, w, h, smoke, heat, steam } = gas;
    const i0 = Math.max(0, Math.floor(camX / s) - 1), i1 = Math.min(w - 2, Math.floor((camX + VIEW_W) / s) + 1);
    const j0 = Math.max(0, Math.floor(camY / s) - 1), j1 = Math.min(h - 2, Math.floor((camY + VIEW_H) / s) + 1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * w + i, k1 = k + 1, k2 = k + w, k3 = k + w + 1;
        const s0 = smoke[k], s1 = smoke[k1], s2 = smoke[k2], s3 = smoke[k3];
        const h0 = heat[k], h1 = heat[k1], h2 = heat[k2], h3 = heat[k3];
        const t0 = steam[k], t1 = steam[k1], t2 = steam[k2], t3 = steam[k3];
        if (s0 + s1 + s2 + s3 < 0.05 && h0 + h1 + h2 + h3 < 0.15 && t0 + t1 + t2 + t3 < 0.05) continue;
        const wx0 = (i + 0.5) * s, wy0 = (j + 0.5) * s;
        for (let oy = 0; oy < s; oy++) {
          const py = wy0 + oy - camY;
          if (py < 0 || py >= VIEW_H) continue;
          const fy = (oy + 0.5) / s;
          for (let ox = 0; ox < s; ox++) {
            const px = wx0 + ox - camX;
            if (px < 0 || px >= VIEW_W) continue;
            const fx = (ox + 0.5) / s;
            const a = (1 - fx) * (1 - fy), b = fx * (1 - fy), c = (1 - fx) * fy, d = fx * fy;
            const ht = h0 * a + h1 * b + h2 * c + h3 * d;
            const th = BAYER[((py & 3) << 2) | (px & 3)];
            const idx = py * VIEW_W + px;
            if (ht > 0.2 + th * 0.7) {
              // flame body is red; only the hottest dithered tongues go white,
              // with black soot flecks licking through (flickers every 3 ticks)
              const flick = hash(px + (this.tick >> 2) * 7, py - (this.tick >> 2) * 13) & 7;
              frame[idx] = flick === 0 ? SOOT : ht > 1.1 + th * 0.9 && flick > 3 ? WHITE : RED;
              continue;
            }
            const sm = s0 * a + s1 * b + s2 * c + s3 * d;
            if (sm > 0.05 + th * 1.1) {
              const L = frame[idx] & 255;
              frame[idx] = sm > 1 && ((px ^ py) & 1) ? SOOT : L < 0x60 ? SMOKE_ON_DARK : SMOKE;
              continue;
            }
            const st = t0 * a + t1 * b + t2 * c + t3 * d;
            if (st > 0.04 + th * 0.7) frame[idx] = (frame[idx] & 255) > 0x90 ? STEAM_ON_LIGHT : WHITE;
          }
        }
      }
    }
  }

  // Comic "burst" star: white fill with a black outline, grows then hollows out.
  drawFlash(frame, f, camX, camY) {
    const t = f.t;
    if (t >= 10) return;
    const R = Math.min(40, f.r * 0.9) * (0.5 + 0.5 * Math.min(1, t / 4));
    const fill = t < 6;
    const cx = f.x - camX, cy = f.y - camY;
    const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(VIEW_W - 1, Math.ceil(cx + R));
    const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(VIEW_H - 1, Math.ceil(cy + R));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > R * R) continue;
        const spike = Math.abs(Math.sin(Math.atan2(dy, dx) * 3.5 + f.spin));
        const lim = R * (0.55 + 0.45 * spike);
        const d = Math.sqrt(d2);
        if (d >= lim) continue;
        if (d > lim - 2) frame[y * VIEW_W + x] = BLACK;
        else if (fill) frame[y * VIEW_W + x] = WHITE;
      }
    }
  }
}
