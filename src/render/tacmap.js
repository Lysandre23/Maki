import { ROOM_W, ROOM_H } from '../config.js';
import { M } from '../world/materials.js';
import { NODE } from '../game/vision.js';
import { alive, centroid } from '../game/squads.js';

// Tactical map: a paused, schematic view of the whole battlefield where the
// player selects squads and gives orders. Drawn on its own full-resolution
// canvas over the stage; the simulation is frozen while it is open.

const DS = 4; // world cells per schematic pixel
const TONE = {
  [M.EMPTY]: [0xdb, 0xd5, 0xc3], [M.RUBBLE]: [0xb3, 0xab, 0x99], [M.GRASS]: [0xbf, 0xcb, 0x9e],
  [M.HEDGE]: [0x5b, 0x77, 0x47], [M.HAY]: [0xd9, 0xbf, 0x66], [M.WOOD]: [0x9c, 0x7a, 0x52],
  [M.BRICK]: [0x5a, 0x4c, 0x48], [M.STONE]: [0x4a, 0x4a, 0x4a], [M.WRECK]: [0x2a, 0x2a, 0x2a],
  [M.BARREL]: [0x8a, 0x5a, 0x30],
};
const SOLID_FIRST = [M.STONE, M.BRICK, M.WRECK, M.WOOD, M.BARREL, M.HAY, M.HEDGE]; // what wins a 4x4 block
const BURN = [0xff, 0x8a, 0x1c];
const YELLOW = '#ffd21e', ALLY = '#3c8cff', RED = '#ff2d2d', INK = '#000';
const ORDER_NAME = { follow: 'FOLLOW', move: 'MOVE', attack: 'ATTACK', hold: 'HOLD' };
const FONT = 'Bangers, Impact, sans-serif';

