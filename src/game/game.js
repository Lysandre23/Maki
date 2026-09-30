import { VIEW_W, VIEW_H, ROOM_W, ROOM_H, ROOMS, MAX_DEBRIS, ACTIVE_MARGIN, GAS_SCALE } from '../config.js';
import { clamp } from '../util/math.js';
import { rnd, makeRng, hash } from '../util/rng.js';
import { Grid } from '../world/grid.js';
import { generateRoom } from '../world/worldgen.js';
import { M, FLAMMABLE } from '../world/materials.js';
import { Debris } from '../world/debris.js';
import { explode } from '../world/explosion.js';
import { Gas } from '../world/gas.js';
import { Fire } from '../world/fire.js';
import { Nav } from '../world/nav.js';
import { Tank, PARTS } from '../entities/tank.js';
import { Projectiles } from '../entities/projectiles.js';
import { initAI, updateAI } from '../entities/ai.js';
import { findCollapses } from '../world/collapse.js';
import { Oil } from '../world/oil.js';
import { Frost } from '../world/frost.js';
import { pickRewards, defaultMods } from './rewards.js';

const BREAK_TEXT = { trackL: 'SNAP!', trackR: 'SNAP!', cannon: 'CRUNCH!', turret: 'JAMMED!', engine: 'FWOOSH!' };

export const PART_LABEL = {
  hull: 'HULL', trackL: 'LEFT TRACK', trackR: 'RIGHT TRACK', turret: 'TURRET',
  cannon: 'CANNON', engine: 'ENGINE', ammo: 'AMMO RACK',
};

// Engine power split between driving, turret traverse and the autoloader.
export const POWER = [
  { name: 'BALANCED', move: 1, turret: 1, reload: 1 },
  { name: 'DRIVE', move: 1.35, turret: 0.7, reload: 0.7 },
  { name: 'GUNNERY', move: 0.6, turret: 1.45, reload: 1.4 },
];

const EMERGENCY_PER_ROOM = 2;
const SMOKE_PER_ROOM = 3;
const MG_OVERHEAT = 60;

// Whole game state, DOM-free (also runs headless in tools/).
// states: play -> cleared -> reward -> play ... | dead | win
export class Game {
  constructor(seed = Date.now()) {
    this.rng = makeRng(seed >>> 0);
    this.grid = new Grid(ROOM_W, ROOM_H);
    this.debris = new Debris(MAX_DEBRIS);
    this.gas = new Gas(ROOM_W, ROOM_H, GAS_SCALE);
    this.flames = new Fire();
    this.oil = new Oil();
    this.frost = new Frost();
    this.nav = new Nav(this.grid, 12);
    this.projectiles = new Projectiles();
    this.flashes = [];
    this.popups = [];
    this.pending = [];
    this.wrecks = [];
    this.scrap = [];         // spare-part pickups dropped by wrecks
    this.smokeClouds = [];   // active smoke grenade emitters
    this.cam = { x: 0, y: 0 };
    this.shake = 0;
    this.tick = 0;
    this.hooks = {
      onBarrel: (id) => this.triggerBarrel(id),
      ignite: (x, y) => this.flames.ignite(this.grid, x, y),
      oil: (x, y, a) => this.oil.add(this.grid, x, y, a),
    };
    this.newRun();
  }

  newRun() {
    this.level = 1;
    this.kills = 0;
    this.build = [];     // card ids taken this run (repeats for stacked cards)
    this.tagCount = {};  // tag -> number of owned cards carrying it
    this.player = new Tank('player', 0, 0, 0, 0);
    this.player.mods = defaultMods();
    this.spares = 40;          // consumed by the crew when repairing
    this.crew = [null, null];  // part each mechanic is working on
    this.crewNext = 0;
    this.powerMode = 0;
    this.player.power = POWER[0];
    this.startRoom();
  }

  startRoom() {
    const layout = generateRoom(this.grid, this.rng, this.level);
    this.debris.clear();
    this.gas.clear();
    this.flames.clear(this.grid);
    this.oil.clear();
    this.frost.clear(this.grid);
    for (const pd of layout.puddles) this.oil.splash(this.grid, pd.x, pd.y, pd.r, 2);
    this.projectiles.list.length = 0;
    this.flashes.length = 0;
    this.pending.length = 0;
    this.wrecks.length = 0;
    this.popups.length = 0;
    this.scrap.length = 0;
    this.smokeClouds.length = 0;
    this.barrels = layout.barrels;
    this.emergency = EMERGENCY_PER_ROOM + this.player.mods.extraEmergency;
    this.smokeCharges = SMOKE_PER_ROOM + this.player.mods.extraSmoke;
    this.smokeCd = 0;
    this.pickupAcc = 0;

    const p = this.player;
    p.x = layout.spawn.x; p.y = layout.spawn.y;
    p.a = 0; p.ta = 0; p.vx = p.vy = p.av = 0;
    p.burning = 0; p.reload = 20; p.events.length = 0;
    p.mgHeat = 0; p.overheat = false; p.frost = 0;

    this.enemies = layout.enemies.map((e, i) => {
      const t = new Tank(e.type, e.x, e.y, e.a, 1);
      t.ta = e.a;
      initAI(t, i);
      return t;
    });
    this.tanks = [p, ...this.enemies];

    this.gas.syncSolid(this.grid);
    this.gasVersion = this.grid.version;
    this.gas.windX = (this.rng() - 0.5) * 0.004;
    this.gas.windY = (this.rng() - 0.5) * 0.004;
    this.nav.rebuild(this.grid);
    this.nav.flow(p.x, p.y);

    this.state = 'play';
    this.stateT = 0;
    this.choices = null;
    this.cam.x = clamp(p.x - VIEW_W / 2, 0, ROOM_W - VIEW_W);
    this.cam.y = clamp(p.y - VIEW_H / 2, 0, ROOM_H - VIEW_H);
    this.popup(this.level >= ROOMS ? 'BOSS ROOM!' : `ROOM ${this.level}`, p.x + 70, p.y - 34, 18, true, true);
  }

