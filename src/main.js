import { VIEW_W, VIEW_H, TICK, BATTLES } from './config.js';
import { Game, POWER } from './game/game.js';
import { CARDS } from './game/rewards.js';
import { PARTS } from './entities/tank.js';
import { Renderer } from './render/renderer.js';
import { Perf } from './util/perf.js';
import { input, initInput } from './util/input.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage'), canvas = $('game'), fxCanvas = $('fx');
const topHud = $('top'), perfHud = $('perf'), partsHud = $('parts'), overlay = $('overlay');

const game = new Game((Math.random() * 1e9) | 0);
const renderer = new Renderer(canvas, fxCanvas, game);
const perf = new Perf();
initInput(stage);

let paused = false;
let showPerf = true;

// Integer scale in *device* pixels (Windows display scaling gives devicePixelRatio
// 1.25, 1.5...), otherwise cells get uneven sizes and dithering breaks up.
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const s = Math.max(1, Math.floor(Math.min((innerWidth * dpr) / VIEW_W, (innerHeight * dpr) / VIEW_H)));
  stage.style.width = (VIEW_W * s) / dpr + 'px';
  stage.style.height = (VIEW_H * s) / dpr + 'px';
  renderer.resize(s);
}
addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ overlays

const PART_NAMES = { hull: 'HULL', trackL: 'TRACK L', trackR: 'TRACK R', turret: 'TURRET', cannon: 'CANNON', engine: 'ENGINE', ammo: 'AMMO' };
partsHud.innerHTML = `<div id="res"></div>` + PARTS.map((k, i) =>
  `<div class="row" id="p-${k}" data-k="${k}"><span class="key">${i + 1}</span><span class="name">${PART_NAMES[k]}</span>` +
  `<div class="bar"><div class="fill"></div></div><span class="crew"></span></div>`).join('');
const partRows = Object.fromEntries(PARTS.map((k) => [k, $('p-' + k)]));
const resHud = $('res');
// click a part to send a mechanic to it (same as keys 1-7)
for (const k of PARTS) partRows[k].addEventListener('mousedown', (e) => { e.stopPropagation(); game.assignCrew(k); });

const TAG_LABEL = { gun: 'CANNON', armor: 'ARMOR', move: 'MOBILITY', crew: 'CREW', cover: 'COVER', squad: 'SQUAD', objective: 'OBJECTIVE' };

function cardHtml(r, i) {
  const tags = r.tags.map((t) => `<i class="tag">${TAG_LABEL[t] || t}</i>`).join('');
  const syn = r.synergy.length ? `<div class="syn">SYNERGY: ${r.synergy.map((t) => TAG_LABEL[t] || t).join(' + ')}</div>` : '';
  return `<div class="card ${r.rarity} fam-${r.fam}" data-i="${i}">` +
    `<div class="band">${r.fam === 'team' ? '&#9873; TEAM' : '&#9670; YOUR TANK'}</div>` +
    `<div class="rar">${r.rarity.toUpperCase()}</div><span class="key">${i + 1}</span>` +
    `<h2>${r.name}</h2><div class="desc">${r.desc}</div><div class="tags">${tags}</div>${syn}</div>`;
}

function buildHtml() {
  if (!game.build.length) return '';
  const counts = {};
  for (const id of game.build) counts[id] = (counts[id] || 0) + 1;
  const chips = Object.entries(counts).map(([id, n]) => {
    const c = CARDS.find((k) => k.id === id);
    return `<span class="chip ${c.rarity} fam-${c.fam}">${c.name}${n > 1 ? ' x' + n : ''}</span>`;
  }).join('');
  const team = game.roster.map((r) => r.type.toUpperCase()).join(' · ') || 'NO ALLIES LEFT';
  return `<div id="build"><span>YOUR BUILD</span>${chips}</div><div id="build"><span>YOUR TEAM</span><span class="chip fam-team">${team}</span></div>`;
}

let shownState = null;
function syncOverlay() {
  const key = game.state + ':' + game.level;
  if (key === shownState) return;
  shownState = key;
  if (game.state === 'reward') {
    overlay.innerHTML = `<h1>BATTLE ${game.level} WON!</h1><p>PICK YOUR REWARD</p><div id="cards">${
      game.choices.map((r, i) => cardHtml(r, i)).join('')
    }</div>${buildHtml()}`;
    overlay.querySelectorAll('.card').forEach((el) => el.addEventListener('click', () => game.chooseReward(+el.dataset.i)));
    overlay.style.display = 'flex';
  } else if (game.state === 'dead') {
    overlay.innerHTML = `<h1 class="red">TANK DESTROYED</h1><p>FELL IN BATTLE ${game.level} / ${BATTLES} - ${game.kills} KILLS</p><p>PRESS R FOR A NEW RUN</p>`;
    overlay.style.display = 'flex';
  } else if (game.state === 'win') {
    overlay.innerHTML = `<h1>VICTORY!</h1><p>ALL ${BATTLES} BATTLES WON - ${game.kills} KILLS</p><p>PRESS R FOR A NEW RUN</p>`;
    overlay.style.display = 'flex';
  } else overlay.style.display = 'none';
}

