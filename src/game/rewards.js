import { PARTS } from '../entities/tank.js';

// ---------------------------------------------------------------------------
// Build system. Every card either
//  - is a SOURCE: gives you an element (fire / ice / oil) on a weapon,
//  - AMPLIFIES an element (only offered once you own a source of it),
//  - or is a BUILD-AROUND legendary that pays off if you commit to a theme.
// Single cards are modest; combinations are what make a run strong:
//   Phoenix Hull (L) + Long Burn (C) + Fireproof Hull (R) = tanky pyromaniac.
// ---------------------------------------------------------------------------

export function defaultMods() {
  return {
    // shell payloads
    incendiary: false, cryo: false, oilShell: false, oilTrail: false, bounces: 0, cluster: false,
    // machine gun payloads
    mgFire: false, mgIce: false, mgCool: 1,
    // fire
    fireLife: 1, fireSpread: 1, fireDmg: 1, afterburn: false, phoenix: false, inferno: false, napalm: false,
    // oil
    oilAmount: 1, noOilSlow: false, leaky: false, slick: false, scorched: false,
    // ice
    frostPower: 1, frostTime: 1, brittle: 2, iceGrip: false, shatter: false, thermal: false, absoluteZero: false, coldBlood: false,
    // misc
    crewRate: 1, extraSmoke: 0, extraEmergency: 0,
  };
}

const boost = (t, k, n) => { const p = t.parts[k]; p.max += n; p.hp = p.max; };

