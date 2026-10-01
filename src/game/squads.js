// Squads: groups of allied tanks sharing one order and stance.
// The game owns them (Game.squads); the AI reads `t.squad` and `t.ai.dest`.
//   follow: formation slot around the player (per-tank FORMATION slot)
//   move:   drive to the point, only stop to fight when hit or a foe is close
//   attack: drive to the point, engaging everything on the way
//   hold:   take cover around the point, fight within a leash
// Stance: aggressive never retreats; cautious falls back to the player below
// 40% hull and stays there until the order is renewed.

export const MAX_SQUADS = 4;
export const RETREAT_HULL = 0.4;
const ROW = 40, SIDE = 28;      // formation spacing around a squad goal
const COVER_R = 5;              // cover search radius, in nav nodes
const REPLAN = 120;             // ticks between hold cover re-evaluations

export function makeSquad(id, stance = 'aggressive') {
  return { id, tanks: [], order: 'follow', goal: null, heading: 0, stance, orderT: 0, planT: 0, planN: 0 };
}

// Roster entries carry a squad id. Recruits join the smallest squad with room
// (3 tanks max), else open a new squad, else the smallest one.
export function squadForRecruit(roster) {
  const n = new Array(MAX_SQUADS).fill(0);
  for (const r of roster) if (r.squad != null) n[r.squad]++;
  const open = n.map((c, i) => [c, i]).filter(([c]) => c > 0 && c < 3).sort((a, b) => a[0] - b[0]);
  if (open.length) return open[0][1];
  const empty = n.indexOf(0);
  if (empty >= 0) return empty;
  return n.indexOf(Math.min(...n));
}

export const alive = (sq) => sq.tanks.filter((t) => t.alive);

export function centroid(tanks) {
  let x = 0, y = 0;
  for (const t of tanks) { x += t.x; y += t.y; }
  return { x: x / tanks.length, y: y / tanks.length };
}

// k-th member's slot around the goal, in rows of two facing `heading`.
function slotAt(sq, k, n) {
  const row = k >> 1, lone = n % 2 === 1 && k === n - 1;
  const dx = -row * ROW, dy = lone ? 0 : (k & 1 ? 1 : -1) * SIDE;
  const c = Math.cos(sq.heading), s = Math.sin(sq.heading);
  return { x: sq.goal.x + dx * c - dy * s, y: sq.goal.y + dx * s + dy * c };
}

// Nearest passable nav node centre to (x, y), searching outward.
export function snapPassable(nav, x, y, maxR = 8) {
  const ci = Math.floor(x / nav.c), cj = Math.floor(y / nav.c);
  for (let r = 0; r <= maxR; r++) {
    let best = null, bd = Infinity;
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
        if (i < 0 || j < 0 || i >= nav.w || j >= nav.h || !nav.pass[j * nav.w + i]) continue;
        const px = (i + 0.5) * nav.c, py = (j + 0.5) * nav.c, d = (px - x) ** 2 + (py - y) ** 2;
        if (d < bd) { bd = d; best = { x: px, y: py }; }
      }
    }
    if (best) return best;
  }
  return { x, y };
}

// Is there something solid between (x, y) and the threat, close to us?
function covered(grid, x, y, tx, ty) {
  const d = Math.hypot(tx - x, ty - y);
  if (d < 60) return false;
  const ux = (tx - x) / d, uy = (ty - y) / d;
  for (let k = 14; k <= 46; k += 4) if (grid.isSolid(Math.floor(x + ux * k), Math.floor(y + uy * k))) return true;
  return false;
}

// Best passable spot near `slot` with cover from `threat`, avoiding `taken`.
function coverSpot(game, slot, threat, taken) {
  const { nav, grid } = game;
  const ci = Math.floor(slot.x / nav.c), cj = Math.floor(slot.y / nav.c);
  let best = null, bs = -Infinity;
  for (let j = cj - COVER_R; j <= cj + COVER_R; j++) {
    for (let i = ci - COVER_R; i <= ci + COVER_R; i++) {
      if (i < 0 || j < 0 || i >= nav.w || j >= nav.h || !nav.pass[j * nav.w + i]) continue;
      const x = (i + 0.5) * nav.c, y = (j + 0.5) * nav.c;
      const dist = Math.hypot(x - slot.x, y - slot.y);
      if (dist > COVER_R * nav.c) continue;
      let sc = -dist * 0.5;
      if (threat && covered(grid, x, y, threat.x, threat.y)) sc += 100;
      for (const o of taken) if (Math.hypot(o.x - x, o.y - y) < 26) sc -= 80;
      if (sc > bs) { bs = sc; best = { x, y }; }
    }
  }
  return best || snapPassable(nav, slot.x, slot.y);
}

// Give a squad a new order. (x, y) is the target point; Hold without a point
// holds where the squad stands.
export function orderSquad(game, sq, order, x, y) {
  const live = alive(sq);
  if (!live.length) return;
  const c = centroid(live);
  if (order === 'hold' && x == null) { x = c.x; y = c.y; }
  sq.order = order;
  sq.goal = order === 'follow' ? null : { x, y };
  if (sq.goal) {
    const h = Math.atan2(y - c.y, x - c.x);
    // Hold in place: face the enemy side rather than an arbitrary direction
    sq.heading = Math.hypot(x - c.x, y - c.y) > 40 ? h : 0;
  }
  sq.orderT = ++game.orderSeq;
  for (const t of live) if (t.ai.retreat) { t.ai.retreat = false; t.ai.exempt = sq.orderT; }
  planSquad(game, sq);
}

export function toggleStance(sq) {
  sq.stance = sq.stance === 'aggressive' ? 'cautious' : 'aggressive';
  if (sq.stance === 'aggressive') for (const t of sq.tanks) t.ai.retreat = false;
}

// Recompute each member's destination for move / attack / hold.
export function planSquad(game, sq) {
  const live = alive(sq);
  sq.planT = game.tick;
  sq.planN = live.length;
  if (!sq.goal) return;
  const threat = sq.order === 'hold' ? game.threatNear(sq.goal.x, sq.goal.y) : null;
  const taken = [];
  live.forEach((t, k) => {
    const slot = slotAt(sq, k, live.length);
    const d = sq.order === 'hold' ? coverSpot(game, slot, threat, taken) : snapPassable(game.nav, slot.x, slot.y);
    taken.push(d);
    t.ai.dest = d;
  });
}

export function updateSquads(game) {
  for (const sq of game.squads) {
    const live = alive(sq);
    if (!live.length) continue;
    // Hold re-checks cover as threats move; deaths reshuffle the formation.
    if (sq.goal && (game.tick - sq.planT > (sq.order === 'hold' ? REPLAN : 600) || live.length !== sq.planN)) planSquad(game, sq);
    if (sq.stance !== 'cautious') continue;
    for (const t of live) {
      if (!t.ai.retreat && t.ai.exempt !== sq.orderT && t.frac('hull') < RETREAT_HULL) {
        t.ai.retreat = true;
        game.popup('FALLING BACK!', t.x, t.y - 16, 10);
      }
    }
  }
}
