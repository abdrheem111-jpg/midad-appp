// A corpus of realistic sentences: polite and dialect forms, typos, and the
// kind of mistakes speech recognition makes. Each line is
// [sentence, intent, expected slots (subset)].
import test from 'node:test';
import assert from 'node:assert/strict';
import { recognize } from '../src/core/intents.js';

const CORPUS = [
  // ---- opening apps, many ways
  ['افتح الحاسبة', 'open', { app: 'calculator' }],
  ['افتح لي الحاسبه لو سمحت', 'open', { app: 'calculator' }],
  ['ممكن تفتح الحاسبة', 'open', { app: 'calculator' }],
  ['تقدر تفتح لي الحاسبة؟', 'open', { app: 'calculator' }],
  ['ابغاك تفتح الحاسبة', 'open', { app: 'calculator' }],
  ['خلفون فج الحاسبة', 'open', { app: 'calculator' }],
  ['يا خلفون الله يخليك افتح الحاسبة بسرعة', 'open', { app: 'calculator' }],
  ['فتح لي الحاسبة', 'open', { app: 'calculator' }],
  ['افتحلي الآلة الحاسبة', 'open', { app: 'calculator' }],
  ['افتح الحاسيه', 'open', { app: 'calculator' }], // typo
  ['افنح الحاسبة', 'open', { app: 'calculator' }], // typo in the verb
  ['إفتح الحاسبة.', 'open', { app: 'calculator' }],
  ['شغل الحاسبة', 'open', { app: 'calculator' }],
  ['أبي الحاسبة', 'open', { app: 'calculator' }],
  ['ابغى المفكرة', 'open', { app: 'notepad' }],
  ['افتح النوت باد', 'open', { app: 'notepad' }],
  ['افتح المفكره يا الغالي', 'open', { app: 'notepad' }],
  ['افتح المتصفخ', 'open', { app: 'browser' }], // typo
  ['افتح كروم', 'open', { app: 'browser' }],
  ['افتح جوجل كروم', 'open', { app: 'browser' }],
  ['وديني يوتيوب', 'open', { app: 'youtube' }],
  ['شغل اليوتيوب', 'open', { app: 'youtube' }],
  ['افتح الواتس', 'open', { app: 'whatsapp' }],
  ['افتح الوتساب', 'open', { app: 'whatsapp' }], // typo
  ['افتح الوورد', 'open', { app: 'word' }],
  ['افتح برنامج الوورد', 'open', { app: 'word' }],
  ['افتح الاكسل', 'open', { app: 'excel' }],
  ['افتح الباوربوينت', 'open', { app: 'powerpoint' }],
  ['افتح مجلد التنزيلات', 'open', { app: 'downloads' }],
  ['افتح التحميلات', 'open', { app: 'downloads' }],
  ['افتح الصور', 'open', { app: 'pictures' }],
  ['افتح الرسام', 'open', { app: 'paint' }],
  ['افتح الملفات', 'open', { app: 'explorer' }],
  ['افتح اعدادات الجهاز', 'open', { app: 'settings' }],
  ['خلنا نفتح الحاسبة', 'open', { app: 'calculator' }],
  ['الحين افتح الحاسبة', 'open', { app: 'calculator' }],

  ['خذني لليوتيوب', 'open', { app: 'youtube' }],
  ['افتح سطح المكتب', 'open', { app: 'desktop' }],
  ['طيب افتح الحاسبة', 'open', { app: 'calculator' }],

  // ---- closing
  ['قفل الحاسبه', 'close', { app: 'calculator' }],
  ['صك الوورد', 'close', { app: 'word' }],
  ['سكر الحاسبة', 'close', { app: 'calculator' }],
  ['سكر المفكره', 'close', { app: 'notepad' }],
  ['اقفل الوورد', 'close', { app: 'word' }],
  ['طفي الحاسبة', 'close', { app: 'calculator' }],
  ['بند المتصفح', 'close', { app: 'browser' }],

  // ---- search
  ['دور لي عن صلاة الجمعة', 'search', { query: 'صلاة الجمعة', engine: 'google' }],
  ['دورلي على مطاعم في مسقط', 'search', { query: 'مطاعم في مسقط' }],
  ['ابحث عن الطقس في صلالة', 'search', { query: 'الطقس في صلالة' }],
  ['ممكن تدور لي عن وصفة عرسية', 'search', { query: 'وصفة عرسية' }],
  ['دور في اليوتيوب عن أناشيد أطفال', 'search', { query: 'أناشيد أطفال', engine: 'youtube' }],
  ['دور على شيلات في يوتيوب', 'search', { query: 'شيلات', engine: 'youtube' }],
  ['فتش عن جدول الامتحانات', 'search', { query: 'جدول الامتحانات' }],
  ['ابحت عن الطقس', 'search', { query: 'الطقس' }], // speech error ث→ت

  // ---- typing
  ['اكتب السلام عليكم', 'type_text', { text: 'السلام عليكم' }],
  ['اكتب لي صباح الخير يا أستاذ', 'type_text', { text: 'صباح الخير يا أستاذ' }],
  ['ممكن تكتب لي شكرا جزيلا', 'type_text', { text: 'شكرا جزيلا' }],
  ['اكتب هذا الكلام: الواجب يوم الأحد', 'type_text', { text: 'الواجب يوم الأحد' }],
  ['اكتب في البي دي اف تم التصحيح', 'pdf_write', { text: 'تم التصحيح' }],

  // ---- volume
  ['ارفع الصوت', 'volume', { direction: 'up' }],
  ['علّي الصوت شوي', 'volume', { direction: 'up' }],
  ['الصوت واجد عالي', 'volume', { direction: 'down' }],
  ['وطي الصوت', 'volume', { direction: 'down' }],
  ['نزل الصوت', 'volume', { direction: 'down' }],
  ['اكتم الصوت', 'volume', { direction: 'mute' }],
  ['ما اسمع شي ارفع الصوت', 'volume', { direction: 'up' }],
  ['خفض الصوت لو سمحت', 'volume', { direction: 'down' }],
  ['نقص الصوت', 'volume', { direction: 'down' }],
  ['هد الصوت شوي', 'volume', { direction: 'down' }],

  // ---- reminders
  ['ذكرني بعد خمس دقايق', 'reminder', { minutes: 5 }],
  ['ذكرني بعد ربع ساعة اشرب ماي', 'reminder', { minutes: 15, note: 'اشرب ماي' }],
  ['نبهني بعد نص ساعة', 'reminder', { minutes: 30 }],
  ['ذكرني بعد ساعتين بالاجتماع', 'reminder', { minutes: 120 }],
  ['ذكرني كل ساعة اقوم امشي', 'reminder', { minutes: 60, repeat: true }],
  ['ذكرني بعد ١٠ دقائق', 'reminder', { minutes: 10 }],
  ['الغ التذكيرات', 'cancel_reminders', {}],

  // ---- time and date
  ['كم الساعة', 'time', {}],
  ['الساعة كم الحين', 'time', {}],
  ['كم الساعه يا خلفون', 'time', {}],
  ['شو الوقت', 'time', {}],
  ['كم التاريخ اليوم', 'date', {}],
  ['شو اليوم', 'date', {}],

  // ---- other commands
  ['صور الشاشة', 'screenshot', {}],
  ['خذ لقطة شاشة', 'screenshot', {}],
  ['رتب التنزيلات', 'organize_downloads', {}],
  ['قول نكتة', 'joke', {}],
  ['ضحكني', 'joke', {}],
  ['عطني نكته', 'joke', {}],
  ['ارقص', 'dance', {}],
  ['تعال', 'come', {}],
  ['تعال هني', 'come', {}],
  ['روح الزاوية', 'away', {}],
  ['خلني أركز', 'away', {}],
  ['نام', 'sleep', {}],
  ['اختبرني', 'quiz', {}],
  ['اسألني سؤال رياضيات', 'quiz', {}],
  ['شو تقدر تسوي', 'help', {}],
  ['وقف', 'stop', {}],
  ['خلاص بس', 'stop', {}],
  ['اسمي سعيد', 'set_name', { name: 'سعيد' }],
  ['البس البشت', 'costume', { name: 'bisht' }],

  // ---- conversation
  ['السلام عليكم', 'greet', {}],
  ['صباح الخير', 'greet', { part: 'morning' }],
  ['شحالك', 'how_are_you', {}],
  ['شخبارك يا خلفون', 'how_are_you', {}],
  ['من انت', 'who', {}],
  ['مشكور', 'thanks', {}],
  ['يعطيك العافية', 'thanks', {}],
  ['كفو عليك', 'praise', {}],
  ['مع السلامة', 'goodbye', {}],
  ['أنا تعبان اليوم', 'feeling', { kind: 'tired' }],
  ['والله زهقان', 'feeling', { kind: 'bored' }],
  ['نجحت في الامتحان', 'feeling', { kind: 'success' }],

  // ---- newer abilities, said in different ways
  ['افتح chrome', 'open', { app: 'browser' }],
  ['افتح الحاسبة يا خلفون', 'open', { app: 'calculator' }],
  ['خلفون، افتح الحاسبة!', 'open', { app: 'calculator' }],
  ['الحاسبة', 'open', { app: 'calculator' }],
  ['عطني الحاسبة', 'open', { app: 'calculator' }],
  ['افتح سبوتيفاي', 'open_unknown', { name: 'سبوتيفاي' }],
  ['شغل زوم', 'open_unknown', { name: 'زوم' }],
  ['افتح', 'open_which', {}],
  ['سكرها', 'close', { it: true }],
  ['اقفله', 'close', { it: true }],
  ['افتحه مرة ثانية', 'open_again', {}],
  ['عيدها', 'repeat', {}],
  ['زيد', 'repeat', {}],
  ['كم ٢٥ ضرب ٤', 'calc', {}],
  ['احسب لي ١٥٪ من ٢٠٠', 'calc', {}],
  ['كم سبعة في ثمانية', 'calc', {}],
  ['ذكرني الساعة خمس العصر بالاجتماع', 'reminder', { note: 'الاجتماع' }],
  ['ذكرني بكرة الساعة ٧ الصبح', 'reminder', {}],
  ['لما اقول صباحو يعني افتح المتصفح', 'teach', { phrase: 'صباحو', command: 'افتح المتصفح' }],
  ['انس كلمة صباحو', 'forget_phrase', { phrase: 'صباحو' }],
  ['جهز الاستماع', 'setup', { part: 'voice' }],
  ['نزل عقلك', 'setup', { part: 'brain' }],
  ['اعداداتك', 'open_settings', {}],

  // ---- yes / no
  ['ايوه', 'yes', {}],
  ['اكيد سوها', 'yes', {}],
  ['لا خلها', 'no', {}],
];

