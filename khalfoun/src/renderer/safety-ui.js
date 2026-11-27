// What the teacher sees of Khalfoun's safety rules:
//   • the yellow countdown — «بسكّر وورد… ٣» with a cancel button, before an action that can annoy;
//   • the click marker — a ring where Claude is about to click, just before it does;
//   • the emergency banner — everything stopped until Ctrl+Alt+End (or the phone) lets go.

const el = (tag, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const ar = (n) => Number(n).toLocaleString('ar-EG');

export class SafetyUi {
  /** @param {{answer: (id: string, ok: boolean) => void, onInteractive?: (on: boolean) => void, note?: Function}} d */
  constructor(parent, d) {
    this.parent = parent;
    this.d = d;
    this.pending = null; // { id, chip, timer }
    this.banner = null;
  }

  get counting() { return Boolean(this.pending); }

  /** The yellow countdown. Goes ahead by itself after `seconds` unless cancelled. */
  soft({ id, text, seconds = 3 }) {
    this.finish(true); // a newer one replaces an older one (which goes ahead)
    const chip = el('div', 'soft-chip fx-ui');
    const label = el('span', 'soft-text', text);
    const count = el('b', 'soft-count', ar(seconds));
    const cancel = el('button', 'soft-cancel', '✕ إلغاء');
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.cancel());
    chip.append(label, count, cancel);
    this.parent.append(chip);
    this.d.onInteractive?.(true);
    let left = seconds;
    const timer = setInterval(() => {
      left -= 1;
      if (left > 0) count.textContent = ar(left);
      else this.finish(true);
    }, 1000);
    this.pending = { id, chip, timer };
  }

  /** «لا / الغ / وقف» or the button. */
  cancel() { return this.finish(false); }

  finish(ok) {
    const p = this.pending;
    if (!p) return false;
    this.pending = null;
    clearInterval(p.timer);
    p.chip.classList.add(ok ? 'went' : 'cancelled');
    setTimeout(() => p.chip.remove(), ok ? 150 : 900);
    if (!ok) p.chip.querySelector('.soft-text').textContent = 'انلغى ✋';
    this.d.answer(p.id, ok);
    this.d.note?.(`yellow ${p.id} → ${ok ? 'ahead' : 'cancelled'}`);
    this.d.onInteractive?.(false);
    return true;
  }

  /** A ring where the click is about to land (screen coordinates of the overlay). */
  marker(x, y) {
    const m = el('div', 'click-marker');
    m.style.left = `${x}px`; m.style.top = `${y}px`;
    this.parent.append(m);
    setTimeout(() => m.remove(), 900);
  }

  /** The emergency stop. */
  halt(on) {
    if (on && !this.banner) {
      this.banner = el('div', 'halt-banner fx-ui');
      this.banner.append(el('b', '', '⛔ خلفون موقوف'), el('span', '', ' لا يسمع ولا يلمس شي. للرجوع: Ctrl+Alt+End أو زر الطوارئ في الجوال.'));
      this.parent.append(this.banner);
    } else if (!on && this.banner) {
      this.banner.remove();
      this.banner = null;
    }
  }
}
