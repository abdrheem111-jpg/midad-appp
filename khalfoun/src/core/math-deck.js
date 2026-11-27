// A verified solution (from the maths engine) laid out as steps on the screen: one line per step,
// the reason under it in «اشرح لي» mode, and a number line for an inequality. Coordinates are in
// look_screen picture pixels (the tools map them to the overlay).

/**
 * @param {{answer: string, steps: {expr: string, why?: string}[], line?: {at: number, dir: string, closed: boolean}, check?: string}} r
 * @param {{show?: 'steps'|'answer', explain?: boolean, size: {width: number, height: number}}} o
 * @returns {{items: object[], say: string}[]}
 */
export function mathDeck(r, o) {
  const W = o.size?.width || 1568; const H = o.size?.height || 882;
  const x = Math.round(W * 0.5);
  const rows = o.show === 'answer' ? [{ expr: r.answer, why: '' }] : (r.steps || []).slice(0, 14);
  const gap = o.explain ? 1.6 : 1;
  const extra = r.line ? 2 : 0;
  const line = Math.max(46, Math.min(82, Math.floor((H * 0.74) / Math.max(1, rows.length * gap + extra))));
  const size = Math.max(28, Math.min(44, Math.round(line * 0.62)));
  let y = Math.round(H * 0.14);
  const deck = rows.map((st, i) => {
    const items = [{ type: 'text', x, y, text: st.expr, size }];
    if (o.explain && st.why) items.push({ type: 'text', x, y: y + Math.round(size * 0.95), text: `(${st.why})`, size: Math.round(size * 0.55), color: '#6b7280' });
    y += Math.round(line * gap);
    const last = i === rows.length - 1;
    const say = o.show === 'answer' ? r.answer : (st.why && st.why !== 'المسألة' ? `${st.why}${last && r.answer ? `. ${r.answer}` : ''}` : (i === 0 ? 'هذي المسألة' : ''));
    return { items, say };
  });
  if (r.line && o.show !== 'answer' && deck.length) {
    const at = Number(r.line.at);
    const from = Math.floor(at) - 5; const to = Math.ceil(at) + 5;
    deck.push({
      items: [{ type: 'numberline', x1: Math.round(W * 0.22), x2: Math.round(W * 0.78), y: y + 30, from, to, step: 1, ray: { at, dir: r.line.dir, closed: r.line.closed } }],
      say: r.line.closed ? 'على خط الأعداد: النقطة مليانة لأنها داخلة في الحل' : 'على خط الأعداد: النقطة فاضية لأنها مو داخلة في الحل',
    });
  }
  return deck;
}