test('corpus: every realistic sentence is understood', () => {
  const failures = [];
  for (const [sentence, intent, slots] of CORPUS) {
    const r = recognize(sentence);
    const slotOk = Object.entries(slots).every(([k, v]) => r.slots[k] === v);
    if (r.intent !== intent || !slotOk) failures.push(`«${sentence}» → ${r.intent} ${JSON.stringify(r.slots)} (want ${intent} ${JSON.stringify(slots)})`);
  }
  const rate = 1 - failures.length / CORPUS.length;
  assert.equal(failures.length, 0, `${(rate * 100).toFixed(1)}% understood, ${failures.length} failed:\n${failures.join('\n')}`);
});

test('corpus: fuzzy matching does not invent commands from unrelated words', () => {
  for (const s of ['كتاب جميل', 'البحر حلو اليوم', 'شو رايك في المدرسة', 'السيارة خربانة', 'امي تسلم عليك', 'قرأت قصة عن الفضاء',
    'الكلام هذا حلو', 'وين راحت القطوة', 'ليش السما زرقا', 'احب الرياضيات', 'كم عمرك', 'شو تحب تاكل', 'الجو حار اليوم']) {
    assert.ok(['unknown', 'greet', 'feeling'].includes(recognize(s).intent), `${s} → ${recognize(s).intent}`);
  }
});

