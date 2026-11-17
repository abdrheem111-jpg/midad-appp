// Rule-based understanding of spoken Omani/Gulf Arabic commands.
// Input is whatever the speech recognizer (or keyboard) produced; output is an
// intent name plus slots. The rules run offline and in well under a millisecond.

import { normalize, hasPhrase, parseMinutes } from './arabic.js';

const N = (list) => list.map(normalize).sort((a, b) => b.length - a.length);

const FILLERS = N([
  'يا خلفون', 'خلفون', 'لو سمحت', 'لوسمحت', 'من فضلك', 'الله يخليك', 'الله يعافيك',
  'بليز', 'يا', 'ممكن', 'تقدر', 'ابا', 'ابي', 'ابغى', 'ابغا', 'اريد', 'ودي', 'بغيت',
  'ابغاك', 'ابيك', 'اباك', 'ابغيك', 'عاد', 'طال عمرك',
]);

/** Apps and sites the assistant knows by name. `kind` decides how main opens it. */
export const APPS = [
  { id: 'browser', kind: 'app', names: ['المتصفح', 'متصفح', 'الانترنت', 'النت', 'كروم', 'جوجل كروم', 'الكروم', 'ايدج', 'الايدج', 'فايرفوكس', 'البراوزر', 'براوزر'] },
  { id: 'google', kind: 'url', url: 'https://www.google.com', names: ['جوجل', 'قوقل', 'غوغل', 'google'] },
  { id: 'youtube', kind: 'url', url: 'https://www.youtube.com', names: ['يوتيوب', 'اليوتيوب', 'يوتيب', 'youtube'] },
  { id: 'whatsapp', kind: 'url', url: 'https://web.whatsapp.com', names: ['الواتساب', 'واتساب', 'الواتس', 'واتس اب', 'whatsapp'] },
  { id: 'calculator', kind: 'app', names: ['الحاسبه', 'حاسبه', 'الاله الحاسبه', 'الكالكوليتر', 'الحاسبة'] },
  { id: 'notepad', kind: 'app', names: ['المفكره', 'مفكره', 'النوتباد', 'نوت باد', 'نوتباد', 'الملاحظات'] },
  { id: 'paint', kind: 'app', names: ['الرسام', 'برنامج الرسم', 'بينت', 'البينت'] },
  { id: 'explorer', kind: 'app', names: ['الملفات', 'مستكشف الملفات', 'المستكشف', 'ملفاتي', 'المجلدات'] },
  { id: 'downloads', kind: 'folder', names: ['التنزيلات', 'التحميلات', 'الداونلود', 'مجلد التنزيلات'] },
  { id: 'documents', kind: 'folder', names: ['المستندات', 'مستنداتي', 'الوثايق', 'مجلد المستندات'] },
  { id: 'pictures', kind: 'folder', names: ['الصور', 'صوري', 'مجلد الصور'] },
  { id: 'word', kind: 'app', names: ['الوورد', 'وورد', 'الورد', 'word'] },
  { id: 'excel', kind: 'app', names: ['الاكسل', 'اكسل', 'الاكسيل', 'excel'] },
  { id: 'powerpoint', kind: 'app', names: ['البوربوينت', 'بوربوينت', 'الباوربوينت', 'باوربوينت', 'العروض التقديميه', 'powerpoint'] },
  { id: 'settings', kind: 'app', names: ['اعدادات الجهاز', 'اعدادات الكمبيوتر', 'اعدادات ويندوز', 'الاعدادات'] },
].map((a) => ({ ...a, names: N(a.names) }));