  popup(text, x, y, size = 14, red = false, burst = false) {
    this.popups.push({ text, x, y, size, red, burst, t: 0, life: 70, rot: (rnd() - 0.5) * 0.3 });
  }

  // ---------------------------------------------------------------- actions

  fire(t) {
    if (!t.canFire()) return false;
    const sh = t.s.shell;
    const cf = t.frac('cannon');
    const ang = t.ta + (rnd() - 0.5) * 0.25 * (1 - cf); // damaged cannon = spread
    const c = Math.cos(ang), s = Math.sin(ang);
    const bx = t.x + t.turretOff * Math.cos(t.a), by = t.y + t.turretOff * Math.sin(t.a);
    const tip = t.turretR + t.barrelLen;
    const x = bx + c * tip, y = by + s * tip;
    this.projectiles.spawn({
      x, y, vx: c * sh.speed, vy: s * sh.speed, owner: t, team: t.team,
      dmg: sh.dmg, r: sh.r, power: sh.power, life: 150, ignore: null,
      incendiary: !!t.mods.incendiary, cryo: !!t.mods.cryo, oilShell: !!t.mods.oilShell,
      oilTrail: !!t.mods.oilTrail, bounces: t.mods.bounces || 0, cluster: !!t.mods.cluster,
    });
    t.reload = t.reloadMax = t.s.reload * (2 - cf); // damaged cannon = slower reload
    const kick = 0.3 * (500 / t.mass); // recoil
    t.vx -= c * kick; t.vy -= s * kick;
    this.gas.addSmoke(x, y, 0.6);
    this.gas.addHeat(x, y, 0.5);
    this.gas.addVel(x, y, c * 3, s * 3);
    this.flashes.push({ x, y, r: 8, t: 3, spin: rnd() * 6.28 });
    for (let k = 0; k < 5; k++) {
      const a = ang + (rnd() - 0.5) * 0.8, v = 1 + rnd() * 2.5;
      this.debris.spawn(x, y, Math.cos(a) * v, Math.sin(a) * v, M.SPARK, 8 + ((rnd() * 10) | 0));
    }
    if (t === this.player) this.shake = Math.min(14, this.shake + 2);
    return true;
  }

  // Coaxial machine gun: fast, weak, chews bricks, strips tracks, lights crates.
  fireMG(t) {
    if (t.mgCd > 0 || t.overheat || t.parts.turret.hp <= 0) return;
    const ang = t.ta + (rnd() - 0.5) * 0.07;
    const c = Math.cos(ang), s = Math.sin(ang);
    const bx = t.x + t.turretOff * Math.cos(t.a), by = t.y + t.turretOff * Math.sin(t.a);
    const px = -Math.sin(t.ta) * 3, py = Math.cos(t.ta) * 3; // offset beside the main gun
    const x = bx + px + c * (t.turretR + 3), y = by + py + s * (t.turretR + 3);
    this.projectiles.spawn({ kind: 'mg', x, y, vx: c * 10, vy: s * 10, owner: t, team: t.team, dmg: 3, life: 45 });
    t.mgCd = 5;
    t.mgHeat += 2.4 * (t.mods.mgCool || 1);
    if (t.mgHeat >= MG_OVERHEAT) { t.overheat = true; if (t === this.player) this.popup('OVERHEAT!', t.x, t.y - t.hw - 10, 10, true); }
    this.debris.spawn(x, y, c * 2 + (rnd() - 0.5), s * 2 + (rnd() - 0.5), M.SPARK, 4 + ((rnd() * 5) | 0));
  }

  // Bullet hitting masonry: chips a few cells, can bring down weakened walls.
  chip(x, y, p) {
    explode(this.grid, this.debris, x, y, 2.2, 3.5, this.hooks);
    this.gas.addSmoke(x, y, 0.05);
    const g = this.grid, cx = Math.floor(x), cy = Math.floor(y);
    const mods = (p && p.owner && p.owner.mods) || {};
    const igniteChance = mods.mgFire ? 0.4 : 0.03;
    for (let k = 0; k < 4; k++) {
      const nx = cx + ((rnd() * 3) | 0) - 1, ny = cy + ((rnd() * 3) | 0) - 1;
      if (g.inBounds(nx, ny) && FLAMMABLE[g.mat[ny * g.w + nx]] && rnd() < igniteChance) this.flames.ignite(g, nx, ny);
    }
    if (mods.mgFire) this.gas.addHeat(x, y, 0.3);
    if (mods.mgIce) this.freezeAt(x, y, 4, 0.5);
    for (const cells of findCollapses(g, x, y, 26)) this.collapse(cells, x, y);
  }

