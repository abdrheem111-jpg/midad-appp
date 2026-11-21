// Writing and drawing in Word, PowerPoint, Excel and PDF: the pure part. What each kind of
// request asks the cloud brain for, how its answer is checked and cleaned (nothing from the
// model is trusted as-is), the Arabic names of shapes, colours and apps, and the layout of
// diagrams. Used by the brain (understanding) and the main process (building files).

import { normalize } from './arabic.js';

export const OFFICE_APPS = ['word', 'powerpoint', 'excel', 'pdf'];
export const APP_LABEL = { word: 'الوورد', powerpoint: 'البوربوينت', excel: 'الإكسل', pdf: 'ملف PDF' };

/** «في الوورد», «بالبوربوينت», «في ملف بي دي اف»... → app id. */
const APP_WORDS = [
  ['word', ['الوورد', 'وورد', 'الورد', 'ورد', 'word', 'مستند', 'المستند', 'مستند وورد', 'ملف وورد', 'ملف ورد']],
  ['powerpoint', ['البوربوينت', 'بوربوينت', 'البور بوينت', 'بور بوينت', 'الباوربوينت', 'باوربوينت', 'البوربوينط', 'powerpoint', 'العرض', 'عرض', 'شريحه', 'الشريحه', 'شرايح', 'الشرايح', 'السلايد', 'سلايد', 'سلايدات', 'العرض التقديمي', 'عرض تقديمي', 'برزنتيشن', 'البرزنتيشن']],
  ['excel', ['الاكسل', 'اكسل', 'الإكسل', 'إكسل', 'excel', 'الاكسيل', 'اكسيل', 'جدول بيانات', 'ملف اكسل']],
  ['pdf', ['pdf', 'بي دي اف', 'البي دي اف', 'ملف pdf', 'ملف بي دي اف', 'بيدياف', 'البيدياف', 'pdf جديد', 'بي دي اف جديد']],
];
const APP_INDEX = new Map();
for (const [id, words] of APP_WORDS) for (const w of words) APP_INDEX.set(normalize(w), id);

const PREPS = new Set(['في', 'ب', 'بال', 'علي', 'على', 'عل', 'داخل', 'جوه', 'جوا', 'ف', 'فـ', 'بي', 'ع']);

/**
 * Finds «في الوورد» at the end of a sentence. Returns {app, rest, fresh} or null;
 * `fresh` when the person said «جديد» (a new file rather than the open one).
 * @param {string} text normalized
 */
export function splitApp(text) {
  let words = String(text || '').trim().split(' ').filter(Boolean);
  let fresh = false;
  if (words.length > 2 && /^(?:جديد|جديده)$/.test(words.at(-1))) { fresh = true; words = words.slice(0, -1); }
  for (let k = Math.min(4, words.length - 1); k >= 1; k -= 1) {
    const name = words.slice(-k).join(' ');
    const pre = words[words.length - k - 1];
    if (APP_INDEX.has(name) && PREPS.has(pre)) return { app: APP_INDEX.get(name), rest: words.slice(0, -k - 1).join(' '), fresh };
  }
  // «بالوورد», «فالبوربوينت», «للاكسل»: the preposition glued to the name.
  const glued = /^(?:بال|فال|لل|في|ب|ف)(.+)$/u.exec(words.at(-1) || '');
  if (glued && words.length > 1 && APP_INDEX.has(glued[1])) return { app: APP_INDEX.get(glued[1]), rest: words.slice(0, -1).join(' '), fresh };
  if (glued && words.length > 1 && APP_INDEX.has(`ال${glued[1]}`)) return { app: APP_INDEX.get(`ال${glued[1]}`), rest: words.slice(0, -1).join(' '), fresh };
  return null;
}

