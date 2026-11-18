import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, parseMinutes, toArabicDigits } from '../src/core/arabic.js';
import { recognize, findApp, rawRestAfter } from '../src/core/intents.js';

test('normalize unifies spelling variants', () => {
  assert.equal(normalize('أَهْلاً'), 'اهلا');
  assert.equal(normalize('إفتح  الحاسبة!!'), 'افتح الحاسبه');
  assert.equal(normalize('مستشفى'), 'مستشفي');
  assert.equal(normalize('١٢٣ دقيقة'), '123 دقيقه');
  assert.equal(normalize('ســـلام'), 'سلام');
  assert.equal(normalize(null), '');
});

test('parseMinutes reads Omani duration phrases', () => {
  assert.equal(parseMinutes('بعد 5 دقايق'), 5);
  assert.equal(parseMinutes('بعد خمس دقايق'), 5);
  assert.equal(parseMinutes('بعد ربع ساعة'), 15);
  assert.equal(parseMinutes('بعد نص ساعة'), 30);
  assert.equal(parseMinutes('بعد ساعتين'), 120);
  assert.equal(parseMinutes('بعد دقيقتين'), 2);
  assert.equal(parseMinutes('بعد ٣ ساعات'), 180);
  assert.equal(parseMinutes('بعد ساعة'), 60);
  assert.equal(parseMinutes('بعد شوي'), null);
});

test('toArabicDigits', () => {
  assert.equal(toArabicDigits(2026), '٢٠٢٦');
});

const cases = [
  ['افتح الحاسبة', 'open', { app: 'calculator' }],
  ['يا خلفون فج المتصفح لو سمحت', 'open', { app: 'browser' }],
  ['شغل يوتيوب', 'open', { app: 'youtube', kind: 'url' }],
  ['افتحلي الوورد', 'open', { app: 'word' }],
  ['ممكن تفتح التنزيلات', 'open', { app: 'downloads' }],
  ['تقدر تدور لي عن فنادق نزوى', 'search', { query: 'فنادق نزوى' }],
  ['ممكن تكتب لي شكرا جزيلا', 'type_text', { text: 'شكرا جزيلا' }],
  ['افتح التنزيلات', 'open', { app: 'downloads', kind: 'folder' }],
  ['افتح برنامج غريب', 'open_unknown', { name: 'غريب' }],
  ['دور لي عن مطاعم في مسقط', 'search', { query: 'مطاعم في مسقط', engine: 'google' }],
  ['ابحث عن طقس صلالة', 'search', { query: 'طقس صلالة', engine: 'google' }],
  ['دور في يوتيوب عن اغاني عمانية', 'search', { query: 'اغاني عمانية', engine: 'youtube' }],
  ['دور على وصفة الحلوى في اليوتيوب', 'search', { query: 'وصفة الحلوى', engine: 'youtube' }],
  ['ارفع الصوت', 'volume', { direction: 'up' }],
  ['وطي الصوت شوي', 'volume', { direction: 'down' }],
  ['الصوت واجد عالي', 'volume', { direction: 'down' }],
  ['اكتم الصوت', 'volume', { direction: 'mute' }],
  ['صور الشاشة', 'screenshot', {}],
  ['خذ لقطة للشاشة', 'screenshot', {}],
  ['كم الساعة؟', 'time', {}],
  ['الساعة كم الحين', 'time', {}],
  ['شو التاريخ اليوم', 'date', {}],
  ['قول نكتة', 'joke', {}],
  ['ضحكني يا خلفون', 'joke', {}],
  ['ذكرني بعد عشر دقايق بالصلاة', 'reminder', { minutes: 10, note: 'الصلاة' }],
  ['نبهني بعد ربع ساعة عن الاجتماع', 'reminder', { minutes: 15, note: 'الاجتماع' }],
  ['ذكرني بالدواء', 'reminder', { minutes: null }],
  ['اكتب السلام عليكم ورحمة الله', 'type_text', { text: 'السلام عليكم ورحمة الله' }],
  ['اكتب لي: موعدنا الساعة 5', 'type_text', { text: 'موعدنا الساعة 5' }],
  ['رتب التنزيلات', 'organize_downloads', {}],
  ['تراجع عن الترتيب', 'undo_organize', {}],
  ['وقف', 'stop', {}],
  ['خلاص بس', 'stop', {}],
  ['ايوه', 'yes', {}],
  ['اكيد سوها', 'yes', {}],
  ['لا لا', 'no', {}],
  ['خلها', 'no', {}],
  ['السلام عليكم', 'greet', { part: 'salam' }],
  ['صباح الخير يا خلفون', 'greet', { part: 'morning' }],
  ['مساء الخير', 'greet', { part: 'evening' }],
  ['شحالك', 'how_are_you', {}],
  ['شخبارك اليوم', 'how_are_you', {}],
  ['منو انت', 'who', {}],
  ['شو اسمك', 'who', {}],
  ['مشكور ما قصرت', 'thanks', {}],
  ['يعطيك العافية', 'thanks', {}],
  ['شاطر', 'praise', {}],
  ['كفو والله', 'praise', {}],
  ['انت غبي', 'scold', {}],
  ['اسمي عبدالرحيم', 'set_name', { name: 'عبدالرحيم' }],
  ['ناديني بو محمد', 'set_name', { name: 'بو محمد' }],
  ['تعال هنا', 'come', {}],
  ['خلني اركز', 'away', {}],
  ['روح نام', 'sleep', {}],
  ['اصحى', 'wake', {}],
  ['ارقص', 'dance', {}],
  ['خفف المزاح', 'humor', { delta: -1 }],
  ['زيد المزاح', 'humor', { delta: 1 }],
  ['شو تقدر تسوي', 'help', {}],
  ['مع السلامة', 'goodbye', {}],
  ['احذف الملفات', 'delete', {}],
  ['سكر المتصفح', 'close', { app: 'browser' }],
  ['يا خلفون', 'call', {}],
  ['', 'empty', {}],
  ['ابغى اعرف كم الوقت', 'time', {}],
  ['الصلاحيات', 'open_settings', {}],
  ['بلبلبل كلام غير مفهوم', 'unknown', {}],
];