  onBulletHit(t, zone, p) {
    const sp = Math.hypot(p.vx, p.vy) || 1;
    const dirx = p.vx / sp, diry = p.vy / sp;
    const dmg = p.dmg * (zone === 'trackL' || zone === 'trackR' ? 1.8 : 1);
    const res = t.takeHit(zone, dmg, dirx, diry, p.x, p.y, true);
    const mods = (p.owner && p.owner.mods) || {};
    if (mods.mgIce) t.frost = Math.min(1.5, t.frost + 0.06 * mods.frostPower);
    if (mods.mgFire) { this.gas.addHeat(p.x, p.y, 0.4); if (rnd() < 0.05) t.burning = Math.max(t.burning, 60); }
    for (let k = 0; k < 3; k++) {
      const a = Math.atan2(-diry, -dirx) + (rnd() - 0.5) * 2, v = 1 + rnd() * 2;
      this.debris.spawn(p.x, p.y, Math.cos(a) * v, Math.sin(a) * v, M.SPARK, 5 + ((rnd() * 8) | 0));
    }
    return res;
  }

  throwSmoke() {
    const p = this.player;
    if (!p.alive || this.smokeCharges <= 0 || this.smokeCd > 0) return;
    if (this.state !== 'play' && this.state !== 'cleared') return;
    for (const off of [-0.45, 0, 0.45]) {
      const a = p.ta + off, v = 3.2;
      this.projectiles.spawn({
        kind: 'smoke', x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        owner: p, team: 0, dmg: 0, life: 16 + ((rnd() * 8) | 0),
      });
    }
    this.smokeCharges--;
    this.smokeCd = 60;
  }

  deploySmoke(x, y) {
    this.smokeClouds.push({ x, y, t: 260 });
    this.gas.addSmoke(x, y, 2);
    this.gas.addExpand(x, y, 0.8);
  }

  assignCrew(part) {
    const c = this.crew;
    if (c[0] === part && c[1] === part) { c[0] = c[1] = null; return; } // both on it: recall
    let i = c.indexOf(null);
    if (i < 0) i = this.crewNext;
    if (c[i] === part) i = 1 - i;
    c[i] = part;
    this.crewNext = 1 - i;
  }

  emergencyRepair() {
    const p = this.player;
    if (!p.alive || this.emergency <= 0 || (this.state !== 'play' && this.state !== 'cleared')) return;
    const order = ['engine', 'trackL', 'trackR', 'cannon', 'turret', 'ammo', 'hull'];
    let k = order.find((n) => p.parts[n].hp <= 0);
    if (!k) k = order.reduce((a, b) => (p.frac(b) < p.frac(a) ? b : a));
    const pp = p.parts[k];
    pp.hp = Math.max(pp.hp, pp.max * 0.35);
    if (k === 'engine') p.burning = 0;
    this.emergency--;
    this.popup(`PATCHED ${PART_LABEL[k]}!`, p.x, p.y - p.hw - 12, 12, true, true);
  }

  cyclePower() {
    this.powerMode = (this.powerMode + 1) % POWER.length;
    this.player.power = POWER[this.powerMode];
    const p = this.player;
    this.popup(`POWER: ${POWER[this.powerMode].name}`, p.x, p.y - p.hw - 12, 11);
  }

