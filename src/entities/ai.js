import { angDiff, clamp } from '../util/math.js';
import { rnd } from '../util/rng.js';

// ticks between "about to fire" warning and the shot
const CHARGE = { scout: 22, gunner: 32, heavy: 42, boss: 28 };
const SIGHT = 460;   // max engagement distance
const LEASH = 240;   // how far a defender strays from its post while fighting
const MOVE_ENGAGE = 200;

// Orders (set by the game now, by the tactical map later):
//   follow: keep a formation slot around the player's tank
//   hold:   stay near `post`, fight whatever comes in range
//   attack: push to `goal`, fighting on the way
//   move:   go to `goal`, only fight when hit or a foe is within MOVE_ENGAGE
// Allies get theirs from their squad (game/squads.js).
export function initAI(t, idx, order = 'hold') {
  t.ai = {
    phase: idx * 5,
    order,
    post: { x: t.x, y: t.y },
    goal: null,
    slot: null,           // {dx, dy} in the leader's frame (behind = negative dx)
    target: null,
    los: false,
    lastSeen: null,
    lastSeenT: 0,
    dest: null,           // squad-planned destination (allies)
    retreat: false,       // cautious stance, falling back to the player
    exempt: 0,            // squad order under which it already fell back
    strafe: rnd() < 0.5 ? 1 : -1,
    strafeT: 60 + rnd() * 120,
    stuck: 0,
    unstuck: 0,
    unTurn: 1,
    breach: 0,
    wake: 40 + idx * 12,
  };
}

// Line of sight through the cell grid; thick smoke also blocks it.
export function lineOfSight(game, x0, y0, x1, y1) {
  const { grid, gas } = game;
  const dx = x1 - x0, dy = y1 - y0;
  const n = Math.ceil(Math.hypot(dx, dy) / 3);
  let smoke = 0;
  for (let k = 1; k < n; k++) {
    const x = x0 + (dx * k) / n, y = y0 + (dy * k) / n;
    if (grid.isSolid(Math.floor(x), Math.floor(y))) return false;
    smoke += gas.smokeAt(x, y);
    if (smoke > 5) return false;
  }
  return true;
}

// Nearest hostile we can actually see (checks at most 3 candidates).
function pickTarget(t, game) {
  const foes = t.team ? game.friendlies : game.enemies;
  const cands = [];
  for (const f of foes) {
    if (!f.alive) continue;
    const d = Math.hypot(f.x - t.x, f.y - t.y);
    if (d < SIGHT) cands.push([d, f]);
  }
  cands.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < Math.min(3, cands.length); i++) {
    const f = cands[i][1];
    if (lineOfSight(game, t.x, t.y, f.x, f.y)) return f;
  }
  return null;
}

// Would a shot along `ang` pass through a friendly tank before `range`?
function friendlyInLine(t, game, ang, range) {
  const mates = t.team ? game.enemies : game.friendlies;
  const c = Math.cos(ang), s = Math.sin(ang);
  for (const m of mates) {
    if (m === t || !m.alive) continue;
    const dx = m.x - t.x, dy = m.y - t.y;
    const along = dx * c + dy * s;
    if (along < 0 || along > range) continue;
    if (Math.abs(-dx * s + dy * c) < m.hw + 6) return true;
  }
  return false;
}

function navDir(game, t, gx, gy, fallback) {
  const d = game.nav.dirAt(game.nav.field(gx, gy), t.x, t.y);
  return d === null ? fallback : d;
}

// Turn toward `desired`; drive in reverse if it's behind us.
function steer(t, desired, speed) {
  const d = angDiff(desired, t.a);
  if (Math.abs(d) > 2.3) {
    const r = angDiff(desired + Math.PI, t.a);
    t.turn = clamp(r * 2.5, -1, 1);
    t.throttle = Math.abs(r) < 0.6 ? -speed : 0;
  } else {
    t.turn = clamp(d * 2.5, -1, 1);
    t.throttle = Math.abs(d) < 0.7 ? speed : 0.1;
  }
}

// Where the order wants this tank to be right now. Allies take the order from
// their squad (game/squads.js), which also plans `ai.dest`; enemies use their own.
// passive = don't stop to fight unless hit or a foe gets close (Move order);
// chase = close in on targets beyond gun range.
function orderGoal(t, game) {
  const ai = t.ai, p = game.player;
  const order = t.squad ? t.squad.order : ai.order;
  if (ai.retreat) {
    const at = p.alive ? { x: p.x - Math.cos(p.a) * 70, y: p.y - Math.sin(p.a) * 70 } : ai.post;
    return { x: at.x, y: at.y, leash: 120, anchor: p.alive ? p : ai.post, passive: true };
  }
  if (order === 'follow' && p.alive) {
    const c = Math.cos(p.a), s = Math.sin(p.a);
    const sl = ai.slot || { dx: -60, dy: 0 };
    return { x: p.x + sl.dx * c - sl.dy * s, y: p.y + sl.dx * s + sl.dy * c, leash: 200, anchor: p, chase: true, follow: true };
  }
  const dest = t.squad ? ai.dest : ai.goal;
  if (order === 'move' && dest) return { x: dest.x, y: dest.y, leash: 1e9, anchor: null, passive: true };
  if (order === 'attack' && dest) return { x: dest.x, y: dest.y, leash: 1e9, anchor: null, chase: true };
  const post = (t.squad && ai.dest) || ai.post;
  return { x: post.x, y: post.y, leash: LEASH, anchor: post };
}

