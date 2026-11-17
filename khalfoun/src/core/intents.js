// Rule-based understanding of spoken Omani/Gulf Arabic commands.
// Input is whatever the speech recognizer (or keyboard) produced; output is an
// intent name plus slots. The rules run offline and in well under a millisecond.

import { normalize, hasPhrase, parseMinutes } from './arabic.js';
import { levenshtein } from './wake.js';

const N = (list) => list.map(normalize).sort((a, b) => b.length - a.length);

const FILLERS = N([
  'يا خلفون', 'خلفون', 'لو سمحت', 'لوسمحت', 'من فضلك', 'الله يخليك', 'الله يعافيك',
  'بليز', 'يا', 'ممكن', 'تقدر', 'ابا', 'ابي', 'ابغى', 'ابغا', 'اريد', 'ودي', 'بغيت',
  'ابغاك', 'ابيك', 'اباك', 'ابغيك', 'عاد', 'طال عمرك', 'لو تكرمت', 'بسرعه', 'الحين', 'هسه', 'خلنا',
  'يا الغالي', 'الغالي', 'يا ريال', 'يا رجال', 'يا اخوي', 'اخوي', 'يا بعدي', 'بعد عمري', 'اذا ممكن', 'اذا سمحت',
]);
/** Words that mean «I want»: «ابي الحاسبة» opens it. */
const WANT = N(['ابا', 'ابي', 'ابغى', 'ابغا', 'اريد', 'ودي', 'بغيت', 'عطني', 'هات', 'جيب لي', 'جيبلي']);