  // A masonry fragment lost its support: it topples away from the blast,
  // spills rubble, raises dust, and crushes whatever it lands on.
  collapse(cells, bx, by) {
    const g = this.grid;
    let cx = 0, cy = 0;
    for (const i of cells) { cx += i % g.w; cy += (i / g.w) | 0; }
    cx /= cells.length; cy /= cells.length;
    let vx = 0, vy = 0;
    for (const i of cells) { vx += (i % g.w - cx) ** 2; vy += (((i / g.w) | 0) - cy) ** 2; }
    let dx, dy;
    if (vx > vy * 2 || vy > vx * 2) {
      // elongated wall piece: it tips over across its long axis, away from the shot
      const nx = vx > vy ? 0 : 1, ny = vx > vy ? 1 : 0;
      const side = (cx - bx) * nx + (cy - by) * ny;
      const sgn = Math.abs(side) > 0.5 ? Math.sign(side) : rnd() < 0.5 ? -1 : 1;
      dx = nx * sgn; dy = ny * sgn;
    } else {
      // chunky piece (pillar stump): falls away from the blast
      dx = cx - bx; dy = cy - by;
      let d = Math.hypot(dx, dy);
      if (d < 0.5) { const a = rnd() * 6.28; dx = Math.cos(a); dy = Math.sin(a); d = 1; }
      dx /= d; dy /= d;
    }
    for (const i of cells) {
      const x = i % g.w, y = (i / g.w) | 0, m = g.mat[i];
      g.mat[i] = M.EMPTY; g.hp[i] = 0; g.data[i] = 0;
      g.markDirty(x, y);
      if (rnd() < 0.55) {
        const s = 0.8 + rnd() * 1.8;
        this.debris.spawn(x + 0.5, y + 0.5, dx * s + (rnd() - 0.5) * 0.8, dy * s + (rnd() - 0.5) * 0.8, m);
      }
      if (rnd() < 0.08) this.gas.addSmoke(x, y, 0.3);
    }
    g.version++;
    const n = cells.length;
    const reach = Math.sqrt(n) * 0.8 + 10;
    const lx = cx + dx * reach * 0.6, ly = cy + dy * reach * 0.6;
    for (const t of this.tanks) {
      if (!t.alive) continue;
      const dd = Math.hypot(t.x - lx, t.y - ly);
      if (dd > reach + t.hw) continue;
      const dmg = Math.min(90, n * 0.2) * (1 - (dd / (reach + t.hw)) * 0.5);
      t.damagePart('hull', dmg);
      t.damagePart('turret', dmg * 0.4);
      t.damagePart(rnd() < 0.5 ? 'trackL' : 'trackR', dmg * 0.5);
      t.vx += dx * 1.2; t.vy += dy * 1.2;
      t.hitT = 4;
      this.popup('CRUSHED!', t.x, t.y - t.hw - 8, 14, t === this.player, true);
    }
    if (n > 60) {
      this.popup('CRASH!', cx, cy, 16, false, true);
      this.shake = Math.min(14, this.shake + 6);
    }
    this.gas.addExpand(cx, cy, 0.4);
  }

  // Explosion: carves terrain, pushes gas, shoves and damages tanks.
  blast(x, y, r, power, opts = {}) {
    explode(this.grid, this.debris, x, y, r, power, this.hooks);
    for (const cells of findCollapses(this.grid, x, y, r * 2.5 + 24)) this.collapse(cells, x, y);
    this.gas.blast(x, y, r, power, opts.incendiary ? 2 : 1);
    this.flashes.push({ x, y, r, t: 0, spin: rnd() * 6.28 });
    this.shake = Math.min(14, this.shake + r * 0.2);

    // explosions light oil they touch (always with NAPALM)
    {
      const g = this.grid, R = r * 1.2, chance = this.player.mods.napalm ? 1 : 0.5;
      for (let yy = Math.max(0, Math.floor(y - R)); yy <= Math.min(g.h - 1, y + R); yy++) {
        for (let xx = Math.max(0, Math.floor(x - R)); xx <= Math.min(g.w - 1, x + R); xx++) {
          if (g.mat[yy * g.w + xx] === M.OIL && (xx - x) ** 2 + (yy - y) ** 2 <= R * R && rnd() < chance) this.flames.ignite(g, xx, yy);
        }
      }
    }
    if (opts.incendiary) {
      const R = r * 1.4, g = this.grid;
      for (let yy = Math.floor(y - R); yy <= y + R; yy++) {
        for (let xx = Math.floor(x - R); xx <= x + R; xx++) {
          if (!g.inBounds(xx, yy) || (xx - x) ** 2 + (yy - y) ** 2 > R * R) continue;
          if (FLAMMABLE[g.mat[yy * g.w + xx]] && rnd() < 0.6) this.flames.ignite(g, xx, yy);
        }
      }
      for (let k = 0; k < 14; k++) {
        const a = rnd() * 6.28, v = 0.8 + rnd() * 2.5;
        this.debris.spawn(x, y, Math.cos(a) * v, Math.sin(a) * v, M.EMBER, 40 + ((rnd() * 60) | 0));
      }
    }

    for (const t of this.tanks) {
      if (!t.alive) continue;
      const dx = t.x - x, dy = t.y - y;
      const d = Math.hypot(dx, dy) || 0.01;
      const reach = r * 1.8 + t.hw;
      if (d > reach) continue;
      const f = 1 - d / reach;
      const k = power * 0.045 * f * (500 / t.mass);
      t.vx += (dx / d) * k; t.vy += (dy / d) * k;
      t.av += (rnd() - 0.5) * k * 0.04;
      const edge = Math.max(0, d - t.hw);
      if (edge < r && !opts.noSplash) {
        const dmg = power * 1.1 * (1 - edge / r);
        t.damagePart('hull', dmg);
        const v = -dx * Math.sin(t.a) + dy * Math.cos(t.a); // blast side, in tank frame
        t.damagePart(v > 0 ? 'trackL' : 'trackR', dmg * 0.5);
        t.hitT = Math.max(t.hitT, 3);
      }
    }
  }

