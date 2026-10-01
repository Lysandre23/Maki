// Fog of war for one team: what its tanks can see, and what it remembers.
// Visibility lives on coarse nodes (NODE cells). Each tank casts RAYS rays
// out to SIGHT_R every REFRESH ticks (staggered per tank); walls stop a ray
// and thick smoke does too. A node counts as visible for a little longer than
// one refresh so it doesn't flicker between passes.

export const NODE = 16;
const SIGHT_R = 360;
const RAYS = 120;
const STEP = 8;
const REFRESH = 10;
const GHOST_TICKS = 20 * 60; // last-seen ghosts fade out after 20 s

export class Vision {
  constructor(w, h) {
    this.w = Math.ceil(w / NODE);
    this.h = Math.ceil(h / NODE);
    this.seen = new Int32Array(this.w * this.h).fill(-1e9); // tick each node was last seen
    this.ever = new Uint8Array(this.w * this.h);            // explored at least once
    this.known = new Map(); // enemy tank -> { x, y, a, t, vis }
    this.tick = 0;
  }

  visible(x, y) {
    const i = Math.floor(x / NODE), j = Math.floor(y / NODE);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return false;
    return this.tick - this.seen[j * this.w + i] <= REFRESH + 2;
  }

  cast(game, t) {
    const { grid, gas } = game;
    const { w, h, seen, ever, tick } = this;
    const n = Math.ceil(SIGHT_R / STEP);
    for (let r = 0; r < RAYS; r++) {
      const a = (r / RAYS) * Math.PI * 2;
      const dx = Math.cos(a) * STEP, dy = Math.sin(a) * STEP;
      let x = t.x, y = t.y, smoke = 0;
      for (let k = 0; k <= n; k++) {
        const i = Math.floor(x / NODE), j = Math.floor(y / NODE);
        if (i < 0 || j < 0 || i >= w || j >= h) break;
        const ni = j * w + i;
        seen[ni] = tick; ever[ni] = 1;
        // the wall itself is seen, what's behind it isn't
        if (k > 1 && grid.isSolid(Math.floor(x), Math.floor(y))) break;
        smoke += gas.smokeAt(x, y) * (STEP / 3);
        if (smoke > 5) break;
        x += dx; y += dy;
      }
    }
  }

  update(game, eyes, foes) {
    this.tick = game.tick;
    eyes.forEach((t, k) => {
      if (t.alive && (game.tick + k * 3) % REFRESH === 0) this.cast(game, t);
    });
    if (game.tick % REFRESH !== 0) return;
    for (const e of foes) {
      if (!e.alive) { this.known.delete(e); continue; }
      if (this.visible(e.x, e.y)) this.known.set(e, { x: e.x, y: e.y, a: e.a, t: game.tick, vis: true });
      else {
        const k = this.known.get(e);
        if (!k) continue;
        k.vis = false;
        if (game.tick - k.t > GHOST_TICKS) this.known.delete(e);
      }
    }
  }

  // 0..1 how faded a ghost is (0 = seen right now).
  fade(k) { return k.vis ? 0 : Math.min(1, (this.tick - k.t) / GHOST_TICKS); }

  clear() {
    this.seen.fill(-1e9);
    this.ever.fill(0);
    this.known.clear();
  }
}