/** Apps and sites the assistant knows by name. `kind` decides how main opens it. */
export const APPS = [
  { id: 'browser', kind: 'app', names: ['المتصفح', 'متصفح', 'الانترنت', 'النت', 'كروم', 'جوجل كروم', 'الكروم', 'ايدج', 'الايدج', 'فايرفوكس', 'البراوزر', 'براوزر'] },
  { id: 'google', kind: 'url', url: 'https://www.google.com', names: ['جوجل', 'قوقل', 'غوغل', 'google'] },
  { id: 'youtube', kind: 'url', url: 'https://www.youtube.com', names: ['يوتيوب', 'اليوتيوب', 'يوتيب', 'youtube'] },
  { id: 'whatsapp', kind: 'url', url: 'https://web.whatsapp.com', names: ['الواتساب', 'واتساب', 'الواتس', 'واتس اب', 'whatsapp'] },
  { id: 'calculator', kind: 'app', names: ['الحاسبه', 'حاسبه', 'الاله الحاسبه', 'الكالكوليتر', 'الحاسبة'] },
  { id: 'notepad', kind: 'app', names: ['المفكره', 'مفكره', 'النوتباد', 'نوت باد', 'النوت باد', 'نوتباد', 'الملاحظات', 'المذكره'] },
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
  noExact: N(['لا', 'لا لا', 'لاء', 'خلها', 'خليها', 'بلاش', 'ما ابا', 'ما ابي', 'لا تسوي', 'لا تسويها', 'مب لازم', 'لا شكرا', 'لا خلها', 'لا خليها', 'لا بلاش', 'لا ما ابا', 'لا ما ابي', 'لا مب لازم', 'ما يحتاج', 'لا ما يحتاج', 'no']),
  soundsOff: N(['اسكت الاصوات', 'بدون اصوات', 'بلا اصوات', 'وقف الاصوات', 'سكت الاصوات', 'اكتم صوتك', 'لا تطلع اصوات', 'طفي الاصوات']),
  soundsOn: N(['شغل الاصوات', 'رجع الاصوات', 'شغل صوتك', 'ابا الاصوات', 'خل الاصوات']),
  pdfSign: N(['وقع الملف', 'وقع البي دي اف', 'وقع ملف البي دي اف', 'حط توقيعي', 'حط اسمي في الملف', 'وقع لي الملف', 'وقعلي الملف']),
  cancelReminders: N(['الغ التذكير', 'الغي التذكير', 'الغ التذكيرات', 'الغي التذكيرات', 'وقف التذكير', 'وقف التذكيرات', 'شيل التذكير', 'شيل التذكيرات', 'لا تذكرني', 'بلاش التذكير']),
  clearRoutines: N(['الغ العادات', 'لا تفتح شي لحالك', 'لا تفتح شي بروحك', 'انس العادات', 'وقف العادات']),
  remind: N(['ذكرني', 'نبهني', 'فكرني', 'ذكرني بعد', 'سولي تذكير', 'سو تذكير', 'حط تذكير', 'حط منبه']),
  type: N(['تكتب لي', 'تكتبلي', 'تكتب', 'اكتب لي', 'اكتبلي', 'اكتب', 'كتب لي', 'دون لي', 'دون']),
  search: N(['تدور لي عن', 'تدور لي على', 'تدورلي عن', 'تدور لي', 'تدورلي', 'تدور عن', 'تدور على', 'تدور', 'تبحث عن', 'تبحث لي عن', 'دور لي عن', 'دور لي على', 'دورلي عن', 'دورلي على', 'دور لي', 'دورلي', 'دور عن', 'دور على', 'دور', 'ابحث لي عن', 'ابحث عن', 'ابحث', 'فتش عن', 'فتش على', 'فتش', 'سيرش', 'سيرش عن']),
  open: N(['تفتح لي', 'تفتحلي', 'تفتح', 'تفج', 'تشغل', 'تشغل لي', 'افتح لي', 'افتحلي', 'افتح', 'فتح لي', 'فتحلي', 'فتح', 'نفتح', 'فج لي', 'فجلي', 'فج', 'فك لي', 'فك', 'شغل لي', 'شغللي', 'شغل', 'نشغل', 'وديني', 'ودني', 'روح على', 'دخلني', 'دخل على']),
  close: N(['سكر', 'سكرلي', 'سكر لي', 'تسكر', 'اقفل', 'اقفل لي', 'تقفل', 'بند', 'اغلق', 'طفي', 'طفي لي', 'طفي البرنامج', 'سكر البرنامج']),
  closeIt: N(['سكره', 'سكرها', 'سكرهم', 'سكرة', 'اقفله', 'اقفلها', 'بنده', 'بندها', 'طفيه', 'طفيها', 'اغلقه', 'اغلقها', 'سكره خلاص', 'سكرها خلاص']),
  openIt: N(['افتحه', 'افتحها', 'افتحه مره ثانيه', 'افتحها مره ثانيه', 'رجعه', 'رجعها', 'شغله', 'شغلها', 'فجه', 'فجها']),
  repeat: N(['مره ثانيه', 'مرة ثانيه', 'عيدها', 'عيد', 'كمان مره', 'كمان', 'سوها مره ثانيه', 'سويها مره ثانيه', 'زيد', 'بعد', 'زيد بعد', 'اكثر', 'زياده', 'بعد زيد', 'نفس الشي', 'كرر', 'كررها', 'ثاني مره', 'مره ثاني']),
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
  costumeOff: N(['شيل البشت', 'فسخ البشت', 'نزل العلم', 'شيل العلم', 'شيل الفانوس', 'شيل الزي', 'رجع لبسك العادي', 'البس العادي']),
  bisht: N(['البس البشت', 'لبس البشت', 'البس بشتك', 'وين البشت', 'البشت']),
  flag: N(['ارفع العلم', 'شيل علم عمان', 'ارفع علم عمان', 'وين العلم', 'العلم']),
  lantern: N(['الفانوس', 'شيل فانوس', 'جيب الفانوس', 'ولع الفانوس']),
  quiz: N(['اختبرني', 'اسالني', 'اسالني سوال', 'اسالني سؤال', 'سؤال رياضيات', 'سوال رياضيات', 'خلنا نلعب', 'نلعب', 'العب معي', 'مسابقه', 'سؤال حساب', 'نتحدى', 'تحداني', 'نراجع رياضيات', 'لعبه رياضيات']),
  dontKnow: N(['ما اعرف', 'ما ادري', 'مدري', 'ما عرفت', 'صعبه', 'صعب', 'استسلم', 'ما اعرفه', 'قول الجواب', 'شو الجواب']),
  nextQ: N(['سؤال ثاني', 'سوال ثاني', 'غيره', 'غير السؤال', 'سؤال غيره', 'التالي', 'غيرها']),
  delete: N(['احذف', 'امسح', 'شيل', 'احذفلي', 'امسحلي']),
};

