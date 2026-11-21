// Word documents (.docx) from a checked plan: right-to-left, Arabic fonts, a coloured title,
// headings, lists, worksheet questions with answer lines, an answer key on its own page for
// the teacher, and tables.

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, Table, TableRow, TableCell, WidthType,
  ShadingType, LevelFormat, PageBreak, Footer, PageNumber, TableLayoutType,
} from 'docx';
import { THEME, arabicDate } from './theme.js';
import { toArabicDigitsAll } from '../../core/office-math.js';

const SIZE = { title: 48, subtitle: 24, h1: 34, body: 30, small: 22 }; // half-points (Sakkal Majalla runs small)

function run(text, opts = {}) {
  return new TextRun({
    text: String(text ?? ''),
    rightToLeft: true,
    font: { ascii: THEME.headFont, hAnsi: THEME.headFont, cs: opts.font || THEME.bodyFontCs, eastAsia: THEME.headFont },
    size: opts.size || SIZE.body,
    sizeComplexScript: opts.size || SIZE.body,
    bold: opts.bold,
    boldComplexScript: opts.bold,
    color: opts.color,
  });
}

function para(children, opts = {}) {
  return new Paragraph({
    bidirectional: true,
    alignment: opts.align || AlignmentType.RIGHT,
    spacing: { after: opts.after ?? 120, before: opts.before ?? 0, line: opts.line ?? 300 },
    ...(opts.heading ? { heading: opts.heading } : {}),
    ...(opts.numbering ? { numbering: opts.numbering } : {}),
    ...(opts.border ? { border: opts.border } : {}),
    ...(opts.shading ? { shading: opts.shading } : {}),
    ...(opts.indent ? { indent: opts.indent } : {}),
    keepNext: opts.keepNext,
    children: Array.isArray(children) ? children : [children],
  });
}

const LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];

function questionParas(items, num) {
  const out = [];
  items.forEach((q, i) => {
    out.push(para([run(`${num(i + 1)}. `, { bold: true, color: THEME.primary }), run(q.q, { bold: true })], { after: 80, before: 160, keepNext: true }));
    if (q.choices.length) {
      // Choices side by side when short, one per line when long.
      const short = q.choices.every((c) => c.length <= 18);
      if (short) {
        out.push(para(q.choices.flatMap((c, k) => [run(`${LETTERS[k] || '-'}) `, { bold: true, color: THEME.accent }), run(c), run(k < q.choices.length - 1 ? '        ' : '')]), { after: 80, indent: { right: 360 } }));
      } else {
        for (const [k, c] of q.choices.entries()) out.push(para([run(`${LETTERS[k] || '-'}) `, { bold: true, color: THEME.accent }), run(c)], { after: 40, indent: { right: 360 } }));
      }
    }
    for (let l = 0; l < (q.choices.length ? 0 : Math.max(1, q.lines || 1)); l += 1) {
      out.push(para(run('.'.repeat(110), { color: 'B8A88F', size: SIZE.small }), { after: 60, indent: { right: 360 } }));
    }
  });
  return out;
}

