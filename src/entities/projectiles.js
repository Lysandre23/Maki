import { rnd } from '../util/rng.js';

// Projectiles, moved in sub-steps of <= 1 cell so they never tunnel.
// kinds: 'shell' (cannon), 'mg' (machine gun bullet), 'smoke' (grenade canister,
// flies over tanks and pops on walls or at the end of its flight).
export class Projectiles {
  constructor() {
    this.list = [];
  }

  spawn(p) {
    p.kind = p.kind || 'shell';
    p.ignore = p.ignore || null;
    this.list.push(p);
  }

  update(game) {
    const { grid, tanks } = game;
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(p.vx, p.vy)));
      let dead = false;
      for (let k = 0; k < steps && !dead; k++) {
        const sx = p.vx / steps, sy = p.vy / steps;
        p.x += sx; p.y += sy;

        if (p.kind !== 'smoke') {
          for (const t of tanks) {
            if (!t.alive || t === p.owner || t === p.ignore) continue;
            const zone = t.hitTest(p.x, p.y);
            if (!zone) continue;
            // barrels are thin: half the shots down the barrel's axis slip past it
            if (zone === 'cannon' && rnd() < 0.5) { p.ignore = t; continue; }
            const res = p.kind === 'mg' ? game.onBulletHit(t, zone, p) : game.onTankHit(t, zone, p);
            if (res.ricochet) {
              // reflect about the struck face and keep flying (can hit the shooter!)
              const d = p.vx * res.nx + p.vy * res.ny;
              p.vx = (p.vx - 2 * d * res.nx) * 0.75;
              p.vy = (p.vy - 2 * d * res.ny) * 0.75;
              p.dmg *= 0.5;
              p.ignore = t; p.owner = null;
              p.x += res.nx * 1.5; p.y += res.ny * 1.5;
            } else dead = true;
            break;
          }
          if (dead) break;
        }

        if (p.oilTrail && ((p.life + k) & 3) === 0) game.oil.add(grid, Math.floor(p.x), Math.floor(p.y), 1);

        if (grid.isSolid(Math.floor(p.x), Math.floor(p.y))) {
          if (p.kind === 'shell' && p.bounces > 0) {
            // RICOCHET ROUNDS: find which axis hit the wall and mirror it
            const px = p.x - sx, py = p.y - sy;
            if (grid.isSolid(Math.floor(p.x), Math.floor(py))) p.vx = -p.vx;
            if (grid.isSolid(Math.floor(px), Math.floor(p.y))) p.vy = -p.vy;
            p.x = px; p.y = py;
            p.bounces--;
            p.owner = null; p.life += 20;
            game.chip(p.x, p.y, p);
            break;
          }
          if (p.kind === 'shell') {
            game.blast(p.x, p.y, p.r, p.power, { incendiary: p.incendiary });
            game.impact(p, p.x - sx, p.y - sy);
          } else if (p.kind === 'mg') game.chip(p.x, p.y, p);
          else game.deploySmoke(p.x - sx, p.y - sy);
          dead = true;
        }
      }
      if (!dead && --p.life <= 0) {
        if (p.kind === 'smoke') game.deploySmoke(p.x, p.y);
        else if (p.kind === 'shell') game.gas.addSmoke(p.x, p.y, 0.3);
        dead = true;
      }
      if (dead) { list[i] = list[list.length - 1]; list.pop(); }
    }
  }
}
