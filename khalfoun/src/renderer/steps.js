// A solution shown step by step: Claude prepares all the steps (each a drawing on the screen and
// a short sentence), and the teacher moves on or back when he wants, from the remote, the phone
// or by saying «كمل» / «ارجع», while he explains and walks around the class.

const ar = (n) => n.toLocaleString('ar-EG');

export class StepsDeck {
  /**
   * @param {{ink: object, say?: (t: string) => void, onChange?: (s: {active: boolean, step: number, steps: number}) => void}} deps
   */
  constructor(deps, parent = document.body) {
    this.d = deps;
    this.steps = [];
    this.items = [];
    this.index = 0;
    this.title = '';
    this.chip = document.createElement('div');
    this.chip.className = 'steps-chip';
    this.chip.hidden = true;
    parent.append(this.chip);
  }

  get active() { return this.steps.length > 0; }

  /** @param {{title?: string, color?: string, steps: {shapes: object[], say?: string}[]}} deck */
  start(deck) {
    this.end(false);
    this.steps = (deck.steps || []).filter((s) => (s.shapes && s.shapes.length) || s.say).slice(0, 30);
    this.color = deck.color || 'blue';
    this.title = String(deck.title || '');
    this.items = [];
    this.index = 0;
    if (!this.steps.length) return false;
    this.next();
    return true;
  }

  next() {
    if (!this.active) return false;
    if (this.index >= this.steps.length) { this.d.say?.('خلصت الخطوات. 👏'); this.render(); return false; }
    const step = this.steps[this.index];
    this.items[this.index] = step.shapes?.length ? this.d.ink.sketch(step.shapes, { color: step.color || this.color }) : null;
    this.index += 1;
    if (step.say) this.d.say?.(step.say);
    this.render();
    return true;
  }

  back() {
    if (!this.active || this.index <= 1) { this.d.say?.('هذي أول خطوة.'); return false; }
    this.index -= 1;
    const item = this.items[this.index];
    if (item) {
      this.d.ink.items = this.d.ink.items.filter((x) => x !== item);
      this.d.ink.redraw();
    }
    this.items[this.index] = null;
    this.d.say?.(`رجعنا للخطوة ${ar(this.index)}.`);
    this.render();
    return true;
  }

  /** The steps are over (the drawings stay until the screen is cleared). */
  end(tell = true) {
    const was = this.active;
    this.steps = [];
    this.items = [];
    this.index = 0;
    this.render();
    if (was && tell) this.d.onChange?.(this.state());
  }

  state() { return { active: this.active, step: this.index, steps: this.steps.length }; }

  render() {
    this.chip.hidden = !this.active;
    if (this.active) {
      const done = this.index >= this.steps.length;
      this.chip.textContent = `${this.title ? `${this.title} · ` : ''}الخطوة ${ar(this.index)} من ${ar(this.steps.length)}${done ? ' ✓' : ' ▶'}`;
    }
    this.d.onChange?.(this.state());
  }
}

/** «كمل» / «الخطوة الجاية» / «ارجع» said while the steps are on (exact, short). */
export function stepWord(normalizedText) {
  const t = String(normalizedText || '').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim().replace(/^يا خلفون /, '');
  if (/^(كمل|كمل الخطوه|كمل الحل|التالي|التاليه|الخطوه الجايه|الخطوه التاليه|اللي بعده|اللي بعدها|بعدها|بعده|الجايه|يلا كمل|واصل)$/.test(t)) return 'next';
  if (/^(ارجع|رجع|ارجع خطوه|الخطوه السابقه|الخطوه اللي قبل|قبلها|اللي قبله|اللي قبلها|السابقه|رجعنا)$/.test(t)) return 'back';
  return null;
}