import { calculate } from '../src/core/calc.js';
import { Brain } from '../src/core/brain.js';
import { defaultMemory } from '../src/core/memory.js';

test('calculations said the Omani way', () => {
  const cases = [
    ['كم ٢٥ ضرب ٤', 100], ['احسب ١٥٪ من ٢٠٠', 30], ['جذر ٨١', 9], ['كم ثلاثة زائد خمسة', 8], ['كم خمسة وعشرين في اربعة', 100],
    ['100 / 8', 12.5], ['كم ٣ تربيع', 9], ['كم 2 اس 10', 1024], ['كم ١٠ بالمية من ٥٠', 5], ['كم ١٢ ناقص ٢٠', -8],
    ['كم ٣ + ٤ × ٢', 11], ['كم (٣ + ٤) × ٢', 14], ['احسب ٢٥٠ مقسوم على ٤', 62.5], ['كم نص زائد ربع', 0.75], ['كم ١٫٥ ضرب ٤', 6],
    ['كم ٩ مطروح منها ٤', 5], ['٧×٨', 56], ['كم 1,000 على 4', 250],
  ];
  for (const [text, want] of cases) assert.equal(calculate(text)?.value, want, text);
  assert.deepEqual(calculate('كم ٧ على ٠'), { ok: false, error: 'div_zero' });
  for (const text of ['كم الساعة', 'دور على مطاعم', 'ذكرني بعد ٥ دقايق', 'اكتب ٥ + ٥', 'افتح الحاسبة', 'كم عمرك', '٥']) assert.equal(calculate(text), null, text);
  assert.equal(recognize('كم ٢٥ ضرب ٤').intent, 'calc');
  assert.equal(recognize('ذكرني بعد ٥ دقايق').intent, 'reminder');
  assert.equal(recognize('اكتب ٥ + ٥').intent, 'type_text');
});

