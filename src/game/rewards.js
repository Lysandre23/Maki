import { PARTS } from '../entities/tank.js';

// ---------------------------------------------------------------------------
// Cards, two families (the full catalogue comes with milestone B4):
//   player: upgrades your own tank
//   team:   grows or strengthens your squad
// Draws favour tags you already own, so runs drift toward coherent builds.
// ---------------------------------------------------------------------------

export function defaultMods() {
  return {
    bounces: 0, cluster: false, mgCool: 1,
    crewRate: 1, extraSmoke: 0, extraEmergency: 0,
    allyReload: 1, allyArmor: 1, fieldWorkshop: false, quickCapture: 1,
  };
}

const boost = (t, k, n) => { const p = t.parts[k]; p.max += n; p.hp = p.max; };
const recruit = (type) => (t, g) => { g.roster.push({ type, hp: null }); };

export const CARDS = [
  // ------------------------------------------------------------- player tank
  { id: 'tungsten', fam: 'player', name: 'TUNGSTEN CORE', rarity: 'common', tags: ['gun'], stack: true,
    desc: '+12 shell damage.', apply: (t) => { t.s.shell.dmg += 12; } },
  { id: 'autoloader', fam: 'player', name: 'AUTOLOADER', rarity: 'common', tags: ['gun'], stack: true,
    desc: 'Reload 20% faster.', apply: (t) => { t.s.reload *= 0.8; } },
  { id: 'hull', fam: 'player', name: 'REINFORCED HULL', rarity: 'common', tags: ['armor'], stack: true,
    desc: '+50 max hull, fully patched.', apply: (t) => boost(t, 'hull', 50) },
  { id: 'tracks', fam: 'player', name: 'HEAVY TRACKS', rarity: 'common', tags: ['armor', 'move'], stack: true,
    desc: '+30 HP on both tracks.', apply: (t) => { boost(t, 'trackL', 30); boost(t, 'trackR', 30); } },
  { id: 'turbo', fam: 'player', name: 'TURBO ENGINE', rarity: 'common', tags: ['move'], stack: true,
    desc: '+15% top speed, engine repaired.', apply: (t) => { t.s.speed *= 1.15; t.parts.engine.hp = t.parts.engine.max; } },
  { id: 'repair', fam: 'player', name: 'FIELD REPAIR', rarity: 'common', tags: ['crew'], stack: true,
    desc: 'Every part of your tank fully repaired.', apply: (t) => { for (const k of PARTS) t.parts[k].hp = t.parts[k].max; } },
  { id: 'spares', fam: 'player', name: 'SPARE CRATES', rarity: 'common', tags: ['crew'], stack: true,
    desc: '+30 spare parts for your crew.', apply: (t, g) => { g.spares = Math.min(99, g.spares + 30); } },
  { id: 'smokepack', fam: 'player', name: 'SMOKE RACK', rarity: 'common', tags: ['cover'], stack: true,
    desc: '+2 smoke grenades per battle.', apply: (t) => { t.mods.extraSmoke += 2; } },
  { id: 'bigbore', fam: 'player', name: 'BIG BORE', rarity: 'rare', tags: ['gun'], stack: true,
    desc: 'Bigger blasts: +4 radius, +3 power.', apply: (t) => { t.s.shell.r += 4; t.s.shell.power += 3; } },
  { id: 'velocity', fam: 'player', name: 'HIGH VELOCITY', rarity: 'rare', tags: ['gun'], stack: true,
    desc: 'Shells fly 35% faster.', apply: (t) => { t.s.shell.speed *= 1.35; } },
  { id: 'plating', fam: 'player', name: 'FRONT PLATING', rarity: 'rare', tags: ['armor'], stack: true,
    desc: 'Frontal hits do 30% less. More ricochets.', apply: (t) => { t.s.armorFront *= 0.7; } },
  { id: 'gyro', fam: 'player', name: 'GYRO TURRET', rarity: 'rare', tags: ['gun'],
    desc: 'Turret turns 50% faster.', apply: (t) => { t.s.turretRate *= 1.5; } },
  { id: 'wrenches', fam: 'player', name: 'SPEEDY WRENCHES', rarity: 'rare', tags: ['crew'], stack: true,
    desc: 'Your mechanics repair 50% faster.', apply: (t) => { t.mods.crewRate *= 1.5; } },
  { id: 'beltfeed', fam: 'player', name: 'BELT FEED', rarity: 'rare', tags: ['gun'],
    desc: 'Machine gun overheats 45% slower.', apply: (t) => { t.mods.mgCool *= 0.55; } },
  { id: 'ricochet', fam: 'player', name: 'RICOCHET ROUNDS', rarity: 'epic', tags: ['gun'],
    desc: 'Shells bounce off the first wall they hit.', apply: (t) => { t.mods.bounces = 1; } },
  { id: 'cluster', fam: 'player', name: 'CLUSTER SHELLS', rarity: 'epic', tags: ['gun'],
    desc: 'Impacts scatter 3 bomblets.', apply: (t) => { t.mods.cluster = true; } },
  { id: 'medkit', fam: 'player', name: 'EMERGENCY KIT', rarity: 'epic', tags: ['crew'],
    desc: '+1 emergency patch per battle.', apply: (t) => { t.mods.extraEmergency += 1; } },

  // ------------------------------------------------------------- team
  { id: 'newscout', fam: 'team', name: 'NEW TANK: SCOUT', rarity: 'common', tags: ['squad'], stack: true,
    desc: 'A fast scout tank joins your team.', apply: recruit('scout') },
  { id: 'newgunner', fam: 'team', name: 'NEW TANK: GUNNER', rarity: 'rare', tags: ['squad'], stack: true,
    desc: 'A gunner tank joins your team.', apply: recruit('gunner') },
  { id: 'newheavy', fam: 'team', name: 'NEW TANK: HEAVY', rarity: 'epic', tags: ['squad'], stack: true,
    desc: 'A heavily armored tank joins your team.', apply: recruit('heavy') },
  { id: 'veterans', fam: 'team', name: 'VETERAN CREWS', rarity: 'rare', tags: ['squad'], stack: true,
    desc: 'Allies reload 25% faster.', apply: (t) => { t.mods.allyReload *= 0.75; } },
  { id: 'applique', fam: 'team', name: 'APPLIQUE ARMOR', rarity: 'rare', tags: ['squad', 'armor'], stack: true,
    desc: 'Allies take 20% less damage.', apply: (t) => { t.mods.allyArmor *= 0.8; } },
  { id: 'workshop', fam: 'team', name: 'FIELD WORKSHOP', rarity: 'epic', tags: ['squad', 'crew'],
    desc: 'Surviving allies are fully repaired between battles.', apply: (t) => { t.mods.fieldWorkshop = true; } },
  { id: 'quickcap', fam: 'team', name: 'FLAG RUNNERS', rarity: 'common', tags: ['objective'], stack: true,
    desc: 'The flag is captured 30% faster.', apply: (t) => { t.mods.quickCapture *= 1.3; } },
];

