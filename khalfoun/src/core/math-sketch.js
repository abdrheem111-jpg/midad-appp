// What the Claude mind can draw on the screen for a maths lesson, checked and cleaned before it
// reaches the page: points, segments, arrows, circles, polygons, angles, stacked fractions,
// coordinate axes, number lines, curves, ✓ and ✗. And the small conversion that makes typed
// maths look like maths (x^2 → x², sqrt → √, * → ×, >= → ≥ …).

export const SKETCH_TYPES = ['point', 'line', 'circle', 'rect', 'polygon', 'angle', 'text', 'fraction', 'axes', 'numberline', 'curve', 'check', 'cross'];

const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻', '+': '⁺', n: 'ⁿ', x: 'ˣ', '٢': '²', '٣': '³' };
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };

/** «x^2 + sqrt(9) * 3 >= pi» → «x² + √(9) × 3 ≥ π» (also Arabic letters and digits). */
export function mathText(text) {
  let t = String(text || '');
  t = t.replace(/\^\(([0-9n+-]{1,4})\)/g, (_, e) => [...e].map((c) => SUP[c] || c).join(''));
  t = t.replace(/\^([0-9٢٣n+-]{1,3})/g, (_, e) => [...e].map((c) => SUP[c] || c).join(''));
  t = t.replace(/_([0-9]{1,2})/g, (_, e) => [...e].map((c) => SUB[c] || c).join(''));
  t = t.replace(/sqrt\s*/gi, '√').replace(/\bpi\b/gi, 'π').replace(/\binfinity\b|\binf\b/gi, '∞');
  t = t.replace(/>=/g, '≥').replace(/<=/g, '≤').replace(/!=/g, '≠').replace(/\+-/g, '±').replace(/->/g, '→');
  t = t.replace(/(\S)\s*\*\s*(\S)/g, '$1 × $2');
  t = t.replace(/\bdeg\b|°?degrees?/gi, '°');
  return t;
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v, n = 80) => (typeof v === 'string' ? v.slice(0, n) : v === undefined || v === null ? '' : String(v).slice(0, n));

/**
 * Cleans the items Claude asked to draw and maps every coordinate with `pt` (picture → overlay)
 * and every length with `len`. Unknown or broken items are dropped.
 * @param {object[]} items
 * @param {{pt: (x: number, y: number) => {x: number, y: number}, len: (v: number) => number}} map
 */
export function cleanSketch(items, map) {
  const out = [];
  for (const it of (Array.isArray(items) ? items : []).slice(0, 60)) {
    if (!it || !SKETCH_TYPES.includes(it.type)) continue;
    const P = (x, y) => (num(x) === null || num(y) === null ? null : map.pt(num(x), num(y)));
    const base = { type: it.type, color: str(it.color, 12) || null, dashed: Boolean(it.dashed), width: num(it.width) ? Math.max(1, Math.min(12, num(it.width))) : null };
    switch (it.type) {
      case 'point': case 'check': case 'cross': {
        const p = P(it.x, it.y);
        if (!p) continue;
        out.push({ ...base, ...p, label: mathText(str(it.label, 20)), size: map.len(num(it.size) || (it.type === 'point' ? 8 : 40)) });
        break;
      }
      case 'line': {
        const a = P(it.x1, it.y1); const b = P(it.x2, it.y2);
        if (!a || !b) continue;
        out.push({ ...base, x1: a.x, y1: a.y, x2: b.x, y2: b.y, arrow: ['end', 'both', 'start'].includes(it.arrow) ? it.arrow : 'none', label: mathText(str(it.label, 20)) });
        break;
      }
      case 'circle': {
        const c = P(it.x, it.y);
        if (!c || !(num(it.r) > 0)) continue;
        out.push({ ...base, ...c, r: map.len(num(it.r)), label: mathText(str(it.label, 20)) });
        break;
      }
      case 'rect': {
        const a = P(it.x, it.y);
        if (!a || !(num(it.w) > 0) || !(num(it.h) > 0)) continue;
        out.push({ ...base, ...a, w: map.len(num(it.w)), h: map.len(num(it.h)) });
        break;
      }
      case 'polygon': case 'curve': {
        const pts = (Array.isArray(it.points) ? it.points : []).slice(0, 200).map((p) => (Array.isArray(p) ? P(p[0], p[1]) : P(p?.x, p?.y))).filter(Boolean);
        if (pts.length < 2) continue;
        const labels = Array.isArray(it.labels) ? it.labels.slice(0, pts.length).map((l) => mathText(str(l, 12))) : [];
        out.push({ ...base, points: pts, closed: it.type === 'polygon' && it.closed !== false, labels });
        break;
      }
      case 'angle': {
        const v = P(it.x, it.y);
        if (!v || num(it.from) === null || num(it.to) === null) continue;
        out.push({ ...base, ...v, from: num(it.from), to: num(it.to), r: map.len(num(it.r) || 30), right: Boolean(it.right), label: mathText(str(it.label, 12)) });
        break;
      }
      case 'text': {
        const p = P(it.x, it.y);
        if (!p || !str(it.text)) continue;
        out.push({ ...base, ...p, text: mathText(str(it.text, 120)), size: map.len(num(it.size) || 34) });
        break;
      }
      case 'fraction': {
        const p = P(it.x, it.y);
        if (!p || str(it.top) === '' || str(it.bottom) === '') continue;
        out.push({ ...base, ...p, top: mathText(str(it.top, 20)), bottom: mathText(str(it.bottom, 20)), size: map.len(num(it.size) || 34) });
        break;
      }
      case 'axes': {
        const o = P(it.x, it.y);
        if (!o) continue;
        out.push({ ...base, ...o, left: map.len(num(it.left) ?? 200), right: map.len(num(it.right) ?? 200), up: map.len(num(it.up) ?? 160), down: map.len(num(it.down) ?? 160), step: map.len(Math.max(8, num(it.step) || 40)), labels: it.labels !== false });
        break;
      }
      case 'numberline': {
        const a = P(it.x1, it.y); const b = P(it.x2, it.y);
        const from = num(it.from); const to = num(it.to);
        if (!a || !b || from === null || to === null || to <= from) continue;
        const step = num(it.step) > 0 ? num(it.step) : 1;
        if ((to - from) / step > 60) continue;
        out.push({ ...base, x1: a.x, y: a.y, x2: b.x, from, to, step, marks: (Array.isArray(it.marks) ? it.marks : []).map(num).filter((m) => m !== null).slice(0, 10) });
        break;
      }
      default: break;
    }
  }
  return out;
}
