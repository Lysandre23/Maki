import { angDiff, clamp } from '../util/math.js';
import { rnd } from '../util/rng.js';

// ticks between "about to fire" warning and the shot
const CHARGE = { scout: 22, gunner: 32, heavy: 42, boss: 28 };

export function initAI(t, idx) {
  t.ai = {
    phase: idx * 3,
    los: false,
    lastSeen: null,
    strafe: rnd() < 0.5 ? 1 : -1,
    strafeT: 60 + rnd() * 120,
    stuck: 0,
    unstuck: 0,
    unTurn: 1,
    breach: 0,
    wake: 60 + idx * 25, // short grace period at room start
  };
}

// Line of sight through the cell grid; thick smoke also blocks it.
function lineOfSight(game, x0, y0, x1, y1) {
  const { grid, gas } = game;
  const dx = x1 - x0, dy = y1 - y0;
  const n = Math.ceil(Math.hypot(dx, dy) / 2);
  let smoke = 0;
  for (let k = 1; k < n; k++) {
    const x = x0 + (dx * k) / n, y = y0 + (dy * k) / n;
    if (grid.isSolid(Math.floor(x), Math.floor(y))) return false;
    smoke += gas.smokeAt(x, y);
    if (smoke > 6) return false;
  }
  return true;
}

function navDir(game, t, fallback) {
  const d = game.nav.dirAt(t.x, t.y);
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

// Part-aware behaviour:
//  - no cannon  -> tries to ram you
//  - no turret  -> turns the whole hull to aim (tank destroyer)
//  - no tracks  -> stays put, still shoots
//  - stuck      -> backs off and blasts the wall in front
export function updateAI(t, game) {
  const ai = t.ai, p = game.player;
  t.throttle = 0; t.turn = 0;
  if (ai.wake > 0) { ai.wake--; return; }
  if (!p.alive) return;

  const dx = p.x - t.x, dy = p.y - t.y, dist = Math.hypot(dx, dy);
  if ((game.tick + ai.phase) % 6 === 0) ai.los = lineOfSight(game, t.x, t.y, p.x, p.y);
  if (ai.los) ai.lastSeen = { x: p.x, y: p.y };
  const toP = Math.atan2(dy, dx);

  // aim (lead the target a bit)
  let aim = t.a;
  if (ai.breach > 0) { ai.breach--; aim = t.a; }
  else if (ai.los) {
    const tt = dist / t.s.shell.speed;
    aim = Math.atan2(p.y + p.vy * tt * 0.8 - t.y, p.x + p.vx * tt * 0.8 - t.x);
  } else if (ai.lastSeen) aim = Math.atan2(ai.lastSeen.y - t.y, ai.lastSeen.x - t.x);
  t.aimAt(aim);

  // Firing is telegraphed: the tank "charges" (laser line + muzzle glint, turret
  // nearly locked) before the shell leaves, so the player can dodge.
  if (t.charge > 0) {
    if (--t.charge === 0 && t.canFire()) { game.fire(t); ai.breach = 0; }
  } else {
    const aligned = Math.abs(angDiff(aim, t.ta)) < 0.06;
    if (aligned && t.canFire() && ((ai.los && rnd() < 0.06) || ai.breach > 0)) {
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
  let desired, speed = 1;
  if (t.parts.cannon.hp <= 0) desired = navDir(game, t, toP); // ram
  else if (ai.los) {
    if (dist < range * 0.6) desired = toP + Math.PI + ai.strafe * 0.5;
    else if (dist > range * 1.2) desired = navDir(game, t, toP);
    else {
      if (--ai.strafeT <= 0) { ai.strafe = -ai.strafe; ai.strafeT = 80 + rnd() * 140; }
      desired = toP + (ai.strafe * Math.PI) / 2;
      speed = 0.7;
    }
  } else desired = navDir(game, t, toP);

  steer(t, desired, speed);

  const v = Math.hypot(t.vx, t.vy);
  const canDrive = t.parts.trackL.hp > 0 && t.parts.trackR.hp > 0 && t.parts.engine.hp > 0;
  if (canDrive && Math.abs(t.throttle) > 0.5 && v < 0.08) {
    if (++ai.stuck > 50) {
      ai.stuck = 0;
      ai.unstuck = 35;
      ai.unTurn = rnd() < 0.5 ? -1 : 1;
      if (t.parts.cannon.hp > 0) ai.breach = 40;
    }
  } else ai.stuck = Math.max(0, ai.stuck - 1);
}
