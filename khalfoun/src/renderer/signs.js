// Big signs and stamps for the class: «✔ صح» stamped on the screen, «🤫 هدوء», «⏰ خلص الوقت»,
// «٣ ٢ ١ يلا!», a trophy, «💯»… each pops in with its own little sound, stays a moment, and goes.
// And marks on a piece of the screen: a glowing frame, a marker underline, a hand-drawn circle,
// a big arrow, a stamp right on a student's answer.

const el = (tag, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

/** name → [big symbol, words, colour, sound, style] */
export const SIGNS = Object.freeze({
  correct: ['✔', 'صح', '#1e8449', 'ding', 'stamp'],
  wrong: ['✘', 'خطأ', '#c0392b', 'aww', 'stamp'],
  excellent: ['🌟', 'ممتاز!', '#e67e22', 'yay', 'pop'],
  great: ['😍', 'رائع!', '#8e44ad', 'yay', 'pop'],
  well_done: ['👏', 'أحسنت!', '#1D70B8', 'yay', 'pop'],
  genius: ['🧠', 'عبقري!', '#16a085', 'sparkle', 'pop'],
  hundred: ['💯', 'مية من مية', '#c0392b', 'yay', 'pop'],
  fire: ['🔥', 'نار!', '#e74c3c', 'sparkle', 'pop'],
  star: ['⭐', 'نجمة!', '#f1c40f', 'sparkle', 'pop'],
  trophy: ['🏆', 'البطل!', '#d4a017', 'yay', 'rise'],
  medal: ['🥇', 'المركز الأول', '#d4a017', 'yay', 'rise'],
  crown: ['👑', 'ملك الصف!', '#d4a017', 'yay', 'rise'],
  level_up: ['⬆️', 'مستوى جديد!', '#27ae60', 'chime', 'rise'],
  try_again: ['💪', 'حاول مرة ثانية', '#1D70B8', 'boing', 'pop'],
  almost: ['🤏', 'قريب!', '#e67e22', 'hmm', 'pop'],
  oops: ['🙈', 'أوبس!', '#e67e22', 'boing', 'shake'],
  think: ['🤔', 'فكّر شوي…', '#7f8c8d', 'hmm', 'pop'],
  idea: ['💡', 'فكرة!', '#f1c40f', 'chime', 'pop'],
  question: ['❓', 'سؤال!', '#8e44ad', 'chime', 'pop'],
  quiet: ['🤫', 'هدوء', '#34495e', 'whistle', 'pop'],
  attention: ['⚠️', 'انتبهوا!', '#e67e22', 'ding', 'shake'],
  eyes: ['👀', 'ركّزوا هنا', '#1D70B8', 'ding', 'pop'],
  stop: ['✋', 'وقف!', '#c0392b', 'thud', 'stamp'],
  time_up: ['⏰', 'خلص الوقت!', '#c0392b', 'gasp', 'shake'],
  go: ['🚀', 'يلا!', '#27ae60', 'yay', 'rise'],
  next: ['➡️', 'التالي', '#1D70B8', 'pop', 'slide'],
  homework: ['📚', 'الواجب', '#8e44ad', 'chime', 'pop'],
  break_time: ['☕', 'استراحة', '#a0522d', 'chime', 'pop'],
  group_work: ['👥', 'عمل جماعي', '#16a085', 'chime', 'pop'],
  pairs: ['🤝', 'ثنائيات', '#16a085', 'chime', 'pop'],
  hands_up: ['🙋', 'ارفعوا أيديكم', '#1D70B8', 'ding', 'rise'],
  wow: ['😮', 'واو!', '#8e44ad', 'gasp', 'pop'],
  welcome: ['👋', 'هلا والله!', '#1D70B8', 'chime', 'pop'],
  bye: ['👋', 'مع السلامة', '#7f8c8d', 'chime', 'pop'],
  heart: ['❤️', 'نحبكم!', '#e74c3c', 'sparkle', 'pop'],
  drumroll: ['🥁', 'والفائز هو…', '#2c3e50', 'tick', 'shake'],
  countdown: ['', '', '#c0392b', 'tick', 'count'],
});

/** name → Arabic words to find it by voice («حط إشارة ممتاز»). */
export function signFromWords(text) {
  const t = String(text || '');
  for (const [name, v] of Object.entries(SIGNS)) if (v[1] && t.includes(v[1].replace(/[!…]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه'))) return name;
  return null;
}

export const MARKS = ['glow', 'underline', 'circle', 'arrow', 'stamp_correct', 'stamp_wrong', 'box'];

export class Signs {
  /** @param {{sound?: (name: string) => void}} d */
  constructor(parent, d = {}) { this.parent = parent; this.d = d; this.current = null; }

  /**
   * A big sign in the middle of the screen (or at {x,y}).
   * @param {string} name one of SIGNS
   * @param {{text?: string, x?: number, y?: number, seconds?: number}} [o]
   */
  show(name, o = {}) {
    const s = SIGNS[name];
    if (!s) return false;
    const [sym, words, color, sound, style] = s;
    this.current?.remove();
    if (style === 'count') return this.countdown(o);
    const box = el('div', `sign sign-${style}`);
    box.style.setProperty('--c', color);
    if (Number.isFinite(o.x) && Number.isFinite(o.y)) { box.style.left = `${o.x}px`; box.style.top = `${o.y}px`; box.classList.add('at'); }
    box.append(el('div', 'sign-sym', sym), el('div', 'sign-words', o.text || words));
    this.parent.append(box);
    this.current = box;
    this.d.sound?.(sound);
    const ms = Math.max(1, Math.min(8, o.seconds || 2.2)) * 1000;
    setTimeout(() => { box.classList.add('out'); setTimeout(() => box.remove(), 450); if (this.current === box) this.current = null; }, ms);
    return true;
  }

  /** ٣ … ٢ … ١ … يلا! */
  countdown(o = {}) {
    const from = Math.max(1, Math.min(10, o.from || 3));
    let n = from;
    const box = el('div', 'sign sign-count');
    const num = el('div', 'sign-sym');
    box.append(num);
    this.parent.append(box);
    this.current = box;
    const tickOnce = () => {
      if (n === 0) { num.textContent = o.text || 'يلا!'; box.classList.add('go'); this.d.sound?.('yay'); setTimeout(() => { box.classList.add('out'); setTimeout(() => box.remove(), 450); }, 900); return; }
      num.textContent = n.toLocaleString('ar-EG');
      num.classList.remove('beat'); void num.offsetWidth; num.classList.add('beat');
      this.d.sound?.('tick');
      n -= 1;
      setTimeout(tickOnce, 900);
    };
    tickOnce();
    return true;
  }

  /**
   * A mark on a piece of the screen (overlay pixels).
   * @param {string} kind one of MARKS
   * @param {{x: number, y: number, w: number, h: number}} r
   */
  mark(kind, r, { seconds = 4, color = '#f2b705' } = {}) {
    if (!MARKS.includes(kind) || ![r?.x, r?.y, r?.w, r?.h].every(Number.isFinite)) return false;
    const m = el('div', `mark mark-${kind}`);
    Object.assign(m.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    m.style.setProperty('--c', color);
    if (kind === 'circle') {
      m.innerHTML = '<svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M50 4 C82 3 97 26 96 52 C95 80 72 97 48 96 C22 95 3 76 4 49 C5 24 24 6 56 5" /></svg>';
    } else if (kind === 'arrow') {
      m.textContent = '⬅️';
    } else if (kind === 'stamp_correct' || kind === 'stamp_wrong') {
      m.textContent = kind === 'stamp_correct' ? '✔' : '✘';
      m.style.setProperty('--c', kind === 'stamp_correct' ? '#1e8449' : '#c0392b');
      this.d.sound?.(kind === 'stamp_correct' ? 'ding' : 'aww');
    }
    this.parent.append(m);
    setTimeout(() => { m.classList.add('out'); setTimeout(() => m.remove(), 450); }, Math.max(1, Math.min(30, seconds)) * 1000);
    return true;
  }
}
