// Doing the office actions: write into the open Word/PowerPoint/Excel document when there is
// one (through the COM host), otherwise make a new, designed file in Documents\خلفون and
// open it. Formatting falls back to keyboard shortcuts when no Office program is in front.

import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { buildDocx } from './docx.js';
import { buildPptx } from './pptx.js';
import { buildXlsx, planAsTable } from './xlsx.js';
import { planHtml } from './html.js';
import { fileTitle, THEME } from './theme.js';
import { SHAPES, COLORS, KINDS, layoutDiagram, planText, textOn, OFFICE_APPS } from '../../core/office-plan.js';
import { linearMath } from '../../core/office-math.js';

/** Office colours are blue-green-red numbers. */
export const bgr = (hex) => {
  const n = parseInt(String(hex || '000000'), 16);
  return ((n >> 16) & 255) + (((n >> 8) & 255) << 8) + ((n & 255) << 16);
};

const PROCESS_APP = { WINWORD: 'word', POWERPNT: 'powerpoint', EXCEL: 'excel' };
export const appOfProcess = (name) => PROCESS_APP[String(name || '').toUpperCase().replace(/\.EXE$/, '')] || null;

/** Shapes for the COM host: fractions of the drawing area, colours as numbers. */
export function shapeItems({ shape, color, count = 1, text = '' }) {
  const spec = SHAPES[shape] || SHAPES.circle;
  const fill = COLORS[color]?.hex || THEME.primary;
  const n = Math.max(1, Math.min(12, count));
  const gap = 0.03;
  const size = Math.min(0.3, (0.9 - gap * (n - 1)) / n);
  const start = (1 - (n * size + (n - 1) * gap)) / 2;
  const items = [];
  for (let i = 0; i < n; i += 1) {
    const x = start + i * (size + gap);
    const h = spec.square || shape === 'circle' ? size * 1.6 : size * 1.2; // the area is wider than tall
    if (spec.line) { items.push({ kind: 'line', x, y: 0.5, w: size, fill: bgr(fill) }); continue; }
    items.push({ kind: 'shape', type: spec.ppt, x, y: (1 - h) / 2, w: size, h, fill: bgr(fill), line: bgr(fill === 'FFFFFF' ? '999999' : fill), text, textColor: bgr(textOn(fill)) });
  }
  return items;
}

/** A diagram's boxes and arrows for the COM host. */
export function diagramItems(plan) {
  const { boxes, arrows } = layoutDiagram(plan);
  return [
    ...arrows.map((a) => ({ kind: 'arrow', x1: a.from.x, y1: a.from.y, x2: a.to.x, y2: a.to.y, line: bgr(THEME.inkSoft) })),
    ...boxes.map((b) => {
      const fill = COLORS[b.color]?.hex || THEME.primary;
      return { kind: 'shape', type: SHAPES.rounded.ppt, x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h, fill: bgr(fill), line: bgr(fill), text: b.text, textColor: bgr(textOn(fill)) };
    }),
  ];
}

