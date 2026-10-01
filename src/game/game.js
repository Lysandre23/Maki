import { VIEW_W, VIEW_H, ROOM_W, ROOM_H, BATTLES, MAX_DEBRIS, ACTIVE_MARGIN, GAS_SCALE, GAS_WIN_W, GAS_WIN_H } from '../config.js';
import { clamp } from '../util/math.js';
import { rnd, makeRng } from '../util/rng.js';
import { Grid } from '../world/grid.js';
import { generateBattle } from '../world/worldgen.js';
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
import { pickRewards, defaultMods } from './rewards.js';
import { Vision } from './vision.js';
import { makeSquad, squadForRecruit, orderSquad, toggleStance, updateSquads } from './squads.js';

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

const EMERGENCY_PER_BATTLE = 2;
const SMOKE_PER_BATTLE = 3;
const MG_OVERHEAT = 60;
const RUSH_TICKS = 180;       // LOADER RUSH: reload x2 for 3 s after a kill
const ABANDON_TICKS = 120;    // crew bails out, then the tank blows
const CAPTURE_TICKS = 8 * 60; // flag capture time with the player alone
const START_ROSTER = ['gunner', 'gunner', 'scout', 'scout'];

// Formation slots around the player's tank, in its frame (x forward).
const FORMATION = [
  { dx: -50, dy: -52 }, { dx: -50, dy: 52 }, { dx: -100, dy: -24 }, { dx: -100, dy: 24 },
  { dx: -150, dy: -60 }, { dx: -150, dy: 60 }, { dx: -190, dy: 0 }, { dx: -230, dy: -40 }, { dx: -230, dy: 40 },
];

// Whole game state, DOM-free (also runs headless in tools/).
// states: play -> cleared -> reward -> play ... | dead | win
export class Game {
  constructor(seed = Date.now()) {
    this.rng = makeRng(seed >>> 0);
    this.grid = new Grid(ROOM_W, ROOM_H);
    this.debris = new Debris(MAX_DEBRIS);
    this.gas = new Gas(ROOM_W, ROOM_H, GAS_SCALE, GAS_WIN_W, GAS_WIN_H);
    this.flames = new Fire();
    this.nav = new Nav(this.grid, 12);
    this.vision = new Vision(ROOM_W, ROOM_H); // our team's fog of war
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
    // allies carried between battles; two squads of two to start
    this.roster = START_ROSTER.map((type, i) => ({ type, hp: null, squad: i >> 1 }));
    this.stances = {};         // squad id -> stance, kept across battles
    this.orderSeq = 0;
    this.spares = 40;          // consumed by the crew when repairing
    this.crew = [null, null];  // part each mechanic is working on
    this.crewNext = 0;
    this.powerMode = 0;
    this.player.power = POWER[0];
    this.startBattle();
  }

