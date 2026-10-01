import { clamp, angDiff } from '../util/math.js';
import { rnd } from '../util/rng.js';
import { M } from '../world/materials.js';
import { F } from '../world/worldgen.js';

export const PARTS = ['hull', 'trackL', 'trackR', 'turret', 'cannon', 'engine', 'ammo'];

// Armor tuning: the front is a wall, flanks and rear are where fights are won.
const SIDE_MULT = 0.9;
const REAR_MULT = 1.6;
const PEN_MULT = 1.5;       // square hit on a flank / the rear
const PART_TO_HULL = 0.6;   // share of a part hit that also hits the hull

const hp = (hull, track, turret, cannon, engine, ammo) =>
  ({ hull, trackL: track, trackR: track, turret, cannon, engine, ammo });

// speed/turn in cells (radians) per tick, reload in ticks.
// armorFront multiplies damage from frontal hits. body/top are gray levels.
export const TYPES = {
  player: {
    len: 40, wid: 26, speed: 1.5, turn: 0.05, turretRate: 0.09, reload: 36, armorFront: 0.5,
    hp: hp(300, 80, 80, 70, 80, 60), shell: { speed: 8, dmg: 55, r: 12, power: 13 }, body: 0xec, top: 0xfc, range: 0,
  },
  scout: {
    len: 32, wid: 20, speed: 1.6, turn: 0.065, turretRate: 0.08, reload: 60, armorFront: 0.8,
    hp: hp(55, 25, 25, 20, 25, 20), shell: { speed: 6.5, dmg: 18, r: 8, power: 9 }, body: 0xb4, top: 0xc8, range: 140,
  },
  gunner: {
    len: 40, wid: 26, speed: 1.0, turn: 0.045, turretRate: 0.05, reload: 95, armorFront: 0.55,
    hp: hp(110, 45, 45, 40, 45, 35), shell: { speed: 7, dmg: 33, r: 11, power: 12 }, body: 0x8c, top: 0xa4, range: 230,
  },
  heavy: {
    len: 48, wid: 32, speed: 0.65, turn: 0.03, turretRate: 0.035, reload: 125, armorFront: 0.2,
    hp: hp(220, 80, 80, 70, 70, 60), shell: { speed: 6.5, dmg: 48, r: 15, power: 15 }, body: 0x64, top: 0x7c, range: 190,
  },
  boss: {
    len: 64, wid: 42, speed: 0.5, turn: 0.022, turretRate: 0.04, reload: 70, armorFront: 0.2,
    hp: hp(520, 140, 140, 120, 120, 100), shell: { speed: 7, dmg: 45, r: 18, power: 17 }, body: 0x4a, top: 0x60, range: 210,
  },
};

// Rigid-body tank made of parts. Movement is differential drive: the two
// tracks each push, so a dead track makes the tank pivot around it.
export class Tank {
  constructor(type, x, y, a, team) {
    const T = TYPES[type];
    this.type = type;
    this.team = team; // 0 = player
    this.s = { ...T, shell: { ...T.shell } }; // mutable stats (upgrades)
    this.x = x; this.y = y; this.a = a; this.ta = a;
    this.vx = 0; this.vy = 0; this.av = 0;
    this.throttle = 0; this.turn = 0;
    this.reload = 30; this.reloadMax = T.reload;
    this.alive = true; this.cookoff = false;
    this.burning = 0;
    this.flashT = 0; this.flashZone = null; this.hitT = 0;
    this.hurtT = 0;   // counts down after real damage (AI: "under fire")
    this.treadL = 0; this.treadR = 0;
    this.turretLock = 0; this.drag = 1;
    this.power = { move: 1, turret: 1, reload: 1 }; // engine power split (player modes)
    this.charge = 0; this.chargeMax = 1;             // AI shot telegraph countdown
    this.mgCd = 0; this.mgHeat = 0; this.overheat = false;
    this.reloadBoost = 1;    // set each tick by upgrades (player)
    this.dmgTaken = 1;       // set each tick by upgrades (player)
    this.mods = {};          // player build flags, see game/rewards.js
    this.isPlayer = type === 'player';
    this.events = [];
    this.parts = {};
    for (const k of PARTS) this.parts[k] = { hp: T.hp[k], max: T.hp[k] };
    this.setGeometry();
  }