const L = {
  stopExact: N(['وقف', 'بس', 'خلاص', 'اسكت', 'وقف وقف', 'خلاص بس', 'كفايه', 'الغي', 'كنسل', 'بس بس', 'استوب']),
  yesExact: N(['نعم', 'اي', 'ايوه', 'ايوا', 'اكيد', 'تمام', 'اوكي', 'اوك', 'يب', 'صح', 'زين', 'ماشي', 'نفذ', 'سوها', 'سويها', 'يلا', 'يالله', 'طيب', 'اي نعم', 'اكيد سوها', 'ok', 'yes']),
  noExact: N(['لا', 'لا لا', 'لاء', 'خلها', 'خليها', 'بلاش', 'ما ابا', 'ما ابي', 'لا تسوي', 'لا تسويها', 'مب لازم', 'لا شكرا', 'no']),
  remind: N(['ذكرني', 'نبهني', 'فكرني', 'ذكرني بعد', 'سولي تذكير', 'سو تذكير', 'حط تذكير', 'حط منبه']),
  type: N(['تكتب لي', 'تكتبلي', 'تكتب', 'اكتب لي', 'اكتبلي', 'اكتب', 'كتب لي', 'دون لي', 'دون']),
  search: N(['تدور لي عن', 'تدور لي على', 'تدورلي عن', 'تدور لي', 'تدورلي', 'تدور عن', 'تدور على', 'تدور', 'تبحث عن', 'تبحث لي عن', 'دور لي عن', 'دور لي على', 'دورلي عن', 'دورلي على', 'دور لي', 'دورلي', 'دور عن', 'دور على', 'دور', 'ابحث لي عن', 'ابحث عن', 'ابحث', 'فتش عن', 'فتش على', 'فتش', 'سيرش', 'سيرش عن']),
  open: N(['تفتح لي', 'تفتحلي', 'تفتح', 'تفج', 'تشغل', 'تشغل لي', 'افتح لي', 'افتحلي', 'افتح', 'فج لي', 'فجلي', 'فج', 'فك لي', 'فك', 'شغل لي', 'شغللي', 'شغل', 'وديني', 'ودني', 'روح على']),
  close: N(['سكر', 'سكرلي', 'اقفل', 'بند', 'اغلق', 'طفي البرنامج', 'سكر البرنامج']),
  volumeWord: N(['الصوت', 'الصوط', 'الساوند']),
  volumeUp: N(['ارفع', 'علي', 'كبر', 'زيد', 'عل', 'ما اسمع', 'ما اسمعه', 'اعلى']),
  volumeDown: N(['وطي', 'نزل', 'قصر', 'صغر', 'خفض', 'خفف', 'عالي', 'واجد عالي', 'ادنى']),
  volumeMute: N(['اكتم', 'كتم', 'سكت', 'طفي', 'اقفل', 'سكر']),
  screenshot: N(['صور الشاشه', 'صورلي الشاشه', 'لقطه شاشه', 'لقطه للشاشه', 'سكرين شوت', 'سكرينشوت', 'صوره للشاشه', 'خذ صوره للشاشه', 'خذ لقطه']),
  time: N(['كم الساعه', 'الساعه كم', 'كم الوقت', 'الوقت كم', 'شو الوقت', 'ايش الوقت', 'كم الساعه الحين', 'الساعه الحين']),
  date: N(['كم التاريخ', 'شو التاريخ', 'التاريخ اليوم', 'اليوم كم', 'شو اليوم', 'اي يوم اليوم', 'ايش اليوم', 'تاريخ اليوم']),
  joke: N(['نكته', 'نكت', 'ضحكني', 'قول نكته', 'عطني نكته', 'قول شي يضحك', 'سو شي يضحك', 'نكته ثانيه', 'وحده ثانيه']),
  organize: N(['رتب', 'نظم', 'رتبلي', 'نظف']),
  undo: N(['تراجع', 'رجع', 'رجعها', 'رجع الترتيب', 'تراجع عن الترتيب', 'الغ الترتيب']),
  sleep: N(['نام', 'روح نام', 'نوم', 'تصبح على خير', 'وقت النوم']),
  wake: N(['اصحى', 'قوم', 'صح النوم', 'اصح', 'قم']),
  come: N(['تعال', 'تعال هني', 'تعال هنا', 'وينك', 'تعال عندي', 'اظهر']),
  away: N(['روح الزاويه', 'ابعد', 'روح بعيد', 'خلني اركز', 'وضع التركيز', 'لا تزعجني', 'اختفي', 'روح ورا']),
  dance: N(['ارقص', 'رقصه', 'رقص', 'سو رقصه']),
  jump: N(['اقفز', 'نط', 'قفز']),
  humorUp: N(['زيد المزاح', 'خلك مجنون', 'ضحكني اكثر', 'زيد الضحك', 'كن مضحك']),
  humorDown: N(['خفف المزاح', 'خلك هادي', 'بلا مزح', 'بدون مزح', 'خلك جدي', 'قلل المزاح']),
  greet: N(['السلام عليكم', 'سلام عليكم', 'السلام', 'مرحبا', 'مرحبه', 'هلا', 'هلا والله', 'اهلين', 'اهلا', 'صباح الخير', 'مساء الخير', 'صباح النور', 'هاي', 'حياك', 'هلو']),
  howareyou: N(['شحالك', 'شخبارك', 'كيفك', 'كيف حالك', 'شو اخبارك', 'عساك بخير', 'شلونك', 'كيف الحال', 'شحالكم']),
  who: N(['من انت', 'منو انت', 'شو اسمك', 'ايش اسمك', 'عرف عن نفسك', 'عرفني بنفسك', 'من تكون']),
  thanks: N(['شكرا', 'مشكور', 'تسلم', 'يعطيك العافيه', 'ما قصرت', 'تسلم يدك', 'ثانكيو', 'شكرا لك', 'يسلمو']),
  praise: N(['شاطر', 'احسنت', 'برافو', 'ما شاء الله عليك', 'زين عليك', 'عفيه', 'كفو', 'انت ذكي', 'حبيبي', 'احبك', 'انت رهيب', 'وايد زين']),
  scold: N(['غبي', 'مب زين', 'ما تفهم', 'فاشل', 'سيء', 'خايس', 'ما تعرف شي']),
  setName: N(['انا اسمي', 'اسمي', 'ناديني', 'سمني']),
  help: N(['شو تقدر تسوي', 'ايش تقدر تسوي', 'ساعدني', 'مساعده', 'الاوامر', 'شو تعرف', 'وش تعرف', 'شو تسوي']),
  settings: N(['اعداداتك', 'الصلاحيات', 'غير الصلاحيات', 'اعدادات خلفون', 'افتح اعداداتك']),
  goodbye: N(['مع السلامه', 'باي', 'في امان الله', 'الله معك', 'نشوفك']),
  delete: N(['احذف', 'امسح', 'شيل', 'احذفلي', 'امسحلي']),
};

