// Fixes from a full review of how Khalfoun understands and answers everyday Omani speech.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMinutes, parseNumberToken } from '../src/core/arabic.js';
import { recognize } from '../src/core/intents.js';
import { Brain, durationPhrase, countPhrase, COUNTED } from '../src/core/brain.js';
import { defaultMemory } from '../src/core/memory.js';
import { isFeminineName, ResponseEngine } from '../src/core/responses.js';
import { TEMPLATES } from '../src/core/templates/ar-om.js';
import { validateAction } from '../src/main/actions/index.js';

function makeBrain(start = Date.UTC(2026, 10, 18, 6, 0, 0)) {
  let now = start;
  const brain = new Brain({ memoryData: { ...defaultMemory(start), onboarded: true, level: 3, name: 'عبدالرحيم' }, clock: () => now, rng: () => 0.1 });
  return { brain, advance: (ms) => { now += ms; } };
}

test('durations with halves, quarters, thirds and compound numbers', () => {
  const cases = [
    ['بعد ساعة ونص', 90], ['بعد ساعه وربع', 75], ['بعد ساعتين ونص', 150], ['بعد ٣ ساعات ونص', 210],
    ['بعد ثلث ساعة', 20], ['بعد ثلاث ارباع ساعه', 45], ['بعد ساعه الا ربع', 45], ['بعد ساعه وعشر دقايق', 70],
    ['بعد خمسة وعشرين دقيقة', 25], ['بعد خمسه و عشرين دقيقه', 25], ['بعد خمسطعش دقيقه', 15], ['بعد ربعطعش دقيقه', 14],
    ['ذكرني بالحصه 3 بعد 10 دقايق', 10], ['بعد 5 دقايق', 5], ['بعد ساعة', 60], ['بعد دقيقتين', 2],
  ];
  for (const [text, minutes] of cases) assert.equal(parseMinutes(text), minutes, text);
  assert.equal(parseMinutes('ذكرني اصلي'), null);
  assert.equal(parseNumberToken('سبعين'), 70);
  assert.equal(parseNumberToken('اثنعش'), 12);
});

test('a reminder for «ساعة ونص» is 90 minutes and says it the way people do', () => {
  const { brain } = makeBrain();
  const r = brain.hear('ذكرني بعد ساعة ونص بالاجتماع');
  assert.deepEqual(r.action.params, { minutes: 90, note: 'الاجتماع', repeat: false });
  assert.match(r.say, /ساعة ونص/);
  const r2 = brain.hear('ذكرني بعد خمسة وعشرين دقيقة اتصل بامي');
  assert.equal(r2.action.params.minutes, 25);
  assert.equal(r2.action.params.note, 'اتصل بامي');
  assert.equal(durationPhrase(75), 'ساعة وربع');
  assert.equal(durationPhrase(100), 'ساعة و٤٠ دقيقة');
});

test('«نقص الصوت» and «هد الصوت» turn the volume down, not up', () => {
  for (const s of ['نقص الصوت', 'هد الصوت', 'قلل الصوت', 'الصوت مزعج']) assert.equal(recognize(s).slots.direction, 'down', s);
});

test('everyday phrasings that were not understood before', () => {
  const cases = [
    ['شو الساعة', 'time'], ['ايش الساعه', 'time'], ['اليوم ايش', 'date'],
    ['قفل الحاسبه', 'close', { app: 'calculator' }], ['صك الوورد', 'close', { app: 'word' }],
    ['خذني لليوتيوب', 'open', { app: 'youtube' }], ['افتح سطح المكتب', 'open', { app: 'desktop' }],
    ['شغل لي في اليوتيوب سورة الكهف', 'search', { engine: 'youtube', query: 'سورة الكهف' }],
    ['شغل لي سورة الكهف في اليوتيوب', 'search', { engine: 'youtube', query: 'سورة الكهف' }],
    ['مسا الخير', 'greet', { part: 'evening' }], ['السلام عليكم', 'greet', { part: 'salam' }],
    ['فمان الله', 'goodbye'], ['سولي اختبار رياضيات', 'quiz'], ['اختر طالب عشوائي', 'pick_student'],
    ['شو حصتي الجاية', 'schedule_next'], ['لا خلاص', 'no'], ['ايش تقدر تسوي', 'help'],
    ['زين الحمدلله', 'fine'], ['بخير وانت', 'fine'],
    ['وكم ٧ ضرب ٨', 'calc'], ['طيب افتح الحاسبة', 'open', { app: 'calculator' }], ['وبعدين سكرها', 'close'],
  ];
  for (const [text, intent, slots = {}] of cases) {
    const r = recognize(text);
    assert.equal(r.intent, intent, text);
    for (const [k, v] of Object.entries(slots)) assert.equal(r.slots[k], v, `${text}: ${k}`);
  }
});