for (const [input, intent, slots] of cases) {
  test(`recognize: "${input}" -> ${intent}`, () => {
    const r = recognize(input);
    assert.equal(r.intent, intent, `got ${r.intent} ${JSON.stringify(r.slots)}`);
    for (const [k, v] of Object.entries(slots)) assert.deepEqual(r.slots[k], v, `slot ${k}`);
  });
}

test('findApp prefers the longest matching name', () => {
  assert.equal(findApp(normalize('افتح جوجل كروم')).id, 'browser');
  assert.equal(findApp(normalize('افتح جوجل')).id, 'google');
  assert.equal(findApp(normalize('ولا شي')), null);
});

test('rawRestAfter keeps the original spelling', () => {
  assert.equal(rawRestAfter('اكتب: مرحباً بكم يا خلفون', ['اكتب']), 'مرحباً بكم');
  assert.equal(rawRestAfter('لا شي هنا', ['اكتب']), null);
});

test('«جهّز الاستماع» and «نزّل عقلك» ask for the one-click setup', () => {
  for (const t of ['جهّز الاستماع', 'ركب لي السماعة', 'ثبت اذانك']) assert.deepEqual([recognize(t).intent, recognize(t).slots.part], ['setup', 'voice'], t);
  for (const t of ['نزّل عقلك', 'جهز العقل', 'ركب لك مخ']) assert.deepEqual([recognize(t).intent, recognize(t).slots.part], ['setup', 'brain'], t);
  // «نزّل الصوت» means turn the volume down, not install listening.
  assert.equal(recognize('نزل الصوت').intent, 'volume');
  assert.notEqual(recognize('نزل نموذج').intent, 'setup');
  assert.equal(recognize('افتح اعداداتك').intent, 'open_settings');
});