test('he answers calculations with the expression and result in Arabic digits', () => {
  const now = Date.UTC(2026, 10, 17, 8);
  const brain = new Brain({ memoryData: { ...defaultMemory(now), onboarded: true, level: 2 }, clock: () => now, rng: () => 0.1 });
  const r = brain.hear('كم ٢٥ ضرب ٤');
  assert.equal(r.situation, 'calc_result');
  assert.ok(r.say.includes('١٠٠') && r.say.includes('٢٥ × ٤'), r.say);
  assert.equal(brain.hear('كم ٧ على ٠').situation, 'calc_div_zero');
});

import { parseClock, clockToTime } from '../src/core/arabic.js';

test('clock times in reminders: periods, halves, «الا ربع», tomorrow', () => {
  const c = (t) => parseClock(t);
  assert.deepEqual(c('الساعة خمس العصر'), { hour: 5, minute: 0, period: 'pm', dayOffset: 0 });
  assert.deepEqual(c('بكرة الساعة ٧ الصبح'), { hour: 7, minute: 0, period: 'am', dayOffset: 1 });
  assert.deepEqual(c('الساعه 4:30'), { hour: 4, minute: 30, period: null, dayOffset: 0 });
  assert.deepEqual(c('الساعة سبعة الا ربع'), { hour: 6, minute: 45, period: null, dayOffset: 0 });
  assert.deepEqual(c('الساعة ٨ ونص'), { hour: 8, minute: 30, period: null, dayOffset: 0 });
  assert.equal(c('بعد خمس دقايق'), null);
  const at = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi).getTime();
  const now = at(2026, 10, 17, 9, 0); // 9:00 in the morning
  assert.equal(clockToTime(c('الساعة خمس العصر'), now), at(2026, 10, 17, 17, 0));
  assert.equal(clockToTime(c('الساعة 10'), now), at(2026, 10, 17, 10, 0)); // next 10 o'clock: this morning
  assert.equal(clockToTime(c('الساعة 8'), now), at(2026, 10, 17, 20, 0)); // 8am passed → 8pm
  assert.equal(clockToTime(c('بكرة الساعة ٧ الصبح'), now), at(2026, 10, 18, 7, 0));
  assert.equal(clockToTime(c('الساعة ٧ الصبح'), now), at(2026, 10, 18, 7, 0)); // passed today → tomorrow
  assert.equal(clockToTime(c('الساعه ١٢ الليل'), now), at(2026, 10, 18, 0, 0));
  assert.equal(clockToTime(c('الساعه ٢ الليل'), now), at(2026, 10, 18, 2, 0));
  assert.equal(clockToTime(c('الساعه ١ الظهر'), now), at(2026, 10, 17, 13, 0));
});

test('«ذكرني الساعة خمس العصر بالاجتماع» sets a reminder for the right number of minutes', () => {
  const now = new Date(2026, 10, 17, 9, 0).getTime();
  const brain = new Brain({ memoryData: { ...defaultMemory(now), onboarded: true, level: 2 }, clock: () => now, rng: () => 0.1 });
  const r = brain.hear('ذكرني الساعة خمس العصر بالاجتماع');
  assert.equal(r.situation, 'reminder_set_at');
  assert.deepEqual(r.action.params, { minutes: 8 * 60, note: 'الاجتماع', repeat: false });
  assert.ok(r.say.includes('الاجتماع') && r.say.includes('الساعة'), r.say);
  const t = brain.hear('ذكرني بكرة الساعة ٧ الصبح اصحى');
  assert.equal(t.action.params.minutes, 22 * 60);
  assert.ok(t.say.includes('بكرة'), t.say);
  assert.equal(brain.hear('ذكرني بعد عشر دقايق').action.params.minutes, 10);
});
