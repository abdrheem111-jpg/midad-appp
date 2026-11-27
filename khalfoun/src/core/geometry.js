// Geometry figures drawn to scale from what the teacher gives («مثلث أضلاعه ٣ و٤ و٥»، «مثلث فيه
// ضلعين ٥ و٧ والزاوية بينهم ٦٠°»، «دائرة نصف قطرها ٤»). The measures (the missing sides and
// angles, the area, the perimeter) are computed here exactly, never guessed, and the figure is
// laid out as sketch items in look_screen picture pixels.

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const r2 = (v) => Math.round(v * 100) / 100;

/**
 * Solves a triangle from: three sides (SSS), two sides and the angle between (SAS), or two angles
 * and the side between (ASA). Sides a b c are opposite angles A B C (degrees).
 * @returns {{ok: true, a: number, b: number, c: number, A: number, B: number, C: number, area: number, perimeter: number, right: string|null}|{ok: false, error: string}}
 */
export function solveTriangle(g) {
  let { a, b, c, A, B, C } = Object.fromEntries(Object.entries(g || {}).map(([k, v]) => [k, Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined]));
  const sides = [a, b, c].filter(Boolean).length; const angles = [A, B, C].filter(Boolean).length;
  if (angles === 2) { const sum = (A || 0) + (B || 0) + (C || 0); if (sum >= 180) return { ok: false, error: 'مجموع الزاويتين لازم أقل من ١٨٠°' }; A ??= 180 - sum; B ??= 180 - sum; C ??= 180 - sum; }
  if (sides === 3) {
    if (a + b <= c || a + c <= b || b + c <= a) return { ok: false, error: 'هالأطوال ما تكوّن مثلث (مجموع أي ضلعين لازم أكبر من الثالث)' };
    A = deg(Math.acos((b * b + c * c - a * a) / (2 * b * c)));
    B = deg(Math.acos((a * a + c * c - b * b) / (2 * a * c)));
    C = 180 - A - B;
  } else if (sides === 2 && angles >= 1) {
    // SAS: the known angle must be between the two known sides
    if (!a && A) a = Math.sqrt(b * b + c * c - 2 * b * c * Math.cos(rad(A)));
    else if (!b && B) b = Math.sqrt(a * a + c * c - 2 * a * c * Math.cos(rad(B)));
    else if (!c && C) c = Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(rad(C)));
    else return { ok: false, error: 'أحتاج الزاوية اللي بين الضلعين' };
    return solveTriangle({ a, b, c });
  } else if (sides === 1 && A && B && C) {
    const k = (a || 0) / Math.sin(rad(A)) || (b || 0) / Math.sin(rad(B)) || (c || 0) / Math.sin(rad(C));
    a = k * Math.sin(rad(A)); b = k * Math.sin(rad(B)); c = k * Math.sin(rad(C));
  } else {
    return { ok: false, error: 'أحتاج: ثلاث أضلاع، أو ضلعين والزاوية بينهم، أو زاويتين وضلع' };
  }
  const s = (a + b + c) / 2;
  const area = Math.sqrt(Math.max(0, s * (s - a) * (s - b) * (s - c)));
  const right = Math.abs(A - 90) < 0.01 ? 'A' : Math.abs(B - 90) < 0.01 ? 'B' : Math.abs(C - 90) < 0.01 ? 'C' : null;
  return { ok: true, a: r2(a), b: r2(b), c: r2(c), A: r2(A), B: r2(B), C: r2(C), area: r2(area), perimeter: r2(a + b + c), right };
}

/**
 * The figure as sketch items, fitted into a box (picture pixels).
 * @param {{shape: 'triangle'|'circle'|'rectangle', given: object, labels?: boolean}} q
 * @param {{x: number, y: number, w: number, h: number}} box
 */