test('«افتح يوتيوب» still just opens the site', () => {
  assert.equal(recognize('افتح يوتيوب').intent, 'open');
  assert.equal(recognize('شغل اليوتيوب').intent, 'open');
});

test('the desktop folder opens and passes the main-process checks', () => {
  const { brain } = makeBrain();
  const r = brain.hear('افتح سطح المكتب');
  assert.deepEqual(r.action.params, { folder: 'desktop' });
  assert.equal(validateAction({ type: 'open_folder', params: { folder: 'desktop' } }), null);
});

test('«السلام عليكم» is answered with «وعليكم السلام», and «زين الحمدلله» gets a reply', () => {
  const { brain, advance } = makeBrain();
  assert.match(brain.hear('السلام عليكم').say, /^وعليكم السلام/);
  advance(3000);
  brain.hear('شحالك');
  advance(3000);
  const r = brain.hear('زين الحمدلله');
  assert.equal(r.situation, 'fine');
  assert.ok(r.say.length > 3);
});

test('feminine names get feminine words: «الحاسبة مفتوحة», «سكرتها», «عندها»', () => {
  assert.equal(isFeminineName('الحاسبة'), true);
  assert.equal(isFeminineName('التنزيلات'), true);
  assert.equal(isFeminineName('مريم'), true);
  assert.equal(isFeminineName('المتصفح'), false);
  assert.equal(isFeminineName('Zoom'), false);
  const eng = new ResponseEngine({ templates: [{ id: 'x', s: 'x', t: '{app} [[مفتوح|مفتوحة]]، سكرت[[ه|ها]]' }], rng: () => 0 });
  assert.equal(eng.say('x', { vars: { app: 'الحاسبة' } }).text, 'الحاسبة مفتوحة، سكرتها');
  assert.equal(eng.say('x', { vars: { app: 'المتصفح' } }).text, 'المتصفح مفتوح، سكرته');
});

test('no reply in the bank leaves a gender marker or a stray brace behind', () => {
  const eng = new ResponseEngine({ templates: TEMPLATES, rng: () => 0 });
  for (const t of TEMPLATES) {
    for (const fem of [true, false]) {
      const text = eng.fill(t.t, { fem, app: 'س', student: 'س', stars: 'نجمة', count: '٣', points: '١' }, 'عبدالرحيم');
      assert.ok(!/\[\[|\]\]/.test(text), `${t.id}: ${text}`);
    }
  }
});

test('stars and counts agree with the number', () => {
  const { brain, advance } = makeBrain();
  brain.hear('اسامي الطلاب: احمد، مريم، فاطمة');
  advance(3000);
  const r = brain.hear('اعط مريم نجمتين');
  assert.match(r.say, /مريم/);
  assert.ok(!/عنده |رصيده/.test(r.say), r.say);
  assert.equal(countPhrase(1, COUNTED.file), 'ملف واحد');
  assert.equal(countPhrase(2, COUNTED.lesson), 'حصتين');
  assert.equal(countPhrase(5, COUNTED.group), '٥ مجموعات');
  assert.equal(countPhrase(25, COUNTED.name), '٢٥ اسم');
});