/** How the person says they feel. Negative lists are checked first («مب مرتاح» before «مرتاح»). */
export const FEELINGS = [
  ['sad', N(['زعلان', 'زعلانه', 'حزين', 'حزينه', 'متضايق', 'متضايقه', 'ضايق خلقي', 'ضايقه خلقي', 'مكتئب', 'مقهور', 'مالي خلق', 'ماني مرتاح', 'مب مرتاح', 'مو مرتاح', 'نفسيتي تعبانه', 'خاطري مكسور'])],
  ['sick', N(['مريض', 'مريضه', 'عندي حراره', 'راسي يعورني', 'بطني يعورني', 'عندي زكام', 'مزكم', 'عيان', 'عيانه', 'عندي صداع'])],
  ['stressed', N(['مضغوط', 'مضغوطه', 'متوتر', 'متوتره', 'قلقان', 'قلقانه', 'خايف من الامتحان', 'عندي امتحان', 'وراي امتحان', 'عندي اختبار', 'وراي اختبار', 'مستعجل', 'مستعجله'])],
  ['tired', N(['تعبان', 'تعبانه', 'تعبت', 'مرهق', 'مرهقه', 'هلكان', 'هلكانه', 'هلكت', 'ميت تعب', 'منهد', 'منهك'])],
  ['sleepy', N(['نعسان', 'نعسانه', 'نعست', 'ابا انام', 'ابي انام', 'ابغى انام'])],
  ['hungry', N(['جوعان', 'جوعانه', 'جعت', 'جوعت', 'ميت جوع'])],
  ['bored', N(['طفشان', 'طفشانه', 'زهقان', 'زهقانه', 'مليت', 'طفشت', 'زهقت'])],
  ['success', N(['نجحت', 'جبت الدرجه', 'درجه كامله', 'الدرجه الكامله', 'فزت', 'فزنا', 'خلصت المشروع', 'خلصت الشغل', 'انقبلت', 'ترقيت', 'جبت الاول', 'اخذت الاول', 'طلعت الاول'])],
  ['happy', N(['فرحان', 'فرحانه', 'مستانس', 'مستانسه', 'مبسوط', 'مبسوطه', 'وناسه', 'سعيد اليوم', 'مرتاح', 'مرتاحه', 'يومي حلو', 'يومي زين'])],
];

/** True when the text is just an app's name, maybe with «برنامج/مجلد» or a want-word. */
function APP_NAME_ONLY(text, app) {
  const rest = WANT.reduce((t, w) => (t.startsWith(`${w} `) ? t.slice(w.length + 1) : t), text).replace(/^(برنامج|مجلد|موقع) /, '');
  return app.names.includes(rest);
}

// ------------------------------------------------------------- teaching
const TEACH_HEAD = /^(?:يا خلفون\s+|خلفون\s+)?(?:لما|لمن|اذا|إذا|متى ما|كل ما|كلما|يوم)\s+(?:اقول|أقول|قلت|اقولك|أقولك|قلتلك|قلت لك)(?:\s+لك)?\s+(.+)$/u;
const TEACH_SEP = /\s+(?:يعني|معناها|معناه|قصدي|افهم|افهمها|افهمه|تراها|ترا|اقصد|أقصد)\s*[:،,]?\s+/u;

/**
 * «لما أقول صباحو يعني افتح المتصفح» → {phrase: 'صباحو', command: 'افتح المتصفح'}.
 * Without «يعني», the command starts at the first command verb («لما أقول X افتح Y»).
 */