  setGeometry() {
    const { len, wid } = this.s;
    this.len = len; this.wid = wid;
    this.hl = len / 2; this.hw = wid / 2;
    this.trackW = Math.max(3, Math.round(wid * 0.22));
    this.turretR = wid * 0.34;
    this.barrelLen = len * 0.5;
    this.turretOff = -len * 0.06;
    this.engineLen = Math.max(4, len * 0.18);
    this.ammoLen = Math.max(3, len * 0.14);
    this.mass = len * wid;
    this.bound = Math.hypot(this.hl, this.hw);
    const reach = Math.max(this.bound, Math.abs(this.turretOff) + this.turretR + this.barrelLen) + 1;
    this.bound2 = reach * reach;

    // Collision samples along the hull outline, with outward normals.
    const s = [];
    const hl = this.hl - 0.5, hw = this.hw - 0.5, step = 2.5;
    const n = Math.ceil((2 * hl) / step);
    for (let i = 0; i <= n; i++) {
      const u = -hl + (2 * hl * i) / n;
      s.push({ u, v: -hw, nu: 0, nv: -1 }, { u, v: hw, nu: 0, nv: 1 });
    }
    const m = Math.ceil((2 * hw) / step);
    for (let i = 1; i < m; i++) {
      const v = -hw + (2 * hw * i) / m;
      s.push({ u: hl, v, nu: 1, nv: 0 }, { u: -hl, v, nu: -1, nv: 0 });
    }
    this.samples = s;
  }

  frac(k) { const p = this.parts[k]; return Math.max(0, p.hp) / p.max; }
  trackFactor(k) { return this.parts[k].hp <= 0 ? 0 : 0.45 + 0.55 * this.frac(k); }
  engineFactor() { return this.parts.engine.hp <= 0 ? 0 : 0.5 + 0.5 * this.frac('engine'); }
  turretFactor() {
    if (this.parts.turret.hp <= 0) return 0;
    return (0.4 + 0.6 * this.frac('turret')) * (this.parts.engine.hp <= 0 ? 0.4 : 1);
  }
  canFire() { return this.alive && this.parts.cannon.hp > 0 && this.reload <= 0; }

  aimAt(target) {
    if (this.parts.turret.hp <= 0) { this.ta = this.a + this.turretLock; return; }
    // while an AI is "charging" a shot the turret nearly locks: dodge window
    const max = this.s.turretRate * this.turretFactor() * this.power.turret * (this.charge > 0 ? 0.25 : 1);
    this.ta += clamp(angDiff(target, this.ta), -max, max);
  }

  circles() {
    const c = Math.cos(this.a) * this.hl * 0.5, s = Math.sin(this.a) * this.hl * 0.5, r = this.hw + 0.5;
    return [{ x: this.x + c, y: this.y + s, r }, { x: this.x - c, y: this.y - s, r }];
  }

  // Returns null if clear, else the summed push-out direction.
  collide(grid, x, y, a) {
    const c = Math.cos(a), s = Math.sin(a);
    let n = 0, px = 0, py = 0;
    for (const p of this.samples) {
      const wx = x + p.u * c - p.v * s, wy = y + p.u * s + p.v * c;
      if (grid.isSolid(Math.floor(wx), Math.floor(wy))) {
        n++;
        px -= p.nu * c - p.nv * s;
        py -= p.nu * s + p.nv * c;
      }
    }
    return n ? { n, px, py } : null;
  }

  update(grid, debris) {
    if (!this.alive) return;
    if (this.reload > 0) this.reload -= this.power.reload * this.reloadBoost;
    if (this.mgCd > 0) this.mgCd--;
    this.mgHeat = Math.max(0, this.mgHeat - 0.35);
    if (this.overheat && this.mgHeat < 10) this.overheat = false;
    if (this.flashT > 0) this.flashT--;
    if (this.hitT > 0) this.hitT--;
    if (this.hurtT > 0) this.hurtT--;
    if (this.burning > 0) {
      this.burning--;
      this.parts.hull.hp -= this.team === 0 ? 0.12 * (this.mods.fireDmg ?? 1) * this.dmgTaken : 0.45;
    }

    const eng = this.engineFactor() * this.power.move;
    const L = clamp(this.throttle + this.turn, -1, 1) * this.trackFactor('trackL');
    const R = clamp(this.throttle - this.turn, -1, 1) * this.trackFactor('trackR');
    const targetF = (L + R) * 0.5 * this.s.speed * eng;
    const targetW = (L - R) * 0.5 * this.s.turn * eng;

    const c = Math.cos(this.a), s = Math.sin(this.a);
    let fs = this.vx * c + this.vy * s;  // forward speed
    let ls = -this.vx * s + this.vy * c; // sideways slip (tracks resist it)
    fs += (targetF - fs) * 0.08;
    ls *= 0.75;
    fs *= this.drag;
    this.av += (targetW - this.av) * 0.2;
    this.vx = fs * c - ls * s;
    this.vy = fs * s + ls * c;
    this.treadL += fs + this.av * this.hw;
    this.treadR += fs - this.av * this.hw;

    this.move(grid);
    this.plow(grid, debris);
    this.stampTracks(grid, fs);
  }