function stamp(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}${p(now.getMinutes())}`;
}

/**
 * @param {{host: {available: boolean, call: Function}, documentsDir: string, openPath: (f: string) => Promise<string>,
 *   personProcess: () => Promise<string|null>, printPdf?: (html: string, file: string) => Promise<void>,
 *   fontCss?: () => Promise<string>, pressKey?: (key: string) => Promise<any>, typeText?: (t: string) => Promise<any>,
 *   openFiles?: boolean, log?: Function}} deps
 */
export function createOfficeActions(deps) {
  const log = deps.log || (() => {});
  let current = 'arabic'; // the digits of the request being done
  const digits = () => current;
  const extras = () => ({ primary: bgr(THEME.primary), green: bgr(THEME.green), moral: 'العبرة:', digits: digits() });

  async function target(app) {
    const proc = await deps.personProcess().catch(() => null);
    return { app: app || null, process: proc || '' };
  }

  /** A new designed file of the right type, opened for the person. */
  async function newFile(app, plan, { shape = null } = {}) {
    const dir = join(deps.documentsDir, 'خلفون');
    await mkdir(dir, { recursive: true });
    let kind = app;
    // Word cannot hold a drawn diagram in our files: diagrams and shapes become slides.
    if ((plan?.kind === 'diagram' || shape) && app !== 'pdf') kind = 'powerpoint';
    const ext = { word: 'docx', powerpoint: 'pptx', excel: 'xlsx', pdf: 'pdf' }[kind] || 'docx';
    const base = fileTitle(plan?.title || (shape ? SHAPES[shape.shape]?.ar : '') || KINDS[plan?.kind]?.ar || 'خلفون');
    let file = join(dir, `${base}.${ext}`);
    // Never overwrite: an existing name gets the time added.
    try { await access(file); file = join(dir, `${base} ${stamp()}.${ext}`); } catch { /* free */ }
    if (kind === 'powerpoint') await writeFile(file, await buildPptx(plan, { digits: digits(), shape }));
    else if (kind === 'excel') await writeFile(file, await buildXlsx(planAsTable(plan, planText(plan).split('\n'))));
    else if (kind === 'pdf') {
      if (!deps.printPdf) return { ok: false, error: 'unsupported' };
      await deps.printPdf(planHtml(plan, { fontCss: deps.fontCss ? await deps.fontCss() : '', digits: digits() }), file);
    } else await writeFile(file, await buildDocx(plan, { digits: digits() }));
    const err = deps.openFiles === false ? '' : await deps.openPath(file);
    return { ok: true, data: { mode: 'file', app: kind, file, opened: !err } };
  }

  /** Writes a plan: into the open document when there is one, else into a new file. */
  async function put({ app, plan, fresh, verbatim, digits: dg }) {
    current = dg === 'latin' ? 'latin' : 'arabic';
    if (!OFFICE_APPS.includes(app)) return { ok: false, error: 'bad_app' };
    if (app === 'pdf' || fresh || !deps.host.available) return newFile(app, plan);
    const t = await target(app);
    const status = await deps.host.call('status', t, 15000);
    if (status.ok && status.data?.app === app && status.data.hasDoc) {
      const c = { ...extras(), items: plan.kind === 'diagram' ? diagramItems(plan) : [], lines: planText(plan).split('\n').filter(Boolean) };
      const res = await deps.host.call('insert', { ...t, plan: { ...plan, verbatim: Boolean(verbatim) }, c });
      if (res.ok) return { ok: true, data: { mode: 'inserted', app } };
      log('office insert failed:', res.error);
      // The document refused (protected view, a dialog open...): paste plain text if it was a few words.
      if (verbatim && deps.typeText) {
        const typed = await deps.typeText(planText(plan));
        if (typed?.ok) return { ok: true, data: { mode: 'pasted', app } };
      }
    }
    return newFile(app, plan);
  }

  async function draw({ app, shape, color, count, text }) {
    const spec = { shape, color, count, text };
    if (!deps.host.available) return app ? newFile(app, null, { shape: spec }) : { ok: false, error: 'no_office' };
    const t = await target(app);
    const res = await deps.host.call('draw', { ...t, items: shapeItems(spec) });
    if (res.ok) return { ok: true, data: { mode: 'inserted', app: res.data?.app } };
    if (res.error === 'no_office') return res; // nothing open: the brain draws on the screen instead
    if (app && (res.error === 'not_running' || /^com/.test(res.error))) return newFile(app, null, { shape: spec });
    return res.error === 'not_running' ? { ok: false, error: 'no_office' } : res;
  }

  const KEY_FALLBACK = { bold: 'bold', italic: 'italic', underline: 'underline', center: 'align_center', grow: 'zoom_in', shrink: 'zoom_out' };
  async function format({ op, value }) {
    const rgb = op === 'color' ? bgr(COLORS[value]?.hex) : undefined;
    if (deps.host.available) {
      const t = await target(null);
      const res = await deps.host.call('format', { ...t, op, value, rgb }, 15000);
      if (res.ok) return { ok: true, data: { mode: 'inserted', app: res.data?.app } };
      if (res.error === 'no_selection') return res;
      if (res.error !== 'no_office' && res.error !== 'not_running') log('office format failed:', res.error);
    }
    // No Office program in front: the usual shortcuts work in most programs.
    if (KEY_FALLBACK[op] && deps.pressKey) {
      const k = await deps.pressKey(KEY_FALLBACK[op]);
      return k?.ok ? { ok: true, data: { mode: 'keys' } } : { ok: false, error: 'no_office' };
    }
    return { ok: false, error: 'no_office' };
  }

  async function slide({ title }) {
    if (!deps.host.available) return { ok: false, error: 'no_office' };
    const res = await deps.host.call('slide', { ...(await target('powerpoint')), title: title || '' });
    if (res.ok) return { ok: true, data: { mode: 'inserted', app: 'powerpoint' } };
    return { ok: false, error: res.error === 'not_running' ? 'no_office' : res.error };
  }

  async function equation({ app, text }) {
    if (!deps.host.available) return { ok: false, error: 'no_office' };
    const res = await deps.host.call('equation', { ...(await target(app)), text, linear: linearMath(text) });
    if (res.ok) return { ok: true, data: { mode: 'inserted', app: res.data?.app } };
    return { ok: false, error: res.error === 'not_running' ? 'no_office' : res.error };
  }

  async function circle() {
    if (!deps.host.available) return { ok: false, error: 'no_office' };
    const res = await deps.host.call('circle', { ...(await target(null)), red: bgr(COLORS.red.hex) });
    if (res.ok) return { ok: true, data: { mode: 'inserted', app: res.data?.app } };
    return { ok: false, error: res.error === 'not_running' ? 'no_office' : res.error };
  }

  async function pdf() {
    if (!deps.host.available) return { ok: false, error: 'no_office' };
    const dir = join(deps.documentsDir, 'خلفون');
    await mkdir(dir, { recursive: true });
    const file = join(dir, `ملف ${stamp()}.pdf`);
    const res = await deps.host.call('pdf', { ...(await target(null)), path: file }, 60000);
    if (!res.ok) return { ok: false, error: res.error === 'not_running' ? 'no_office' : res.error };
    if (deps.openFiles !== false) await deps.openPath(file);
    return { ok: true, data: { mode: 'inserted', file } };
  }

  return { put, draw, format, slide, equation, circle, pdf, newFile };
}