  onTankHit(t, zone, p) {
    const sp = Math.hypot(p.vx, p.vy) || 1;
    const dirx = p.vx / sp, diry = p.vy / sp;
    let dmg = p.dmg;
    const pm = this.player.mods;
    if (p.team === 0 && t.team) {
      if (pm.shatter && t.frost > 0.2) { dmg *= 2; this.popup('SHATTER!', p.x, p.y - 12, 12, false); }
      if (pm.thermal && ((p.incendiary && t.frost > 0.2) || (p.cryo && t.burning > 0))) {
        dmg *= 3;
        t.frost = 0;
        const cracks = ['trackL', 'trackR', 'turret', 'cannon', 'engine'];
        t.damagePart(cracks[(rnd() * cracks.length) | 0], 30);
        this.popup('THERMAL SHOCK!', p.x, p.y - 16, 15, true, true);
        this.gas.addSteam(p.x, p.y, 2);
      }
    }
    const res = t.takeHit(zone, dmg, dirx, diry, p.x, p.y);
    const push = p.dmg * 0.008 * (500 / t.mass) * (res.ricochet ? 0.3 : 1);
    t.vx += dirx * push; t.vy += diry * push;
    if (res.ricochet) {
      this.popup('KLANG!', p.x, p.y - 8, 12, false, true);
      for (let k = 0; k < 10; k++) {
        const a = Math.atan2(res.ny, res.nx) + (rnd() - 0.5) * 1.8, v = 1.5 + rnd() * 2.5;
        this.debris.spawn(p.x, p.y, Math.cos(a) * v, Math.sin(a) * v, M.SPARK, 10 + ((rnd() * 12) | 0));
      }
      if (t === this.player) this.shake = Math.min(14, this.shake + 2);
      return res;
    }
    this.blast(p.x, p.y, p.r * 0.45, p.power * 0.5, { noSplash: true, incendiary: p.incendiary });
    this.impact(p, p.x, p.y);
    if (p.incendiary && pm.afterburn && t.team) t.burning = Math.max(t.burning, 150);
    if (zone === 'engine') this.gas.addSteam(p.x, p.y, 1.2);
    if (t === this.player) this.shake = Math.min(14, this.shake + 5);
    return res;
  }

  triggerBarrel(id) {
    const b = this.barrels[id - 1];
    if (!b || b.done) return;
    b.done = true;
    this.pending.push({
      t: 6,
      fn: () => {
        this.blast(b.x, b.y, 24, 18, { incendiary: true });
        this.popup('WHOOMPH!', b.x, b.y - 14, 18, true, true);
        this.shake = Math.min(14, this.shake + 8);
      },
    });
  }

  killTank(t) {
    t.alive = false;
    if (t.team) this.kills++;
    const big = t.cookoff;
    this.blast(t.x, t.y, big ? 24 + t.hw * 0.4 : 16 + t.hw * 0.3, big ? 20 : 14);
    this.stampWreck(t);
    this.wrecks.push({ x: t.x, y: t.y, t: 900, max: 900 });
    const pm = this.player.mods;
    if (t.team && pm.scorched) { // SCORCHED EARTH
      this.spillOil(t.x, t.y, 20);
      for (let k = 0; k < 12; k++) this.flames.ignite(this.grid, Math.floor(t.x + (rnd() - 0.5) * 20), Math.floor(t.y + (rnd() - 0.5) * 20));
    }
    if (t.team && pm.absoluteZero && t.frost > 0.2) { // ABSOLUTE ZERO: freezing nova, can chain
      this.freezeAt(t.x, t.y, 70, 1.6);
      this.popup('ABSOLUTE ZERO!', t.x, t.y - t.hw - 22, 16, false, true);
    }
    if (t.team) { // spare parts thrown out of the wreck
      const n = 4 + Math.floor(t.hw / 3);
      for (let k = 0; k < n; k++) {
        const a = rnd() * 6.28, v = 1.5 + rnd() * 2.5;
        this.scrap.push({ x: t.x, y: t.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 1800 });
      }
    }
    this.popup(big ? 'KA-BOOM!' : 'BLAM!', t.x, t.y - t.hw - 8, big ? 22 : 18, false, true);
    this.shake = Math.min(14, this.shake + (big ? 10 : 6));
  }

  // The dead tank becomes part of the terrain: destructible metal cover.
  stampWreck(t) {
    const g = this.grid;
    const c = Math.cos(t.a), s = Math.sin(t.a);
    const R = Math.ceil(t.bound);
    const others = this.tanks.filter((o) => o.alive && o !== t);
    for (let y = Math.floor(t.y - R); y <= t.y + R; y++) {
      for (let x = Math.floor(t.x - R); x <= t.x + R; x++) {
        if (!g.inBounds(x, y)) continue;
        const dx = x + 0.5 - t.x, dy = y + 0.5 - t.y;
        const u = dx * c + dy * s, v = -dx * s + dy * c;
        if (Math.abs(u) > t.hl - 1 || Math.abs(v) > t.hw - 1) continue;
        if (rnd() > 0.88) continue; // ragged, holed wreck
        const i = y * g.w + x;
        if (g.mat[i] !== M.EMPTY && g.mat[i] !== M.RUBBLE) continue;
        if (others.some((o) => (o.x - x) ** 2 + (o.y - y) ** 2 < (o.hw + 2) ** 2)) continue;
        const du = u - t.turretOff;
        const d = du * du + v * v < t.turretR * t.turretR ? 3 : Math.abs(v) > t.hw - t.trackW ? 2 : 1;
        g.setCell(x, y, M.WRECK, d);
      }
    }
  }

