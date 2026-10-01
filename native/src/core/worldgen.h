#pragma once
#include <string>
#include <vector>
#include "grid.h"
#include "util.h"

struct EnemySpawn { std::string type; double x, y, a; };
struct Barrel { int x, y; bool done; };

struct Layout {
  Pt spawn, flag;
  std::vector<EnemySpawn> enemies;
  std::vector<Barrel> barrels;
};

// Builds a Field battlefield into the grid: farmland crossed by a dirt road,
// hedgerows (bocage) cutting it into fields with gaps, copses of trees, hay
// bales, a farm or two, old shell craters. Player enters west, flag is east.
Layout generateBattle(Grid& g, Rng& rng, int level);
