// The reading-aloud check window: the teacher puts a passage, the student reads it, and
// Khalfoun shows words read right, words per minute and the words to practise.
import { compareReading, readingVerdict, readingWords } from '../core/reading.js';
import { Recorder } from '../renderer/recorder.js';

const $ = (id) => document.getElementById(id);
const ar = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
const MAX_MS = 60000;

// Original practice passages (written for Khalfoun), from short to longer.
const SAMPLES = [
  { title: 'القطة الصغيرة (قصير)', text: 'عند سارة قطة صغيرة لونها أبيض. تحب القطة اللعب بالكرة في الحديقة. في المساء تنام القطة قرب الباب.' },
  { title: 'يوم في البحر', text: 'ذهب أحمد مع أبيه إلى البحر يوم الجمعة. ركبا القارب الصغير وشاهدا الدلافين تقفز فوق الماء. اصطاد الأب سمكة كبيرة، وفرح أحمد كثيراً وقال: هذا أجمل يوم في الأسبوع.' },
  { title: 'النخلة', text: 'النخلة شجرة مباركة تنمو في بلادنا منذ زمن بعيد. نأكل من ثمرها التمر، ونصنع من سعفها الحصير والسلال. وكان أجدادنا يستظلون بظلها في أيام الصيف الحارة، ولذلك نحافظ عليها ونسقيها.' },
  { title: 'الأفلاج في عمان (طويل)', text: 'الأفلاج قنوات قديمة تنقل الماء من باطن الأرض أو من العيون إلى القرى والمزارع. بناها العمانيون قبل مئات السنين بمهارة عالية، فجعلوا الماء يجري بلطف ليصل إلى كل بيت ومزرعة. ويتقاسم أهل القرية الماء بنظام دقيق وعادل، ولهذا أصبحت الأفلاج رمزاً للتعاون والحكمة.' },
];

// In a plain browser (previews and tests) a fake hearing echoes the passage with two mistakes.
const host = window.readingHost || {
  async info() { return { cloud: true, azure: false, whisper: false }; },
  async transcribe() {
    const words = ($('passage').value || '').split(/\s+/).filter(Boolean);
    if (words.length > 3) words.splice(2, 1);
    if (words.length > 6) words[5] = 'كلمه';
    return window.__rdFail ? { ok: false, error: 'stt_failed' } : { ok: true, text: words.join(' '), service: 'preview' };
  },
  tell() {},
};

const recorder = new Recorder();
let state = 'idle'; // idle | recording | working
let clockTimer = null;
let startedAt = 0;
let lastText = '';

function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
function store(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* full or blocked */ } }

function show(step) {
  for (const id of ['step-setup', 'step-read', 'step-result']) $(id).hidden = id !== step;
  $('error').hidden = true;
}

function error(text) {
  $('error').textContent = text;
  $('error').hidden = false;
}

function passageInfo() {
  const n = readingWords($('passage').value).length;
  $('passage-info').textContent = n ? `${ar(n)} كلمة` : '';
  $('go').disabled = n < 3;
}

function renderHistory() {
  const list = load('rd-history', []);
  $('history').replaceChildren(...list.map((h) => {
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = `${h.name || 'طالب'} — ${ar(h.accuracy)}٪`;
    const sm = document.createElement('small');
    sm.textContent = `${ar(h.wpm)} كلمة/دقيقة · ${new Date(h.at).toLocaleDateString('ar-OM', { day: 'numeric', month: 'short' })}`;
    li.append(b, sm);
    return li;
  }));
  $('history-empty').hidden = list.length > 0;
  $('clear-history').hidden = list.length === 0;
}

function tick() {
  const s = Math.floor((performance.now() - startedAt) / 1000);
  $('clock').textContent = `${ar(Math.floor(s / 60))}:${ar(String(s % 60).padStart(2, '0'))}`;
}

function setRec(mode) {
  state = mode;
  const rec = $('rec');
  rec.classList.toggle('on', mode === 'recording');
  rec.classList.toggle('busy', mode === 'working');
  rec.disabled = mode === 'working';
  $('rec-label').textContent = mode === 'recording' ? 'خلصت' : mode === 'working' ? 'خلفون يسمع…' : 'ابدأ التسجيل';
  $('back').disabled = mode !== 'idle';
}

