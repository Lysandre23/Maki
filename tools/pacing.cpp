// Pacing check with a bot player.
// Run: maki_pacing [level] [seeds] [maxMinutes] [rush]
//        one battle per seed at `level` (rush = the old straight-to-the-flag bot)
//      maki_pacing campaign [seeds]
//        full runs: battle after battle, first reward card each time, until death or victory
#include <cstdio>
#include <cstdlib>
#include <string>
#include "sim.h"

static void step(Game& g, bool rush) {
  if (rush) g.update(botInput(g));
  else { carefulBotManage(g); g.update(carefulBotInput(g)); }
}

static int campaign(int seeds) {
  int reached[BATTLES + 2] = {};
  double dur[BATTLES + 1] = {};
  int durN[BATTLES + 1] = {};
  for (int s = 1; s <= seeds; s++) {
    uint32_t seed = 1000 + s * 77;
    seedRnd(seed * 2654435761u);
    Game g(seed);
    std::printf("seed %u:", seed);
    int t = 0;
    while (true) {
      if (g.state == "reward") {
        g.chooseReward(0);
        t = 0;
        Tank& p = *g.player;
        std::printf(" [B%d start: %s, hull %.0f%% trk %.0f/%.0f%% eng %.0f%% gun %.0f%% spares %.0f]", g.level, g.build.back().c_str(),
                    p.frac(HULL) * 100, p.frac(TRACK_L) * 100, p.frac(TRACK_R) * 100, p.frac(ENGINE) * 100, p.frac(CANNON) * 100, g.spares);
        continue;
      }
      if (g.state == "dead" || g.state == "win" || t > 15 * 3600) break;
      int lvl = g.level;
      bool was = g.state == "play";
      step(g, false);
      t++;
      if (was && g.state == "cleared") { dur[lvl] += t / 60.0; durN[lvl]++; std::printf(" B%d %.0fs", lvl, t / 60.0); }
    }
    std::printf("  -> %s in battle %d after %.0fs (kills %d, allies %d)\n", g.state == "win" ? "WON" : g.state == "dead" ? "died" : "timeout", g.level,
                t / 60.0, g.kills, (int)g.roster.size());
    reached[g.state == "win" ? BATTLES + 1 : g.level]++;
  }
  std::printf("average capture time per battle:");
  for (int l = 1; l <= BATTLES; l++) if (durN[l]) std::printf("  B%d %.0fs (%d)", l, dur[l] / durN[l], durN[l]);
  std::printf("\nruns ended in battle:");
  for (int l = 1; l <= BATTLES; l++) if (reached[l]) std::printf("  B%d x%d", l, reached[l]);
  if (reached[BATTLES + 1]) std::printf("  WON x%d", reached[BATTLES + 1]);
  std::printf("\n");
  return 0;
}

int main(int argc, char** argv) {
  enableFastFloats();
  if (argc > 1 && std::string(argv[1]) == "campaign") return campaign(argc > 2 ? std::atoi(argv[2]) : 8);
  int level = argc > 1 ? std::atoi(argv[1]) : 1;
  int seeds = argc > 2 ? std::atoi(argv[2]) : 8;
  int maxTicks = (argc > 3 ? std::atoi(argv[3]) : 10) * 3600;
  bool rush = argc > 4 && std::string(argv[4]) == "rush";
  int wins = 0, deaths = 0;
  double winTime = 0;
  for (int s = 1; s <= seeds; s++) {
    uint32_t seed = 1000 + s * 77;
    seedRnd(seed * 2654435761u);
    Game g(seed);
    if (level > 1) { g.level = level; g.startBattle(); }
    int t = 0;
    while (g.state == "play" && t < maxTicks) { step(g, rush); t++; }
    int allies = 0, enemies = 0;
    for (Tank* a : g.allies) allies += a->alive;
    for (Tank* e : g.enemies) enemies += e->alive;
    const char* out = g.state == "cleared" ? "CAPTURED" : g.state == "dead" ? "DIED" : "TIMEOUT";
    if (g.state == "cleared") { wins++; winTime += t / 60.0; }
    if (g.state == "dead") deaths++;
    std::printf("seed %u: %-8s at %5.1f s  kills %2d  waves %d  allies left %d  enemies left %2d  hull %3.0f%%\n", seed, out, t / 60.0,
                g.kills, g.waveNo, allies, enemies, g.player->frac(HULL) * 100);
  }
  std::printf("level %d: %d/%d captured (avg %.0f s), %d died\n", level, wins, seeds, wins ? winTime / wins : 0.0, deaths);
}
