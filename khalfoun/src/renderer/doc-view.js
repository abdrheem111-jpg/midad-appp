// «اعرض الدفتر على الشاشة»: a student's notebook photographed with the teacher's phone, shown big
// for the whole class (like a document camera). It sits under Khalfoun's ink, so the teacher's pen
// and Claude's marks can go on top of it.

const el = (tag, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

export class DocView {
  constructor(parent = document.body, { onClose } = {}) {
    this.parent = parent;
    this.root = null;
    this.onClose = onClose;
    this.turn = 0;
  }

  get open() { return Boolean(this.root); }

  show(blob) {
    this.close(false);
    const root = el('section', 'doc-view');
    root.setAttribute('aria-label', 'دفتر الطالب');
    const bar = el('div', 'doc-bar fx-ui');
    bar.append(el('span', '', '📖 دفتر الطالب'));
    const rot = el('button', 'doc-btn', '↻ لف');
    rot.type = 'button';
    rot.addEventListener('click', () => { this.turn = (this.turn + 90) % 360; this.img.style.transform = `rotate(${this.turn}deg)`; });
    const close = el('button', 'doc-btn', '✕ سكّر');
    close.type = 'button';
    close.addEventListener('click', () => this.close());
    bar.append(rot, close);
    this.url = URL.createObjectURL(blob);
    this.img = el('img', 'doc-photo');
    this.img.alt = 'صورة دفتر الطالب';
    this.img.src = this.url;
    this.turn = 0;
    root.append(this.img, bar);
    this.parent.append(root);
    this.root = root;
    return true;
  }

  close(tell = true) {
    if (!this.root) return;
    this.root.remove();
    this.root = null;
    URL.revokeObjectURL(this.url);
    if (tell) this.onClose?.();
  }
}