/** Like splitApp, but «في الوورد» may also sit in the middle: «سو اختبار في الوورد عن الجمع». */
export function splitAppAnywhere(text) {
  const end = splitApp(text);
  if (end) return end;
  const words = String(text || '').trim().split(' ').filter(Boolean);
  for (let i = 0; i < words.length - 1; i += 1) {
    for (let k = 3; k >= 1; k -= 1) {
      const name = words.slice(i + 1, i + 1 + k).join(' ');
      if (PREPS.has(words[i]) && APP_INDEX.has(name)) {
        return { app: APP_INDEX.get(name), rest: [...words.slice(0, i), ...words.slice(i + 1 + k)].join(' '), fresh: false };
      }
    }
  }
  return null;
}

export function appFromWord(word) {
  return APP_INDEX.get(normalize(word)) || null;
}

// ------------------------------------------------------------------ shapes and colours

/** Shapes Khalfoun can draw by name. `ppt`: MsoAutoShapeType, `gen`: pptxgenjs shape name. */
export const SHAPES = {
  circle: { ar: 'دائرة', names: ['دايره', 'دائره', 'دواير', 'دوائر', 'كره', 'دايرة', 'بيضاوي', 'شكل بيضاوي'], ppt: 9, gen: 'ellipse' },
  square: { ar: 'مربع', names: ['مربع', 'مربعات', 'مربعه'], ppt: 1, gen: 'rect', square: true },
  rectangle: { ar: 'مستطيل', names: ['مستطيل', 'مستطيلات', 'صندوق', 'بوكس'], ppt: 1, gen: 'rect' },
  rounded: { ar: 'مستطيل بزوايا دائرية', names: ['مستطيل مدور', 'مستطيل بزوايا مدوره', 'زر', 'بطاقه', 'كرت'], ppt: 5, gen: 'roundRect' },
  triangle: { ar: 'مثلث', names: ['مثلث', 'مثلثات'], ppt: 7, gen: 'triangle' },
  star: { ar: 'نجمة', names: ['نجمه', 'نجوم', 'نجمة'], ppt: 92, gen: 'star5' },
  heart: { ar: 'قلب', names: ['قلب', 'قلوب'], ppt: 21, gen: 'heart' },
  arrow: { ar: 'سهم', names: ['سهم', 'اسهم', 'سهم يمين', 'سهم لليمين'], ppt: 33, gen: 'rightArrow' },
  left_arrow: { ar: 'سهم لليسار', names: ['سهم يسار', 'سهم لليسار', 'سهم يسار'], ppt: 34, gen: 'leftArrow' },
  up_arrow: { ar: 'سهم لفوق', names: ['سهم فوق', 'سهم لفوق', 'سهم للاعلى'], ppt: 35, gen: 'upArrow' },
  down_arrow: { ar: 'سهم لتحت', names: ['سهم تحت', 'سهم لتحت', 'سهم للاسفل'], ppt: 36, gen: 'downArrow' },
  cloud: { ar: 'سحابة', names: ['سحابه', 'غيمه', 'سحاب', 'غيوم'], ppt: 179, gen: 'cloud' },
  sun: { ar: 'شمس', names: ['شمس'], ppt: 23, gen: 'sun' },
  moon: { ar: 'هلال', names: ['هلال', 'قمر'], ppt: 24, gen: 'moon' },
  hexagon: { ar: 'سداسي', names: ['سداسي', 'شكل سداسي', 'مسدس'], ppt: 10, gen: 'hexagon' },
  pentagon: { ar: 'خماسي', names: ['خماسي', 'شكل خماسي', 'مخمس'], ppt: 51, gen: 'pentagon' },
  diamond: { ar: 'معين', names: ['معين', 'ماسه', 'الماسه', 'شكل معين'], ppt: 4, gen: 'diamond' },
  line: { ar: 'خط', names: ['خط', 'خط مستقيم'], ppt: 0, gen: 'line', line: true },
  callout: { ar: 'فقاعة كلام', names: ['فقاعه كلام', 'فقاعه', 'بالون كلام', 'فقاعه حوار'], ppt: 106, gen: 'wedgeRoundRectCallout' },
  smiley: { ar: 'وجه مبتسم', names: ['وجه مبتسم', 'سمايلي', 'وجه ضاحك', 'ابتسامه'], ppt: 17, gen: 'smileyFace' },
};
const SHAPE_INDEX = [];
for (const [id, s] of Object.entries(SHAPES)) for (const n of s.names) SHAPE_INDEX.push([normalize(n), id]);
SHAPE_INDEX.sort((a, b) => b[0].length - a[0].length);

