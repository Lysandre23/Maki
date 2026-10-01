#include <algorithm>
#include <cmath>
#include "world.h"

static constexpr int DIRS[8][2] = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {1, -1}, {-1, 1}, {-1, -1}};
static constexpr size_t CACHE = 24;

// Coarse navigation grid + BFS flow fields.
// Many tanks share a few destinations (follow the player, hold a post, take
// the flag), so fields are cached per destination node (LRU) and dropped when
// the terrain changes (rebuildRegion).
Nav::Nav(const Grid& grid, int cell) : c(cell) {
  w = (grid.w + c - 1) / c;
  h = (grid.h + c - 1) / c;
  size_t n = (size_t)w * h;
  blocked.assign(n, 0);
  pass.assign(n, 0);
  queue.assign(n, 0);
}

// Recompute blocked/pass for the nodes covering a world rect.
void Nav::rebuildRegion(const Grid& grid, int x0, int y0, int x1, int y1) {
  const int gw = grid.w;
  int ni0 = std::max(0, (int)std::floor(x0 / (double)c) - 1), ni1 = std::min(w - 1, (int)std::floor(x1 / (double)c) + 1);
  int nj0 = std::max(0, (int)std::floor(y0 / (double)c) - 1), nj1 = std::min(h - 1, (int)std::floor(y1 / (double)c) + 1);
  for (int nj = nj0; nj <= nj1; nj++) {
    for (int ni = ni0; ni <= ni1; ni++) {
      uint8_t b = 0;
      int bx = ni * c, by = nj * c;
      for (int y = by; y < by + c && y < grid.h && !b; y++) {
        int row = y * gw;
        for (int x = bx; x < bx + c && x < gw; x++) {
          if (SOLID[grid.mat[row + x]]) { b = 1; break; }
        }
      }
      blocked[nj * w + ni] = b;
    }
  }
  // A tank needs clearance: node plus its 8 neighbours must be free.
  for (int nj = std::max(0, nj0 - 1); nj <= std::min(h - 1, nj1 + 1); nj++) {
    for (int ni = std::max(0, ni0 - 1); ni <= std::min(w - 1, ni1 + 1); ni++) {
      uint8_t ok = 1;
      for (int dj = -1; dj <= 1 && ok; dj++) {
        for (int di = -1; di <= 1; di++) {
          int i = ni + di, j = nj + dj;
          if (i < 0 || j < 0 || i >= w || j >= h || blocked[j * w + i]) { ok = 0; break; }
        }
      }
      pass[nj * w + ni] = ok;
    }
  }
  cache.clear();
  version++;
}

int Nav::node(double x, double y) const {
  int i = std::max(0, std::min(w - 1, (int)std::floor(x / c)));
  int j = std::max(0, std::min(h - 1, (int)std::floor(y / c)));
  return j * w + i;
}

// BFS distance field toward (x, y), cached (-1 = unreachable).
const std::vector<int32_t>& Nav::field(double x, double y) {
  int s = node(x, y);
  auto it = cache.find(s);
  if (it != cache.end()) { it->second.used = ++useClock; return it->second.dist; }
  if (cache.size() >= CACHE) { // evict the least recently used
    auto old = cache.begin();
    for (auto e = cache.begin(); e != cache.end(); ++e) if (e->second.used < old->second.used) old = e;
    cache.erase(old);
  }
  Entry& ent = cache[s];
  ent.used = ++useClock;
  auto& dist = ent.dist;
  dist.assign((size_t)w * h, -1);
  int head = 0, tail = 0;
  dist[s] = 0; queue[tail++] = s;
  while (head < tail) {
    int k = queue[head++];
    int i = k % w, j = k / w;
    for (int d = 0; d < 8; d++) {
      int ni = i + DIRS[d][0], nj = j + DIRS[d][1];
      if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
      int nk = nj * w + ni;
      if (dist[nk] >= 0 || !pass[nk]) continue;
      if (d >= 4 && (!pass[j * w + ni] || !pass[nj * w + i])) continue; // no corner cutting
      dist[nk] = dist[k] + 1;
      queue[tail++] = nk;
    }
  }
  return dist;
}

bool Nav::dirAt(const std::vector<int32_t>& dist, double x, double y, double& out) const {
  int i = (int)std::floor(x / c), j = (int)std::floor(y / c);
  if (i < 0 || j < 0 || i >= w || j >= h) return false;
  int own = dist[j * w + i];
  if (own == 0) return false;
  int best = -1, bd = own >= 0 ? own : 1000000000;
  for (int d = 0; d < 8; d++) {
    int ni = i + DIRS[d][0], nj = j + DIRS[d][1];
    if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
    int nd = dist[nj * w + ni];
    if (nd >= 0 && nd < bd) { bd = nd; best = d; }
  }
  if (best < 0) return false;
  double tx = (i + DIRS[best][0] + 0.5) * c, ty = (j + DIRS[best][1] + 0.5) * c;
  out = std::atan2(ty - y, tx - x);
  return true;
}

// After a blast, look for masonry fragments that have lost their support:
// connected pieces fully inside the search box that are small compared to the
// structure they came from (a wall segment cut off at both ends, the stump of a
// shattered pillar).
std::vector<std::vector<int>> findCollapses(const Grid& grid, double x, double y, double R, int maxSize, double ratio) {
  const int w = grid.w;
  auto isMasonry = [](uint8_t m) { return m == M::BRICK || m == M::STONE; };
  int x0 = std::max(0, (int)std::floor(x - R)), x1 = std::min(w - 1, (int)std::ceil(x + R));
  int y0 = std::max(0, (int)std::floor(y - R)), y1 = std::min(grid.h - 1, (int)std::ceil(y + R));
  int bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  std::vector<std::vector<int>> out;
  if (bw <= 0 || bh <= 0) return out;
  std::vector<uint8_t> seen((size_t)bw * bh, 0);
  std::vector<int> queue((size_t)bw * bh);
  auto toGrid = [&](int b) { return (y0 + b / bw) * w + x0 + (b % bw); };

  for (int b0 = 0; b0 < bw * bh; b0++) {
    if (seen[b0] || !isMasonry(grid.mat[toGrid(b0)])) continue;
    // BFS over 4-connected masonry inside the box
    int head = 0, tail = 0;
    bool edge = false;
    seen[b0] = 1; queue[tail++] = b0;
    while (head < tail) {
      int b = queue[head++];
      int cx = b % bw, cy = b / bw;
      if (cx == 0 || cy == 0 || cx == bw - 1 || cy == bh - 1) edge = true;
      int nb[4] = {cx > 0 ? b - 1 : -1, cx < bw - 1 ? b + 1 : -1, cy > 0 ? b - bw : -1, cy < bh - 1 ? b + bw : -1};
      for (int n : nb) {
        if (n < 0 || seen[n] || !isMasonry(grid.mat[toGrid(n)])) continue;
        seen[n] = 1;
        queue[tail++] = n;
      }
    }
    if (edge || tail > maxSize) continue;
    int sid = grid.structId[toGrid(queue[0])];
    int orig = sid < (int)grid.structSize.size() ? grid.structSize[sid] : 0;
    if (tail >= orig * ratio) continue; // still most of the structure: it stands
    std::vector<int> cells(tail);
    for (int k = 0; k < tail; k++) cells[k] = toGrid(queue[k]);
    out.push_back(std::move(cells));
  }
  return out;
}
