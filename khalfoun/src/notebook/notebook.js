// The AI notebook window. Notes live in %APPDATA%\Khalfoun\notebook.json through the
// main process; the local model does the summaries, explanations, questions and cards,
// and simple offline helpers step in when no model is installed.
import { Notebook, autoTitle, parseCards, offlineSummary, keywords, readingInfo } from '../core/notebook.js';

const $ = (id) => document.getElementById(id);

// In a plain browser (previews and tests) the notebook keeps its data in the page.
const host = window.notebookHost || {
  _d: null,
  async load() { return { data: this._d || JSON.parse(localStorage.getItem('nb') || 'null'), ai: Boolean(window.__nbAi), kidsMode: false }; },
  async save(d) { this._d = d; try { localStorage.setItem('nb', JSON.stringify(d)); } catch { /* storage full */ } return { ok: true }; },
  async task(mode, text) { return window.__nbAi ? window.__nbAi(mode, text) : { ok: false, error: 'chat_unavailable' }; },
  tell() {},
  openBoard() {},
};

let nb = new Notebook();
let current = null; // id of the open note
let aiAvailable = false;
let saveTimer = null;
let lastResult = null; // {mode, text}

const MODE_TITLE = {
  summarize: 'الملخص', explain: 'الشرح', simplify: 'بلغة أبسط', questions: 'الأسئلة', cards: 'بطاقات المراجعة', solve: 'الحل',
};
const ar = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

function toast(text, ms = 2600) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

function setStatus(text) { $('status').textContent = text; }

function scheduleSave() {
  $('saved').textContent = 'يحفظ…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 600);
}

async function saveNow() {
  clearTimeout(saveTimer);
  const r = await host.save(nb.data);
  $('saved').textContent = r?.ok ? 'محفوظ ✓' : 'ما قدرت أحفظ!';
}

function relTime(t) {
  const d = new Date(t);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `اليوم ${d.toLocaleTimeString('ar-OM', { hour: 'numeric', minute: '2-digit' })}`;
  return d.toLocaleDateString('ar-OM', { day: 'numeric', month: 'long' });
}

function renderList() {
  const list = nb.list($('search').value);
  const ul = $('notes');
  ul.replaceChildren(...list.map((n) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.id = n.id;
    if (n.id === current) b.setAttribute('aria-current', 'true');
    const title = document.createElement('span');
    title.className = 'note-title';
    title.textContent = n.title || autoTitle(n.body);
    const sub = document.createElement('span');
    sub.className = 'note-sub';
    sub.textContent = `${relTime(n.updated)} · ${n.body.replace(/\s+/g, ' ').slice(0, 60) || 'فاضية'}`;
    b.append(title, sub);
    b.addEventListener('click', () => openNote(n.id));
    li.append(b);
    return li;
  }));
  $('empty-list').hidden = list.length > 0;
  const due = nb.dueCards().length;
  $('due-count').hidden = !due;
  $('due-count').textContent = ar(due);
  $('review-all').disabled = !nb.data.cards.length;
}

function renderInfo() {
  const n = nb.get(current);
  if (!n) return;
  const { words, minutes } = readingInfo(n.body);
  const cards = nb.data.cards.filter((c) => c.note === n.id).length;
  $('info').textContent = `${ar(words)} كلمة · قراءة ${ar(minutes)} دقيقة${cards ? ` · ${ar(cards)} بطاقة` : ''}`;
}

function openNote(id) {
  const n = nb.get(id);
  if (!n) return;
  current = id;
  $('welcome').hidden = true;
  $('note').hidden = false;
  $('title').value = n.title;
  $('body').value = n.body;
  $('saved').textContent = '';
  showResult(n.ai);
  renderInfo();
  renderList();
}

function newNote() {
  const n = nb.add({ title: '', body: '' });
  host.tell('note_new');
  openNote(n.id);
  scheduleSave();
  $('body').focus();
}

