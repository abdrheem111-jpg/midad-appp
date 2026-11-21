// A printable page (HTML) from a checked plan, for «... في PDF»: Electron prints it to a PDF,
// so Arabic shaping, right-to-left and fonts are exactly as in the app. Diagrams are drawn as SVG.

import { layoutDiagram, COLORS, textOn } from '../../core/office-plan.js';
import { toArabicDigitsAll } from '../../core/office-math.js';
import { THEME, arabicDate } from './theme.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];

function diagramSvg(plan) {
  const { boxes, arrows } = layoutDiagram(plan);
  const W = 1000;
  const H = 600;
  const parts = [`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="diagram"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#${THEME.inkSoft}"/></marker></defs>`];
  for (const a of arrows) parts.push(`<line x1="${a.from.x * W}" y1="${a.from.y * H}" x2="${a.to.x * W}" y2="${a.to.y * H}" stroke="#${THEME.inkSoft}" stroke-width="3" marker-end="url(#ah)"/>`);
  for (const b of boxes) {
    const fill = COLORS[b.color]?.hex || THEME.primary;
    parts.push(`<rect x="${(b.x - b.w / 2) * W}" y="${(b.y - b.h / 2) * H}" width="${b.w * W}" height="${b.h * H}" rx="16" fill="#${fill}"/>`);
    parts.push(`<text x="${b.x * W}" y="${b.y * H}" fill="#${textOn(fill)}" font-size="26" font-weight="700" text-anchor="middle" dominant-baseline="central">${esc(b.text)}</text>`);
  }
  parts.push('</svg>');
  return parts.join('');
}

/**
 * @param {object} plan a checked plan
 * @param {{fontCss?: string, digits?: 'arabic'|'latin', now?: Date}} [opts]
 */
export function planHtml(plan, { fontCss = '', digits = 'arabic', now = new Date() } = {}) {
  const num = (n) => (digits === 'arabic' ? toArabicDigitsAll(n) : String(n));
  const body = [];
  const sheet = plan.kind === 'worksheet' || plan.kind === 'quiz';
  if (plan.title) body.push(`<h1>${esc(plan.title)}</h1>`);
  if (sheet) body.push('<div class="who"><span>الاسم: ..............................</span><span>الصف: ............</span><span>التاريخ: ............</span></div>');
  else if (plan.title) body.push(`<div class="date">${esc(arabicDate(now))}</div>`);
  body.push('<hr>');
  const answers = [];
  if (plan.kind === 'slides') {
    plan.slides.forEach((s, i) => body.push(`<h2>${num(i + 1)}. ${esc(s.title)}</h2><ul>${s.bullets.map((b) => `<li>${esc(num(b))}</li>`).join('')}</ul>`));
  } else if (plan.kind === 'table') {
    body.push(`<table><thead><tr>${plan.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${plan.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(num(String(c)))}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
  } else if (plan.kind === 'diagram') {
    body.push(diagramSvg(plan));
  } else {
    for (const b of plan.blocks) {
      if (b.type === 'heading') body.push(`<h2>${esc(b.text)}</h2>`);
      else if (b.type === 'paragraph') body.push(`<p class="${b.soft ? 'soft' : ''}">${esc(b.text)}</p>`);
      else if (b.type === 'bullets') body.push(`<ul>${b.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`);
      else if (b.type === 'numbered') body.push(`<ol>${b.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`);
      else if (b.type === 'moral') body.push(`<div class="moral"><b>العبرة:</b> ${esc(b.text)}</div>`);
      else if (b.type === 'questions') {
        b.items.forEach((q, i) => {
          answers.push(q.answer);
          body.push(`<div class="q"><div class="qt"><b>${num(i + 1)}.</b> ${esc(q.q)}</div>${q.choices.length ? `<div class="choices">${q.choices.map((c, k) => `<span><b>${LETTERS[k] || '-'})</b> ${esc(c)}</span>`).join('')}</div>` : Array.from({ length: Math.max(1, q.lines || 1) }, () => '<div class="line"></div>').join('')}</div>`);
        });
      }
    }
    if (answers.some(Boolean)) body.push(`<section class="key"><h2>مفتاح الإجابة (للمعلم)</h2><ol>${answers.map((a) => `<li>${esc(a || '—')}</li>`).join('')}</ol></section>`);
  }
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(plan.title || 'خلفون')}</title><style>
${fontCss}
@page { size: A4; margin: 18mm 16mm; }
body { font-family: 'Tajawal', 'Segoe UI', Tahoma, sans-serif; color: #${THEME.ink}; font-size: 15pt; line-height: 1.9; }
h1 { text-align: center; color: #${THEME.primary}; font-size: 26pt; margin: 0 0 4px; }
.date { text-align: center; color: #${THEME.inkSoft}; font-size: 11pt; }
.who { display: flex; justify-content: space-between; color: #${THEME.inkSoft}; font-size: 12pt; }
hr { border: 0; border-top: 2.5px solid #${THEME.accent}; margin: 10px 0 18px; }
h2 { color: #${THEME.primary}; font-size: 17pt; margin: 18px 0 6px; break-after: avoid; }
p { margin: 0 0 10px; text-align: justify; } p.soft { color: #${THEME.inkSoft}; }
ul { list-style: none; padding-inline-start: 18px; } ul li::before { content: '◆'; color: #${THEME.accent}; margin-inline-end: 8px; font-size: 10pt; }
ol { padding-inline-start: 26px; } body.arabic ol { list-style-type: arabic-indic; } ol li::marker { color: #${THEME.primary}; font-weight: 700; }
.q { margin: 12px 0; break-inside: avoid; } .qt b { color: #${THEME.primary}; }
.choices { display: flex; flex-wrap: wrap; gap: 8px 36px; margin: 4px 22px 0 0; } .choices b { color: #${THEME.accent}; }
.line { border-bottom: 1.5px dotted #B8A88F; height: 26px; margin: 0 22px 0 0; }
.moral { background: #${THEME.sand}; border-inline-start: 6px solid #${THEME.green}; padding: 10px 14px; border-radius: 8px; margin-top: 16px; }
table { width: 100%; border-collapse: collapse; } th { background: #${THEME.primary}; color: #fff; } th, td { border: 1px solid #${THEME.sandDark}; padding: 6px 8px; text-align: center; } tr:nth-child(even) td { background: #FBF7EE; }
.diagram { width: 100%; height: auto; margin-top: 20px; }
.key { break-before: page; } .key h2 { color: #${THEME.accent}; }
</style></head><body class="${digits === 'arabic' ? 'arabic' : 'latin'}">${body.join('\n')}</body></html>`;
}