  chooseReward(i) {
    if (this.state !== 'reward' || !this.choices || !this.choices[i]) return;
    const r = this.choices[i];
    r.apply(this.player, this);
    this.build.push(r.id);
    for (const tag of r.tags) this.tagCount[tag] = (this.tagCount[tag] || 0) + 1;
    // patch-up between rooms: +20%, and wrecked parts come back at 30%
    for (const k of PARTS) {
      const p = this.player.parts[k];
      p.hp = p.hp <= 0 ? p.max * 0.3 : Math.min(p.max, p.hp + p.max * 0.2);
    }
    this.level++;
    this.startRoom();
  }

  // ---------------------------------------------------------------- update

  update(inp) {
    this.tick++;
    const p = this.player;
    const playing = this.state === 'play' || this.state === 'cleared';

    if (playing && p.alive) {
      p.throttle = inp.throttle;
      p.turn = inp.turn;
      p.aimAt(Math.atan2(inp.aimY - p.y, inp.aimX - p.x));
      if (inp.fire) this.fire(p);
      if (inp.mg) this.fireMG(p);
      this.updateCrew();
    } else { p.throttle = 0; p.turn = 0; }
    if (this.smokeCd > 0) this.smokeCd--;

    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (playing) updateAI(e, this);
      else { e.throttle = 0; e.turn = 0; }
    }

    for (const t of this.tanks) t.update(this.grid, this.debris);
    this.collideTanks();
    this.projectiles.update(this);

    for (let i = this.pending.length - 1; i >= 0; i--) {
      const b = this.pending[i];
      if (--b.t <= 0) { this.pending.splice(i, 1); b.fn(); }
    }

    this.emitters();
    this.updateScrap();
    this.updateElements();
    this.flames.step(this.grid, this.gas, this.hooks.onBarrel);
    if (this.grid.version !== this.gasVersion && this.tick % 4 === 0) {
      this.gas.syncSolid(this.grid);
      this.gasVersion = this.grid.version;
    }
    this.gas.step();

    // standing in fire hurts (engine first)
    for (const t of this.tanks) {
      if (!t.alive || t.burning > 0) continue;
      const h = this.gas.heatAt(t.x, t.y);
      const fd = t === p ? p.mods.fireDmg : 1; // FIREPROOF HULL
      if (h > 0.5 && fd > 0) { t.damagePart('hull', (h - 0.5) * 0.4 * fd); t.damagePart('engine', (h - 0.5) * 0.3 * fd); }
    }

    const cam = this.cam;
    this.debris.update(this.grid,
      cam.x - ACTIVE_MARGIN, cam.y - ACTIVE_MARGIN,
      cam.x + VIEW_W + ACTIVE_MARGIN, cam.y + VIEW_H + ACTIVE_MARGIN, this.hooks);

    if (this.tick % 30 === 0 && this.nav.version !== this.grid.version) this.nav.rebuild(this.grid);
    if (this.tick % 20 === 0 && p.alive) this.nav.flow(p.x, p.y);

    for (const t of this.tanks) {
      for (const e of t.events) {
        const text = BREAK_TEXT[e] || (e === 'ammo' && !t.team ? 'AMMO HIT!' : null);
        if (text) this.popup(text, t.x, t.y - t.hw - 10, 12, t === p);
        if (e === 'engine') this.gas.addSteam(t.x, t.y, 1.5);
      }
      t.events.length = 0;
    }
    for (const t of this.tanks) if (t.alive && t.parts.hull.hp <= 0) this.killTank(t);

    for (let i = this.flashes.length - 1; i >= 0; i--) if (++this.flashes[i].t >= 10) this.flashes.splice(i, 1);
    for (let i = this.popups.length - 1; i >= 0; i--) if (++this.popups[i].t >= this.popups[i].life) this.popups.splice(i, 1);
    this.shake *= 0.85;