  startBattle() {
    const layout = generateBattle(this.grid, this.rng, this.level);
    this.debris.clear();
    this.gas.clear();
    this.flames.clear(this.grid);
    this.projectiles.list.length = 0;
    this.flashes.length = 0;
    this.pending.length = 0;
    this.wrecks.length = 0;
    this.popups.length = 0;
    this.scrap.length = 0;
    this.smokeClouds.length = 0;
    this.vision.clear();
    this.barrels = layout.barrels;
    this.biome = layout.biome;
    const m = this.player.mods;
    this.emergency = EMERGENCY_PER_BATTLE + m.extraEmergency;
    this.smokeCharges = SMOKE_PER_BATTLE + m.extraSmoke;
    this.smokeCd = 0;
    this.pickupAcc = 0;
    this.rushT = 0;
    this.flag = { x: layout.flag.x, y: layout.flag.y, r: 64, progress: 0, contested: false };

    const p = this.player;
    p.x = layout.spawn.x; p.y = layout.spawn.y;
    p.a = 0; p.ta = 0; p.vx = p.vy = p.av = 0;
    p.burning = 0; p.reload = 20; p.events.length = 0;
    p.mgHeat = 0; p.overheat = false;

    // allies from the roster, in formation behind the player
    this.allies = this.roster.map((r, i) => {
      const sl = FORMATION[i] || { dx: -240 - (i - FORMATION.length) * 40, dy: (i % 2 ? 1 : -1) * 30 };
      const t = new Tank(r.type, p.x + sl.dx * 0.6 + 60, clamp(p.y + sl.dy, 40, ROOM_H - 40), 0, 0);
      if (r.hp) for (const k of PARTS) t.parts[k].hp = r.hp[k];
      t.s.reload *= m.allyReload;
      t.dmgTaken = m.allyArmor;
      t.rosterRef = r;
      initAI(t, i, 'follow');
      t.ai.slot = sl;
      t.ai.wake = 20;
      return t;
    });
    // squads from the roster's squad ids, all following the player at first
    const byId = new Map();
    for (const t of this.allies) {
      const id = t.rosterRef.squad ?? 0;
      if (!byId.has(id)) byId.set(id, makeSquad(id, this.stances[id]));
      t.squad = byId.get(id);
      t.squad.tanks.push(t);
    }
    this.squads = [...byId.values()].sort((a, b) => a.id - b.id);
    this.enemies = layout.enemies.map((e, i) => {
      const t = new Tank(e.type, e.x, e.y, e.a, 1);
      t.ta = e.a;
      initAI(t, i, 'hold');
      return t;
    });
    this.friendlies = [p, ...this.allies];
    this.tanks = [...this.friendlies, ...this.enemies];

    this.gas.follow(p.x, p.y);
    this.gas.syncSolid(this.grid);
    this.gasVersion = this.grid.version;
    this.gas.windX = (this.rng() - 0.5) * 0.004;
    this.gas.windY = (this.rng() - 0.5) * 0.004;
    this.nav.rebuild(this.grid);

    this.state = 'play';
    this.stateT = 0;
    this.choices = null;
    this.cam.x = clamp(p.x - VIEW_W / 2, 0, ROOM_W - VIEW_W);
    this.cam.y = clamp(p.y - VIEW_H / 2, 0, ROOM_H - VIEW_H);
    this.popup(this.level >= BATTLES ? 'FINAL ASSAULT!' : `BATTLE ${this.level}`, p.x + 80, p.y - 40, 18, true, true);
    this.popup('TAKE THE FLAG!', p.x + 80, p.y - 18, 12, true);
  }