// rarity: common | rare | epic | legendary     el: fire | ice | oil | null
// tags drive synergy weighting; requires: offered only if you own one of these tags
// stack: can be taken several times
export const CARDS = [
  // ------------------------------------------------------------- neutral
  { id: 'tungsten', name: 'TUNGSTEN CORE', rarity: 'common', el: null, tags: ['gun'], stack: true,
    desc: '+12 shell damage.', apply: (t) => { t.s.shell.dmg += 12; } },
  { id: 'autoloader', name: 'AUTOLOADER', rarity: 'common', el: null, tags: ['gun'], stack: true,
    desc: 'Reload 20% faster.', apply: (t) => { t.s.reload *= 0.8; } },
  { id: 'hull', name: 'REINFORCED HULL', rarity: 'common', el: null, tags: ['hull'], stack: true,
    desc: '+40 max hull, fully patched.', apply: (t) => boost(t, 'hull', 40) },
  { id: 'tracks', name: 'HEAVY TRACKS', rarity: 'common', el: null, tags: ['hull', 'move'], stack: true,
    desc: '+30 HP on both tracks.', apply: (t) => { boost(t, 'trackL', 30); boost(t, 'trackR', 30); } },
  { id: 'turbo', name: 'TURBO ENGINE', rarity: 'common', el: null, tags: ['move'], stack: true,
    desc: '+15% top speed, engine repaired.', apply: (t) => { t.s.speed *= 1.15; t.parts.engine.hp = t.parts.engine.max; } },
  { id: 'repair', name: 'FIELD REPAIR', rarity: 'common', el: null, tags: ['crew'], stack: true,
    desc: 'Every part fully repaired.', apply: (t) => { for (const k of PARTS) t.parts[k].hp = t.parts[k].max; } },
  { id: 'spares', name: 'SPARE CRATES', rarity: 'common', el: null, tags: ['crew'], stack: true,
    desc: '+30 spare parts for the crew.', apply: (t, g) => { g.spares = Math.min(99, g.spares + 30); } },
  { id: 'smokepack', name: 'SMOKE RACK', rarity: 'common', el: null, tags: ['utility'], stack: true,
    desc: '+2 smoke grenades per room.', apply: (t) => { t.mods.extraSmoke += 2; } },
  { id: 'bigbore', name: 'BIG BORE', rarity: 'rare', el: null, tags: ['gun'], stack: true,
    desc: 'Bigger blasts: +4 radius, +3 power. Walls come down faster.', apply: (t) => { t.s.shell.r += 4; t.s.shell.power += 3; } },
  { id: 'velocity', name: 'HIGH VELOCITY', rarity: 'rare', el: null, tags: ['gun'], stack: true,
    desc: 'Shells fly 35% faster.', apply: (t) => { t.s.shell.speed *= 1.35; } },
  { id: 'plating', name: 'FRONT PLATING', rarity: 'rare', el: null, tags: ['hull'], stack: true,
    desc: 'Frontal hits do 30% less. More ricochets.', apply: (t) => { t.s.armorFront *= 0.7; } },
  { id: 'gyro', name: 'GYRO TURRET', rarity: 'rare', el: null, tags: ['gun'],
    desc: 'Turret turns 50% faster.', apply: (t) => { t.s.turretRate *= 1.5; } },
  { id: 'wrenches', name: 'SPEEDY WRENCHES', rarity: 'rare', el: null, tags: ['crew'], stack: true,
    desc: 'Mechanics repair 50% faster.', apply: (t) => { t.mods.crewRate *= 1.5; } },
  { id: 'beltfeed', name: 'BELT FEED', rarity: 'rare', el: null, tags: ['mg'],
    desc: 'Machine gun overheats 45% slower.', apply: (t) => { t.mods.mgCool *= 0.55; } },
  { id: 'ricochet', name: 'RICOCHET ROUNDS', rarity: 'epic', el: null, tags: ['gun'],
    desc: 'Shells bounce off the first wall they hit, then explode on the next.', apply: (t) => { t.mods.bounces = 1; } },
  { id: 'cluster', name: 'CLUSTER SHELLS', rarity: 'epic', el: null, tags: ['gun'],
    desc: 'Impacts scatter 3 bomblets that carry your shell\'s elements.', apply: (t) => { t.mods.cluster = true; } },
  { id: 'medkit', name: 'EMERGENCY KIT', rarity: 'epic', el: null, tags: ['crew'],
    desc: '+1 emergency patch per room.', apply: (t) => { t.mods.extraEmergency += 1; } },

  // ------------------------------------------------------------- fire
  { id: 'incendiary', name: 'INCENDIARY SHELLS', rarity: 'common', el: 'fire', tags: ['fire', 'fire-src', 'gun'],
    desc: 'Shells set crates, oil and ruins ablaze.', apply: (t) => { t.mods.incendiary = true; } },
  { id: 'tracer', name: 'TRACER ROUNDS', rarity: 'common', el: 'fire', tags: ['fire', 'fire-src', 'mg'],
    desc: 'Machine gun bullets light fires and oil.', apply: (t) => { t.mods.mgFire = true; } },
  { id: 'longburn', name: 'LONG BURN', rarity: 'common', el: 'fire', tags: ['fire'], stack: true,
    desc: 'Flames last 60% longer.', apply: (t) => { t.mods.fireLife *= 1.6; } },
  { id: 'fireproof', name: 'FIREPROOF HULL', rarity: 'rare', el: 'fire', tags: ['fire', 'hull'],
    desc: 'Your tank takes no damage from fire.', apply: (t) => { t.mods.fireDmg = 0; } },
  { id: 'wildfire', name: 'WILDFIRE', rarity: 'rare', el: 'fire', tags: ['fire'], requires: ['fire-src', 'oil-src'],
    desc: 'Fire spreads twice as fast.', apply: (t) => { t.mods.fireSpread *= 2; } },
  { id: 'afterburn', name: 'AFTERBURN', rarity: 'rare', el: 'fire', tags: ['fire', 'gun'], requires: ['fire-src'],
    desc: 'Incendiary hits set enemy engines burning.', apply: (t) => { t.mods.afterburn = true; } },
  { id: 'napalm', name: 'NAPALM', rarity: 'epic', el: 'fire', tags: ['fire', 'oil'], requires: ['oil-src'],
    desc: 'Every blast ignites oil it touches. Oil fires burn twice as hot.', apply: (t) => { t.mods.napalm = true; } },
  { id: 'phoenix', name: 'PHOENIX HULL', rarity: 'legendary', el: 'fire', tags: ['fire', 'hull'],
    desc: 'The more of the room is burning, the less damage you take (up to -70%).', apply: (t) => { t.mods.phoenix = true; } },
  { id: 'inferno', name: 'INFERNO LOADER', rarity: 'legendary', el: 'fire', tags: ['fire', 'gun'],
    desc: 'Flames near your tank speed up your reload (up to x2).', apply: (t) => { t.mods.inferno = true; } },

  // ------------------------------------------------------------- oil
  { id: 'slickshell', name: 'SLICK SHELLS', rarity: 'common', el: 'oil', tags: ['oil', 'oil-src', 'gun'],
    desc: 'Shells burst into a pool of oil. Oil slows tanks and burns.', apply: (t) => { t.mods.oilShell = true; } },
  { id: 'leaky', name: 'LEAKY TANK', rarity: 'common', el: 'oil', tags: ['oil', 'oil-src', 'move'],
    desc: 'You leave a trail of oil when driving. Lay traps.', apply: (t) => { t.mods.leaky = true; } },
  { id: 'crude', name: 'CRUDE LOAD', rarity: 'common', el: 'oil', tags: ['oil'], requires: ['oil-src'], stack: true,
    desc: 'Oil spills are twice as big.', apply: (t) => { t.mods.oilAmount *= 2; } },
  { id: 'dripping', name: 'DRIPPING SHELLS', rarity: 'rare', el: 'oil', tags: ['oil', 'oil-src', 'gun'],
    desc: 'Shells drip oil along their whole flight.', apply: (t) => { t.mods.oilTrail = true; } },
  { id: 'grip', name: 'GRIP TREADS', rarity: 'rare', el: 'oil', tags: ['oil', 'ice', 'move'],
    desc: 'Oil doesn\'t slow you, ice doesn\'t make you slide.', apply: (t) => { t.mods.noOilSlow = true; t.mods.iceGrip = true; } },
  { id: 'slick', name: 'SLICK OPERATOR', rarity: 'legendary', el: 'oil', tags: ['oil', 'crew'],
    desc: 'Standing in oil, mechanics work 3x faster and use no spares.', apply: (t) => { t.mods.slick = true; } },
  { id: 'scorched', name: 'SCORCHED EARTH', rarity: 'legendary', el: 'oil', tags: ['oil', 'fire', 'oil-src'],
    desc: 'Destroyed enemies burst into a huge burning oil slick.', apply: (t) => { t.mods.scorched = true; } },

  // ------------------------------------------------------------- ice
  { id: 'cryo', name: 'CRYO SHELLS', rarity: 'common', el: 'ice', tags: ['ice', 'ice-src', 'gun'],
    desc: 'Impacts freeze the area: slippery floor, brittle walls, frozen tanks slow down.', apply: (t) => { t.mods.cryo = true; } },
  { id: 'frostrounds', name: 'FROST ROUNDS', rarity: 'common', el: 'ice', tags: ['ice', 'ice-src', 'mg'],
    desc: 'Machine gun bullets chill enemies and frost walls.', apply: (t) => { t.mods.mgIce = true; } },
  { id: 'deepfreeze', name: 'DEEP FREEZE', rarity: 'rare', el: 'ice', tags: ['ice'], requires: ['ice-src'], stack: true,
    desc: 'Ice lasts twice as long, freezing is 50% stronger.', apply: (t) => { t.mods.frostTime *= 2; t.mods.frostPower *= 1.5; } },
  { id: 'brittle', name: 'BRITTLE', rarity: 'rare', el: 'ice', tags: ['ice', 'gun'], requires: ['ice-src'],
    desc: 'Frozen walls take 4x blast damage (instead of 2x).', apply: (t) => { t.mods.brittle = 4; } },
  { id: 'skates', name: 'ICE SKATES', rarity: 'common', el: 'ice', tags: ['ice', 'move'], requires: ['ice-src'],
    desc: 'You never slide on ice.', apply: (t) => { t.mods.iceGrip = true; } },
  { id: 'shatter', name: 'SHATTER', rarity: 'epic', el: 'ice', tags: ['ice', 'gun'], requires: ['ice-src'],
    desc: 'Hits on frozen enemies deal double damage.', apply: (t) => { t.mods.shatter = true; } },
  { id: 'thermal', name: 'THERMAL SHOCK', rarity: 'epic', el: 'ice', tags: ['ice', 'fire'], requires: ['ice-src', 'fire-src'],
    desc: 'Fire on a frozen tank, or ice on a burning one: x3 damage and a cracked part.', apply: (t) => { t.mods.thermal = true; } },
  { id: 'absolute', name: 'ABSOLUTE ZERO', rarity: 'legendary', el: 'ice', tags: ['ice'],
    desc: 'Enemies destroyed while frozen explode in a freezing nova. Chains.', apply: (t) => { t.mods.absoluteZero = true; } },
  { id: 'coldblood', name: 'COLD BLOOD', rarity: 'legendary', el: 'ice', tags: ['ice', 'gun'],
    desc: 'While any enemy is frozen, you reload twice as fast.', apply: (t) => { t.mods.coldBlood = true; } },
];