  move(grid) {
    const nx = this.x + this.vx, ny = this.y + this.vy, na = this.a + this.av;
    let hit = this.collide(grid, nx, ny, na);
    if (!hit) { this.x = nx; this.y = ny; this.a = na; return; }

    // push out of the wall along the contact normals
    let tx = nx, ty = ny;
    for (let k = 0; k < 4 && hit; k++) {
      const l = Math.hypot(hit.px, hit.py) || 1;
      tx += (hit.px / l) * 0.5; ty += (hit.py / l) * 0.5;
      hit = this.collide(grid, tx, ty, na);
    }
    if (!hit) {
      const dx = tx - nx, dy = ty - ny, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
      const d = this.vx * ux + this.vy * uy;
      if (d < 0) { this.vx -= ux * d; this.vy -= uy * d; }
      this.x = tx; this.y = ty; this.a = na;
      return;
    }
    // blocked: try translation only, then rotation only
    if (!this.collide(grid, nx, ny, this.a)) { this.x = nx; this.y = ny; this.av = 0; }
    else if (!this.collide(grid, this.x, this.y, na)) { this.a = na; this.vx *= 0.2; this.vy *= 0.2; }
    else {
      this.vx *= 0.2; this.vy *= 0.2; this.av = 0;
      const cur = this.collide(grid, this.x, this.y, this.a); // already overlapping: squeeze out
      if (cur) {
        const l = Math.hypot(cur.px, cur.py) || 1;
        this.x += (cur.px / l) * 0.5; this.y += (cur.py / l) * 0.5;
      }
    }
  }

  // Tanks shove rubble aside: rubble under the hull edge is kicked up as debris.
  plow(grid, debris) {
    const c = Math.cos(this.a), s = Math.sin(this.a);
    const speed = Math.hypot(this.vx, this.vy);
    let n = 0;
    for (const p of this.samples) {
      const wx = Math.floor(this.x + p.u * c - p.v * s), wy = Math.floor(this.y + p.u * s + p.v * c);
      if (!grid.inBounds(wx, wy)) continue;
      const i = wy * grid.w + wx;
      if (grid.mat[i] === M.GRASS) { // tall grass is crushed flat under the tracks
        grid.mat[i] = M.EMPTY; grid.hp[i] = 0;
        grid.floor[i] = F.FLAT;
        grid.touch(wx, wy);
        continue;
      }
      if (grid.mat[i] !== M.RUBBLE) continue;
      n++;
      if (speed > 0.15 && n <= 12) {
        grid.setCell(wx, wy, M.EMPTY);
        const nx = p.nu * c - p.nv * s, ny = p.nu * s + p.nv * c;
        debris.spawn(wx + 0.5, wy + 0.5,
          this.vx * 1.3 + nx * 0.5 + (rnd() - 0.5) * 0.4,
          this.vy * 1.3 + ny * 0.5 + (rnd() - 0.5) * 0.4, M.RUBBLE);
      }
    }
    this.drag = 1 - Math.min(0.25, n * 0.02);
  }

  stampTracks(grid, fs) {
    if (Math.abs(fs) < 0.05 && Math.abs(this.av) < 0.005) return;
    const c = Math.cos(this.a), s = Math.sin(this.a);
    const u = -this.hl + 1.5;
    for (const side of [-1, 1]) {
      const phase = side < 0 ? this.treadL : this.treadR;
      if (((Math.floor(phase) % 3) + 3) % 3 === 0) continue;
      for (let o = -1; o <= 1; o++) {
        const v = side * (this.hw - this.trackW / 2) + o;
        const wx = Math.floor(this.x + u * c - v * s), wy = Math.floor(this.y + u * s + v * c);
        if (!grid.inBounds(wx, wy)) continue;
        const i = wy * grid.w + wx;
        if (grid.mat[i] !== M.EMPTY || grid.scorch[i] || grid.floor[i] === F.TRACK || grid.floor[i] === F.DOT) continue;
        grid.floor[i] = F.TRACK;
        grid.touch(wx, wy);
      }
    }
  }

