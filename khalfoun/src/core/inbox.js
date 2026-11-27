// The teacher's private inbox on his phone: Khalfoun's suggestions, a grading waiting for his
// approval, a quiz to show. Nothing here appears on the class screen until he chooses.

const MAX = 30;
const TTL = 3 * 60 * 60 * 1000;
const KINDS = new Set(['suggest', 'grade', 'quiz', 'note', 'routine']);

export class Inbox {
  constructor(now = () => Date.now()) { this.items = []; this.now = now; this.seq = 0; }

  /** @param {{kind: string, title: string, body?: string, actions?: {id: string, label: string, main?: boolean}[], data?: any}} it */
  add(it) {
    if (!it || !KINDS.has(it.kind) || !String(it.title || '').trim()) return null;
    this.seq += 1;
    const item = {
      id: `${it.kind}-${this.now().toString(36)}-${this.seq}`,
      kind: it.kind, title: String(it.title).slice(0, 120), body: String(it.body || '').slice(0, 1500),
      actions: (Array.isArray(it.actions) ? it.actions : []).filter((a) => /^[a-z_]{1,20}$/.test(a?.id || '') && a.label).slice(0, 3).map((a) => ({ id: a.id, label: String(a.label).slice(0, 30), main: Boolean(a.main) })),
      data: it.data ?? null, at: this.now(), status: 'new',
    };
    if (!item.actions.length) item.actions = [{ id: 'dismiss', label: 'تمام' }];
    this.items.push(item);
    this.prune();
    return item;
  }

  prune() {
    const t = this.now();
    this.items = this.items.filter((i) => t - i.at < TTL).slice(-MAX);
  }

  /** What the phone shows (no private data beyond the text). */
  list() { this.prune(); return this.items.map(({ data, ...rest }) => rest); }

  /** The teacher pressed a button: the item (with its data) for the page to act on, or null. */
  act(id, action) {
    const it = this.items.find((i) => i.id === id && i.status === 'new');
    if (!it || !it.actions.some((a) => a.id === action)) return null;
    it.status = 'done';
    it.answer = action;
    return it;
  }
}
