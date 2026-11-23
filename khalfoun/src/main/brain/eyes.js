// What Claude sees: the primary screen at its real resolution, sent as a picture of at most
// 1568 px on the long side (what Claude reads best), with the text Windows' OCR reads on it
// and where each line is. Every coordinate Claude uses is in that picture; this module turns
// them into physical pixels (the mouse) and overlay pixels (Khalfoun's ink).

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findOnScreen, layoutHint } from '../../core/screen-find.js';

export const PICTURE_MAX = 1568;

/** Picture pixels per physical pixel, for a screen of this physical size. */
export function pictureScale(width, height, max = PICTURE_MAX) {
  return Math.max(1, Math.max(width, height) / max);
}

/**
 * Pure mapping between the picture, the physical screen and the overlay window.
 * @param {{bounds: {x:number,y:number,width:number,height:number}, workArea: {x:number,y:number}, scaleFactor: number}} display
 */
export function screenMap(display, max = PICTURE_MAX) {
  const sf = display.scaleFactor || 1;
  const W = Math.round(display.bounds.width * sf);
  const H = Math.round(display.bounds.height * sf);
  const s = pictureScale(W, H, max);
  const ox = Math.round(display.bounds.x * sf); const oy = Math.round(display.bounds.y * sf);
  const offX = display.workArea.x - display.bounds.x; const offY = display.workArea.y - display.bounds.y;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const map = {
    physical: { width: W, height: H },
    picture: { width: Math.round(W / s), height: Math.round(H / s) },
    scale: s,
    pictureScale: () => s / sf, // picture px -> overlay px factor
    toPhysical: (x, y) => ({ x: ox + clamp(Math.round(x * s), 0, W - 1), y: oy + clamp(Math.round(y * s), 0, H - 1) }),
    toOverlay: (x, y) => ({ x: Math.round((x * s) / sf - offX), y: Math.round((y * s) / sf - offY) }),
    boxToOverlay: (b) => {
      const p = map.toOverlay(b.x, b.y);
      return { x: p.x, y: p.y, w: Math.max(1, Math.round((b.w * s) / sf)), h: Math.max(1, Math.round((b.h * s) / sf)) };
    },
    fromPhysical: (x, y) => ({ x: Math.round((x - ox) / s), y: Math.round((y - oy) / s) }),
    size: () => map.picture,
  };
  return map;
}

/**
 * @param {{electron: {screen: any, desktopCapturer: any}, ocrImage?: Function, hideWhile: (fn: () => Promise<any>) => Promise<any>,
 *   activeWindow?: () => Promise<{title?: string, process?: string}|null>, platform?: string, log?: Function}} deps
 */
export function createEyes(deps) {
  const { screen, desktopCapturer } = deps.electron;
  const platform = deps.platform || process.platform;
  const current = () => screenMap(screen.getPrimaryDisplay());

  async function capture() {
    const display = screen.getPrimaryDisplay();
    const map = screenMap(display);
    const shot = await deps.hideWhile(async () => {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: map.physical });
      const source = sources.find((s) => s.display_id === String(display.id)) || sources[0];
      return source?.thumbnail || null;
    });
    if (!shot || shot.isEmpty?.()) return null;
    return { shot, map, display };
  }

  async function ocrWords(shot) {
    if (platform !== 'win32' || !deps.ocrImage) return [];
    const dir = await mkdtemp(join(tmpdir(), 'khalfoun-eyes-'));
    try {
      await writeFile(join(dir, 's.png'), shot.toPNG());
      const r = await deps.ocrImage(join(dir, 's.png'), { words: true });
      return r.ok ? r.data.words || [] : [];
    } catch { return []; } finally { rm(dir, { recursive: true, force: true }).catch(() => {}); }
  }

  /** look_screen */
  async function look({ zoom } = {}) {
    const c = await capture();
    if (!c) return { ok: false, error: 'no_screen' };
    const { shot, map } = c;
    const [words, win] = await Promise.all([ocrWords(shot), deps.activeWindow?.().catch(() => null)]);
    let img;
    if (zoom && zoom.w > 4 && zoom.h > 4) {
      const p1 = map.toPhysical(zoom.x, zoom.y); const p2 = map.toPhysical(zoom.x + zoom.w, zoom.y + zoom.h);
      const rect = { x: p1.x, y: p1.y, width: Math.max(8, p2.x - p1.x), height: Math.max(8, p2.y - p1.y) };
      img = shot.crop(rect);
      const s = pictureScale(rect.width, rect.height);
      if (s > 1) img = img.resize({ width: Math.round(rect.width / s), quality: 'best' });
    } else {
      img = shot.resize({ width: map.picture.width, height: map.picture.height, quality: 'best' });
    }
    const size = img.getSize();
    const cur = screen.getCursorScreenPoint();
    const sf = c.display.scaleFactor || 1;
    const cursor = map.fromPhysical(Math.round(cur.x * sf), Math.round(cur.y * sf));
    const layout = layoutHint(words, { scale: map.scale, maxLines: 90 });
    deps.log?.('claude look', `${size.width}x${size.height}`, `${words.length} words`, zoom ? 'zoom' : '');
    return {
      ok: true, data: img.toJPEG(85).toString('base64'), mime: 'image/jpeg', width: size.width, height: size.height,
      full: map.picture, cursor, layout, window: win?.title ? `${win.title}${win.process ? ` — ${win.process}` : ''}` : '',
    };
  }

  /** find_text */
  async function find(text) {
    const c = await capture();
    if (!c) return { ok: false, error: 'no_screen' };
    if (platform !== 'win32') return { ok: false, error: 'unsupported' };
    const words = await ocrWords(c.shot);
    const boxes = findOnScreen(words, text, { scale: c.map.scale });
    deps.log?.('claude find', `«${String(text).slice(0, 30)}»`, `${boxes.length} of ${words.length} words`);
    return { ok: true, boxes };
  }

  const screenApi = {
    toPhysical: (x, y) => current().toPhysical(x, y),
    toOverlay: (x, y) => current().toOverlay(x, y),
    boxToOverlay: (b) => current().boxToOverlay(b),
    pictureScale: () => current().pictureScale(),
    size: () => current().size(),
  };
  return { look, find, screen: screenApi };
}
