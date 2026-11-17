// Turns the list of open windows into "platforms" Khalfoun can stand on: the
// visible part of each window's top edge. Windows are given top-most first;
// parts of an edge hidden behind a window in front of it are cut away.
// Pure: unit-tested in Node.

/**
 * @param {Array<{id: number|string, x: number, y: number, w: number, h: number}>} windows top-most first, in overlay coordinates
 * @param {{width: number, height: number}} area overlay size
 * @param {{width: number, height: number}} size character size
 * @returns {Array<{id: number|string, x1: number, x2: number, y: number}>}
 */
export function visiblePlatforms(windows, area, size) {
  const out = [];
  const list = Array.isArray(windows) ? windows : [];
  for (let i = 0; i < list.length; i += 1) {
    const win = list[i];
    if (![win?.x, win?.y, win?.w, win?.h].every(Number.isFinite)) continue;
    const y = Math.round(win.y);
    // room to stand above it, not hugging the floor, and wide enough
    if (y < size.height * 0.8 || y > area.height - 60 || win.w < size.width * 0.6) continue;
    let pieces = [[Math.max(0, win.x), Math.min(area.width, win.x + win.w)]];
    for (let j = 0; j < i && pieces.length; j += 1) {
      const above = list[j];
      if (!(above.y <= y && above.y + above.h > y)) continue;
      const a1 = above.x;
      const a2 = above.x + above.w;
      const next = [];
      for (const [p1, p2] of pieces) {
        if (a2 <= p1 || a1 >= p2) { next.push([p1, p2]); continue; }
        if (a1 > p1) next.push([p1, a1]);
        if (a2 < p2) next.push([a2, p2]);
      }
      pieces = next;
    }
    for (const [x1, x2] of pieces) if (x2 - x1 >= Math.max(60, size.width * 0.5)) out.push({ id: win.id, x1, x2, y });
  }
  return out;
}
