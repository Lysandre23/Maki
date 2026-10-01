#include <algorithm>
#include <cmath>
#include "game.h"

// Cards, two families (the full catalogue comes with milestone B4):
//   player: upgrades your own tank
//   team:   grows or strengthens your squad
// Draws favour tags you already own, so runs drift toward coherent builds.

const char* RARITIES[4] = {"common", "rare", "epic", "legendary"};

static void boost(Tank& t, Part k, double n) { auto& p = t.parts[k]; p.max += n; p.hp = p.max; }
static std::function<void(Tank&, Game&)> recruit(const char* type) {
  return [type](Tank&, Game& g) { g.addRecruit(type); };
}

const std::vector<Card>& cards() {
  static const std::vector<Card> list = {
    // ------------------------------------------------------------- player tank
    {"tungsten", "player", "TUNGSTEN CORE", "common", {"gun"}, true, "+12 shell damage.",
     [](Tank& t, Game&) { t.s.shell.dmg += 12; }},
    {"autoloader", "player", "AUTOLOADER", "common", {"gun"}, true, "Reload 20% faster.",
     [](Tank& t, Game&) { t.s.reload *= 0.8; }},
    {"hull", "player", "REINFORCED HULL", "common", {"armor"}, true, "+50 max hull, fully patched.",
     [](Tank& t, Game&) { boost(t, HULL, 50); }},
    {"tracks", "player", "HEAVY TRACKS", "common", {"armor", "move"}, true, "+30 HP on both tracks.",
     [](Tank& t, Game&) { boost(t, TRACK_L, 30); boost(t, TRACK_R, 30); }},
    {"turbo", "player", "TURBO ENGINE", "common", {"move"}, true, "+15% top speed, engine repaired.",
     [](Tank& t, Game&) { t.s.speed *= 1.15; t.parts[ENGINE].hp = t.parts[ENGINE].max; }},
    {"repair", "player", "FIELD REPAIR", "common", {"crew"}, true, "Every part of your tank fully repaired.",
     [](Tank& t, Game&) { for (auto& p : t.parts) p.hp = p.max; }},
    {"spares", "player", "SPARE CRATES", "common", {"crew"}, true, "+30 spare parts for your crew.",
     [](Tank&, Game& g) { g.spares = std::min(99.0, g.spares + 30); }},
    {"smokepack", "player", "SMOKE RACK", "common", {"cover"}, true, "+2 smoke grenades per battle.",
     [](Tank& t, Game&) { t.mods.extraSmoke += 2; }},
    {"bigbore", "player", "BIG BORE", "rare", {"gun"}, true, "Bigger blasts: +4 radius, +3 power.",
     [](Tank& t, Game&) { t.s.shell.r += 4; t.s.shell.power += 3; }},
    {"velocity", "player", "HIGH VELOCITY", "rare", {"gun"}, true, "Shells fly 35% faster.",
     [](Tank& t, Game&) { t.s.shell.speed *= 1.35; }},
    {"plating", "player", "FRONT PLATING", "rare", {"armor"}, true, "Frontal hits do 30% less. More ricochets.",
     [](Tank& t, Game&) { t.s.armorFront *= 0.7; }},
    {"gyro", "player", "GYRO TURRET", "rare", {"gun"}, false, "Turret turns 50% faster.",
     [](Tank& t, Game&) { t.s.turretRate *= 1.5; }},
    {"wrenches", "player", "SPEEDY WRENCHES", "rare", {"crew"}, true, "Your mechanics repair 50% faster.",
     [](Tank& t, Game&) { t.mods.crewRate *= 1.5; }},
    {"beltfeed", "player", "BELT FEED", "rare", {"gun"}, false, "Machine gun overheats 45% slower.",
     [](Tank& t, Game&) { t.mods.mgCool *= 0.55; }},
    {"ricochet", "player", "RICOCHET ROUNDS", "epic", {"gun"}, false, "Shells bounce off the first wall they hit.",
     [](Tank& t, Game&) { t.mods.bounces = 1; }},
    {"cluster", "player", "CLUSTER SHELLS", "epic", {"gun"}, false, "Impacts scatter 3 bomblets.",
     [](Tank& t, Game&) { t.mods.cluster = true; }},
    {"medkit", "player", "EMERGENCY KIT", "epic", {"crew"}, false, "+1 emergency patch per battle.",
     [](Tank& t, Game&) { t.mods.extraEmergency += 1; }},

    // ------------------------------------------------------------- team
    {"newscout", "team", "NEW TANK: SCOUT", "common", {"squad"}, true, "A fast scout tank joins your team.", recruit("scout")},
    {"newgunner", "team", "NEW TANK: GUNNER", "rare", {"squad"}, true, "A gunner tank joins your team.", recruit("gunner")},
    {"newheavy", "team", "NEW TANK: HEAVY", "epic", {"squad"}, true, "A heavily armored tank joins your team.", recruit("heavy")},
    {"veterans", "team", "VETERAN CREWS", "rare", {"squad"}, true, "Allies reload 25% faster.",
     [](Tank& t, Game&) { t.mods.allyReload *= 0.75; }},
    {"applique", "team", "APPLIQUE ARMOR", "rare", {"squad", "armor"}, true, "Allies take 20% less damage.",
     [](Tank& t, Game&) { t.mods.allyArmor *= 0.8; }},
    {"workshop", "team", "FIELD WORKSHOP", "epic", {"squad", "crew"}, false, "Surviving allies are fully repaired between battles.",
     [](Tank& t, Game&) { t.mods.fieldWorkshop = true; }},
    {"quickcap", "team", "FLAG RUNNERS", "common", {"objective"}, true, "The flag is captured 30% faster.",
     [](Tank& t, Game&) { t.mods.quickCapture *= 1.3; }},
  };
  return list;
}