/** Colours in Arabic (masculine, feminine and Gulf forms) → hex. */
export const COLORS = {
  red: { ar: 'أحمر', hex: 'E63946', names: ['احمر', 'حمرا', 'حمراء', 'حمره', 'أحمر'] },
  blue: { ar: 'أزرق', hex: '1D70B8', names: ['ازرق', 'زرقا', 'زرقاء', 'زرقه'] },
  green: { ar: 'أخضر', hex: '2A9D5C', names: ['اخضر', 'خضرا', 'خضراء', 'خضره'] },
  yellow: { ar: 'أصفر', hex: 'F4C430', names: ['اصفر', 'صفرا', 'صفراء', 'صفره'] },
  orange: { ar: 'برتقالي', hex: 'F4842A', names: ['برتقالي', 'برتقاليه', 'برتقالي اللون'] },
  purple: { ar: 'بنفسجي', hex: '8E44AD', names: ['بنفسجي', 'بنفسجيه', 'موف', 'ليلكي'] },
  pink: { ar: 'وردي', hex: 'F06292', names: ['وردي', 'ورديه', 'زهري', 'زهريه', 'بمبي'] },
  black: { ar: 'أسود', hex: '222222', names: ['اسود', 'سودا', 'سوداء'] },
  white: { ar: 'أبيض', hex: 'FFFFFF', names: ['ابيض', 'بيضا', 'بيضاء'] },
  gray: { ar: 'رمادي', hex: '8A8F98', names: ['رمادي', 'رماديه', 'رصاصي', 'سكني'] },
  brown: { ar: 'بني', hex: '8B5A2B', names: ['بني', 'بنيه', 'قهوائي'] },
  gold: { ar: 'ذهبي', hex: 'C9962C', names: ['ذهبي', 'ذهبيه'] },
  sky: { ar: 'سماوي', hex: '4FC3F7', names: ['سماوي', 'سماويه', 'لبني'] },
};
const COLOR_INDEX = new Map();
for (const [id, c] of Object.entries(COLORS)) for (const n of c.names) COLOR_INDEX.set(normalize(n), id);
export const colorFromWord = (w) => COLOR_INDEX.get(normalize(w)) || null;

const COUNT_WORDS = { واحد: 1, وحده: 1, اثنين: 2, ثنتين: 2, ثلاث: 3, ثلاثه: 3, اربع: 4, اربعه: 4, خمس: 5, خمسه: 5, ست: 6, سته: 6, سبع: 7, سبعه: 7, ثمان: 8, ثمانيه: 8, تسع: 9, تسعه: 9, عشر: 10, عشره: 10 };
const toNum = (w) => {
  const d = String(w).replace(/[٠-٩]/g, (x) => '٠١٢٣٤٥٦٧٨٩'.indexOf(x));
  if (/^\d{1,2}$/.test(d)) return Number(d);
  return COUNT_WORDS[normalize(w)] || null;
};

/**
 * Reads a simple drawing request: «دايرة حمرا», «٣ نجوم صفرا», «مربع ازرق مكتوب فيه مرحبا».
 * @returns {{shape: string, color: string|null, count: number, text: string} | null}
 */