function showResult(ai) {
  lastResult = ai && ai.text ? ai : null;
  $('result').hidden = !lastResult;
  if (!lastResult) return;
  $('result-title').textContent = MODE_TITLE[ai.mode] || 'خلفون يقول';
  const body = $('result-body');
  if (ai.mode === 'cards') {
    const cards = parseCards(ai.text);
    body.replaceChildren(...(cards.length ? cards : [{ q: ai.text, a: '' }]).map((c) => {
      const s = document.createElement('span');
      s.className = 'card-preview';
      s.textContent = c.a ? `س: ${c.q}\nج: ${c.a}` : c.q;
      return s;
    }));
  } else {
    body.textContent = ai.text;
  }
}

async function runTool(mode, button) {
  const n = nb.get(current);
  if (!n) return;
  const text = `${n.title ? `${n.title}\n` : ''}${n.body}`.trim();
  if (text.length < 15) { toast('اكتب شي أطول شوي عشان أشتغل عليه.'); return; }
  if (!aiAvailable) {
    // No local model: still useful offline.
    if (mode === 'summarize') {
      const lines = offlineSummary(text);
      const keys = keywords(text);
      const result = { mode, text: `${lines.map((l) => `- ${l}`).join('\n')}${keys.length ? `\n\nكلمات مهمة: ${keys.join('، ')}` : ''}` };
      nb.update(n.id, { ai: result });
      showResult(result);
      scheduleSave();
      toast('لخصته بدون عقل خلفون. للملخص الذكي جهّز العقل من إعدادات خلفون.');
      return;
    }
    toast('هذي تحتاج عقل خلفون. افتح إعدادات خلفون ← «جهّز عقل خلفون».', 4200);
    return;
  }
  document.querySelectorAll('.tool').forEach((b) => { b.disabled = true; });
  button.setAttribute('aria-busy', 'true');
  setStatus('خلفون يفكر…');
  try {
    const res = await host.task(mode, text);
    if (!res?.ok || !res.text) {
      toast(res?.error === 'timeout' ? 'عقلي تأخر. جرب مرة ثانية.' : 'ما قدرت هالمرة. جرب مرة ثانية.');
      return;
    }
    const result = { mode, text: res.text };
    nb.update(n.id, { ai: result });
    if (mode === 'cards') {
      const added = nb.addCards(n.id, parseCards(res.text));
      if (added) toast(`سويت ${ar(added)} بطاقة مراجعة. اضغط «راجع البطاقات».`);
    }
    showResult(result);
    renderInfo();
    renderList();
    scheduleSave();
  } finally {
    document.querySelectorAll('.tool').forEach((b) => { b.disabled = false; });
    button.removeAttribute('aria-busy');
    setStatus(aiAvailable ? 'عقل خلفون جاهز، وكل شي على جهازك.' : 'ملاحظاتك تبقى على جهازك.');
  }
}

// ---------------------------------------------------------------- review
let deck = [];
let deckPos = 0;
let flipped = false;
let rightCount = 0;

function startReview() {
  deck = nb.dueCards(current && nb.data.cards.some((c) => c.note === current && c.due <= Date.now()) ? current : null);
  if (!deck.length) deck = [...nb.data.cards].sort((a, b) => a.box - b.box).slice(0, 10);
  if (!deck.length) { toast('ما فيه بطاقات بعد. اضغط «بطاقات مراجعة» في أي ملاحظة.'); return; }
  deckPos = 0;
  rightCount = 0;
  $('review').hidden = false;
  showCard();
}

function showCard() {
  const c = deck[deckPos];
  flipped = false;
  $('flash').classList.remove('flipped');
  $('flash-label').textContent = 'السؤال';
  $('flash-text').textContent = c.q;
  $('review-progress').textContent = `بطاقة ${ar(deckPos + 1)} من ${ar(deck.length)}`;
  $('right').disabled = true;
  $('wrong').disabled = true;
  $('flash').focus();
}

function flip() {
  const c = deck[deckPos];
  if (!c) return;
  flipped = !flipped;
  $('flash').classList.toggle('flipped', flipped);
  $('flash-label').textContent = flipped ? 'الجواب' : 'السؤال';
  $('flash-text').textContent = flipped ? c.a : c.q;
  $('right').disabled = !flipped;
  $('wrong').disabled = !flipped;
}

