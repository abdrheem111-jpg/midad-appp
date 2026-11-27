// A quick quiz from the lesson, shown big for the class: one question at a time, four choices
// (أ ب ج د), the teacher moves on with «كمل» / the remote / his phone, and «الجواب» lights up the
// right one with a little celebration.

const el = (tag, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const ar = (n) => Number(n).toLocaleString('ar-EG');
const LETTERS = ['أ', 'ب', 'ج', 'د'];

export class QuizBoard {
  /** @param {{celebrate?: Function, say?: Function, onOpen?: Function, onClose?: Function, write?: (t: string) => string}} d */
  constructor(parent, d = {}) { this.parent = parent; this.d = d; this.root = null; this.qs = []; this.i = 0; this.revealed = false; }

  get open() { return Boolean(this.root); }

  /** @param {{title?: string, questions: {q: string, choices: string[], answer: number}[]}} quiz */
  show(quiz) {
    const qs = (quiz?.questions || []).filter((q) => q && q.q && Array.isArray(q.choices) && q.choices.length >= 2 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.choices.length).slice(0, 20);
    if (!qs.length) return false;
    this.close();
    this.qs = qs.map((q) => ({ q: String(q.q).slice(0, 300), choices: q.choices.slice(0, 4).map((c) => String(c).slice(0, 120)), answer: q.answer }));
    this.title = String(quiz.title || 'مسابقة').slice(0, 60);
    this.root = el('section', 'quiz-board fx-ui');
    this.parent.append(this.root);
    this.i = 0;
    this.d.onOpen?.();
    this.render();
    return true;
  }

  render() {
    const q = this.qs[this.i];
    const w = this.d.write || ((t) => t);
    this.root.textContent = '';
    const head = el('div', 'qb-head');
    head.append(el('b', '', this.title), el('span', 'qb-count', `سؤال ${ar(this.i + 1)} من ${ar(this.qs.length)}`));
    const close = el('button', 'qb-close', '✕'); close.type = 'button'; close.addEventListener('click', () => this.close());
    head.append(close);
    const body = el('div', 'qb-q', w(q.q));
    const grid = el('div', 'qb-grid');
    q.choices.forEach((c, k) => {
      const tile = el('button', 'qb-choice'); tile.type = 'button';
      tile.append(el('i', '', LETTERS[k]), el('span', '', w(c)));
      if (this.revealed) tile.classList.add(k === q.answer ? 'right' : 'dim');
      tile.addEventListener('click', () => this.reveal());
      grid.append(tile);
    });
    const bar = el('div', 'qb-bar');
    const back = el('button', '', '◀ السابق'); back.type = 'button'; back.addEventListener('click', () => this.back());
    const ans = el('button', 'go', 'الجواب'); ans.type = 'button'; ans.addEventListener('click', () => this.reveal());
    const next = el('button', '', 'التالي ▶'); next.type = 'button'; next.addEventListener('click', () => this.next());
    bar.append(back, ans, next);
    this.root.append(head, body, grid, bar);
  }

  reveal() {
    if (!this.open || this.revealed) return;
    this.revealed = true;
    this.render();
    this.d.celebrate?.();
    const q = this.qs[this.i];
    this.d.say?.(`الجواب ${LETTERS[q.answer]}: ${q.choices[q.answer]}`);
  }

  next() {
    if (!this.open) return false;
    if (!this.revealed) { this.reveal(); return true; }
    if (this.i >= this.qs.length - 1) { this.d.say?.('خلصت المسابقة 👏'); this.close(); return true; }
    this.i += 1; this.revealed = false; this.render();
    return true;
  }

  back() {
    if (!this.open || this.i === 0) return false;
    this.i -= 1; this.revealed = false; this.render();
    return true;
  }

  close() {
    if (!this.root) return;
    this.root.remove(); this.root = null;
    this.d.onClose?.();
  }
}