export function parseShape(text) {
  let t = normalize(text).replace(/^(?:لي|لنا)\s+/, '');
  let written = '';
  const w = /\s+(?:مكتوب|مكتوبه|اكتب|واكتب|وكتب|فيه كلمه|فيها كلمه|عليه|عليها)\s+(?:فيه|فيها|عليه|عليها)?\s*(.+)$/u.exec(t);
  if (w) { written = w[1].replace(/^[«"]|[»"]$/g, '').trim(); t = t.slice(0, w.index).trim(); }
  let count = 1;
  const first = t.split(' ')[0];
  const n = toNum(first);
  if (n && t.split(' ').length > 1) { count = Math.min(12, n); t = t.split(' ').slice(1).join(' '); }
  let shape = null;
  for (const [name, id] of SHAPE_INDEX) {
    if (t === name || t.startsWith(`${name} `)) { shape = id; t = t.slice(name.length).trim(); break; }
  }
  if (!shape) return null;
  let color = null;
  for (const word of t.split(' ')) {
    const c = colorFromWord(word.replace(/^(?:لون|لونه|لونها|باللون|ال)/, ''));
    if (c) { color = c; break; }
  }
  // Anything else left over (other than colour words and «كبير/صغير») means it was not a plain shape.
  const leftover = t.split(' ').filter((x) => x && !colorFromWord(x.replace(/^(?:لون|لونه|لونها|باللون|ال)/, '')) && !['لون', 'لونه', 'لونها', 'باللون', 'كبير', 'كبيره', 'صغير', 'صغيره', 'كبار', 'صغار', 'في', 'النص', 'الوسط', 'بالنص', 'بالوسط'].includes(x));
  if (leftover.length) return null;
  return { shape, color, count, text: written.slice(0, 80) };
}

// ------------------------------------------------------------------ what to ask the cloud

/** Kinds of content Khalfoun composes, and the default app for each. */
export const KINDS = {
  text: { app: 'word', ar: 'الفقرة' },
  doc: { app: 'word', ar: 'المستند' },
  worksheet: { app: 'word', ar: 'ورقة العمل' },
  quiz: { app: 'word', ar: 'الاختبار' },
  lesson: { app: 'word', ar: 'تحضير الدرس' },
  letter: { app: 'word', ar: 'الرسالة' },
  story: { app: 'word', ar: 'القصة' },
  slides: { app: 'powerpoint', ar: 'العرض التقديمي' },
  table: { app: 'excel', ar: 'الجدول' },
  diagram: { app: 'powerpoint', ar: 'الرسم التوضيحي' },
};

/** Words that name the kind: «فقرة», «ورقة عمل», «عرض», «جدول», «مخطط»... (normalized) */
export const KIND_WORDS = [
  ['worksheet', ['ورقه عمل', 'اوراق عمل', 'ورقه تمارين', 'تمارين', 'ورقه نشاط', 'نشاط', 'واجب', 'ورقه واجب']],
  ['quiz', ['اختبار', 'امتحان', 'اسئله', 'اسئله اختبار', 'كويز', 'اختبار قصير', 'اسئله اختيار من متعدد', 'اسئله صح وخطا']],
  ['lesson', ['تحضير', 'تحضير درس', 'خطه درس', 'خطه الدرس', 'تحضير الدرس', 'خطه']],
  ['letter', ['رساله', 'خطاب', 'ايميل', 'بريد', 'دعوه', 'تعميم', 'اعلان', 'شهاده', 'شهاده تقدير']],
  ['story', ['قصه', 'حكايه', 'قصه قصيره', 'سالفه']],
  ['slides', ['عرض تقديمي', 'عرض', 'برزنتيشن', 'شرايح', 'شريحه', 'سلايدات', 'بوربوينت', 'عرض بوربوينت', 'باوربوينت']],
  ['table', ['جدول', 'جداول', 'جدول ضرب', 'كشف', 'قايمه']],
  ['diagram', ['مخطط', 'رسم توضيحي', 'رسم بياني توضيحي', 'خريطه ذهنيه', 'خريطه مفاهيم', 'دوره', 'شكل يوضح', 'مخطط يوضح', 'مراحل', 'خطوات', 'هرم', 'شجره']],
  ['text', ['فقره', 'فقرات', 'موضوع', 'مقال', 'مقاله', 'تعبير', 'ملخص', 'تلخيص', 'شرح', 'نبذه', 'مقدمه', 'خاتمه', 'كلمه', 'كلمه صباحيه', 'نص', 'تعريف', 'قصيده', 'ابيات', 'خاطره', 'فكره']],
];
const KIND_INDEX = [];
for (const [kind, words] of KIND_WORDS) for (const w of words) KIND_INDEX.push([normalize(w), kind]);
KIND_INDEX.sort((a, b) => b[0].length - a[0].length);