  // Which part does world point (px, py) land on? null = miss.
  hitTest(px, py) {
    const dx = px - this.x, dy = py - this.y;
    if (dx * dx + dy * dy > this.bound2) return null;
    const c = Math.cos(this.a), s = Math.sin(this.a);
    const ex = px - (this.x + this.turretOff * c), ey = py - (this.y + this.turretOff * s);
    const tc = Math.cos(this.ta), ts = Math.sin(this.ta);
    const tu = ex * tc + ey * ts, tv = -ex * ts + ey * tc;
    const BL = this.parts.cannon.hp > 0 ? this.barrelLen : this.barrelLen * 0.45;
    if (tu > this.turretR - 1 && tu <= this.turretR + BL && Math.abs(tv) <= 1.6) return 'cannon';
    if (tu * tu + tv * tv <= this.turretR * this.turretR) return 'turret';
    const u = dx * c + dy * s, v = -dx * s + dy * c;
    if (Math.abs(u) > this.hl || Math.abs(v) > this.hw) return null;
    if (Math.abs(v) > this.hw - this.trackW) return v < 0 ? 'trackL' : 'trackR';
    const eu = u + this.hl;
    if (eu < this.engineLen) return 'engine';
    if (eu < this.engineLen + this.ammoLen) return 'ammo';
    return 'hull';
  }

  // Returns true if the part just broke.
  damagePart(name, amount) {
    const p = this.parts[name];
    if (p.hp <= 0 || amount <= 0) return false;
    p.hp -= amount * this.dmgTaken;
    this.hurtT = 180;
    if (p.hp > 0) return false;
    p.hp = 0;
    this.events.push(name);
    if (name === 'turret') this.turretLock = angDiff(this.ta, this.a);
    else if (name === 'engine') this.burning = this.team ? 1e9 : Math.max(this.burning, 180);
    else if (name === 'ammo') {
      if (this.team) { this.cookoff = true; this.parts.hull.hp = 0; }
      else { this.parts.hull.hp -= 50; this.burning = Math.max(this.burning, 150); }
    }
    return true;
  }

  // Impact at world point (px, py) travelling along (dirx, diry).
  // Armor = which face is struck (front/side/rear) x how square the hit is:
  // the struck face's normal is found from the impact point, so angling the
  // hull really deflects shots. Glancing hits ricochet: the caller reflects the
  // projectile about the returned normal (nx, ny).
  takeHit(zone, dmg, dirx, diry, px, py, light = false) {
    const c = Math.cos(this.a), s = Math.sin(this.a);
    let face, nx, ny;
    if (zone === 'turret' || zone === 'cannon') {
      const tx = px - (this.x + this.turretOff * c), ty = py - (this.y + this.turretOff * s);
      const l = Math.hypot(tx, ty) || 1;
      nx = tx / l; ny = ty / l;
      const facing = nx * Math.cos(this.ta) + ny * Math.sin(this.ta);
      face = facing > 0.5 ? 'front' : facing < -0.5 ? 'rear' : 'side';
    } else {
      const dx = px - this.x, dy = py - this.y;
      const u = dx * c + dy * s, v = -dx * s + dy * c;
      let nu = 0, nv = 0;
      if (Math.abs(u) / this.hl > Math.abs(v) / this.hw) { nu = Math.sign(u) || 1; face = u > 0 ? 'front' : 'rear'; }
      else { nv = Math.sign(v) || 1; face = 'side'; }
      nx = nu * c - nv * s; ny = nu * s + nv * c;
    }
    const cos = Math.abs(dirx * nx + diry * ny); // 1 = square hit, 0 = grazing
    const isTrack = zone === 'trackL' || zone === 'trackR';
    const faceMult = face === 'front' ? this.s.armorFront : face === 'rear' ? REAR_MULT : SIDE_MULT;
    const mult = isTrack ? Math.max(faceMult, 0.8) : faceMult;
    let eff = dmg * mult * (0.35 + 0.65 * cos) * (0.85 + rnd() * 0.3);
    // (the flanks are mostly track, so grazing track hits must deflect too)
    const ricochet = face !== 'rear' &&
      ((cos < 0.4 && rnd() < (isTrack ? 0.6 : 0.85)) || (!isTrack && mult < 0.35 && cos < 0.75 && rnd() < 0.5));
    if (ricochet) eff *= 0.15;
    // PENETRATION: a square hit on a flank or the rear goes straight through
    const pen = !ricochet && face !== 'front' && cos > 0.85;
    if (pen) eff *= PEN_MULT;

    this.flashZone = zone; this.flashT = light ? 4 : 12;
    if (!light) this.hitT = 3;
    // weak point: a clean hit on an enemy's ammo rack cooks it off
    if (this.team && zone === 'ammo' && !ricochet && eff >= this.parts.ammo.max * 0.5) {
      this.damagePart('ammo', this.parts.ammo.hp + 1);
      return { ricochet, eff, nx, ny, face, pen };
    }
    this.damagePart(zone, eff);
    if (zone !== 'hull') this.damagePart('hull', eff * PART_TO_HULL); // hits on parts still wreck the hull
    return { ricochet, eff, nx, ny, face, pen };
  }
}