export function parseTeach(raw) {
  const m = TEACH_HEAD.exec(String(raw || '').trim());
  if (!m) return null;
  let body = m[1].replace(/[«»"“”]/g, '').trim();
  let phrase = null;
  let command = null;
  const sep = TEACH_SEP.exec(body);
  if (sep) {
    phrase = body.slice(0, sep.index);
    command = body.slice(sep.index + sep[0].length);
  } else {
    const words = body.split(/\s+/);
    const verbs = [...L.open, ...L.close, ...L.search, ...L.type, ...L.remind].filter((v) => !v.includes(' '));
    const at = words.findIndex((w, i) => i > 0 && verbs.includes(normalize(w)));
    if (at > 0) { phrase = words.slice(0, at).join(' '); command = words.slice(at).join(' '); }
  }
  phrase = (phrase || '').replace(/[،,:.!؟?]+$/u, '').trim();
  command = (command || '').replace(/[،,:.!؟?]+$/u, '').trim();
  if (!phrase || !command || phrase.length > 60 || command.length > 200) return null;
  return { phrase, command };
}

/** The form a sentence is remembered under when the person teaches a phrase. */
export function phraseKey(raw) {
  return stripFillers(normalize(raw));
}

// ------------------------------------------------------- several commands
const THEN = new Set(N(['وبعدين', 'بعدين', 'وبعدها', 'بعدها', 'ثم', 'وثم', 'وبعد كذا', 'بعد كذا']));
const SPLIT_INTENTS = new Set(['open', 'close', 'search', 'type_text', 'pdf_write', 'volume', 'reminder', 'screenshot', 'time', 'date',
  'joke', 'dance', 'jump', 'come', 'away', 'sleep', 'organize_downloads', 'cancel_reminders', 'quiz', 'sounds']);
const LEAD_VERBS = new Set(N(['افتح', 'فج', 'شغل', 'سكر', 'اقفل', 'طفي', 'دور', 'ابحث', 'اكتب', 'ذكرني', 'ارفع', 'وطي', 'نزل', 'اكتم', 'رتب', 'صور', 'قول', 'ارقص', 'تعال', 'روح']));

/**
 * Splits «افتح الحاسبة وبعدين المفكرة» or «افتح الحاسبة وافتح الوورد» into
 * separate commands. Only splits when every part is a command on its own, so
 * text to type or search («دور عن خبز ثم حليب») stays whole.
 * @param {string} raw
 * @returns {string[]}
 */
export function splitCommands(raw) {
  const tokens = String(raw || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return [String(raw || '').trim()];
  const parts = [[]];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    const n = normalize(t);
    const two = i + 1 < tokens.length ? `${n} ${normalize(tokens[i + 1])}` : '';
    if (parts.at(-1).length && THEN.has(two)) { parts.push([]); i += 1; continue; }
    if (parts.at(-1).length && (THEN.has(n) || n === 'و')) { parts.push([]); continue; }
    if (parts.at(-1).length && n.length > 2 && n.startsWith('و') && LEAD_VERBS.has(n.slice(1))) { parts.push([t.replace(/^و/u, '')]); continue; }
    parts.at(-1).push(t);
  }
  let segs = parts.map((p) => p.join(' ').trim()).filter(Boolean);
  // «افتح الحاسبة والمفكرة» / «...وبعدين المفكرة»: carry the verb over to a bare app name.
  segs = segs.flatMap((seg, i) => {
    if (i === 0) return [seg];
    const prev = recognize(segs[0]);
    const words = seg.split(/\s+/);
    const bareApp = findApp(normalize(seg));
    if (bareApp && words.length <= 3 && APP_NAME_ONLY(normalize(seg).replace(/^و/, ''), bareApp) && ['open', 'close'].includes(prev.intent)) {
      const verb = prev.intent === 'open' ? 'افتح' : 'سكر';
      return [`${verb} ${seg.replace(/^و/u, '')}`];
    }
    return [seg];
  });
  if (segs.length === 1) {
    // «افتح الحاسبة والمفكرة» in one part: split on «و» + app name.
    const m = /^(.*\S)\s+و(\S+(?:\s+\S+)?)$/u.exec(segs[0]);
    if (m) {
      const first = recognize(m[1]);
      const app = findApp(normalize(m[2]));
      if (['open', 'close'].includes(first.intent) && first.slots.app && app && APP_NAME_ONLY(normalize(m[2]), app)) {
        return [m[1], `${first.intent === 'open' ? 'افتح' : 'سكر'} ${m[2]}`];
      }
    }
    return segs;
  }
  const ok = segs.every((seg) => SPLIT_INTENTS.has(recognize(seg).intent));
  return ok ? segs : [String(raw).trim()];
}

/** The closest known app to a name that was not recognized, or null. */
export function nearestApp(name) {
  const n = normalize(name);
  if (!n || n.length < 3) return null;
  let best = null;
  for (const app of APPS) {
    for (const an of app.names) {
      const d = levenshtein(n, an);
      const limit = Math.max(1, Math.min(2, Math.floor(an.length / 3)));
      if (d <= limit && (!best || d < best.d)) best = { app, d };
    }
  }
  return best ? best.app : null;
}

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

// ------------------------------------------------------------ typo tolerance
// Words the rules know. A word outside this set that is one letter away from
// exactly one known word (two letters for long words) is read as that word, so
// typing slips and speech-recognition mistakes still work («افنح الحاسيه»).
let VOCAB = null;
const CORRECTION_CACHE = new Map();
function vocab() {
  if (VOCAB) return VOCAB;
  VOCAB = new Set();
  const add = (phrase) => { for (const w of phrase.split(' ')) if (w) VOCAB.add(w); };
  for (const list of Object.values(L)) list.forEach(add);
  for (const app of APPS) app.names.forEach(add);
  for (const [, words] of FEELINGS) words.forEach(add);
  FILLERS.forEach(add);
  WANT.forEach(add);
  // everyday words that must never be "corrected" into commands
  N(['الكلام', 'هالكلام', 'كلام', 'التالي', 'برنامج', 'لي', 'كتاب', 'كتابه', 'كتب', 'الكتاب', 'تسلم', 'يسلم', 'عليك', 'عليكم', 'امي', 'ابوي', 'البحر', 'المدرسه', 'السياره', 'قصه', 'الفضاء',
    'حلو', 'حلوه', 'رايك', 'شو', 'ايش', 'وش', 'في', 'عن', 'على', 'من', 'الى', 'مع', 'هذا', 'هذي', 'اليوم', 'امس', 'بكره', 'شوي',
    'واجد', 'وايد', 'زين', 'كيف', 'ليش', 'متى', 'وين', 'منو', 'انا', 'انت', 'هو', 'هي', 'احنا', 'والله', 'صدق', 'كذا', 'ثاني', 'ثانيه',
    'العب', 'نلعب', 'اكل', 'ماي', 'شاي', 'قهوه', 'صلاه', 'الصلاه', 'الجمعه', 'سلام', 'حبيبي', 'قلبي', 'صديقي', 'استاذ', 'الاستاذ',
    'المعلم', 'الطلاب', 'درس', 'الدرس', 'واجب', 'الواجب', 'امتحان', 'الامتحان', 'اختبار', 'الاختبار', 'رياضيات', 'علوم', 'عربي',
    'قرات', 'قريت', 'شفت', 'سمعت', 'رحت', 'جيت', 'خربانه', 'خربان', 'جميل', 'جميله', 'ساعه', 'ساعات', 'دقيقه', 'دقايق']).forEach(add);
  return VOCAB;
}

function correctWord(w) {
  if (w.length < 4 || /\d/.test(w)) return w;
  const known = vocab();
  if (known.has(w)) return w;
  if (CORRECTION_CACHE.has(w)) return CORRECTION_CACHE.get(w);
  let best = null;
  let bestD = Infinity;
  let tie = false;
  const maxD = w.length >= 8 ? 2 : 1;
  for (const k of known) {
    if (k.length < 4 || Math.abs(k.length - w.length) > maxD) continue;
    const d = levenshtein(w, k);
    if (d > maxD) continue;
    if (d < bestD) { best = k; bestD = d; tie = false; } else if (d === bestD && k !== best) tie = true;
  }
  const out = best && !tie ? best : w;
  if (CORRECTION_CACHE.size > 2000) CORRECTION_CACHE.clear();
  CORRECTION_CACHE.set(w, out);
  return out;
}

/** Corrects near-miss words in normalized text (see above). */
export function correctTypos(normalizedText) {
  return normalizedText.split(' ').map(correctWord).join(' ');
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
  const norm = tokens.map((t) => (fuzzyPass ? correctWord(normalize(t)) : normalize(t)));
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

function reminderNote(raw, verbs, repeat = false) {
  const rest = rawRestAfter(raw, verbs) || '';
  const words = rest.split(/\s+/).filter(Boolean).filter((w) => {
    const n = normalize(w);
    return n && !DURATION_WORDS.has(n) && !(repeat && n === 'كل') && !/^\d+$/.test(n) && !/^(واحد|اثنين|ثلاث|ثلاثه|اربع|اربعه|خمس|خمسه|ست|سته|سبع|سبعه|ثمان|ثمانيه|تسع|تسعه|عشر|عشره|عشرين|ثلاثين|اربعين|خمسين|ستين)$/.test(n);
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
  const exact = recognizeOnce(raw, false);
  if (!['unknown', 'open_unknown'].includes(exact.intent) && !(exact.intent === 'close' && !exact.slots.app)) return exact;
  // Not understood as written: try again reading near-miss words as known ones,
  // and accept only a command (never a chat reply) from that second reading.
  const fuzzy = recognizeOnce(raw, true);
  if (FUZZY_OK.has(fuzzy.intent) && !(fuzzy.intent === 'close' && !fuzzy.slots.app)) {
    return { ...fuzzy, confidence: Math.min(fuzzy.confidence, 0.8), slots: { ...fuzzy.slots, corrected: true } };
  }
  return exact;
}

/** Intents a typo-corrected reading may produce. */
const FUZZY_OK = new Set(['open', 'close', 'search', 'type_text', 'pdf_write', 'pdf_sign', 'volume', 'reminder', 'cancel_reminders',
  'screenshot', 'time', 'date', 'joke', 'organize_downloads', 'quiz', 'help', 'dance', 'come', 'away', 'sounds', 'setup', 'open_settings']);
let fuzzyPass = false;

function recognizeOnce(raw, fuzzy) {
  fuzzyPass = fuzzy;
  try {
    return recognizeText(raw, fuzzy);
  } finally {
    fuzzyPass = false;
  }
}

function recognizeText(raw, fuzzy) {
  const normalized = normalize(raw);
  const text = stripFillers(fuzzy ? correctTypos(normalized) : normalized);
  const padded = ` ${text} `;
  const out = (intent, slots = {}, confidence = 0.9) => ({ intent, slots, confidence, text });

  if (!normalized) return out('empty', {}, 1);
  if (!text) return out('call', {}, 0.95);

  if (L.stopExact.includes(text)) return out('stop', {}, 0.98);
  if (L.yesExact.includes(text)) return out('yes', {}, 0.95);
  if (L.noExact.includes(text)) return out('no', {}, 0.95);

  if (L.repeat.includes(text)) return out('repeat', {}, 0.85);
  if (L.closeIt.includes(text)) return out('close', { app: null, it: true }, 0.85);
  if (L.openIt.includes(text)) return out('open_again', {}, 0.85);
  const teach = parseTeach(raw);
  if (teach) return out('teach', teach, 0.9);

  if (findPhrase(padded, L.cancelReminders)) return out('cancel_reminders');
  if (findPhrase(padded, L.clearRoutines)) return out('clear_routines');
  if (findPhrase(padded, L.remind)) {
    const minutes = parseMinutes(text);
    const repeat = / كل (\S+ )?(دقيقه|دقايق|دقائق|دقيقتين|ساعه|ساعات|ساعتين|ربع|نص|نصف)( |$)/.test(` ${text} `);
    return out('reminder', { minutes, note: reminderNote(raw, L.remind, repeat), repeat }, minutes ? 0.92 : 0.6);
  }

  if (findPhrase(padded, L.pdfSign)) {
    return out('pdf_sign', { position: /(فوق|اعلى|الاعلى)/.test(text) ? 'top' : 'bottom' });
  }

  const typeVerb = startsWithPhrase(text, L.type);
  if (typeVerb) {
    let content = rawRestAfter(raw, L.type, N(['هذا', 'هذي', 'هالكلام', 'الكلام', 'التالي'])) || '';
    // «اكتب ... في ملف الـPDF» writes into the newest PDF instead of the active window
    const pdfTail = /\s*(فوق|تحت|في الأعلى|في الاعلى|في الأسفل|في الاسفل)?\s*(في|ف|على|بـ?)\s*(ملف\s*)?(ال)?(pdf|بي\s*دي\s*اف|بيدي\s*اف|بي\s*دي\s*إف|الـ\s*pdf)\s*(فوق|تحت|في الأعلى|في الاعلى|في الأسفل|في الاسفل)?\s*$/iu;
    // «اكتب في البي دي اف ...» names the PDF first
    const pdfHead = /^\s*(في|ف|على)\s*(ملف\s*)?(ال)?(pdf|بي\s*دي\s*اف|بيدي\s*اف|بي\s*دي\s*إف)\s*[:،,]?\s*/iu;
    const h = content.match(pdfHead);
    if (h) {
      const rest = content.slice(h[0].length).trim();
      return out('pdf_write', { text: rest, position: 'top' }, rest ? 0.9 : 0.6);
    }
    const m = content.match(pdfTail);
    if (m) {
      const where = `${m[1] || ''} ${m[6] || ''}`;
      content = content.slice(0, m.index).trim();
      return out('pdf_write', { text: content, position: /(تحت|الأسفل|الاسفل)/.test(where) ? 'bottom' : 'top' }, content ? 0.92 : 0.6);
    }
    return out('type_text', { text: content }, content ? 0.93 : 0.6);
  }

  if (findPhrase(padded, L.soundsOff)) return out('sounds', { on: false });
  if (findPhrase(padded, L.soundsOn)) return out('sounds', { on: true });

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

  // «جهّز الاستماع» / «نزّل عقلك»: shows the one-click setup in the settings panel.
  const setupMatch = /^(جهز|ركب|نزل|ثبت|حمل)( لي| لك)? (ال)?(استماع|سماعه|سماعتك|اذانك|اذنك|عقل|عقلك|مخ|مخك|ذكاء|ذكاءك)( |$)/.exec(text);
  if (setupMatch) return out('setup', { part: /عقل|مخ|ذكاء/.test(setupMatch[4]) ? 'brain' : 'voice' });
  if (findPhrase(padded, L.settings)) return out('open_settings');

  // «ابي الحاسبة» / just «الحاسبة»: open it.
  {
    const bare = findApp(text);
    if (bare && APP_NAME_ONLY(text, bare)) {
      const wanted = WANT.some((w) => hasPhrase(` ${normalized} `, w));
      return out('open', { app: bare.id, kind: bare.kind, url: bare.url || null }, wanted ? 0.85 : 0.7);
    }
  }
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
  if (findPhrase(padded, L.costumeOff)) return out('costume', { name: null });
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

  if (findPhrase(padded, L.bisht)) return out('costume', { name: 'bisht' });
  if (findPhrase(padded, L.flag)) return out('costume', { name: 'flag' });
  if (findPhrase(padded, L.lantern)) return out('costume', { name: 'lantern' });
  if (findPhrase(padded, L.quiz)) return out('quiz');
  if (findPhrase(padded, L.dontKnow)) return out('dont_know', {}, 0.85);
  if (findPhrase(padded, L.nextQ)) return out('next_question', {}, 0.85);
  for (const [kind, words] of FEELINGS) {
    if (findPhrase(padded, words)) return out('feeling', { kind });
  }

  if (findPhrase(padded, L.who)) return out('who');
  if (findPhrase(padded, L.howareyou)) return out('how_are_you');
  if (findPhrase(padded, L.greet)) {
    const part = findPhrase(padded, MORNING) ? 'morning' : findPhrase(padded, EVENING) ? 'evening' : 'any';
    return out('greet', { part });
  }
  if (/ (تسلم|يسلم|يسلمون|تسلمون) (عليك|عليكم) /.test(padded)) return out('greet', { part: 'any' }, 0.8);
  if (findPhrase(padded, L.thanks)) return out('thanks');
  if (findPhrase(padded, L.praise)) return out('praise');
  if (findPhrase(padded, L.scold)) return out('scold');
  if (findPhrase(padded, L.goodbye)) return out('goodbye');
  if (startsWithPhrase(text, N(['وقف']))) return out('stop', {}, 0.85);

  return out('unknown', {}, 0.2);
}