/** The kind a phrase starts with («ورقه عمل عن الكسور» → worksheet, rest «عن الكسور»). */
export function leadingKind(text) {
  const t = normalize(text);
  for (const [w, kind] of KIND_INDEX) {
    if (t === w || t.startsWith(`${w} `)) return { kind, word: w, rest: t.slice(w.length).trim() };
  }
  return null;
}

const SYSTEM = [
  'أنت خلفون، مساعد معلم عُماني ذكي. تكتب محتوى تعليمي عربي فصيح واضح ومنسق، مناسب للمدارس في سلطنة عُمان.',
  'اكتب بالعربية الفصحى المبسطة، بدون أخطاء إملائية، وبدون رموز ماركداون (لا ** ولا #).',
  'المحتوى مناسب للأطفال والطلاب: لا عنف ولا ألفاظ غير لائقة ولا آراء سياسية.',
  'أعد فقط JSON صالح بالشكل المطلوب، بدون أي كلام قبله أو بعده.',
].join('\n');

/**
 * The prompt for one request.
 * @param {{kind: string, topic: string, count?: number, level?: string, raw?: string}} req
 */
export function composePrompt(req) {
  const topic = String(req.topic || '').slice(0, 300);
  const n = Math.max(1, Math.min(12, Number(req.count) || 0));
  const ask = `الطلب كما قاله المعلم: «${String(req.raw || topic).slice(0, 400)}»`;
  const shapes = {
    text: `اكتب ${n > 1 ? `${n} فقرات` : 'فقرة أو فقرتين'} عن: ${topic}.\nالشكل: {"title": "عنوان قصير", "paragraphs": ["...", "..."]}`,
    doc: `اكتب مستنداً منسقاً عن: ${topic}.\nالشكل: {"title": "...", "blocks": [{"type": "heading", "text": "..."}, {"type": "paragraph", "text": "..."}, {"type": "bullets", "items": ["...", "..."]}]}`,
    worksheet: `صمم ورقة عمل للطلاب عن: ${topic}${n > 1 ? ` فيها ${n} أسئلة` : ''}، بأنواع أسئلة متنوعة (أكمل، اختر، صح وخطأ، أجب).\nالشكل: {"title": "...", "intro": "تعليمات قصيرة", "questions": [{"q": "نص السؤال", "choices": ["أ", "ب", "ج"], "answer": "الجواب", "lines": 2}]}\nالخيارات اختيارية (للاختيار من متعدد فقط)، وlines عدد أسطر الإجابة (٠ إلى ٤).`,
    quiz: `صمم اختباراً قصيراً عن: ${topic} فيه ${n > 1 ? n : 5} أسئلة اختيار من متعدد.\nالشكل: {"title": "...", "intro": "...", "questions": [{"q": "...", "choices": ["...", "...", "...", "..."], "answer": "الخيار الصحيح نفسه"}]}`,
    lesson: `اكتب تحضير درس عن: ${topic}.\nالشكل: {"title": "...", "blocks": [{"type": "heading", "text": "الأهداف"}, {"type": "bullets", "items": ["..."]}, {"type": "heading", "text": "التهيئة"}, {"type": "paragraph", "text": "..."}, {"type": "heading", "text": "سير الدرس"}, {"type": "numbered", "items": ["..."]}, {"type": "heading", "text": "التقويم"}, {"type": "bullets", "items": ["..."]}]}`,
    letter: `اكتب ${topic} بأسلوب رسمي لطيف.\nالشكل: {"title": "...", "blocks": [{"type": "paragraph", "text": "..."}]}`,
    story: `اكتب قصة قصيرة للأطفال عن: ${topic}، فيها بداية ومشكلة ونهاية سعيدة وعبرة.\nالشكل: {"title": "...", "paragraphs": ["...", "..."], "moral": "العبرة"}`,
    slides: `صمم عرضاً تقديمياً عن: ${topic} من ${n > 1 ? n : 6} شرائح (بدون شريحة العنوان).\nالشكل: {"title": "عنوان العرض", "subtitle": "سطر قصير", "slides": [{"title": "عنوان الشريحة", "bullets": ["نقطة قصيرة", "نقطة قصيرة"], "note": "ملاحظة للمعلم"}]}\nكل شريحة ٣ إلى ٥ نقاط، كل نقطة أقل من ١٢ كلمة.`,
    table: `جهز جدولاً عن: ${topic}.\nالشكل: {"title": "...", "columns": ["عمود ١", "عمود ٢"], "rows": [["...", "..."]]}\nالأرقام تكتب أرقاماً. لا تزيد عن ٨ أعمدة و٤٠ صفاً.`,
    diagram: `صمم رسماً توضيحياً بسيطاً عن: ${topic}.\nالشكل: {"title": "...", "layout": "cycle" أو "flow" أو "tree" أو "grid", "nodes": [{"id": "a", "text": "كلمتين أو ثلاث", "color": "red|blue|green|yellow|orange|purple|pink|gray|brown|gold|sky"}], "links": [{"from": "a", "to": "b", "label": ""}]}\ncycle للدورات (مثل دورة الماء)، flow للخطوات بالترتيب، tree للتصنيف (الأول هو الجذر)، grid لمجموعة عناصر. من ٣ إلى ٨ عناصر.`,
  };
  return { system: SYSTEM, user: `${ask}\n${shapes[req.kind] || shapes.text}` };
}