function answer(correct) {
  const c = deck[deckPos];
  if (!c || !flipped) return;
  nb.review(c.id, correct);
  if (correct) rightCount += 1;
  host.tell(correct ? 'card_right' : 'card_wrong');
  deckPos += 1;
  if (deckPos >= deck.length) {
    $('review').hidden = true;
    host.tell('review_done', { count: rightCount });
    toast(`خلصت المراجعة: عرفت ${ar(rightCount)} من ${ar(deck.length)}.`, 3500);
    renderList();
    renderInfo();
    scheduleSave();
    return;
  }
  showCard();
}

// ---------------------------------------------------------------- wiring
$('new-note').addEventListener('click', newNote);
$('welcome-new').addEventListener('click', newNote);
$('search').addEventListener('input', renderList);
$('title').addEventListener('input', () => { if (!current) return; nb.update(current, { title: $('title').value }); renderList(); scheduleSave(); });
let listTimer = null;
$('body').addEventListener('input', () => {
  if (!current) return;
  nb.update(current, { body: $('body').value });
  renderInfo();
  scheduleSave();
  clearTimeout(listTimer);
  listTimer = setTimeout(renderList, 400);
});
$('body').addEventListener('blur', () => { if (current && $('saved').textContent === 'يحفظ…') { saveNow(); host.tell('note_saved'); } });
document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => runTool(b.dataset.mode, b)));
$('result-close').addEventListener('click', () => { if (current) nb.update(current, { ai: null }); showResult(null); scheduleSave(); });
$('result-insert').addEventListener('click', () => {
  if (!current || !lastResult) return;
  const n = nb.get(current);
  const add = `\n\n— ${MODE_TITLE[lastResult.mode] || 'خلفون'} —\n${lastResult.text}`;
  nb.update(current, { body: `${n.body}${add}` });
  $('body').value = nb.get(current).body;
  renderInfo();
  scheduleSave();
  toast('أضفته في آخر الملاحظة.');
});
$('delete').addEventListener('click', () => {
  if (!current) return;
  const n = nb.get(current);
  // A second press within a few seconds confirms; no browser dialogs.
  if ($('delete').dataset.armed !== '1') {
    $('delete').dataset.armed = '1';
    $('delete').textContent = 'متأكد؟ اضغط مرة ثانية';
    setTimeout(() => { $('delete').dataset.armed = ''; $('delete').textContent = 'احذف'; }, 3500);
    return;
  }
  $('delete').dataset.armed = '';
  $('delete').textContent = 'احذف';
  nb.remove(n.id);
  host.tell('note_deleted');
  current = null;
  $('note').hidden = true;
  $('welcome').hidden = false;
  renderList();
  saveNow();
});
$('to-board').addEventListener('click', () => host.openBoard());
$('review-all').addEventListener('click', startReview);
$('review-close').addEventListener('click', () => { $('review').hidden = true; renderList(); scheduleSave(); });
$('flash').addEventListener('click', flip);
$('right').addEventListener('click', () => answer(true));
$('wrong').addEventListener('click', () => answer(false));
document.addEventListener('keydown', (e) => {
  if (!$('review').hidden) {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
    if (e.key === 'ArrowLeft' && flipped) answer(true);
    if (e.key === 'ArrowRight' && flipped) answer(false);
    if (e.key === 'Escape') $('review').hidden = true;
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); newNote(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(); }
});
window.addEventListener('beforeunload', () => { if ($('saved').textContent === 'يحفظ…') host.save(nb.data); });

(async () => {
  const state = await host.load();
  nb = new Notebook(state?.data || undefined);
  aiAvailable = Boolean(state?.ai);
  setStatus(aiAvailable ? 'عقل خلفون جاهز، وكل شي على جهازك.' : 'ملاحظاتك تبقى على جهازك. (بدون عقل خلفون: الملخص البسيط فقط)');
  renderList();
  const first = nb.list()[0];
  if (first) openNote(first.id);
  window.__notebookReady = true;
})();