function tableOf(columns, rows) {
  const cell = (text, head) => new TableCell({
    children: [para(run(text, { bold: head, color: head ? THEME.white : THEME.ink, size: head ? SIZE.body : SIZE.body - 2 }), { align: AlignmentType.CENTER, after: 40 })],
    shading: head ? { type: ShadingType.CLEAR, fill: THEME.primary, color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
  });
  return new Table({
    visuallyRightToLeft: true,
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.AUTOFIT,
    rows: [
      new TableRow({ tableHeader: true, children: columns.map((c) => cell(c, true)) }),
      ...rows.map((r) => new TableRow({ children: r.map((c) => cell(String(c), false)) })),
    ],
  });
}

/**
 * @param {object} plan a checked plan (cleanPlan)
 * @returns {Promise<Buffer>}
 */
export async function buildDocx(plan, { now = new Date(), digits = 'arabic' } = {}) {
  const num = (n) => (digits === 'arabic' ? toArabicDigitsAll(n) : String(n));
  const children = [];
  if (plan.title) {
    children.push(para(run(plan.title, { size: SIZE.title, bold: true, color: THEME.primary, font: THEME.bodyFontCs }), { align: AlignmentType.CENTER, after: 60, heading: HeadingLevel.TITLE }));
  }
  const worksheet = plan.kind === 'worksheet' || plan.kind === 'quiz';
  if (worksheet) {
    children.push(para([run('الاسم: ' + '.'.repeat(40), { size: SIZE.small, color: THEME.inkSoft }), run('        الصف: ' + '.'.repeat(15), { size: SIZE.small, color: THEME.inkSoft }), run('        التاريخ: ' + '.'.repeat(15), { size: SIZE.small, color: THEME.inkSoft })], { align: AlignmentType.CENTER, after: 120 }));
  } else if (plan.title) {
    children.push(para(run(arabicDate(now), { size: SIZE.small, color: THEME.inkSoft }), { align: AlignmentType.CENTER, after: 80 }));
  }
  // A gold rule under the header.
  children.push(para(run(''), { after: 200, border: { bottom: { color: THEME.accent, space: 1, style: BorderStyle.SINGLE, size: 12 } } }));

  if (plan.kind === 'table') {
    children.push(tableOf(plan.columns, plan.rows));
  } else if (plan.kind === 'slides') {
    plan.slides.forEach((s, i) => {
      children.push(para(run(`${num(i + 1)}. ${s.title}`, { size: SIZE.h1, bold: true, color: THEME.primary }), { heading: HeadingLevel.HEADING_1, before: 200, keepNext: true }));
      for (const b of s.bullets) children.push(para(run(b), { numbering: { reference: 'kh-bullets', level: 0 } }));
    });
  } else if (plan.kind === 'diagram') {
    children.push(para(run('العناصر:', { bold: true, color: THEME.primary })));
    for (const n of plan.nodes) children.push(para(run(n.text), { numbering: { reference: 'kh-numbers', level: 0 } }));
  } else {
    let answers = [];
    let numberedRef = 0;
    for (const b of plan.blocks) {
      if (b.type === 'heading') children.push(para(run(b.text, { size: SIZE.h1, bold: true, color: THEME.primary }), { heading: HeadingLevel.HEADING_1, before: 240, keepNext: true }));
      else if (b.type === 'paragraph') children.push(para(run(b.text, b.soft ? { color: THEME.inkSoft } : {}), { after: 160, line: 340 }));
      else if (b.type === 'bullets') for (const it of b.items) children.push(para(run(it), { numbering: { reference: 'kh-bullets', level: 0 } }));
      else if (b.type === 'numbered') {
        numberedRef += 1;
        for (const it of b.items) children.push(para(run(it), { numbering: { reference: 'kh-numbers', level: 0, instance: numberedRef } }));
      } else if (b.type === 'questions') {
        children.push(...questionParas(b.items, num));
        answers = answers.concat(b.items.map((q) => q.answer));
      } else if (b.type === 'moral') {
        children.push(para([run('العبرة: ', { bold: true, color: THEME.green }), run(b.text)], {
          before: 240, shading: { type: ShadingType.CLEAR, fill: THEME.sand, color: 'auto' },
          border: { right: { color: THEME.green, space: 8, style: BorderStyle.SINGLE, size: 24 } },
        }));
      }
    }
    // The answer key, on its own page, for the teacher.
    if (answers.some(Boolean)) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
      children.push(para(run('مفتاح الإجابة (للمعلم)', { size: SIZE.h1, bold: true, color: THEME.accent }), { heading: HeadingLevel.HEADING_1, after: 160 }));
      answers.forEach((a, i) => children.push(para([run(`${num(i + 1)}. `, { bold: true }), run(a || '—')], { after: 60 })));
    }
  }

  const doc = new Document({
    creator: 'خلفون',
    title: plan.title || 'خلفون',
    styles: {
      default: { document: { run: { font: THEME.bodyFontCs, size: SIZE.body, rightToLeft: true }, paragraph: { bidirectional: true } } },
    },
    numbering: {
      config: [
        { reference: 'kh-bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '◆', alignment: AlignmentType.RIGHT, style: { run: { color: THEME.accent }, paragraph: { indent: { right: 540, hanging: 300 } } } }] },
        { reference: 'kh-numbers', levels: [{ level: 0, format: digits === 'arabic' ? LevelFormat.HINDI_NUMBERS : LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.RIGHT, style: { run: { color: THEME.primary, bold: true }, paragraph: { indent: { right: 540, hanging: 340 } } } }] },
      ],
    },
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } }, bidi: true },
      footers: {
        default: new Footer({ children: [para([run('صفحة ', { size: SIZE.small, color: THEME.inkSoft }), new TextRun({ children: [PageNumber.CURRENT], size: SIZE.small, color: THEME.inkSoft, rightToLeft: true })], { align: AlignmentType.CENTER })] }),
      },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}