export class TacMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.open = false;
    this.sel = null;       // selected squad id
    this.flash = null;     // { text, t } feedback line
    this.terrain = document.createElement('canvas');
    this.terrain.width = Math.ceil(ROOM_W / DS);
    this.terrain.height = Math.ceil(ROOM_H / DS);
    this.fog = document.createElement('canvas');
    this.mouse = { x: 0, y: 0 };
    this.tags = new Map(); // squad id -> tag centre, as last drawn (click target)
  }

  resize(w, h, scale) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.s = scale;
  }

  toggle(game) {
    this.open = !this.open;
    this.canvas.style.display = this.open ? 'block' : 'none';
    if (!this.open) return;
    this.buildTerrain(game);
    this.buildFog(game);
    if (!game.squad(this.sel)) this.sel = game.squads.find((q) => alive(q).length)?.id ?? null;
  }

  // Flat-tone schematic, one pixel per DS x DS block; solids win so thin
  // hedgerows and walls survive the downscale. Fires are baked in (sim is paused).
  buildTerrain(game) {
    const { grid } = game, cv = this.terrain, w = cv.width, h = cv.height;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
    const burning = new Uint8Array(w * h);
    for (const i of game.flames.list) {
      const x = i % grid.w, y = (i / grid.w) | 0;
      burning[((y / DS) | 0) * w + ((x / DS) | 0)] = 1;
    }
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        let best = -1, rank = 99, grass = 0, rubble = 0;
        for (let y = j * DS; y < j * DS + DS && y < grid.h; y++) {
          for (let x = i * DS; x < i * DS + DS && x < grid.w; x++) {
            const m = grid.mat[y * grid.w + x];
            const r = SOLID_FIRST.indexOf(m);
            if (r >= 0 && r < rank) { rank = r; best = m; }
            else if (m === M.GRASS) grass++;
            else if (m === M.RUBBLE) rubble++;
          }
        }
        if (best < 0) best = grass >= 6 ? M.GRASS : rubble >= 6 ? M.RUBBLE : M.EMPTY;
        const c = burning[j * w + i] ? BURN : TONE[best] || TONE[M.EMPTY];
        const k = (j * w + i) * 4;
        d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // Fog: clear where we see now, light veil where explored, dark elsewhere.
  buildFog(game) {
    const v = game.vision, cv = this.fog;
    cv.width = v.w; cv.height = v.h;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(v.w, v.h), d = img.data;
    for (let n = 0; n < v.w * v.h; n++) {
      const vis = v.tick - v.seen[n] <= 12;
      d[n * 4 + 3] = vis ? 0 : v.ever[n] ? 60 : 130;
    }
    ctx.putImageData(img, 0, 0);
  }

  // ---------------------------------------------------------------- input

  layout() {
    const W = this.canvas.width, H = this.canvas.height, u = this.s;
    const top = 30 * u, bottom = 70 * u, side = 14 * u;
    const ms = Math.min((W - side * 2) / ROOM_W, (H - top - bottom) / ROOM_H);
    const mw = ROOM_W * ms, mh = ROOM_H * ms;
    return { W, H, u, ms, x0: (W - mw) / 2, y0: top + (H - top - bottom - mh) / 2, mw, mh };
  }

  toWorld(px, py) {
    const L = this.layout();
    const x = (px - L.x0) / L.ms, y = (py - L.y0) / L.ms;
    return x >= 0 && y >= 0 && x < ROOM_W && y < ROOM_H ? { x, y } : null;
  }

  say(text) { this.flash = { text, t: 120 }; }

  // input.mx/my are in view cells; the map canvas is in device pixels.
  handleInput(game, input) {
    this.mouse.x = input.mx * this.s;
    this.mouse.y = input.my * this.s;
    const P = input.pressed, shift = input.keys.has('shift'), ctrl = input.keys.has('control');
    for (let k = 1; k <= 4; k++) if (P.has(String(k)) && game.squad(k - 1)) this.sel = k - 1;
    const sq = game.squad(this.sel);
    const w = this.toWorld(this.mouse.x, this.mouse.y);
    for (const c of input.clicks) {
      if (c.b === 0) { const hit = this.squadAt(game, this.mouse.x, this.mouse.y); if (hit) this.sel = hit.id; }
      else if (c.b === 2 && sq && w) {
        const order = c.ctrl || ctrl ? 'hold' : c.shift || shift ? 'attack' : 'move';
        game.orderSquad(sq.id, order, w.x, w.y);
        this.say(`SQUAD ${sq.id + 1}: ${ORDER_NAME[order]}`);
      }
    }
    if (!sq) return;
    if (P.has('h')) { game.orderSquad(sq.id, 'hold'); this.say(`SQUAD ${sq.id + 1}: HOLD HERE`); }
    if (P.has('f')) { game.orderSquad(sq.id, 'follow'); this.say(`SQUAD ${sq.id + 1}: FOLLOW ME`); }
    if (P.has('s')) { game.toggleStance(sq.id); this.say(`SQUAD ${sq.id + 1}: ${sq.stance.toUpperCase()}`); }
  }

  squadAt(game, px, py) {
    const L = this.layout();
    let best = null, bd = 16 * L.u;
    for (const q of game.squads) {
      for (const t of alive(q)) {
        const d = Math.hypot(L.x0 + t.x * L.ms - px, L.y0 + t.y * L.ms - py);
        if (d < bd) { bd = d; best = q; }
      }
      const tag = this.tags.get(q.id);
      if (!tag || !alive(q).length) continue;
      const d = Math.hypot(tag.x - px, tag.y - py); // its tag, as last drawn
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }

  // ---------------------------------------------------------------- draw

  draw(game) {
    const f = this.ctx, L = this.layout(), { u, ms, x0, y0 } = L;
    const X = (x) => x0 + x * ms, Y = (y) => y0 + y * ms;
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.clearRect(0, 0, L.W, L.H);
    f.fillStyle = 'rgba(8,8,8,0.95)';
    f.fillRect(0, 0, L.W, L.H);

    // terrain + fog
    f.imageSmoothingEnabled = false;
    f.drawImage(this.terrain, x0, y0, L.mw, L.mh);
    f.imageSmoothingEnabled = true;
    const v = game.vision;
    f.drawImage(this.fog, x0, y0, v.w * NODE * ms, v.h * NODE * ms);
    f.lineWidth = 2 * u / 2; f.strokeStyle = '#fff';
    f.strokeRect(x0, y0, L.mw, L.mh);

    f.save();
    f.beginPath(); f.rect(x0, y0, L.mw, L.mh); f.clip();
    this.drawFlag(f, game.flag, X, Y, ms, u, game.tick);
    for (const q of game.squads) this.drawPath(f, game, q, X, Y, u);
    // known enemies: solid = seen now, faded outline = last seen
    for (const [, k] of v.known) {
      const fade = v.fade(k);
      f.globalAlpha = 1 - fade * 0.8;
      this.tankIcon(f, X(k.x), Y(k.y), k.a, 4 * u, k.vis ? RED : null, RED, u);
    }
    f.globalAlpha = 1;
    for (const q of game.squads) for (const t of alive(q)) this.tankIcon(f, X(t.x), Y(t.y), t.a, 3.6 * u, ALLY, INK, u);
    const placed = [];
    this.tags.clear();
    for (const q of game.squads) this.drawSquadTag(f, game, q, X, Y, u, L, placed);
    const p = game.player; // on top of the tags so it's never hidden
    if (p.alive) this.tankIcon(f, X(p.x), Y(p.y), p.a, 5 * u, YELLOW, INK, u);
    f.restore();

    this.drawHeader(f, L);
    this.drawPanel(f, game, L);
    this.drawCursor(f, L);
    if (this.flash && --this.flash.t <= 0) this.flash = null;
  }

  tankIcon(f, x, y, a, r, fill, stroke, u) {
    f.save();
    f.translate(x, y); f.rotate(a);
    f.beginPath(); f.moveTo(r * 1.3, 0); f.lineTo(-r, -r * 0.85); f.lineTo(-r * 0.55, 0); f.lineTo(-r, r * 0.85); f.closePath();
    if (fill) { f.fillStyle = fill; f.fill(); }
    f.lineWidth = 0.8 * u; f.strokeStyle = stroke; f.stroke();
    f.restore();
  }

  drawFlag(f, flag, X, Y, ms, u, tick) {
    if (!flag) return;
    const x = X(flag.x), y = Y(flag.y), r = flag.r * ms;
    f.save();
    f.lineWidth = 0.8 * u;
    f.setLineDash([3 * u, 2 * u]); f.lineDashOffset = -tick * 0.3;
    f.strokeStyle = flag.contested ? RED : YELLOW;
    f.beginPath(); f.arc(x, y, r, 0, Math.PI * 2); f.stroke();
    f.setLineDash([]);
    if (flag.progress > 0) {
      f.lineWidth = 2 * u; f.strokeStyle = ALLY;
      f.beginPath(); f.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + flag.progress * Math.PI * 2); f.stroke();
    }
    // pennant
    f.lineWidth = 1 * u; f.strokeStyle = INK;
    f.beginPath(); f.moveTo(x, y + 5 * u); f.lineTo(x, y - 9 * u); f.stroke();
    f.beginPath(); f.moveTo(x, y - 9 * u); f.lineTo(x + 8 * u, y - 6 * u); f.lineTo(x, y - 3 * u); f.closePath();
    f.fillStyle = YELLOW; f.fill(); f.lineWidth = 0.6 * u; f.stroke();
    f.restore();
  }

  // Route the squad will take, sampled from the nav flow field toward its goal.
  drawPath(f, game, q, X, Y, u) {
    const live = alive(q);
    if (!q.goal || !live.length) return;
    const nav = game.nav, field = nav.field(q.goal.x, q.goal.y);
    let { x, y } = centroid(live);
    const pts = [[x, y]];
    for (let k = 0; k < 400; k++) {
      if (Math.hypot(q.goal.x - x, q.goal.y - y) < 18) break;
      const d = nav.dirAt(field, x, y);
      if (d === null) break;
      x += Math.cos(d) * nav.c; y += Math.sin(d) * nav.c;
      if (k % 2) pts.push([x, y]);
    }
    pts.push([q.goal.x, q.goal.y]);
    const sel = q.id === this.sel;
    f.save();
    f.strokeStyle = ALLY; f.globalAlpha = sel ? 1 : 0.6;
    f.lineWidth = (sel ? 1.6 : 1) * u; f.lineJoin = 'round';
    f.setLineDash([4 * u, 2.5 * u]);
    f.beginPath();
    pts.forEach(([px, py], i) => (i ? f.lineTo(X(px), Y(py)) : f.moveTo(X(px), Y(py))));
    f.stroke();
    f.setLineDash([]);
    // arrow head along the last segment, then the order marker
    const [ax, ay] = pts[Math.max(0, pts.length - 2)], gx = X(q.goal.x), gy = Y(q.goal.y);
    const a = Math.atan2(gy - Y(ay), gx - X(ax)), r = 5 * u;
    f.fillStyle = ALLY;
    f.beginPath(); f.moveTo(gx, gy); f.lineTo(gx - Math.cos(a - 0.5) * r, gy - Math.sin(a - 0.5) * r);
    f.lineTo(gx - Math.cos(a + 0.5) * r, gy - Math.sin(a + 0.5) * r); f.closePath(); f.fill();
    f.lineWidth = 1.2 * u;
    if (q.order === 'hold') { f.strokeRect(gx - 4 * u, gy - 4 * u, 8 * u, 8 * u); }
    else if (q.order === 'attack') {
      f.strokeStyle = RED;
      f.beginPath(); f.moveTo(gx - 4 * u, gy - 4 * u); f.lineTo(gx + 4 * u, gy + 4 * u);
      f.moveTo(gx + 4 * u, gy - 4 * u); f.lineTo(gx - 4 * u, gy + 4 * u); f.stroke();
    } else { f.beginPath(); f.arc(gx, gy, 4 * u, 0, Math.PI * 2); f.stroke(); }
    f.restore();
  }

  // Number + order + health bar floating above the squad.
  drawSquadTag(f, game, q, X, Y, u, L, placed) {
    const live = alive(q);
    if (!live.length) return;
    const c = centroid(live), sel = q.id === this.sel;
    const label = `${q.id + 1} ${ORDER_NAME[q.order]}${q.stance === 'cautious' ? ' (C)' : ''}`;
    f.save();
    f.font = `${8 * u}px ${FONT}`; f.textAlign = 'center'; f.textBaseline = 'middle';
    const w = f.measureText(label).width + 8 * u, h = 11 * u;
    // kept inside the map frame
    const x = Math.max(L.x0 + w / 2 + 2 * u, Math.min(L.x0 + L.mw - w / 2 - 2 * u, X(c.x)));
    let y = Math.max(L.y0 + h / 2 + 2 * u, Y(c.y) - 14 * u);
    // squads standing together: stack their tags instead of overlapping
    while (placed.some((r) => Math.abs(r.x - x) < (r.w + w) / 2 && Math.abs(r.y - y) < h + 3 * u)) y += h + 4 * u;
    placed.push({ x, y, w });
    this.tags.set(q.id, { x, y });
    f.fillStyle = ALLY; f.fillRect(x - w / 2, y - h / 2, w, h);
    f.lineWidth = (sel ? 2 : 1) * u; f.strokeStyle = sel ? YELLOW : INK;
    f.strokeRect(x - w / 2, y - h / 2, w, h);
    f.fillStyle = '#fff'; f.fillText(label, x, y + 0.5 * u);
    // health: mean hull of the living members
    const hp = live.reduce((s, t) => s + t.frac('hull'), 0) / live.length;
    f.fillStyle = INK; f.fillRect(x - w / 2, y + h / 2, w, 3 * u);
    f.fillStyle = hp < 0.4 ? '#ff8a1c' : '#fff'; f.fillRect(x - w / 2, y + h / 2, w * hp, 3 * u);
    f.restore();
  }

  drawHeader(f, L) {
    const u = L.u;
    f.save();
    f.font = `${16 * u}px ${FONT}`; f.textBaseline = 'middle';
    f.fillStyle = YELLOW; f.textAlign = 'left';
    f.fillText('TACTICAL MAP - PAUSED', 14 * u, 15 * u);
    if (this.flash) {
      f.textAlign = 'right'; f.fillStyle = '#fff';
      f.fillText(this.flash.text, L.W - 14 * u, 15 * u);
    }
    f.restore();
  }

  // Squad cards + controls along the bottom.
  drawPanel(f, game, L) {
    const u = L.u, y = L.H - 62 * u;
    f.save();
    f.textBaseline = 'top';
    let x = 14 * u;
    for (const q of game.squads) {
      const live = alive(q), w = 120 * u, sel = q.id === this.sel;
      f.fillStyle = live.length ? (sel ? '#1d3f73' : '#14223a') : '#222';
      f.fillRect(x, y, w, 34 * u);
      f.lineWidth = (sel ? 2 : 1) * u; f.strokeStyle = sel ? YELLOW : ALLY;
      f.strokeRect(x, y, w, 34 * u);
      f.font = `${10 * u}px ${FONT}`; f.fillStyle = sel ? YELLOW : '#fff';
      f.fillText(`[${q.id + 1}] SQUAD ${q.id + 1}`, x + 5 * u, y + 3 * u);
      f.font = `${8 * u}px ${FONT}`; f.fillStyle = '#ddd';
      f.fillText(live.length ? `${ORDER_NAME[q.order]} · ${q.stance.toUpperCase()}` : 'WIPED OUT', x + 5 * u, y + 15 * u);
      q.tanks.forEach((t, k) => {
        const bx = x + 5 * u + k * 28 * u, by = y + 26 * u;
        f.fillStyle = INK; f.fillRect(bx, by, 24 * u, 4 * u);
        f.fillStyle = !t.alive ? '#555' : t.frac('hull') < 0.4 ? '#ff8a1c' : ALLY;
        f.fillRect(bx, by, 24 * u * (t.alive ? t.frac('hull') : 1), 4 * u);
      });
      x += w + 8 * u;
    }
    f.font = `${8 * u}px ${FONT}`; f.fillStyle = '#fff'; f.textAlign = 'right';
    const lines = [
      '1-4 / CLICK SELECT SQUAD · RIGHT CLICK MOVE · SHIFT+RIGHT ATTACK · CTRL+RIGHT HOLD THERE',
      'H HOLD HERE · F FOLLOW ME · S STANCE (AGGRESSIVE / CAUTIOUS) · TAB / M BACK TO BATTLE',
    ];
    lines.forEach((l, i) => f.fillText(l, L.W - 14 * u, y + 6 * u + i * 12 * u));
    f.restore();
  }

  drawCursor(f, L) {
    const { x, y } = this.mouse, u = L.u, r = 6 * u;
    f.save();
    f.lineWidth = 2.4 * u; f.strokeStyle = INK;
    f.beginPath(); f.moveTo(x - r, y); f.lineTo(x + r, y); f.moveTo(x, y - r); f.lineTo(x, y + r); f.stroke();
    f.lineWidth = 1 * u; f.strokeStyle = YELLOW; f.stroke();
    f.restore();
  }
}
