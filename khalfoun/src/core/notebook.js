// خلفون's AI notebook: notes, review cards with spaced repetition, and offline helpers
// (a summary and key words without any model). Pure: the window stores the data through
// the main process and asks the local model for the AI parts.

const DAY = 24 * 60 * 60 * 1000;
/** Days until a card in each Leitner box comes back for review. */
export const BOX_DAYS = [0, 1, 3, 7, 14, 30];
const MAX_NOTES = 2000;
const MAX_BODY = 50000;

export function emptyNotebook() {
  return { version: 1, notes: [], cards: [] };
}

let counter = 0;
function newId(now) {
  counter = (counter + 1) % 1000;
  return `${now.toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** Brings stored data (maybe old or damaged) into a safe shape. */
export function cleanNotebook(data) {
  const out = emptyNotebook();
  if (!data || typeof data !== 'object') return out;
  for (const n of Array.isArray(data.notes) ? data.notes.slice(0, MAX_NOTES) : []) {
    if (!n || typeof n.id !== 'string') continue;
    out.notes.push({
      id: n.id.slice(0, 40),
      title: String(n.title || '').slice(0, 200),
      body: String(n.body || '').slice(0, MAX_BODY),
      created: Number(n.created) || 0,
      updated: Number(n.updated) || Number(n.created) || 0,
      ai: n.ai && typeof n.ai === 'object' ? { mode: String(n.ai.mode || ''), text: String(n.ai.text || '').slice(0, 5000) } : null,
    });
  }
  const ids = new Set(out.notes.map((n) => n.id));
  for (const c of Array.isArray(data.cards) ? data.cards.slice(0, 5000) : []) {
    if (!c || typeof c.q !== 'string' || typeof c.a !== 'string' || !ids.has(c.note)) continue;
    out.cards.push({ id: String(c.id || '').slice(0, 40), note: c.note, q: c.q.slice(0, 300), a: c.a.slice(0, 300), box: Math.min(5, Math.max(0, Number(c.box) || 0)), due: Number(c.due) || 0 });
  }
  return out;
}

export class Notebook {
  /** @param {object} [data] @param {() => number} [clock] */
  constructor(data, clock = () => Date.now()) {
    this.data = cleanNotebook(data);
    this.clock = clock;
  }

  /** Newest first. */
  list(query = '') {
    const q = normalizeForSearch(query);
    const notes = [...this.data.notes].sort((a, b) => b.updated - a.updated);
    if (!q) return notes;
    return notes.filter((n) => normalizeForSearch(`${n.title} ${n.body}`).includes(q));
  }

  get(id) { return this.data.notes.find((n) => n.id === id) || null; }

  add({ title = '', body = '' } = {}) {
    const now = this.clock();
    const note = { id: newId(now), title: String(title).slice(0, 200), body: String(body).slice(0, MAX_BODY), created: now, updated: now, ai: null };
    this.data.notes.push(note);
    if (this.data.notes.length > MAX_NOTES) this.data.notes.shift();
    return note;
  }

  update(id, patch) {
    const n = this.get(id);
    if (!n) return null;
    if (patch.title !== undefined) n.title = String(patch.title).slice(0, 200);
    if (patch.body !== undefined) n.body = String(patch.body).slice(0, MAX_BODY);
    if (patch.ai !== undefined) n.ai = patch.ai ? { mode: String(patch.ai.mode), text: String(patch.ai.text).slice(0, 5000) } : null;
    n.updated = this.clock();
    return n;
  }

  remove(id) {
    const before = this.data.notes.length;
    this.data.notes = this.data.notes.filter((n) => n.id !== id);
    this.data.cards = this.data.cards.filter((c) => c.note !== id);
    return this.data.notes.length < before;
  }

  /** Adds review cards for a note (duplicates of an existing question are skipped). */
  addCards(noteId, cards) {
    if (!this.get(noteId)) return 0;
    const have = new Set(this.data.cards.filter((c) => c.note === noteId).map((c) => normalizeForSearch(c.q)));
    let added = 0;
    for (const { q, a } of cards) {
      const key = normalizeForSearch(q);
      if (!key || have.has(key)) continue;
      have.add(key);
      this.data.cards.push({ id: newId(this.clock()), note: noteId, q, a, box: 0, due: 0 });
      added += 1;
    }
    return added;
  }

  /** Cards due now, oldest due first. */
  dueCards(noteId = null) {
    const now = this.clock();
    return this.data.cards.filter((c) => (!noteId || c.note === noteId) && c.due <= now).sort((a, b) => a.due - b.due);
  }

  /** Leitner review: a right answer moves the card up a box, a wrong one back to the first. */
  review(cardId, correct) {
    const c = this.data.cards.find((x) => x.id === cardId);
    if (!c) return null;
    c.box = correct ? Math.min(5, c.box + 1) : 0;
    c.due = this.clock() + BOX_DAYS[c.box] * DAY;
    return c;
  }

  /** Simple numbers Khalfoun can talk about. */
  stats() {
    const now = this.clock();
    return {
      notes: this.data.notes.length,
      cards: this.data.cards.length,
      due: this.data.cards.filter((c) => c.due <= now).length,
      mastered: this.data.cards.filter((c) => c.box >= 4).length,
    };
  }
}

/** A title from the first words of the text when the person did not give one. */
export function autoTitle(body) {
  const line = String(body || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  const words = line.split(/\s+/).slice(0, 6).join(' ');
  return words.length > 50 ? `${words.slice(0, 50)}…` : words || 'ملاحظة جديدة';
}

/** Arabic text for comparisons and search: no diacritics, unified letters. */
export function normalizeForSearch(text) {
  return String(text || '')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Reads review cards from the model's answer. Accepts «س: ... | ج: ...», «سؤال: ...» on
 * one line and «جواب: ...» on the next, and «1. ... — ...».
 * @returns {Array<{q: string, a: string}>}
 */
export function parseCards(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const cards = [];
  const clean = (s) => s.replace(/^[\s\-–—•*\d.)]+/, '').replace(/^(?:س|سؤال|السؤال|ج|جواب|الجواب)\s*[:：]\s*/u, '').trim();
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    const one = /^(?:[\d.)\-•*\s]*)?(?:س|سؤال|السؤال)\s*[:：]\s*(.+?)\s*[|｜]\s*(?:ج|جواب|الجواب)\s*[:：]\s*(.+)$/u.exec(l);
    if (one) { cards.push({ q: one[1].trim(), a: one[2].trim() }); continue; }
    if (/^(?:[\d.)\-•*\s]*)?(?:س|سؤال|السؤال)\s*[:：]/u.test(l) && /^(?:ج|جواب|الجواب)\s*[:：]/u.test(lines[i + 1] || '')) {
      cards.push({ q: clean(l), a: clean(lines[i + 1]) });
      i += 1;
      continue;
    }
    const dash = /^\d+[.)]\s*(.+?[؟?])\s*[—–-]\s*(.+)$/u.exec(l);
    if (dash) cards.push({ q: dash[1].trim(), a: dash[2].trim() });
  }
  return cards.filter((c) => c.q.length >= 3 && c.a.length >= 1).map((c) => ({ q: c.q.slice(0, 300), a: c.a.slice(0, 300) })).slice(0, 20);
}

const STOP = new Set(['في', 'من', 'على', 'الى', 'إلى', 'عن', 'مع', 'هذا', 'هذه', 'هذي', 'ذلك', 'التي', 'الذي', 'التى', 'او', 'أو', 'ثم', 'كان', 'كانت',
  'و', 'ف', 'ب', 'ل', 'لا', 'ما', 'لم', 'لن', 'قد', 'كل', 'بعض', 'هو', 'هي', 'هم', 'انه', 'أنه', 'ان', 'أن', 'إن', 'كما', 'عند', 'حتى', 'بين', 'وهو', 'وهي',
  'يكون', 'تكون', 'اي', 'أي', 'اذا', 'إذا', 'لكن', 'بل', 'به', 'بها', 'له', 'لها', 'فيه', 'فيها', 'منه', 'منها', 'the', 'and', 'of', 'to', 'a', 'is']);

function words(text) {
  return normalizeForSearch(text).split(' ').filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
}

/** The most repeated meaningful words: a quick offline «key words». */
export function keywords(text, count = 6) {
  const freq = new Map();
  for (const w of words(text)) {
    const root = w.replace(/^(ال|وال|بال|لل|فال)/, '');
    if (root.length < 3) continue;
    freq.set(root, (freq.get(root) || 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, count).map(([w]) => w);
}

/**
 * Offline summary without a model: the sentences that carry the most repeated words,
 * kept in their original order.
 */
export function offlineSummary(text, maxSentences = 3) {
  const sentences = String(text || '').split(/(?<=[.!؟?])\s+|\n+/u).map((s) => s.trim()).filter((s) => s.length > 15);
  if (sentences.length <= maxSentences) return sentences;
  const top = new Set(keywords(text, 12));
  const scored = sentences.map((s, i) => {
    const ws = words(s).map((w) => w.replace(/^(ال|وال|بال|لل|فال)/, ''));
    const hits = ws.filter((w) => top.has(w)).length;
    return { s, i, score: hits / Math.sqrt(ws.length + 1) + (i === 0 ? 0.3 : 0) };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, maxSentences).sort((a, b) => a.i - b.i).map((x) => x.s);
}

/** Reading time and size, said the Omani way. */
export function readingInfo(text) {
  const n = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(n / 180));
  return { words: n, minutes };
}