    this.updateState();
    this.updateCamera(inp);
  }

  // smoke/fire/steam sources attached to entities
  // ------------------------------------------------------------ elements

  // Shell payloads applied where a shell lands (wall or tank).
  impact(p, x, y) {
    if (p.cryo) this.freezeAt(x, y, p.r * 1.6, 1);
    if (p.oilShell) this.spillOil(x, y, p.r * 0.9);
    if (p.cluster) {
      for (let k = 0; k < 3; k++) {
        const a = rnd() * 6.28, v = 2 + rnd() * 1.5;
        this.projectiles.spawn({
          kind: 'shell', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, owner: null, team: p.team,
          dmg: p.dmg * 0.3, r: p.r * 0.55, power: p.power * 0.55, life: 6 + ((rnd() * 8) | 0),
          incendiary: p.incendiary, cryo: p.cryo, oilShell: p.oilShell, cluster: false, bounces: 0,
        });
      }
    }
  }

  freezeAt(x, y, r, strength) {
    const m = this.player.mods;
    this.frost.freeze(this.grid, this.gas, this.flames, x, y, r, strength * m.frostPower, m.frostTime);
    for (const t of this.tanks) {
      if (!t.alive) continue;
      const d = Math.hypot(t.x - x, t.y - y), reach = r + t.hw;
      if (d < reach) t.frost = Math.min(1.5, t.frost + 0.8 * strength * m.frostPower * (1 - d / reach));
    }
    const n = Math.min(24, Math.round(r));
    for (let k = 0; k < n; k++) {
      const a = rnd() * 6.28, v = 0.8 + rnd() * 2.5;
      this.debris.spawn(x, y, Math.cos(a) * v, Math.sin(a) * v, M.ICEBIT, 10 + ((rnd() * 20) | 0));
    }
  }

  // Oil pool plus droplets flung outward that land as more oil.
  spillOil(x, y, r) {
    const k = this.player.mods.oilAmount;
    this.oil.splash(this.grid, x, y, r * 0.6 * Math.sqrt(k), 6); // deep pool: it will run
    const n = Math.round(20 * k);
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.28, v = 0.6 + rnd() * 2.2;
      this.debris.spawn(x, y, Math.cos(a) * v, Math.sin(a) * v, M.OILDROP);
    }
  }

  // Element simulation + build effects that depend on the room state.
  updateElements() {
    const p = this.player, m = p.mods, g = this.grid;
    this.flames.lifeMult = m.fireLife;
    this.flames.spreadMult = m.fireSpread;
    this.flames.oilHeat = m.napalm ? 2 : 1;
    g.brittle = m.brittle;
    this.oil.step(g);
    if (this.tick % 4 === 0) this.frost.step(g, this.gas);

    for (const t of this.tanks) {
      if (!t.alive || t.frost <= 0) continue;
      t.frost = Math.max(0, t.frost - (t === p ? 0.004 : 0.004 / m.frostTime));
      if (this.gas.heatAt(t.x, t.y) > 0.3) t.frost = Math.max(0, t.frost - 0.05); // heat thaws
    }

    // PHOENIX HULL: damage taken shrinks with the burning area
    p.dmgTaken = m.phoenix ? Math.max(0.3, 1 - this.flames.list.length / 2000) : 1;
    // INFERNO LOADER / COLD BLOOD: reload speed
    let rb = 1;
    if (m.inferno) {
      const L = this.flames.list;
      let near = 0;
      for (let i = 0; i < L.length; i += 4) {
        const dx = (L[i] % g.w) - p.x, dy = ((L[i] / g.w) | 0) - p.y;
        if (dx * dx + dy * dy < 80 * 80) near += 4;
      }
      rb += Math.min(1, near / 150);
    }
    if (m.coldBlood && this.enemies.some((e) => e.alive && e.frost > 0.2)) rb *= 2;
    p.reloadBoost = rb;
    // LEAKY TANK
    if (m.leaky && p.alive && Math.hypot(p.vx, p.vy) > 0.3 && this.tick % 3 === 0) {
      const bx = p.x - Math.cos(p.a) * (p.hl + 2), by = p.y - Math.sin(p.a) * (p.hl + 2);
      this.oil.add(g, Math.floor(bx), Math.floor(by), Math.round(2 * m.oilAmount));
    }
  }

  // Mechanics repair their assigned part, using spare parts; twice as fast
  // when the tank holds still. Wrecked parts come back slowly.
  updateCrew() {
    const p = this.player;
    const still = Math.hypot(p.vx, p.vy) < 0.2 && Math.abs(p.av) < 0.01;
    for (const k of this.crew) {
      if (!k) continue;
      const pp = p.parts[k];
      const slick = p.mods.slick && p.onOil > 0.15; // SLICK OPERATOR
      if (pp.hp >= pp.max || (this.spares <= 0 && !slick)) continue;
      const rate = pp.max * 0.0008 * (still ? 2 : 1) * (k === 'hull' ? 0.35 : 1) * (pp.hp <= 0 ? 0.5 : 1) *
        p.mods.crewRate * (slick ? 3 : 1);
      const add = Math.min(rate, pp.max - pp.hp);
      const was = pp.hp;
      pp.hp += add;
      if (!slick) this.spares = Math.max(0, this.spares - add / (k === 'hull' ? 4 : 8));
      if (was <= 0 && pp.hp > 0) this.popup(`${PART_LABEL[k]} FIXED!`, p.x, p.y - p.hw - 10, 11, true);
    }
    if (this.crew.includes('engine') && p.burning > 0) p.burning = Math.max(0, p.burning - 3); // put the fire out
  }

  updateScrap() {
    const p = this.player, g = this.grid;
    for (let i = this.scrap.length - 1; i >= 0; i--) {
      const s = this.scrap[i];
      if (--s.t <= 0) { this.scrap.splice(i, 1); continue; }
      if (p.alive) {
        const dx = p.x - s.x, dy = p.y - s.y, d = Math.hypot(dx, dy) || 1;
        if (d < p.hw + 6) {
          this.spares = Math.min(99, this.spares + 3);
          this.pickupAcc += 3;
          this.scrap.splice(i, 1);
          continue;
        }
        if (d < 40) { s.vx += (dx / d) * 0.12; s.vy += (dy / d) * 0.12; } // magnet
      }
      s.vx *= 0.9; s.vy *= 0.9;
      const nx = s.x + s.vx, ny = s.y + s.vy;
      if (g.isSolid(Math.floor(nx), Math.floor(s.y))) s.vx *= -0.5; else s.x = nx;
      if (g.isSolid(Math.floor(s.x), Math.floor(ny))) s.vy *= -0.5; else s.y = ny;
    }
    if (this.pickupAcc && this.tick % 20 === 0) {
      this.popup(`+${this.pickupAcc} SPARES`, p.x, p.y - p.hw - 10, 10);
      this.pickupAcc = 0;
    }
  }

  emitters() {
    for (let i = this.smokeClouds.length - 1; i >= 0; i--) {
      const c = this.smokeClouds[i];
      if (--c.t <= 0) { this.smokeClouds.splice(i, 1); continue; }
      const k = Math.min(1, c.t / 60);
      for (let n = 0; n < 3; n++) this.gas.addSmoke(c.x + (rnd() - 0.5) * 14, c.y + (rnd() - 0.5) * 14, 0.3 * k);
      if (c.t % 10 === 0) this.gas.addExpand(c.x, c.y, 0.15 * k);
    }
    for (const t of this.tanks) {
      if (!t.alive) continue;
      const ex = t.x - Math.cos(t.a) * t.hl * 0.7, ey = t.y - Math.sin(t.a) * t.hl * 0.7;
      if (t.burning > 0) {
        this.gas.addHeat(ex, ey, 0.25);
        this.gas.addSmoke(ex, ey, 0.12);
      } else if (t.frac('engine') < 0.5 && this.tick % 4 === 0) {
        this.gas.addSteam(ex, ey, 0.25 * (1 - t.frac('engine'))); // leaking radiator
      }
      if (t.frac('hull') < 0.35 && this.tick % 6 === 0) this.gas.addSmoke(t.x, t.y, 0.08);
    }
    for (let i = this.wrecks.length - 1; i >= 0; i--) {
      const w = this.wrecks[i];
      if (--w.t <= 0) { this.wrecks.splice(i, 1); continue; }
      const k = w.t / w.max;
      this.gas.addSmoke(w.x + (rnd() - 0.5) * 8, w.y + (rnd() - 0.5) * 8, 0.1 * k);
      if (w.t > w.max - 150) this.gas.addHeat(w.x + (rnd() - 0.5) * 6, w.y + (rnd() - 0.5) * 6, 0.3);
    }
  }

  collideTanks() {
    const ts = this.tanks;
    for (let i = 0; i < ts.length; i++) {
      const a = ts[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < ts.length; j++) {
        const b = ts[j];
        if (!b.alive) continue;
        const lim = a.bound + b.bound;
        if ((b.x - a.x) ** 2 + (b.y - a.y) ** 2 > lim * lim) continue;
        for (const pa of a.circles()) {
          for (const pb of b.circles()) {
            const dx = pb.x - pa.x, dy = pb.y - pa.y, rr = pa.r + pb.r;
            const d2 = dx * dx + dy * dy;
            if (d2 >= rr * rr) continue;
            const d = Math.sqrt(d2) || 0.01, nx = dx / d, ny = dy / d, o = rr - d;
            const wa = b.mass / (a.mass + b.mass), wb = 1 - wa;
            a.x -= nx * o * wa; a.y -= ny * o * wa;
            b.x += nx * o * wb; b.y += ny * o * wb;
            const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rv < 0) {
              const j2 = -rv * 1.2;
              a.vx -= nx * j2 * wa; a.vy -= ny * j2 * wa;
              b.vx += nx * j2 * wb; b.vy += ny * j2 * wb;
              if (-rv > 0.6) { // ramming damage
                const dmg = -rv * 12;
                a.damagePart('hull', dmg * wa); b.damagePart('hull', dmg * wb);
              }
            }
          }
        }
      }
    }
  }

  updateState() {
    const p = this.player;
    if (this.state === 'play') {
      if (!p.alive) { this.state = 'dead'; this.stateT = 0; }
      else if (this.enemies.every((e) => !e.alive)) {
        this.state = 'cleared'; this.stateT = 0;
        this.popup('ROOM CLEARED!', p.x, p.y - 30, 22, true, true);
      }
    } else if (this.state === 'cleared') {
      if (!p.alive) { this.state = 'dead'; this.stateT = 0; }
      else if (++this.stateT > 120) {
        if (this.level >= ROOMS) this.state = 'win';
        else { this.state = 'reward'; this.choices = pickRewards(this.rng, this.build, this.tagCount, this.level); }
      }
    } else this.stateT++;
  }

  updateCamera(inp) {
    const p = this.player;
    let tx = p.x - VIEW_W / 2, ty = p.y - VIEW_H / 2;
    if (p.alive && inp) { // look ahead toward the mouse
      tx += clamp((inp.aimX - p.x) * 0.25, -90, 90);
      ty += clamp((inp.aimY - p.y) * 0.25, -60, 60);
    }
    this.cam.x += (tx - this.cam.x) * 0.1;
    this.cam.y += (ty - this.cam.y) * 0.1;
    this.cam.x = clamp(this.cam.x, 0, ROOM_W - VIEW_W);
    this.cam.y = clamp(this.cam.y, 0, ROOM_H - VIEW_H);
  }
}