export const RARITIES = ['common', 'rare', 'epic', 'legendary'];

function rollRarity(rng, level) {
  const w = [60, 27 + level, 10 + level, 3 + level * 0.6];
  let r = rng() * w.reduce((a, b) => a + b);
  for (let i = 0; i < 4; i++) { if ((r -= w[i]) < 0) return i; }
  return 0;
}

// Pick n distinct cards; at least one from each family when possible.
export function pickRewards(rng, build, tagCount, level, n = 3) {
  const owned = new Set(build);
  const pool = CARDS.filter((c) => c.stack || !owned.has(c.id));
  const weight = (c) => 1 + c.tags.reduce((w, t) => w + (tagCount[t] ? 0.8 : 0), 0);
  const out = [];
  let guard = 0;
  while (out.length < n && guard++ < 60) {
    const needFam = out.length === n - 1 && out.every((c) => c.fam === out[0].fam) ? (out[0].fam === 'player' ? 'team' : 'player') : null;
    const r0 = rollRarity(rng, level);
    let cands = [];
    for (let d = 0; d < 4 && !cands.length; d++) {
      for (const r of [r0 - d, r0 + d]) {
        if (r < 0 || r > 3) continue;
        cands = cands.concat(pool.filter((c) => c.rarity === RARITIES[r] && !out.includes(c) && (!needFam || c.fam === needFam)));
      }
    }
    if (!cands.length) break;
    let x = rng() * cands.reduce((a, c) => a + weight(c), 0);
    let pick = cands[0];
    for (const c of cands) { if ((x -= weight(c)) < 0) { pick = c; break; } }
    out.push(pick);
  }
  return out.map((c) => ({ ...c, synergy: c.tags.filter((t) => tagCount[t]) }));
}