// ------------------------------------------------------------------ checking the answer

const clean = (s, max = 400) => String(s ?? '').replace(/\*\*|__|`+/g, '').replace(/^#+\s*/gm, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\s+\n/g, '\n').trim().slice(0, max);
const list = (a, max, len) => (Array.isArray(a) ? a : []).map((x) => clean(x, len)).filter(Boolean).slice(0, max);

/** Pulls the first JSON object out of a model's answer. */
export function extractJson(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i += 1) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/**
 * Checks and cleans what the model wrote, into one shape the builders understand:
 * {kind, title, subtitle?, blocks: [...]} for documents, {kind:'slides', title, subtitle, slides} for decks,
 * {kind:'table', title, columns, rows}, {kind:'diagram', title, layout, nodes, links}.
 * Returns null when nothing usable came back.
 */
export function cleanPlan(kind, raw) {
  const j = raw && typeof raw === 'object' ? raw : null;
  if (!j) return null;
  const title = clean(j.title, 120) || '';
  if (kind === 'slides') {
    const slides = (Array.isArray(j.slides) ? j.slides : []).slice(0, 15).map((s) => ({
      title: clean(s?.title, 90), bullets: list(s?.bullets, 7, 160), note: clean(s?.note, 400),
    })).filter((s) => s.title || s.bullets.length);
    return slides.length ? { kind, title: title || slides[0].title, subtitle: clean(j.subtitle, 120), slides } : null;
  }
  if (kind === 'table') {
    const columns = list(j.columns, 8, 60);
    if (!columns.length) return null;
    const rows = (Array.isArray(j.rows) ? j.rows : []).slice(0, 60).map((r) => (Array.isArray(r) ? r : [r]).slice(0, columns.length).map((c) => (typeof c === 'number' && Number.isFinite(c) ? c : clean(c, 120))));
    return rows.length ? { kind, title, columns, rows: rows.map((r) => [...r, ...Array(columns.length - r.length).fill('')]) } : null;
  }
  if (kind === 'diagram') {
    const nodes = (Array.isArray(j.nodes) ? j.nodes : []).slice(0, 10).map((n, i) => ({
      id: clean(n?.id, 20) || `n${i}`, text: clean(n?.text, 40), color: COLORS[n?.color] ? n.color : null,
    })).filter((n) => n.text);
    const ids = new Set(nodes.map((n) => n.id));
    const links = (Array.isArray(j.links) ? j.links : []).slice(0, 16).map((l) => ({ from: clean(l?.from, 20), to: clean(l?.to, 20), label: clean(l?.label, 30) })).filter((l) => ids.has(l.from) && ids.has(l.to) && l.from !== l.to);
    const layout = ['cycle', 'flow', 'tree', 'grid'].includes(j.layout) ? j.layout : 'flow';
    return nodes.length >= 2 ? { kind, title, layout, nodes, links } : null;
  }
  // Documents of every other kind become blocks.
  const blocks = [];
  if (j.intro) blocks.push({ type: 'paragraph', text: clean(j.intro, 600), soft: true });
  for (const p of list(j.paragraphs, 12, 2000)) blocks.push({ type: 'paragraph', text: p });
  const laterQuestions = [];
  let laterMoral = '';
  for (const b of (Array.isArray(j.blocks) ? j.blocks : []).slice(0, 40)) {
    // An already-checked plan comes back through here too (the main process checks again).
    if (b?.type === 'questions' && Array.isArray(b.items)) { laterQuestions.push(...b.items); continue; }
    if (b?.type === 'moral') { laterMoral = b.text; continue; }
    const type = ['heading', 'paragraph', 'bullets', 'numbered'].includes(b?.type) ? b.type : null;
    if (!type) continue;
    if (type === 'bullets' || type === 'numbered') {
      const items = list(b.items, 15, 300);
      if (items.length) blocks.push({ type, items });
    } else {
      const text = clean(b.text, type === 'heading' ? 120 : 2000);
      if (text) blocks.push({ type, text });
    }
  }
  const questions = [...(Array.isArray(j.questions) ? j.questions : []), ...laterQuestions].slice(0, 30).map((q) => ({
    q: clean(q?.q, 400), choices: list(q?.choices, 6, 120), answer: clean(q?.answer, 200), lines: Math.max(0, Math.min(4, Math.round(Number(q?.lines) || 0))),
  })).filter((q) => q.q);
  if (questions.length) blocks.push({ type: 'questions', items: questions });
  if (j.moral || laterMoral) blocks.push({ type: 'moral', text: clean(j.moral || laterMoral, 300) });
  return blocks.length ? { kind, title, blocks } : null;
}

/** Plain text of a plan (for pasting into any program, and for the PDF). */
export function planText(plan) {
  if (!plan) return '';
  const out = [];
  if (plan.title) out.push(plan.title, '');
  if (plan.kind === 'slides') {
    plan.slides.forEach((s, i) => { out.push(`${i + 1}. ${s.title}`, ...s.bullets.map((b) => `• ${b}`), ''); });
  } else if (plan.kind === 'table') {
    out.push(plan.columns.join('\t'), ...plan.rows.map((r) => r.join('\t')));
  } else if (plan.kind === 'diagram') {
    out.push(...plan.nodes.map((n) => `• ${n.text}`));
  } else {
    for (const b of plan.blocks) {
      if (b.type === 'heading' || b.type === 'paragraph' || b.type === 'moral') out.push(b.type === 'moral' ? `العبرة: ${b.text}` : b.text, '');
      else if (b.type === 'bullets') out.push(...b.items.map((x) => `• ${x}`), '');
      else if (b.type === 'numbered') out.push(...b.items.map((x, i) => `${i + 1}. ${x}`), '');
      else if (b.type === 'questions') b.items.forEach((q, i) => { out.push(`${i + 1}. ${q.q}`, ...q.choices.map((c, k) => `   ${'أبجدهو'[k] || '-'}) ${c}`), ''); });
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ------------------------------------------------------------------ diagram layout

/**
 * Places the diagram's boxes in a 0..1 square (x, y are centres; w, h sizes), right-to-left
 * for flows (Arabic reading order). Arrows go from box edge to box edge.
 */
export function layoutDiagram(plan) {
  const n = plan.nodes.length;
  const boxes = new Map();
  const W = n > 6 ? 0.2 : 0.24;
  const H = 0.13;
  if (plan.layout === 'cycle') {
    plan.nodes.forEach((node, i) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2; // clockwise from the top
      boxes.set(node.id, { x: 0.5 + Math.cos(a) * 0.36, y: 0.52 + Math.sin(a) * 0.34, w: W, h: H });
    });
  } else if (plan.layout === 'tree') {
    const root = plan.nodes[0];
    const kids = plan.nodes.slice(1);
    boxes.set(root.id, { x: 0.5, y: 0.18, w: Math.min(0.4, W * 1.3), h: H });
    kids.forEach((k, i) => {
      boxes.set(k.id, { x: 1 - (i + 0.5) / kids.length, y: 0.68, w: Math.min(W, 0.92 / kids.length), h: H * 1.2 });
    });
  } else if (plan.layout === 'grid') {
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    plan.nodes.forEach((node, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      boxes.set(node.id, { x: 1 - (c + 0.5) / cols, y: 0.2 + ((r + 0.5) / rows) * 0.72, w: Math.min(0.28, 0.85 / cols), h: Math.min(0.2, 0.6 / rows) });
    });
  } else {
    // flow: one row (or two when long), right to left.
    const perRow = n > 5 ? Math.ceil(n / 2) : n;
    plan.nodes.forEach((node, i) => {
      const r = Math.floor(i / perRow);
      const c = i % perRow;
      const across = r % 2 === 0 ? c : perRow - 1 - c; // a second row snakes back
      boxes.set(node.id, { x: 1 - (across + 0.5) / perRow, y: perRow === n ? 0.55 : 0.36 + r * 0.38, w: Math.min(0.24, 0.8 / perRow), h: H });
    });
  }
  let links = plan.links;
  if (!links.length) {
    // No links given: connect in order (and close the circle for a cycle; root to all for a tree).
    if (plan.layout === 'tree') links = plan.nodes.slice(1).map((k) => ({ from: plan.nodes[0].id, to: k.id, label: '' }));
    else if (plan.layout !== 'grid') {
      links = plan.nodes.slice(1).map((k, i) => ({ from: plan.nodes[i].id, to: k.id, label: '' }));
      if (plan.layout === 'cycle' && n > 2) links.push({ from: plan.nodes[n - 1].id, to: plan.nodes[0].id, label: '' });
    }
  }
  const arrows = links.map((l) => {
    const a = boxes.get(l.from);
    const b = boxes.get(l.to);
    const edge = (p, q) => {
      // The point where the line from p's centre toward q leaves p's box.
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const sx = dx ? (p.w / 2) / Math.abs(dx) : Infinity;
      const sy = dy ? (p.h / 2) / Math.abs(dy) : Infinity;
      const s = Math.min(sx, sy, 1);
      return { x: p.x + dx * s, y: p.y + dy * s };
    };
    return { from: edge(a, b), to: edge(b, a), label: l.label };
  });
  return { boxes: plan.nodes.map((node, i) => ({ ...node, ...boxes.get(node.id), color: node.color || DIAGRAM_COLORS[i % DIAGRAM_COLORS.length] })), arrows };
}

export const DIAGRAM_COLORS = ['blue', 'green', 'orange', 'purple', 'red', 'sky', 'gold', 'pink'];

/** A readable text colour on a fill. */
export function textOn(hex) {
  const n = parseInt(hex, 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 160 ? '222222' : 'FFFFFF';
}
