// PowerPoint decks (.pptx) from a checked plan, with one designed look: a teal title slide
// with gold accents, cream content slides with the title on the right, Arabic right-to-left
// text, slide numbers, teacher notes, tables, and diagrams laid out by layoutDiagram.

import PptxGenJS from 'pptxgenjs';
import { THEME } from './theme.js';
import { layoutDiagram, COLORS, SHAPES, textOn } from '../../core/office-plan.js';
import { toArabicDigitsAll } from '../../core/office-math.js';

const W = 13.333; // 16:9, inches
const H = 7.5;
const RTL = { rtlMode: true, align: 'right', fontFace: THEME.slideFont, lang: 'ar-OM' };

function master(pptx) {
  pptx.defineSlideMaster({
    title: 'KH_CONTENT',
    background: { color: THEME.sand },
    objects: [
      { rect: { x: W - 0.22, y: 0, w: 0.22, h: H, fill: { color: THEME.primary } } },
      { rect: { x: 0.6, y: 1.32, w: W - 1.4, h: 0.04, fill: { color: THEME.accent } } },
      { ellipse: { x: -0.9, y: H - 1.4, w: 2.2, h: 2.2, fill: { color: THEME.sandDark } } },
    ],
    slideNumber: { x: 0.35, y: H - 0.55, w: 0.6, h: 0.35, fontFace: THEME.slideFont, fontSize: 12, color: THEME.inkSoft },
  });
}

function titleSlide(pptx, title, subtitle) {
  const s = pptx.addSlide();
  s.background = { color: THEME.primary };
  s.addShape(pptx.ShapeType.ellipse, { x: W - 3.2, y: -1.6, w: 4.6, h: 4.6, fill: { color: THEME.primaryDark } });
  s.addShape(pptx.ShapeType.ellipse, { x: -1.2, y: H - 2.4, w: 3.6, h: 3.6, fill: { color: THEME.primaryDark } });
  s.addShape(pptx.ShapeType.rect, { x: 1.2, y: 4.15, w: W - 2.4, h: 0.06, fill: { color: THEME.accent } });
  s.addText(title, { ...RTL, x: 1.0, y: 2.0, w: W - 2.0, h: 2.0, fontSize: 48, bold: true, color: THEME.white, align: 'center', valign: 'bottom', fit: 'shrink' });
  if (subtitle) s.addText(subtitle, { ...RTL, x: 1.0, y: 4.35, w: W - 2.0, h: 0.9, fontSize: 24, color: 'F3DFAE', align: 'center', valign: 'top' });
  return s;
}

function contentTitle(s, title) {
  s.addText(title, { ...RTL, x: 0.6, y: 0.35, w: W - 1.3, h: 0.9, fontSize: 32, bold: true, color: THEME.primary, valign: 'middle', fit: 'shrink' });
}

function bulletsSlide(pptx, slide, num) {
  const s = pptx.addSlide({ masterName: 'KH_CONTENT' });
  contentTitle(s, slide.title);
  const items = slide.bullets.length ? slide.bullets : [''];
  const size = items.length > 5 ? 22 : 26;
  s.addText(items.map((b) => ({ text: num(b), options: { rtlMode: true, align: 'right', bullet: { code: '25C6', indent: 28 }, color: THEME.ink, breakLine: true, paraSpaceAfter: 10 } })), {
    ...RTL, x: 0.9, y: 1.6, w: W - 1.8, h: H - 2.4, fontSize: size, valign: 'top', lineSpacingMultiple: 1.15, fit: 'shrink',
  });
  if (slide.note) s.addNotes(slide.note);
  return s;
}

function tableSlide(pptx, plan, num) {
  const s = pptx.addSlide({ masterName: 'KH_CONTENT' });
  contentTitle(s, plan.title || 'جدول');
  // Tables have no right-to-left switch here, so the columns go in reverse: the first one on the right.
  const head = [...plan.columns].reverse().map((c) => ({ text: c, options: { bold: true, color: THEME.white, fill: { color: THEME.primary }, align: 'center', rtlMode: true } }));
  const rows = plan.rows.slice(0, 14).map((r, i) => [...r].reverse().map((c) => ({ text: num(String(c)), options: { align: 'center', rtlMode: true, fill: { color: i % 2 ? 'FFFFFF' : 'FBF7EE' } } })));
  s.addTable([head, ...rows], {
    x: 0.8, y: 1.6, w: W - 1.6, fontFace: THEME.slideFont, fontSize: rows.length > 10 ? 14 : 18, color: THEME.ink, border: { type: 'solid', pt: 0.75, color: THEME.sandDark }, rtlMode: true, autoPage: false,
  });
  return s;
}

