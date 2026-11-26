// Finding the students' faces in a class photo, on the teacher's computer (YuNet, ONNX): for
// «اختار طالب بالكاميرا». A class photo has small, far faces at the back, so the photo is also
// looked at in overlapping tiles (each tile enlarged), and the results are merged.
// Pure logic (decoding, tiles, merging, choosing fairly); the ONNX runtime and the pixels are
// passed in, so the same code runs in the page and in the tests.

export const YUNET_SIZE = 640;
const STRIDES = [8, 16, 32];

/** Sensitivity levels in settings: how many tiles and how sure a face must be. */
export const SENSITIVITY = {
  normal: { grid: 2, threshold: 0.62 },
  high: { grid: 3, threshold: 0.55 },
  max: { grid: 4, threshold: 0.48 },
};

/**
 * YuNet's outputs for one 640×640 input → face boxes in input pixels.
 * @param {Record<string, {data: Float32Array}>} out cls_8.., obj_8.., bbox_8.., kps_8..
 */
export function decodeYunet(out, threshold) {
  const faces = [];
  for (const st of STRIDES) {
    const n = YUNET_SIZE / st;
    const cls = out[`cls_${st}`].data; const obj = out[`obj_${st}`].data; const bb = out[`bbox_${st}`].data; const kps = out[`kps_${st}`]?.data;
    for (let i = 0; i < cls.length; i += 1) {
      const score = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i])));
      if (score < threshold) continue;
      const r = Math.floor(i / n); const c = i % n;
      const cx = (c + bb[i * 4]) * st; const cy = (r + bb[i * 4 + 1]) * st;
      const w = Math.exp(bb[i * 4 + 2]) * st; const h = Math.exp(bb[i * 4 + 3]) * st;
      const face = { x: cx - w / 2, y: cy - h / 2, w, h, score };
      if (kps) face.eyes = [[(c + kps[i * 10]) * st, (r + kps[i * 10 + 1]) * st], [(c + kps[i * 10 + 2]) * st, (r + kps[i * 10 + 3]) * st]];
      faces.push(face);
    }
  }
  return faces;
}

const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x); const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w); const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};

/**
 * Merges faces found in several tiles: one box per face (the surest), and drops what cannot be
 * a face (too thin, too wide, or a small box inside a bigger face).
 */
export function mergeFaces(faces, { overlap = 0.3 } = {}) {
  const ok = faces.filter((f) => f.w > 6 && f.h > 6 && f.h / f.w > 0.7 && f.h / f.w < 2.2);
  ok.sort((a, b) => b.score - a.score);
  const keep = [];
  for (const f of ok) {
    const inside = keep.some((k) => {
      const cx = f.x + f.w / 2; const cy = f.y + f.h / 2;
      return iou(k, f) > overlap || (cx > k.x && cx < k.x + k.w && cy > k.y && cy < k.y + k.h && k.w * k.h > f.w * f.h * 1.5);
    });
    if (!inside) keep.push(f);
  }
  // In a class photo, faces in the same row are about the same size: a box much smaller than
  // its neighbours is a hand, a tie or a pattern.
  if (keep.length >= 6) {
    return keep.filter((f) => {
      const row = keep.filter((g) => g !== f && Math.abs((g.y + g.h / 2) - (f.y + f.h / 2)) < Math.max(f.h, g.h) * 1.5).map((g) => g.h).sort((a, b) => a - b);
      if (row.length < 3) return true;
      return f.h >= row[Math.floor(row.length / 2)] * 0.55;
    });
  }
  return keep;
}

/** Sure faces only, when there are enough of them (the higher sensitivity fills in when few). */
export const STRONG = 0.62;
export function sureFaces(faces) {
  const strong = faces.filter((f) => f.score >= STRONG);
  return strong.length >= 2 ? strong : faces;
}

/**
 * The views to run the detector on: the whole photo, then a grid of overlapping tiles.
 * @returns {{x:number, y:number, w:number, h:number}[]} in photo pixels
 */
export function tilesFor(width, height, grid) {
  const views = [{ x: 0, y: 0, w: width, h: height }];
  if (grid < 2) return views;
  const tw = Math.round((width / grid) * 1.35); const th = Math.round((height / grid) * 1.35);
  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      const x = Math.round(((width - tw) * i) / (grid - 1)); const y = Math.round(((height - th) * j) / (grid - 1));
      views.push({ x: Math.max(0, x), y: Math.max(0, y), w: Math.min(tw, width), h: Math.min(th, height) });
    }
  }
  return views;
}

/**
 * Faces in a photo. `pixels(view)` returns the view letterboxed into 640×640 as BGR planes
 * (Float32Array 3×640×640) and the scale used.
 * @param {{run: (feeds: object) => Promise<object>}} session YuNet
 * @param {{width: number, height: number, pixels: (view) => {data: Float32Array, scale: number}}} photo
 * @param {{level?: keyof SENSITIVITY, Tensor: Function}} opts
 */
export async function findFaces(session, photo, { level = 'high', Tensor }) {
  const { grid, threshold } = SENSITIVITY[level] || SENSITIVITY.high;
  const all = [];
  for (const view of tilesFor(photo.width, photo.height, grid)) {
    const { data, scale } = photo.pixels(view);
    const out = await session.run({ input: new Tensor('float32', data, [1, 3, YUNET_SIZE, YUNET_SIZE]) });
    for (const f of decodeYunet(out, threshold)) {
      all.push({ ...f, x: view.x + f.x / scale, y: view.y + f.y / scale, w: f.w / scale, h: f.h / scale, eyes: f.eyes?.map(([ex, ey]) => [view.x + ex / scale, view.y + ey / scale]) });
    }
  }
  return mergeFaces(all);
}

/**
 * The student chosen, fairly: not one picked already this lesson (by place in the photo), while
 * there are others left.
 * @param {{x,y,w,h}[]} faces
 * @param {{x: number, y: number}[]} picked earlier choices, as fractions of the photo
 */
export function chooseFace(faces, picked, { width, height, random = Math.random } = {}) {
  faces = sureFaces(faces);
  if (!faces.length) return null;
  const near = (f) => picked.some((p) => Math.hypot((f.x + f.w / 2) / width - p.x, (f.y + f.h / 2) / height - p.y) < 0.06);
  const fresh = faces.filter((f) => !near(f));
  const pool = fresh.length ? fresh : faces;
  return pool[Math.floor(random() * pool.length)];
}
