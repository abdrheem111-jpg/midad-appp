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

  // ---- closing
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
  for (const s of ['كتاب جميل', 'البحر حلو اليوم', 'شو رايك في المدرسة', 'السيارة خربانة', 'امي تسلم عليك', 'قرأت قصة عن الفضاء']) {
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
