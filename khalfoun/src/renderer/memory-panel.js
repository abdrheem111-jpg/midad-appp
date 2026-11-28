// The teacher looks through what Khalfoun learned and did — and changes or deletes it:
// his notes (words, likes, corrections), the routines, the dialect dictionary, and the log of
// every action Khalfoun took.

const el = (tag, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const time = (t) => new Date(t).toLocaleString('ar-OM', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
const KIND = { word: 'كلمة', like: 'يحب', fix: 'تصحيح', fact: 'معلومة' };
const TYPE = { open_app: 'فتح برنامج', open_web: 'فتح موقع', open_file: 'فتح ملف', type_text: 'كتابة', mouse_click: 'نقرة', key_combo: 'أزرار', window_op: 'نافذة', close_app: 'إغلاق برنامج', office_put: 'كتابة في أوفيس', save_sheet: 'حفظ جدول', delete_files: 'حذف', reminder: 'تذكير' };

export class MemoryPanel {
  /** @param {{getData: () => object, setData: (patch: object) => void, bridge: any, onOpen?: Function, onClose?: Function}} d */
  constructor(parent, d) { this.parent = parent; this.d = d; this.root = null; }

  get open() { return Boolean(this.root); }

  async show(tab = 'memory') {
    this.close();
    this.root = el('section', 'memory-panel fx-ui');
    const head = el('div', 'mp-head');
    const tabs = [['memory', '🧠 الذاكرة'], ['log', '📜 السجل']];
    for (const [id, label] of tabs) {
      const b = el('button', id === tab ? 'on' : '', label); b.type = 'button';
      b.addEventListener('click', () => this.show(id));
      head.append(b);
    }
    const x = el('button', 'mp-x', '✕'); x.type = 'button'; x.addEventListener('click', () => this.close());
    head.append(x);
    this.body = el('div', 'mp-body');
    this.root.append(head, this.body);
    this.parent.append(this.root);
    this.d.onOpen?.();
    if (tab === 'log') await this.renderLog(); else await this.renderMemory();
  }

  section(title, rows, empty) {
    this.body.append(el('h4', '', title));
    if (!rows.length) { this.body.append(el('p', 'mp-empty', empty)); return; }
    for (const r of rows) this.body.append(r);
  }

  row(text, onDelete, onEdit) {
    const r = el('div', 'mp-row');
    r.append(el('span', '', text));
    if (onEdit) { const e = el('button', '', '✎'); e.type = 'button'; e.title = 'عدّل'; e.addEventListener('click', onEdit); r.append(e); }
    const del = el('button', 'del', '🗑'); del.type = 'button'; del.title = 'احذف';
    del.addEventListener('click', async () => { await onDelete(); r.remove(); });
    r.append(del);
    return r;
  }

  async renderMemory() {
    const data = this.d.getData();
    const l = (await this.d.bridge.mind?.learned?.().catch(() => null)) || {};
    const notes = Array.isArray(l) ? l : l.notes || [];
    const habits = Array.isArray(l) ? [] : l.habits || [];
    this.section('اللي تعلّمه عنك', notes.map((n) => this.row(`${KIND[n.kind] || n.kind}: ${n.text}`, () => this.d.bridge.mind.forget(n.id))), 'ما تعلّم شي بعد.');
    this.section('عاداتك (يسويها على طول)', habits.map((h) => this.row(`«${h.phrase}» (${Number(h.count || 0).toLocaleString('ar-EG')} مرات)`, () => this.d.bridge.mind.forget(h.id))), 'ما فيه عادات بعد.');
    const routines = Object.entries(data.routines || {});
    this.section('الروتينات (قلها باسمها وتتنفذ)', routines.map(([k, r]) => this.row(`«${r.name || k}»: ${(r.steps || []).join(' ← ')}`, () => {
      const all = { ...(this.d.getData().routines || {}) }; delete all[k]; this.d.setData({ routines: all });
    })), 'ما فيه روتينات. قل «سجل روتين ابدأ الحصة» وبعدها الخطوات، وفي الأخير «خلاص الروتين».');
    const pron = Object.entries(data.pronounce || {});
    this.section('نطق الكلمات (صوته)', pron.map(([w, say]) => this.row(`«${w}» ينقال: ${say}`, () => {
      const all = { ...(this.d.getData().pronounce || {}) }; delete all[w]; this.d.setData({ pronounce: all });
    }, () => {
      const v = prompt(`كيف ينقال «${w}»؟ (اكتبه بالتشكيل)`, say);
      if (v && v.trim()) { this.d.setData({ pronounce: { ...(this.d.getData().pronounce || {}), [w]: v.trim().slice(0, 40) } }); this.show('memory'); }
    })), 'فاضي. إذا نطق كلمة غلط قول: «انطق الكلمة كذا: …».');
    const dict = Object.entries(data.dictionary || {});
    this.section('قاموس لهجتك', dict.map(([from, to]) => this.row(`«${from}» يعني «${to}»`, () => {
      const all = { ...(this.d.getData().dictionary || {}) }; delete all[from]; this.d.setData({ dictionary: all });
    }, () => {
      const v = prompt(`«${from}» يعني:`, to);
      if (v && v.trim()) { this.d.setData({ dictionary: { ...(this.d.getData().dictionary || {}), [from]: v.trim().slice(0, 40) } }); this.show('memory'); }
    })), 'فاضي. قل «لما أقول … أقصد …».');
  }

  async renderLog() {
    const list = (await this.d.bridge.actions?.recent?.().catch(() => [])) || [];
    this.section('آخر اللي سواه خلفون', list.map((a) => {
      const r = el('div', `mp-row ${a.ok ? '' : 'bad'}`);
      r.append(el('span', '', `${time(a.at)} — ${TYPE[a.type] || a.type}${a.what ? `: ${a.what}` : ''} ${a.ok ? '✓' : `✗ ${a.error}`}`));
      return r;
    }), 'ما سوّى شي بعد.');
  }

  close() {
    if (!this.root) return;
    this.root.remove(); this.root = null;
    this.d.onClose?.();
  }
}