const MORNING = N(['صباح الخير', 'صباح النور']);
const EVENING = N(['مساء الخير']);
const YOUTUBE = N(['يوتيوب', 'اليوتيوب', 'يوتيب']);

function stripFillers(normalized) {
  let padded = ` ${normalized} `;
  for (const f of FILLERS) {
    while (padded.includes(` ${f} `)) padded = padded.replace(` ${f} `, ' ');
  }
  return padded.replace(/\s+/g, ' ').trim();
}

function findPhrase(padded, list) {
  for (const p of list) if (hasPhrase(padded, p)) return p;
  return null;
}

function startsWithPhrase(text, list) {
  for (const p of list) if (text === p || text.startsWith(`${p} `)) return p;
  return null;
}

/** Finds a known app/site name inside normalized text. */
export function findApp(normalizedText) {
  const padded = ` ${normalizedText} `;
  let best = null;
  for (const app of APPS) {
    for (const name of app.names) {
      if (hasPhrase(padded, name) && (!best || name.length > best.name.length)) best = { app, name };
    }
  }
  return best ? best.app : null;
}

/**
 * Returns the original (non-normalized) words that follow one of the verbs,
 * skipping helper words. Keeps the user's spelling for text we will type or search.
 */
export function rawRestAfter(raw, verbs, skip = []) {
  const tokens = String(raw).trim().split(/\s+/).filter(Boolean);
  const norm = tokens.map(normalize);
  for (let i = 0; i < norm.length; i += 1) {
    for (const verb of verbs) {
      const parts = verb.split(' ');
      if (parts.every((w, k) => norm[i + k] === w)) {
        let j = i + parts.length;
        while (j < norm.length && (skip.includes(norm[j]) || norm[j] === '')) j += 1;
        return tokens.slice(j).join(' ').replace(/[\s،,.!؟?]*(يا\s+)?خلفون[\s،,.!؟?]*$/u, '').trim();
      }
    }
  }
  return null;
}

const DURATION_WORDS = new Set(['بعد', 'ربع', 'نص', 'نصف', 'ساعه', 'ساعات', 'ساعتين', 'الا', 'دقيقه', 'دقايق', 'دقائق', 'دقيقتين', 'ثانيه', 'ثواني']);

function reminderNote(raw, verbs) {
  const rest = rawRestAfter(raw, verbs) || '';
  const words = rest.split(/\s+/).filter(Boolean).filter((w) => {
    const n = normalize(w);
    return n && !DURATION_WORDS.has(n) && !/^\d+$/.test(n) && !/^(واحد|اثنين|ثلاث|ثلاثه|اربع|اربعه|خمس|خمسه|ست|سته|سبع|سبعه|ثمان|ثمانيه|تسع|تسعه|عشر|عشره|عشرين|ثلاثين|اربعين|خمسين|ستين)$/.test(n);
  });
  while (words.length && /^(ب|عن|ان|انه|انو|على)$/.test(normalize(words[0]))) words.shift();
  if (words.length && /^بال/.test(words[0])) words[0] = words[0].slice(1);
  return words.join(' ').trim();
}

/**
 * Understands one utterance.
 * @param {string} raw
 * @returns {{intent: string, slots: Record<string, any>, confidence: number, text: string}}
 */