export const RARITIES = ['common', 'rare', 'epic', 'legendary'];
const GENERIC = new Set(['gun', 'hull', 'move', 'crew', 'utility', 'mg']);

function rollRarity(rng, level) {
  const w = [60, 27 + level, 10 + level, 3 + level * 0.6];
  let r = rng() * w.reduce((a, b) => a + b);
  for (let i = 0; i < 4; i++) { if ((r -= w[i]) < 0) return i; }
  return 0;
}

// Pick n distinct cards. Cards sharing tags with the build are favoured
// (element tags count much more), so runs drift toward coherent builds, while
// legendaries can show up any time to tempt a new direction.
export function pickRewards(rng, build, tagCount, level, n = 3) {
  const owned = new Set(build);
  const pool = CARDS.filter((c) => (c.stack || !owned.has(c.id)) &&
    (!c.requires || c.requires.some((t) => tagCount[t])));
  const weight = (c) => {
    let w = 1;
    for (const t of c.tags) if (tagCount[t]) w += GENERIC.has(t) ? 0.4 : 1.8;
    return w;
  };
  const out = [];
  // no element yet: make sure one elemental source is on the table
  const hasSource = ['fire-src', 'ice-src', 'oil-src'].some((t) => tagCount[t]);
  if (!hasSource) {
    const src = pool.filter((c) => c.tags.some((t) => t.endsWith('-src')) && c.rarity !== 'legendary');
    out.push(src[Math.floor(rng() * src.length)]);
  }
  let guard = 0;
  while (out.length < n && guard++ < 50) {
    const r0 = rollRarity(rng, level);
    let cands = [];
    for (let d = 0; d < 4 && !cands.length; d++) {
      for (const r of [r0 - d, r0 + d]) {
        if (r < 0 || r > 3) continue;
        cands = cands.concat(pool.filter((c) => c.rarity === RARITIES[r] && !out.includes(c)));
      }
    }
    if (!cands.length) break;
    let total = cands.reduce((a, c) => a + weight(c), 0), x = rng() * total;
    let pick = cands[0];
    for (const c of cands) { if ((x -= weight(c)) < 0) { pick = c; break; } }
    out.push(pick);
  }
  // shuffle so the guaranteed source isn't always first
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out.map((c) => ({ ...c, synergy: c.tags.filter((t) => tagCount[t] && !t.endsWith('-src') && !GENERIC.has(t)) }));
}