/** Draws a laid-out diagram on a slide (inside the content area). */
export function drawDiagram(pptx, s, plan) {
  const { boxes, arrows } = layoutDiagram(plan);
  const area = { x: 0.7, y: 1.55, w: W - 1.6, h: H - 2.2 };
  const X = (v) => area.x + v * area.w;
  const Y = (v) => area.y + v * area.h;
  for (const a of arrows) {
    const x1 = X(a.from.x);
    const y1 = Y(a.from.y);
    const x2 = X(a.to.x);
    const y2 = Y(a.to.y);
    s.addShape(pptx.ShapeType.line, {
      x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(0.01, Math.abs(x2 - x1)), h: Math.max(0.01, Math.abs(y2 - y1)),
      flipH: x2 < x1, flipV: y2 < y1, line: { color: THEME.inkSoft, width: 2.5, endArrowType: 'triangle' },
    });
    if (a.label) s.addText(a.label, { ...RTL, x: (x1 + x2) / 2 - 1, y: (y1 + y2) / 2 - 0.25, w: 2, h: 0.4, fontSize: 12, color: THEME.inkSoft, align: 'center' });
  }
  for (const b of boxes) {
    const fill = COLORS[b.color]?.hex || THEME.primary;
    s.addText(b.text, {
      ...RTL, shape: pptx.ShapeType.roundRect, rectRadius: 0.18,
      x: X(b.x - b.w / 2), y: Y(b.y - b.h / 2), w: b.w * area.w, h: b.h * area.h,
      fill: { color: fill }, color: textOn(fill), fontSize: 20, bold: true, align: 'center', valign: 'middle', fit: 'shrink',
      shadow: { type: 'outer', blur: 4, offset: 2, angle: 90, color: '000000', opacity: 0.18 },
    });
  }
}

/** One simple shape («دايرة حمرا») on a slide, centred, `count` of them in a row. */
export function drawShapes(pptx, s, { shape, color, count = 1, text = '' }) {
  const spec = SHAPES[shape] || SHAPES.circle;
  const fill = COLORS[color]?.hex || THEME.primary;
  const n = Math.max(1, Math.min(12, count));
  const size = Math.min(2.6, (W - 2) / n - 0.3);
  const startX = (W - (n * size + (n - 1) * 0.3)) / 2;
  for (let i = 0; i < n; i += 1) {
    const x = startX + i * (size + 0.3);
    const y = (H - size) / 2 + 0.3;
    const h = spec.square || shape === 'circle' ? size : spec.line ? 0.01 : size * 0.75;
    if (spec.line) {
      s.addShape(pptx.ShapeType.line, { x, y: H / 2, w: size, h: 0.01, line: { color: fill, width: 4 } });
      continue;
    }
    const opts = { shape: pptx.ShapeType[spec.gen] || spec.gen, x, y, w: size, h, fill: { color: fill }, line: { color: fill === 'FFFFFF' ? '999999' : fill } };
    if (text) s.addText(text, { ...opts, ...RTL, color: textOn(fill), fontSize: 20, bold: true, align: 'center', valign: 'middle', fit: 'shrink' });
    else s.addShape(opts.shape, opts);
  }
}

/**
 * @param {object} plan a checked plan
 * @param {{digits?: 'arabic'|'latin', shape?: object}} [opts]
 * @returns {Promise<Buffer>}
 */
export async function buildPptx(plan, { digits = 'arabic', shape = null } = {}) {
  const num = (t) => (digits === 'arabic' ? toArabicDigitsAll(t) : String(t));
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.rtlMode = true;
  pptx.author = 'خلفون';
  pptx.title = plan?.title || 'خلفون';
  pptx.theme = { headFontFace: THEME.slideFont, bodyFontFace: THEME.slideFont, lang: 'ar-OM' };
  master(pptx);
  if (shape) {
    const s = pptx.addSlide({ masterName: 'KH_CONTENT' });
    drawShapes(pptx, s, shape);
  } else if (plan.kind === 'slides') {
    titleSlide(pptx, plan.title, plan.subtitle);
    for (const sl of plan.slides) bulletsSlide(pptx, sl, num);
  } else if (plan.kind === 'diagram') {
    const s = pptx.addSlide({ masterName: 'KH_CONTENT' });
    contentTitle(s, plan.title || 'رسم توضيحي');
    drawDiagram(pptx, s, plan);
  } else if (plan.kind === 'table') {
    tableSlide(pptx, plan, num);
  } else {
    // Text, stories, worksheets...: a title slide and one slide per block.
    titleSlide(pptx, plan.title || 'خلفون', '');
    let current = null;
    for (const b of plan.blocks) {
      if (b.type === 'heading') {
        if (current?.bullets.length) bulletsSlide(pptx, current, num);
        current = { title: b.text, bullets: [] };
        continue;
      }
      const lines = b.type === 'paragraph' || b.type === 'moral' ? [b.text] : b.type === 'questions' ? b.items.map((q) => q.q) : b.items;
      if (!current) current = { title: plan.title || '', bullets: [] };
      current.bullets.push(...lines);
      if (current.bullets.length >= 5 || b.type === 'paragraph') { bulletsSlide(pptx, current, num); current = null; }
    }
    if (current && current.bullets.length) bulletsSlide(pptx, current, num);
  }
  return pptx.write({ outputType: 'nodebuffer' });
}