export function recognize(raw) {
  const normalized = normalize(raw);
  const text = stripFillers(normalized);
  const padded = ` ${text} `;
  const out = (intent, slots = {}, confidence = 0.9) => ({ intent, slots, confidence, text });

  if (!normalized) return out('empty', {}, 1);
  if (!text) return out('call', {}, 0.95);

  if (L.stopExact.includes(text)) return out('stop', {}, 0.98);
  if (L.yesExact.includes(text)) return out('yes', {}, 0.95);
  if (L.noExact.includes(text)) return out('no', {}, 0.95);

  if (findPhrase(padded, L.remind)) {
    const minutes = parseMinutes(text);
    return out('reminder', { minutes, note: reminderNote(raw, L.remind) }, minutes ? 0.92 : 0.6);
  }

  const typeVerb = startsWithPhrase(text, L.type);
  if (typeVerb) {
    const content = rawRestAfter(raw, L.type, N(['هذا', 'هذي', 'هالكلام', 'الكلام', 'التالي']));
    return out('type_text', { text: content || '' }, content ? 0.93 : 0.6);
  }

  if (findPhrase(padded, L.volumeWord)) {
    if (findPhrase(padded, L.volumeMute)) return out('volume', { direction: 'mute' });
    if (findPhrase(padded, L.volumeDown)) return out('volume', { direction: 'down' });
    if (findPhrase(padded, L.volumeUp)) return out('volume', { direction: 'up' });
    return out('volume', { direction: 'up' }, 0.6);
  }

  if (findPhrase(padded, L.screenshot)) return out('screenshot');

  const searchVerb = startsWithPhrase(text, L.search);
  if (searchVerb) {
    const engine = findPhrase(padded, YOUTUBE) ? 'youtube' : 'google';
    let query = rawRestAfter(raw, L.search, N(['لي', 'عن', 'على'])) || '';
    query = query.replace(/\s*(في|ف|على|عل|من)\s+(ال)?(يوتيوب|يوتيب|جوجل|قوقل|غوغل)\s*$/u, '').trim();
    query = query.replace(/^(في|على)\s+(ال)?(يوتيوب|يوتيب|جوجل|قوقل)\s+(عن|على)?\s*/u, '').trim();
    return out('search', { query, engine }, query ? 0.92 : 0.6);
  }

  if (startsWithPhrase(text, L.organize) && findApp(text)?.id === 'downloads') return out('organize_downloads');
  if (startsWithPhrase(text, L.undo) && /(ترتيب|رتبت|تنزيلات|التنزيلات|رجع|تراجع)/.test(text)) return out('undo_organize', {}, 0.85);

  if (findPhrase(padded, L.settings)) return out('open_settings');

  const openVerb = startsWithPhrase(text, L.open);
  if (openVerb) {
    const app = findApp(text);
    if (app) return out('open', { app: app.id, kind: app.kind, url: app.url || null });
    const name = rawRestAfter(raw, L.open, N(['لي', 'برنامج'])) || '';
    return out('open_unknown', { name }, 0.6);
  }
  if (startsWithPhrase(text, L.close)) {
    const app = findApp(text);
    return out('close', { app: app ? app.id : null }, 0.8);
  }
  if (startsWithPhrase(text, L.delete)) return out('delete', { target: rawRestAfter(raw, L.delete) || '' }, 0.85);

  if (findPhrase(padded, L.time)) return out('time');
  if (findPhrase(padded, L.date)) return out('date');
  if (findPhrase(padded, L.humorUp)) return out('humor', { delta: 1 });
  if (findPhrase(padded, L.humorDown)) return out('humor', { delta: -1 });
  if (findPhrase(padded, L.joke)) return out('joke');
  if (findPhrase(padded, L.help)) return out('help');
  if (findPhrase(padded, L.away)) return out('away');
  if (startsWithPhrase(text, L.dance)) return out('dance');
  if (startsWithPhrase(text, L.jump)) return out('jump');
  if (startsWithPhrase(text, L.sleep) || findPhrase(padded, N(['تصبح على خير']))) return out('sleep');
  if (startsWithPhrase(text, L.wake)) return out('wake');
  if (startsWithPhrase(text, L.come)) return out('come');

  const nameVerb = startsWithPhrase(text, L.setName);
  if (nameVerb) {
    const name = (rawRestAfter(raw, L.setName) || '').split(/\s+/).slice(0, 3).join(' ');
    if (name) return out('set_name', { name }, 0.9);
  }

  if (findPhrase(padded, L.who)) return out('who');
  if (findPhrase(padded, L.howareyou)) return out('how_are_you');
  if (findPhrase(padded, L.greet)) {
    const part = findPhrase(padded, MORNING) ? 'morning' : findPhrase(padded, EVENING) ? 'evening' : 'any';
    return out('greet', { part });
  }
  if (findPhrase(padded, L.thanks)) return out('thanks');
  if (findPhrase(padded, L.praise)) return out('praise');
  if (findPhrase(padded, L.scold)) return out('scold');
  if (findPhrase(padded, L.goodbye)) return out('goodbye');
  if (startsWithPhrase(text, N(['وقف']))) return out('stop', {}, 0.85);

  return out('unknown', {}, 0.2);
}
