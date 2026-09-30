import { M } from './materials.js';

const isMasonry = (m) => m === M.BRICK || m === M.STONE;

// After a blast, look for masonry fragments that have lost their support:
// connected pieces fully inside the search box that are small compared to the
// structure they came from (a wall segment cut off at both ends, the stump of a
// shattered pillar). Returns arrays of cell indices to bring down.
export function findCollapses(grid, x, y, R, maxSize = 450, ratio = 0.45) {
  const { w, mat, struct, structSize } = grid;
  const x0 = Math.max(0, Math.floor(x - R)), x1 = Math.min(w - 1, Math.ceil(x + R));
  const y0 = Math.max(0, Math.floor(y - R)), y1 = Math.min(grid.h - 1, Math.ceil(y + R));
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const seen = new Uint8Array(bw * bh);
  const queue = new Int32Array(bw * bh);
  const toGrid = (b) => (y0 + ((b / bw) | 0)) * w + x0 + (b % bw);
  const out = [];

  for (let b0 = 0; b0 < bw * bh; b0++) {
    if (seen[b0] || !isMasonry(mat[toGrid(b0)])) continue;
    // BFS over 4-connected masonry inside the box
    let head = 0, tail = 0, edge = false;
    seen[b0] = 1; queue[tail++] = b0;
    while (head < tail) {
      const b = queue[head++];
      const cx = b % bw, cy = (b / bw) | 0;
      if (cx === 0 || cy === 0 || cx === bw - 1 || cy === bh - 1) edge = true;
      const nb = [cx > 0 ? b - 1 : -1, cx < bw - 1 ? b + 1 : -1, cy > 0 ? b - bw : -1, cy < bh - 1 ? b + bw : -1];
      for (const n of nb) {
        if (n < 0 || seen[n] || !isMasonry(mat[toGrid(n)])) continue;
        seen[n] = 1;
        queue[tail++] = n;
      }
    }
    if (edge || tail > maxSize) continue;
    const orig = structSize[struct[toGrid(queue[0])]] || 0;
    if (tail >= orig * ratio) continue; // still most of the structure: it stands
    const cells = new Array(tail);
    for (let k = 0; k < tail; k++) cells[k] = toGrid(queue[k]);
    out.push(cells);
  }
  return out;
}