  popup(text, x, y, size = 14, accent = false, burst = false) {
    this.popups.push({ text, x, y, size, accent, burst, t: 0, life: 70, rot: (rnd() - 0.5) * 0.3 });
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
      x, y, vx: c * sh.speed, vy: s * sh.speed, owner: t, team: t.team, fromPlayer: t.isPlayer,
      dmg: sh.dmg, r: sh.r, power: sh.power, life: 150, ignore: null,
      bounces: t.mods.bounces || 0, cluster: !!t.mods.cluster,
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

  // Coaxial machine gun: fast, weak, chews bricks and hedges, strips tracks.
  fireMG(t) {
    if (t.mgCd > 0 || t.overheat || t.parts.turret.hp <= 0) return;
    const ang = t.ta + (rnd() - 0.5) * 0.07;
    const c = Math.cos(ang), s = Math.sin(ang);
    const bx = t.x + t.turretOff * Math.cos(t.a), by = t.y + t.turretOff * Math.sin(t.a);
    const px = -Math.sin(t.ta) * 3, py = Math.cos(t.ta) * 3; // offset beside the main gun
    const x = bx + px + c * (t.turretR + 3), y = by + py + s * (t.turretR + 3);
    this.projectiles.spawn({ kind: 'mg', x, y, vx: c * 10, vy: s * 10, owner: t, team: t.team, fromPlayer: t.isPlayer, dmg: 3, life: 45 });
    t.mgCd = 5;
    t.mgHeat += 2.4 * (t.mods.mgCool || 1);
    if (t.mgHeat >= MG_OVERHEAT) { t.overheat = true; if (t === this.player) this.popup('OVERHEAT!', t.x, t.y - t.hw - 10, 10, true); }
    this.debris.spawn(x, y, c * 2 + (rnd() - 0.5), s * 2 + (rnd() - 0.5), M.SPARK, 4 + ((rnd() * 5) | 0));
  }

  // Bullet hitting something solid: chips a few cells, can bring down weakened walls.
  chip(x, y) {
    explode(this.grid, this.debris, x, y, 2.2, 3.5, this.hooks);
    this.gas.addSmoke(x, y, 0.05);
    const g = this.grid, cx = Math.floor(x), cy = Math.floor(y);
    for (let k = 0; k < 4; k++) {
      const nx = cx + ((rnd() * 3) | 0) - 1, ny = cy + ((rnd() * 3) | 0) - 1;
      if (g.inBounds(nx, ny) && FLAMMABLE[g.mat[ny * g.w + nx]] && rnd() < 0.03) this.flames.ignite(g, nx, ny);
    }
    for (const cells of findCollapses(g, x, y, 26)) this.collapse(cells, x, y);
  }

  onBulletHit(t, zone, p) {
    const sp = Math.hypot(p.vx, p.vy) || 1;
    const dirx = p.vx / sp, diry = p.vy / sp;
    const dmg = p.dmg * (zone === 'trackL' || zone === 'trackR' ? 1.8 : 1);
    const res = t.takeHit(zone, dmg, dirx, diry, p.x, p.y, true);
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
      g.navTouch(x, y);
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
  // Hot blasts sometimes light the dry grass and hedges around them.
  blast(x, y, r, power, opts = {}) {
    explode(this.grid, this.debris, x, y, r, power, this.hooks);
    for (const cells of findCollapses(this.grid, x, y, r * 2.5 + 24)) this.collapse(cells, x, y);
    this.gas.blast(x, y, r, power, opts.incendiary ? 2 : 1);
    this.flashes.push({ x, y, r, t: 0, spin: rnd() * 6.28 });
    this.shake = Math.min(14, this.shake + r * 0.2);

    const g = this.grid;
    if (opts.incendiary) {
      const R = r * 1.4;
      for (let yy = Math.max(0, Math.floor(y - R)); yy <= Math.min(g.h - 1, y + R); yy++) {
        for (let xx = Math.max(0, Math.floor(x - R)); xx <= Math.min(g.w - 1, x + R); xx++) {
          if ((xx - x) ** 2 + (yy - y) ** 2 <= R * R && FLAMMABLE[g.mat[yy * g.w + xx]] && rnd() < 0.6) this.flames.ignite(g, xx, yy);
        }
      }
    } else if (rnd() < 0.25) { // one blast in four starts a small fire in the dry grass
      for (let k = 0; k < 3; k++) {
        const a = rnd() * 6.28, d = r * (0.6 + rnd() * 0.6);
        this.flames.ignite(g, Math.floor(x + Math.cos(a) * d), Math.floor(y + Math.sin(a) * d));
      }
    }
    if (opts.incendiary) {
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
    const res = t.takeHit(zone, p.dmg, dirx, diry, p.x, p.y);
    if (res.pen) this.popup('PENETRATION!', p.x, p.y - 14, 13, !t.team, !res.ricochet && !!t.team);
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
    this.blast(p.x, p.y, p.r * 0.45, p.power * 0.5, { noSplash: true });
    this.impact(p, p.x, p.y);
    if (zone === 'engine') this.gas.addSteam(p.x, p.y, 1.2);
    if (t === this.player) this.shake = Math.min(14, this.shake + 5);
    return res;
  }

  // Extra effects where a shell lands (wall or tank).
  impact(p, x, y) {
    if (!p.cluster) return;
    for (let k = 0; k < 3; k++) {
      const a = rnd() * 6.28, v = 2 + rnd() * 1.5;
      this.projectiles.spawn({
        kind: 'shell', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, owner: null, team: p.team, fromPlayer: p.fromPlayer,
        dmg: p.dmg * 0.3, r: p.r * 0.55, power: p.power * 0.55, life: 6 + ((rnd() * 8) | 0), cluster: false, bounces: 0,
      });
    }
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
    // spare parts thrown out of the wreck (yours too: salvage your fallen)
    const n = (t.team ? 4 : 2) + Math.floor(t.hw / 3);
    for (let k = 0; k < n; k++) {
      const a = rnd() * 6.28, v = 1.5 + rnd() * 2.5;
      this.scrap.push({ x: t.x, y: t.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 1800 });
    }
    if (!t.team && !t.isPlayer) this.popup('ALLY LOST!', t.x, t.y - t.hw - 24, 14, true);
    this.popup(big ? 'KA-BOOM!' : 'BLAM!', t.x, t.y - t.hw - 8, big ? 22 : 18, false, true);
    this.shake = Math.min(14, this.shake + (big ? 10 : 6));
    if (t.team && this.player.alive) { // LOADER RUSH: momentum after a kill
      this.rushT = RUSH_TICKS;
      this.popup('LOADER RUSH!', this.player.x, this.player.y - this.player.hw - 14, 11, true);
    }
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
        if (g.mat[i] !== M.EMPTY && g.mat[i] !== M.RUBBLE && g.mat[i] !== M.GRASS) continue;
        if (others.some((o) => (o.x - x) ** 2 + (o.y - y) ** 2 < (o.hw + 2) ** 2)) continue;
        const du = u - t.turretOff;
        const d = du * du + v * v < t.turretR * t.turretR ? 3 : Math.abs(v) > t.hw - t.trackW ? 2 : 1;
        g.setCell(x, y, M.WRECK, d);
      }
    }
  }

  // Survivors go back into the roster (damage carried over).
  saveRoster() {
    this.roster = this.allies.filter((t) => t.alive).map((t) => {
      const hp = {};
      for (const k of PARTS) hp[k] = t.parts[k].hp;
      return { type: t.type, hp, squad: t.squad.id };
    });
  }

  addRecruit(type) {
    this.roster.push({ type, hp: null, squad: squadForRecruit(this.roster) });
  }

  // ---------------------------------------------------------------- squads

  squad(id) { return this.squads.find((q) => q.id === id) || null; }

  orderSquad(id, order, x, y) {
    const sq = this.squad(id);
    if (sq) orderSquad(this, sq, order, x, y);
  }

  toggleStance(id) {
    const sq = this.squad(id);
    if (!sq) return;
    toggleStance(sq);
    this.stances[id] = sq.stance;
  }

  // Nearest enemy we know about (seen or remembered) to a point, for cover planning.
  threatNear(x, y) {
    let best = null, bd = Infinity;
    for (const k of this.vision.known.values()) {
      const d = (k.x - x) ** 2 + (k.y - y) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  chooseReward(i) {
    if (this.state !== 'reward' || !this.choices || !this.choices[i]) return;
    const r = this.choices[i];
    r.apply(this.player, this);
    this.build.push(r.id);
    for (const tag of r.tags) this.tagCount[tag] = (this.tagCount[tag] || 0) + 1;
    // patch-up between battles: +20%, and wrecked parts come back at 30%
    const patch = (parts, full) => {
      for (const k of PARTS) {
        const p = parts[k], max = p.max;
        p.hp = full ? max : p.hp <= 0 ? max * 0.3 : Math.min(max, p.hp + max * 0.2);
      }
    };
    patch(this.player.parts, false);
    for (const r2 of this.roster) {
      if (!r2.hp) continue;
      const tmp = new Tank(r2.type, 0, 0, 0, 0);
      for (const k of PARTS) tmp.parts[k].hp = r2.hp[k];
      patch(tmp.parts, this.player.mods.fieldWorkshop);
      for (const k of PARTS) r2.hp[k] = tmp.parts[k].hp;
    }
    this.level++;
    this.startBattle();
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

    if (playing) {
      this.vision.update(this, this.friendlies, this.enemies);
      updateSquads(this);
    }
    for (const t of this.tanks) {
      if (!t.alive || t.isPlayer) continue;
      if (playing) updateAI(t, this);
      else { t.throttle = 0; t.turn = 0; }
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
    if (this.rushT > 0) this.rushT--;
    p.reloadBoost = this.rushT > 0 ? 2 : 1;
    this.flames.step(this.grid, this.gas, this.hooks.onBarrel);

    // gas window follows the camera; re-sync obstacles when it moves or walls change
    const moved = this.gas.follow(this.cam.x + VIEW_W / 2, this.cam.y + VIEW_H / 2);
    if (moved || (this.grid.version !== this.gasVersion && this.tick % 4 === 0)) {
      this.gas.syncSolid(this.grid);
      this.gasVersion = this.grid.version;
    }
    this.gas.step();

    // standing in fire hurts (engine first)
    for (const t of this.tanks) {
      if (!t.alive || t.burning > 0) continue;
      const h = this.gas.heatAt(t.x, t.y);
      if (h > 0.5) { t.damagePart('hull', (h - 0.5) * 0.4); t.damagePart('engine', (h - 0.5) * 0.3); }
    }

    const cam = this.cam;
    this.debris.update(this.grid,
      cam.x - ACTIVE_MARGIN, cam.y - ACTIVE_MARGIN,
      cam.x + VIEW_W + ACTIVE_MARGIN, cam.y + VIEW_H + ACTIVE_MARGIN, this.hooks);

    // pathfinding catches up with destroyed hedges / walls / new wrecks
    const nb = this.grid.navBox;
    if (nb && this.tick % 15 === 0) {
      this.nav.rebuildRegion(this.grid, nb[0] - 24, nb[1] - 24, nb[2] + 24, nb[3] + 24);
      this.grid.navBox = null;
    }

    for (const t of this.tanks) {
      for (const e of t.events) {
        const text = BREAK_TEXT[e] || (e === 'ammo' && !t.team ? 'AMMO HIT!' : null);
        if (text) this.popup(text, t.x, t.y - t.hw - 10, 12, t === p);
        if (e === 'engine') this.gas.addSteam(t.x, t.y, 1.5);
      }
      t.events.length = 0;
    }
    this.missionKills();
    for (const t of this.tanks) if (t.alive && t.parts.hull.hp <= 0) this.killTank(t);

    for (let i = this.flashes.length - 1; i >= 0; i--) if (++this.flashes[i].t >= 10) this.flashes.splice(i, 1);
    for (let i = this.popups.length - 1; i >= 0; i--) if (++this.popups[i].t >= this.popups[i].life) this.popups.splice(i, 1);
    this.shake *= 0.85;

    if (this.state === 'play') this.updateFlag();
    this.updateState();
    this.updateCamera(inp);
  }

  // Capture fills while friendlies (and no enemies) are in the zone; more
  // friendlies capture faster. Contested = frozen; empty = slow decay.
  updateFlag() {
    const f = this.flag;
    let friends = 0, foes = 0;
    for (const t of this.tanks) {
      if (!t.alive || Math.hypot(t.x - f.x, t.y - f.y) > f.r + t.hw * 0.5) continue;
      if (t.team) foes++; else friends++;
    }
    f.contested = friends > 0 && foes > 0;
    const rate = (1 / CAPTURE_TICKS) * this.player.mods.quickCapture;
    if (friends && !foes) f.progress = Math.min(1, f.progress + rate * (1 + 0.3 * (friends - 1)));
    else if (!friends) f.progress = Math.max(0, f.progress - rate * 0.25);
    if (f.progress >= 1) {
      this.state = 'cleared'; this.stateT = 0;
      this.saveRoster();
      this.popup('FLAG CAPTURED!', f.x, f.y - 50, 24, true, true);
    }
  }

  // Mission kill: a tank with no gun and no way to move is abandoned by its
  // crew and scuttled a couple of seconds later (yours too, except you).
  missionKills() {
    for (const t of this.tanks) {
      if (!t.alive || t.isPlayer) continue;
      const pt = t.parts;
      const stuck = pt.engine.hp <= 0 || (pt.trackL.hp <= 0 && pt.trackR.hp <= 0);
      if (!t.abandonT && pt.cannon.hp <= 0 && stuck) {
        t.abandonT = ABANDON_TICKS;
        this.popup('ABANDONED!', t.x, t.y - t.hw - 12, 14, !t.team, true);
        this.gas.addSmoke(t.x, t.y, 1.5);
      }
      if (t.abandonT && --t.abandonT <= 0) t.parts.hull.hp = 0;
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
      if (pp.hp >= pp.max || this.spares <= 0) continue;
      const rate = pp.max * 0.0008 * (still ? 2 : 1) * (k === 'hull' ? 0.35 : 1) * (pp.hp <= 0 ? 0.5 : 1) * p.mods.crewRate;
      const add = Math.min(rate, pp.max - pp.hp);
      const was = pp.hp;
      pp.hp += add;
      this.spares = Math.max(0, this.spares - add / (k === 'hull' ? 4 : 8));
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

  // smoke/fire/steam sources attached to entities
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
              if (-rv > 0.6 && a.team !== b.team) { // ramming damage (friends just bump)
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
    } else if (this.state === 'cleared') {
      if (!p.alive) { this.state = 'dead'; this.stateT = 0; }
      else if (++this.stateT > 150) {
        if (this.level >= BATTLES) this.state = 'win';
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
