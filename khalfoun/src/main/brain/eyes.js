// What Claude sees: the primary screen at its real resolution, sent as a picture of at most
// 1568 px on the long side (what Claude reads best), with the text Windows' OCR reads on it
// and where each line is. Every coordinate Claude uses is in that picture; this module turns
// them into physical pixels (the mouse) and overlay pixels (Khalfoun's ink).

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findOnScreen, layoutHint } from '../../core/screen-find.js';
import { parseOcrOutput } from '../ocr.js';

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

  /**
   * Starts reading the screen's text and returns the promise: the fast way is the long-lived
   * hands process (OCR engine already loaded), else a one-off PowerShell.
   */
  async function ocrWords(shot) {
    if (platform !== 'win32') return [];
    const dir = await mkdtemp(join(tmpdir(), 'khalfoun-eyes-'));
    const file = join(dir, 's.png');
    try {
      await writeFile(file, shot.toPNG());
      let r = null;
      if (deps.hands) {
        const h = await deps.hands.call('ocr', { path: file }, 20000);
        r = h?.ok ? parseOcrOutput(h.data) : null;
      }
      if (!r && deps.ocrImage) r = await deps.ocrImage(file, { words: true });
      return r?.ok ? r.data.words || [] : [];
    } catch { return []; } finally { rm(dir, { recursive: true, force: true }).catch(() => {}); }
  }

  // The last reading, reused by find_text when nothing was done on the screen since.
  let last = null;
  let changes = 0;
  const fresh = () => last && last.changes === changes && Date.now() - last.at < 4000;

  /**
   * A piece of the screen as a picture, for a playful effect on it (a question crumpled into a
   * ball...): the region in picture pixels → a PNG at the overlay's size and where it sits there.
   */
  async function snap(region) {
    const c = await capture();
    if (!c) return { ok: false, error: 'no_screen' };
    const { shot, map } = c;
    const p1 = map.toPhysical(region.x, region.y); const p2 = map.toPhysical(region.x + region.w, region.y + region.h);
    const size = shot.getSize();
    const x = Math.max(0, Math.min(size.width - 8, p1.x)); const y = Math.max(0, Math.min(size.height - 8, p1.y));
    const rect = { x, y, width: Math.max(8, Math.min(size.width - x, p2.x - p1.x)), height: Math.max(8, Math.min(size.height - y, p2.y - p1.y)) };
    let img = shot.crop(rect);
    if (rect.width > 1800) img = img.resize({ width: 1800, quality: 'good' }); // plenty for an animation
    const o1 = map.toOverlay(region.x, region.y); const o2 = map.toOverlay(region.x + region.w, region.y + region.h);
    return { ok: true, image: `data:image/png;base64,${img.toPNG().toString('base64')}`, rect: { x: o1.x, y: o1.y, w: Math.max(4, o2.x - o1.x), h: Math.max(4, o2.y - o1.y) } };
  }

  /** look_screen */
  async function look({ zoom } = {}) {
    const c = await capture();
    if (!c) return { ok: false, error: 'no_screen' };
    const { shot, map } = c;
    const t0 = Date.now();
    // Reading the text runs in another process while the picture is made here.
    const reading = ocrWords(shot);
    const winP = deps.activeWindow?.().catch(() => null);
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
    const data = img.toJPEG(85).toString('base64');
    const [words, win] = await Promise.all([reading, winP]);
    last = { at: Date.now(), changes, words, map };
    const cur = screen.getCursorScreenPoint();
    const sf = c.display.scaleFactor || 1;
    const cursor = map.fromPhysical(Math.round(cur.x * sf), Math.round(cur.y * sf));
    const layout = layoutHint(words, { scale: map.scale, maxLines: 90 });
    deps.log?.('claude look', `${size.width}x${size.height}`, `${words.length} words`, zoom ? 'zoom' : '', `${Date.now() - t0} ms`);
    return {
      ok: true, data, mime: 'image/jpeg', width: size.width, height: size.height,
      full: map.picture, cursor, layout, window: win?.title ? `${win.title}${win.process ? ` — ${win.process}` : ''}` : '',
    };
  }

  /** find_text */
  async function find(text) {
    if (platform !== 'win32') return { ok: false, error: 'unsupported' };
    let words; let map;
    if (fresh()) ({ words, map } = last);
    else {
      const c = await capture();
      if (!c) return { ok: false, error: 'no_screen' };
      words = await ocrWords(c.shot);
      map = c.map;
      last = { at: Date.now(), changes, words, map };
    }
    const boxes = findOnScreen(words, text, { scale: map.scale });
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
  return { look, find, snap, screen: screenApi, changed: () => { changes += 1; } };
}