function updateHud() {
  const alive = game.enemies.filter((e) => e.alive).length;
  const allies = game.allies.filter((e) => e.alive).length;
  const f = game.flag;
  const flagTxt = f.contested ? 'CONTESTED!' : `${Math.round(f.progress * 100)}%`;
  topHud.textContent = `BATTLE ${game.level} / ${BATTLES}    ALLIES : ${allies}    ENEMIES : ${alive}    KILLS : ${game.kills}    FLAG : ${flagTxt}`;
  for (const k of PARTS) {
    const f = game.player.frac(k);
    const row = partRows[k];
    row.querySelector('.fill').style.width = (f * 100).toFixed(0) + '%';
    row.classList.toggle('low', f > 0 && f < 0.35);
    row.classList.toggle('dead', f <= 0);
    const crew = ['A', 'B'].filter((_, i) => game.crew[i] === k);
    row.querySelector('.crew').innerHTML = crew.map((c) => `<b>${c}</b>`).join('');
    row.classList.toggle('repairing', crew.length > 0 && f < 1 && game.spares > 0);
  }
  const pips = (n, max) => '■'.repeat(n) + '□'.repeat(Math.max(0, max - n));
  resHud.innerHTML =
    `<span>SPARES ${Math.floor(game.spares)}</span> <span>EMERGENCY [E] ${pips(game.emergency, 2)}</span><br>` +
    `<span>SMOKE [SPACE] ${pips(game.smokeCharges, 3)}</span> <span>POWER [C] ${POWER[game.powerMode].name}</span>`;
  const s = perf.summary();
  perfHud.textContent = showPerf
    ? `FPS ${s.fps.toFixed(0)}  frame ${s.avg.toFixed(1)}ms (worst ${s.max.toFixed(1)})\n` +
      `update ${s.update.toFixed(2)}ms  render ${s.render.toFixed(2)}ms\n` +
      `debris ${game.debris.n}  fire ${game.flames.list.length}  F3 hide`
    : '';
}

// ------------------------------------------------------------------ loop

function tick() {
  const k = input.keys;
  if (input.pressed.has('p') || input.pressed.has('escape')) paused = !paused;
  if (input.pressed.has('f3')) showPerf = !showPerf;
  if (input.pressed.has('r') && (game.state === 'dead' || game.state === 'win')) game.newRun();
  if (game.state === 'reward') {
    for (const n of ['1', '2', '3']) if (input.pressed.has(n)) game.chooseReward(+n - 1);
  } else if (!paused) {
    PARTS.forEach((part, i) => { if (input.pressed.has(String(i + 1))) game.assignCrew(part); });
    if (input.pressed.has('e')) game.emergencyRepair();
    if (input.pressed.has('c')) game.cyclePower();
    if (input.pressed.has(' ')) game.throwSmoke();
  }
  input.pressed.clear();
  if (paused) return;

  const has = (...ks) => ks.some((x) => k.has(x));
  game.update({
    throttle: (has('w', 'z', 'arrowup') ? 1 : 0) - (has('s', 'arrowdown') ? 1 : 0),
    turn: (has('d', 'arrowright') ? 1 : 0) - (has('a', 'q', 'arrowleft') ? 1 : 0),
    aimX: game.cam.x + input.mx,
    aimY: game.cam.y + input.my,
    fire: input.down[0],
    mg: input.down[2],
  });
}

let last = performance.now();
let acc = 0;
let hudT = 0;

function frame(now) {
  const dtMs = now - last;
  last = now;
  acc += Math.min(dtMs, 100) / 1000;

  const u0 = performance.now();
  let steps = 0;
  while (acc >= TICK && steps < 4) { tick(); acc -= TICK; steps++; }
  if (steps === 4) acc = 0;
  const u1 = performance.now();

  renderer.draw(game, { x: input.mx, y: input.my });
  const r1 = performance.now();
  perf.record(dtMs, u1 - u0, r1 - u1);

  syncOverlay();
  if (now - hudT > 100) { hudT = now; updateHud(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