// Part-aware behaviour:
//  - no cannon  -> tries to ram its target
//  - no turret  -> turns the whole hull to aim (tank destroyer)
//  - stuck      -> backs off and blasts the wall in front
export function updateAI(t, game) {
  const ai = t.ai;
  t.throttle = 0; t.turn = 0;
  if (ai.wake > 0) { ai.wake--; return; }

  if ((game.tick + ai.phase) % 12 === 0) {
    ai.target = pickTarget(t, game);
    ai.los = !!ai.target;
    if (ai.target) { ai.lastSeen = { x: ai.target.x, y: ai.target.y }; ai.lastSeenT = game.tick; }
  }
  const tg = ai.target && ai.target.alive ? ai.target : null;
  if (!tg) ai.los = false;
  if (ai.lastSeen && game.tick - ai.lastSeenT > 360) ai.lastSeen = null;

  const goal = orderGoal(t, game);

  // aim (lead the target a bit)
  let aim = t.a, dist = Infinity, toT = t.a;
  if (tg) {
    dist = Math.hypot(tg.x - t.x, tg.y - t.y);
    toT = Math.atan2(tg.y - t.y, tg.x - t.x);
  }
  if (ai.breach > 0) { ai.breach--; aim = t.a; }
  else if (tg && ai.los) {
    const tt = dist / t.s.shell.speed;
    aim = Math.atan2(tg.y + tg.vy * tt * 0.8 - t.y, tg.x + tg.vx * tt * 0.8 - t.x);
  } else if (ai.lastSeen) aim = Math.atan2(ai.lastSeen.y - t.y, ai.lastSeen.x - t.x);
  else if (t.team) aim = Math.PI; // defenders watch the west
  t.aimAt(aim);

  // Firing is telegraphed: the tank "charges" (laser line + muzzle glint,
  // turret nearly locked) before the shell leaves, so the player can dodge.
  if (t.charge > 0) {
    if (--t.charge === 0 && t.canFire() && !friendlyInLine(t, game, t.ta, Math.min(dist, SIGHT))) {
      game.fire(t);
      ai.breach = 0;
    }
  } else {
    const aligned = Math.abs(angDiff(aim, t.ta)) < 0.06;
    const wantShot = (ai.los && dist < SIGHT && rnd() < 0.05) || ai.breach > 0;
    if (aligned && t.canFire() && wantShot && !friendlyInLine(t, game, t.ta, Math.min(dist, SIGHT))) {
      t.charge = t.chargeMax = CHARGE[t.type] || 30;
    }
  }

  if (ai.unstuck > 0) { ai.unstuck--; t.throttle = -0.8; t.turn = ai.unTurn; return; }

  // turret knocked out: rotate the hull to bring the gun on target
  if (t.parts.turret.hp <= 0 && t.parts.cannon.hp > 0 && ai.los) {
    t.turn = clamp(angDiff(aim - t.turretLock, t.a) * 3, -1, 1);
    return;
  }

  const range = t.s.range;
  const fromAnchor = goal.anchor ? Math.hypot(t.x - goal.anchor.x, t.y - goal.anchor.y) : 0;
  const toGoal = Math.hypot(goal.x - t.x, goal.y - t.y);
  let desired = null, speed = 1;

  if (tg && t.parts.cannon.hp <= 0) desired = navDir(game, t, tg.x, tg.y, toT); // ram
  else if (tg && ai.los && fromAnchor < goal.leash && (!goal.passive || dist < MOVE_ENGAGE || t.hurtT > 0)) {
    if (dist < range * 0.6) desired = toT + Math.PI + ai.strafe * 0.5;
    else if (dist > range * 1.2 && goal.chase) desired = navDir(game, t, tg.x, tg.y, toT);
    else {
      if (--ai.strafeT <= 0) { ai.strafe = -ai.strafe; ai.strafeT = 80 + rnd() * 140; }
      desired = toT + (ai.strafe * Math.PI) / 2;
      speed = 0.6;
    }
  } else if (toGoal > (goal.follow ? 30 : 24)) {
    desired = navDir(game, t, goal.x, goal.y, Math.atan2(goal.y - t.y, goal.x - t.x));
    if (goal.follow) speed = clamp(toGoal / 80, 0.4, 1);
  }

  if (desired === null) { // idle: face the likely threat
    const face = ai.lastSeen ? Math.atan2(ai.lastSeen.y - t.y, ai.lastSeen.x - t.x) : t.team ? Math.PI : game.player.a;
    const d = angDiff(face, t.a);
    if (Math.abs(d) > 0.3) t.turn = clamp(d * 1.5, -0.6, 0.6);
    return;
  }
  steer(t, desired, speed);

  const v = Math.hypot(t.vx, t.vy);
  const canDrive = t.parts.trackL.hp > 0 && t.parts.trackR.hp > 0 && t.parts.engine.hp > 0;
  if (canDrive && Math.abs(t.throttle) > 0.5 && v < 0.08) {
    if (++ai.stuck > 50) {
      ai.stuck = 0;
      ai.unstuck = 35;
      ai.unTurn = rnd() < 0.5 ? -1 : 1;
      if (t.parts.cannon.hp > 0 && t.team) ai.breach = 40; // enemies blast through; allies don't shoot hedges near you
    }
  } else ai.stuck = Math.max(0, ai.stuck - 1);
}
