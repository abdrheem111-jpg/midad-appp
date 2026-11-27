// Students' faces never reach Claude. Before a screenshot leaves the PC, every window that may
// show the class (the camera app, a video call, a webcam tool) is painted over. Khalfoun's own
// panels with class photos (the camera pick, the notebook view) are already hidden, since the
// whole overlay is hidden while the screen is taken.

/** Programs whose windows show a camera picture. */
export const CAMERA_PROGRAMS = [
  'windowscamera', 'camera', 'zoom', 'ms-teams', 'teams', 'obs64', 'obs32', 'obs', 'skype', 'webex', 'ciscowebexstart',
  'manycam', 'xsplit.core', 'snapcamera', 'discord', 'whatsapp', 'telegram', 'facetime', 'cameraapp',
];
const CAMERA_TITLES = /(^|[\s\-–|])(الكاميرا|كاميرا|camera|webcam|كام)([\s\-–|]|$)|zoom meeting|اجتماع zoom|meeting|اجتماع|مكالمة|video call|google meet|meet\.google|jitsi/i;
// a browser tab that is a video meeting shows it in the window title
const BROWSERS = /^(chrome|msedge|firefox|opera|brave)$/i;

/**
 * Which windows to cover.
 * @param {{program: string, state: string, rect: string, title: string}[]} windows (parseWindows)
 * @param {{photos?: boolean}} [opts] photos: also cover the Photos app (off by default: worksheets are photographed too)
 * @returns {{x: number, y: number, w: number, h: number, why: string}[]}
 */
export function sensitiveRects(windows, opts = {}) {
  const out = [];
  for (const w of windows || []) {
    if (!w || w.state === 'min') continue;
    const prog = String(w.program || '').toLowerCase();
    const title = String(w.title || '');
    let why = '';
    if (CAMERA_PROGRAMS.includes(prog)) why = prog;
    else if (prog === 'applicationframehost' && /الكاميرا|camera/i.test(title)) why = 'camera';
    else if (BROWSERS.test(prog) && CAMERA_TITLES.test(title)) why = 'meeting';
    else if (opts.photos && /^(microsoft\.photos|photos|photosapp)$/i.test(prog)) why = 'photos';
    if (!why) continue;
    const [x, y, wd, ht] = String(w.rect || '').split(',').map(Number);
    if (![x, y, wd, ht].every(Number.isFinite) || wd < 20 || ht < 20) continue;
    out.push({ x, y, w: wd, h: ht, why });
  }
  return out;
}

/**
 * Paints the rectangles over a BGRA/RGBA bitmap (in place) with a calm grey and a darker frame.
 * @param {Uint8Array|Buffer} buf  4 bytes per pixel
 * @returns {number} how many rectangles touched the picture
 */
export function maskBitmap(buf, width, height, rects) {
  let n = 0;
  for (const r of rects || []) {
    const x0 = Math.max(0, Math.floor(r.x)); const y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(width, Math.ceil(r.x + r.w)); const y1 = Math.min(height, Math.ceil(r.y + r.h));
    if (x1 <= x0 || y1 <= y0) continue;
    n += 1;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const edge = x - x0 < 4 || x1 - x <= 4 || y - y0 < 4 || y1 - y <= 4;
        const i = (y * width + x) * 4;
        const v = edge ? 70 : 128;
        buf[i] = v; buf[i + 1] = v; buf[i + 2] = v; buf[i + 3] = 255;
      }
    }
  }
  return n;
}