export function geometryFigure(q, box) {
  const pad = 60;
  if (q.shape === 'circle') {
    const r = Number(q.given?.r);
    if (!(r > 0)) return { ok: false, error: 'أحتاج نصف القطر' };
    const R = Math.min(box.w, box.h) / 2 - pad;
    const cx = box.x + box.w / 2; const cy = box.y + box.h / 2;
    return {
      ok: true,
      measures: { r, d: r2(2 * r), area: r2(Math.PI * r * r), circumference: r2(2 * Math.PI * r) },
      items: [
        { type: 'circle', x: cx, y: cy, r: R },
        { type: 'point', x: cx, y: cy },
        { type: 'line', x1: cx, y1: cy, x2: cx + R, y2: cy },
        { type: 'text', x: cx + R / 2, y: cy - 22, text: `نق = ${r}`, size: 30 },
      ],
    };
  }
  if (q.shape === 'rectangle') {
    const w = Number(q.given?.w); const h = Number(q.given?.h);
    if (!(w > 0 && h > 0)) return { ok: false, error: 'أحتاج الطول والعرض' };
    const k = Math.min((box.w - 2 * pad) / w, (box.h - 2 * pad) / h);
    const W = w * k; const H = h * k; const x0 = box.x + (box.w - W) / 2; const y0 = box.y + (box.h - H) / 2;
    return {
      ok: true,
      measures: { w, h, area: r2(w * h), perimeter: r2(2 * (w + h)), diagonal: r2(Math.hypot(w, h)) },
      items: [
        { type: 'rect', x: x0, y: y0, w: W, h: H },
        { type: 'text', x: x0 + W / 2, y: y0 + H + 34, text: String(w), size: 30 },
        { type: 'text', x: x0 - 34, y: y0 + H / 2, text: String(h), size: 30 },
      ],
    };
  }
  const t = solveTriangle(q.given);
  if (!t.ok) return t;
  // vertices: B at the origin, C on the base, A above (side a = BC is the base)
  const Bp = [0, 0]; const Cp = [t.a, 0];
  const Ap = [t.c * Math.cos(rad(t.B)), -t.c * Math.sin(rad(t.B))];
  const xs = [Bp[0], Cp[0], Ap[0]]; const ys = [Bp[1], Cp[1], Ap[1]];
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const k = Math.min((box.w - 2 * pad) / (maxX - minX || 1), (box.h - 2 * pad) / (maxY - minY || 1));
  const ox = box.x + (box.w - (maxX - minX) * k) / 2 - minX * k; const oy = box.y + (box.h - (maxY - minY) * k) / 2 - minY * k;
  const P = ([x, y]) => [Math.round(ox + x * k), Math.round(oy + y * k)];
  const [A, B, C] = [P(Ap), P(Bp), P(Cp)];
  const mid = (p, q2) => [(p[0] + q2[0]) / 2, (p[1] + q2[1]) / 2];
  const cen = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3];
  const out = (m) => { const dx = m[0] - cen[0]; const dy = m[1] - cen[1]; const l = Math.hypot(dx, dy) || 1; return [m[0] + (dx / l) * 30, m[1] + (dy / l) * 30]; };
  const angAt = (V, P1, P2) => [Math.atan2(-(P1[1] - V[1]), P1[0] - V[0]), Math.atan2(-(P2[1] - V[1]), P2[0] - V[0])].map(deg);
  const items = [{ type: 'polygon', points: [A, B, C], labels: q.labels === false ? [] : ['أ', 'ب', 'ج'] }];
  for (const [p1, p2, v] of [[B, C, t.a], [A, C, t.b], [A, B, t.c]]) { const m = out(mid(p1, p2)); items.push({ type: 'text', x: m[0], y: m[1], text: String(v), size: 26 }); }
  for (const [V, P1, P2, val, name] of [[A, B, C, t.A, 'A'], [B, A, C, t.B, 'B'], [C, A, B, t.C, 'C']]) {
    const [f, to] = angAt(V, P1, P2);
    items.push({ type: 'angle', x: V[0], y: V[1], from: f, to, r: 34, right: t.right === name, label: t.right === name ? '' : `${val}°` });
  }
  return { ok: true, measures: t, items };
}