async function startRecording() {
  setRec('recording');
  startedAt = performance.now();
  tick();
  clockTimer = setInterval(tick, 250);
  host.tell('reading_started');
  let wav;
  try {
    const res = await recorder.record((l) => { $('level').style.width = `${Math.round(l * 100)}%`; }, { maxMs: MAX_MS, silenceMs: null, noSpeechMs: 12000, worklet: '../renderer/recorder-worklet.js' });
    wav = res.spoke ? res.wav : null;
  } catch (err) {
    clearInterval(clockTimer);
    setRec('idle');
    error(/NotAllowed|Permission/i.test(String(err?.name || err)) ? 'ما عندي إذن للمايك.' : 'ما قدرت أشغّل المايك. تأكد إنه موصول.');
    return;
  }
  clearInterval(clockTimer);
  $('level').style.width = '0';
  const seconds = wav ? Math.max(1, (wav.length - 44) / 32000) : 0;
  if (!wav) { setRec('idle'); error('ما سمعت صوت. قرّب المايك وجرب مرة ثانية.'); return; }
  setRec('working');
  const heard = await host.transcribe(wav);
  setRec('idle');
  if (!heard?.ok) {
    error(heard?.error === 'no_hearing'
      ? 'السمع غير جاهز. فعّل Azure أو Gemini من إعدادات خلفون ← السرعة والذكاء.'
      : 'ما قدرت أحوّل التسجيل لكلام. جرب مرة ثانية.');
    return;
  }
  if (!heard.text.trim()) { error('ما فهمت كلام واضح في التسجيل. خل الطالب يقرأ بصوت أعلى.'); return; }
  showResult(heard.text, seconds);
}

function showResult(heardText, seconds) {
  const passage = $('passage').value;
  const r = compareReading(passage, heardText, seconds);
  const name = $('student').value.trim();
  $('res-name').textContent = name ? `— ${name}` : '';
  $('res-acc').textContent = `${ar(r.accuracy)}٪`;
  $('res-wpm').textContent = ar(r.wpm);
  $('res-correct').textContent = `${ar(r.correct)}/${ar(r.total)}`;
  $('res-time').textContent = ar(Math.round(seconds));
  $('res-verdict').textContent = readingVerdict(r);
  $('res-heard').textContent = heardText;
  // The passage as written, each word coloured by how it was read.
  const out = $('res-words');
  out.replaceChildren();
  let k = 0;
  for (const token of passage.split(/(\s+)/)) {
    if (/^\s+$/.test(token) || !token) { out.append(token); continue; }
    const n = readingWords(token).length;
    if (!n) { out.append(token); continue; }
    const ok = r.words.slice(k, k + n).every((w) => w.ok);
    k += n;
    const span = document.createElement('span');
    span.className = `w ${ok ? 'ok' : 'bad'}`;
    span.textContent = token;
    out.append(span);
  }
  const list = load('rd-history', []);
  list.unshift({ name, accuracy: r.accuracy, wpm: r.wpm, at: Date.now() });
  store('rd-history', list.slice(0, 40));
  renderHistory();
  host.tell('reading_done', { count: r.accuracy });
  show('step-result');
  window.__rdResult = r;
}

// ------------------------------------------------------------------ wiring
for (const [i, s] of SAMPLES.entries()) {
  const o = document.createElement('option');
  o.value = String(i);
  o.textContent = s.title;
  $('samples').append(o);
}
$('samples').addEventListener('change', () => {
  const s = SAMPLES[Number($('samples').value)];
  if (s) { $('passage').value = s.text; passageInfo(); store('rd-passage', s.text); }
});
$('passage').addEventListener('input', () => { passageInfo(); store('rd-passage', $('passage').value); });
$('go').addEventListener('click', () => {
  $('passage-show').textContent = $('passage').value.trim();
  $('read-title').textContent = $('student').value.trim() ? `دور ${$('student').value.trim()}: اقرأ بصوت واضح` : 'اقرأ النص بصوت واضح';
  $('clock').textContent = '٠:٠٠';
  show('step-read');
  $('rec').focus();
});
$('rec').addEventListener('click', () => {
  if (state === 'idle') startRecording();
  else if (state === 'recording') recorder.stop();
});
$('back').addEventListener('click', () => show('step-setup'));
$('again').addEventListener('click', () => $('go').click());
$('next').addEventListener('click', () => { $('student').value = ''; show('step-setup'); $('student').focus(); });
$('clear-history').addEventListener('click', () => { store('rd-history', []); renderHistory(); });
document.addEventListener('keydown', (e) => {
  if (e.key === ' ' && !$('step-read').hidden && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); $('rec').click(); }
});

(async () => {
  $('passage').value = load('rd-passage', '') || '';
  passageInfo();
  renderHistory();
  const info = await host.info();
  if (info && !info.cloud && !info.whisper) $('status').textContent = 'تنبيه: السمع غير مفعّل. فعّل Azure أو Gemini من إعدادات خلفون ← السرعة والذكاء.';
  else if (info && !info.cloud) $('status').textContent = 'يسمع بالاستماع المحلي (بطيء). Azure أو Gemini أسرع وأدق.';
  window.__readingReady = true;
})();