static int rollRarity(Rng& rng, int level) {
  double w[4] = {60, 27.0 + level, 10.0 + level, 3 + level * 0.6};
  double r = rng() * (w[0] + w[1] + w[2] + w[3]);
  for (int i = 0; i < 4; i++) { if ((r -= w[i]) < 0) return i; }
  return 0;
}

// Pick n distinct cards; at least one from each family when possible.
std::vector<Reward> pickRewards(Rng& rng, const std::vector<std::string>& build, const std::map<std::string, int>& tagCount, int level, int n) {
  auto owned = [&](const std::string& id) { return std::find(build.begin(), build.end(), id) != build.end(); };
  auto has = [&](const std::string& tag) { auto it = tagCount.find(tag); return it != tagCount.end() && it->second; };
  std::vector<const Card*> pool;
  for (const auto& c : cards()) if (c.stack || !owned(c.id)) pool.push_back(&c);
  auto weight = [&](const Card* c) { double w = 1; for (auto& t : c->tags) w += has(t) ? 0.8 : 0; return w; };
  std::vector<const Card*> out;
  int guard = 0;
  while ((int)out.size() < n && guard++ < 60) {
    std::string needFam;
    if ((int)out.size() == n - 1 && std::all_of(out.begin(), out.end(), [&](const Card* c) { return c->fam == out[0]->fam; }))
      needFam = out[0]->fam == "player" ? "team" : "player";
    int r0 = rollRarity(rng, level);
    std::vector<const Card*> cands;
    for (int d = 0; d < 4 && cands.empty(); d++) {
      for (int r : {r0 - d, r0 + d}) { // (d = 0 visits r0 twice, like the JS)
        if (r < 0 || r > 3) continue;
        for (const Card* c : pool) {
          if (c->rarity == RARITIES[r] && std::find(out.begin(), out.end(), c) == out.end() && (needFam.empty() || c->fam == needFam)) cands.push_back(c);
        }
      }
    }
    if (cands.empty()) break;
    double total = 0;
    for (const Card* c : cands) total += weight(c);
    double x = rng() * total;
    const Card* pick = cands[0];
    for (const Card* c : cands) { if ((x -= weight(c)) < 0) { pick = c; break; } }
    out.push_back(pick);
  }
  std::vector<Reward> res;
  for (const Card* c : out) {
    Reward rw{c, {}};
    for (auto& t : c->tags) if (has(t)) rw.synergy.push_back(t);
    res.push_back(rw);
  }
  return res;
}
