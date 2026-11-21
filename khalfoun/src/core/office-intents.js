// Understanding writing and drawing commands for Word, PowerPoint, Excel and PDF:
//   «اكتب فقرة عن النخلة في الوورد», «سو عرض عن الكسور من ٥ شرائح», «ارسم دايرة حمرا»,
//   «ارسم دورة الماء في البوربوينت», «اكتب في الوورد: السلام عليكم», «خلي الخط عريض»,
//   «شريحة جديدة»، «حوله PDF».
// Called by intents.recognizeText with the normalized text and the raw sentence; returns
// [intent, slots, confidence] or null.

import { normalize } from './arabic.js';
import { splitApp, splitAppAnywhere, leadingKind, parseShape, colorFromWord, COLORS, KINDS } from './office-plan.js';
import { spokenMath, looksLikeMath } from './office-math.js';

const S = (list) => new Set(list.map(normalize));

const MAKE = /^(?:(?:يا خلفون|خلفون)\s+)?(?:ممكن\s+|لو سمحت\s+|ابي(?:ك)?\s+|ابغي(?:ك)?\s+|ابغا(?:ك)?\s+|اريد(?:ك)?\s+|ودي\s+)?(?:تكتب|تسوي|تعمل|تجهز|تحضر|تصمم|ترسم|اكتب|اكتبي|سو|سوي|اعمل|جهز|حضر|صمم|الف|انشئ|عطني|اعطني|هات|طلع|سولي|اكتبلي|جهزلي|حضرلي|صملي|ارسم|ارسملي|ارسم لي|نزل)(?:\s+(?:لي|لنا|لهم|للطلاب|للصف))?\s+(.+)$/u;
const DRAW = /^(?:(?:يا خلفون|خلفون)\s+)?(?:ممكن\s+)?(?:ارسم|ارسملي|ترسم|رسم|حط|ضيف|اضف|سو|سوي)(?:\s+(?:لي|لنا))?\s+(.+)$/u;
const ABOUT = /^(?:عن|حول|بخصوص|في موضوع|عن موضوع|موضوعه|بعنوان|عنوانه|لدرس|للدرس|درس|ل)\s+/u;
const COUNT_ANY = /(?:^|\s)(?:من|فيه|فيها|في|ب)?\s*(\d{1,2}|[٠-٩]{1,2}|ثلاث|ثلاثه|اربع|اربعه|خمس|خمسه|ست|سته|سبع|سبعه|ثمان|ثمانيه|تسع|تسعه|عشر|عشره|اثنين|ثنتين)\s+(?:شرايح|شريحه|سلايدات|سلايد|اسيله|سوال|فقرات|فقره|صفحات|نقاط|خطوات|تمارين|مسايل|اسطر|صفوف)/u;
const NUMS = { ثلاث: 3, ثلاثه: 3, اربع: 4, اربعه: 4, خمس: 5, خمسه: 5, ست: 6, سته: 6, سبع: 7, سبعه: 7, ثمان: 8, ثمانيه: 8, تسع: 9, تسعه: 9, عشر: 10, عشره: 10, اثنين: 2, ثنتين: 2 };
const numOf = (w) => {
  const d = String(w).replace(/[٠-٩]/g, (x) => '٠١٢٣٤٥٦٧٨٩'.indexOf(x));
  return /^\d+$/.test(d) ? Number(d) : NUMS[w] || null;
};

/** The words of the raw sentence after the first `skip` words (keeps the person's spelling). */
function rawTail(raw, skipWords) {
  return String(raw).trim().split(/\s+/).slice(skipWords).join(' ');
}

/**
 * The same words as `part` (a piece of the normalized text), in the person's own spelling.
 * Normalizing keeps one word for one word, so positions match; if not, the normalized piece is used.
 */
function fromRaw(text, raw, part) {
  const rw = String(raw).trim().split(/\s+/);
  const rn = rw.map((w) => normalize(w));
  const pw = String(part || '').split(' ').filter(Boolean);
  if (!pw.length) return part;
  // The part's first and last words in the raw sentence (fillers like «يا» may sit between them).
  for (let j = rn.length - 1; j >= 0; j -= 1) {
    if (rn[j] !== pw[0]) continue;
    for (let k = rn.length - 1; k >= j; k -= 1) {
      if (rn[k] === pw.at(-1) && k - j + 1 >= pw.length) return rw.slice(j, k + 1).join(' ');
    }
  }
  return part;
}

/** Text the person wants written as-is, taken from the raw sentence after «:» or after the app name. */
function verbatimFrom(raw) {
  const r = String(raw).trim();
  const colon = r.search(/[:：]/);
  if (colon >= 0) return r.slice(colon + 1).trim();
  return null;
}

const FORMAT = [
  ['bold', S(['عريض', 'خلي الخط عريض', 'خله عريض', 'خليه عريض', 'خليها عريضه', 'سوه عريض', 'بولد', 'غامق', 'خلي الكلام غامق', 'خلي الخط غامق', 'خلي النص عريض', 'خط عريض', 'كلام عريض', 'سوه بولد', 'خليه بولد'])],
  ['italic', S(['مائل', 'مايل', 'خلي الخط مايل', 'خلي الخط مائل', 'خليه مايل', 'ايتاليك', 'خط مايل'])],
  ['underline', S(['تحته خط', 'حط تحته خط', 'حط خط تحته', 'سطر تحته', 'خط تحته', 'سطر تحت الكلام', 'حط تحتها خط'])],
  ['grow', S(['كبر الخط', 'كبر حجم الخط', 'كبر الكلام', 'خلي الخط اكبر', 'كبر النص', 'خلي الكلام اكبر', 'كبره', 'كبر الكتابه', 'كبر الخط شوي'])],
  ['shrink', S(['صغر الخط', 'صغر حجم الخط', 'صغر الكلام', 'خلي الخط اصغر', 'صغر النص', 'خلي الكلام اصغر', 'صغره', 'صغر الكتابه'])],
  ['center', S(['وسط الكلام', 'وسطه', 'وسطها', 'خليه في الوسط', 'خليه بالوسط', 'خلي الكلام في الوسط', 'وسط النص', 'توسيط', 'وسط العنوان'])],
  ['right', S(['خليه يمين', 'يمين الصفحه', 'خلي الكلام يمين', 'محاذاه يمين', 'على اليمين'])],
  ['left', S(['خليه يسار', 'يسار الصفحه', 'خلي الكلام يسار', 'محاذاه يسار', 'على اليسار'])],
  ['heading', S(['خليه عنوان', 'حوله عنوان', 'عنوان رئيسي', 'سوه عنوان', 'خليها عنوان', 'حولها عنوان'])],
  ['bullets', S(['حوله نقاط', 'حولها نقاط', 'سوه نقاط', 'خليه نقاط', 'تعداد نقطي'])],
  ['numbers', S(['حوله ارقام', 'رقمه', 'رقمها', 'تعداد رقمي', 'سوه ارقام', 'خليه مرقم'])],
  ['highlight', S(['ظلله', 'ظللها', 'هايلايت', 'ظلل بالاصفر', 'ظلله بالاصفر', 'حط عليه اصفر'])],
];
const PEN_ON = S(['قلم', 'القلم', 'شغل القلم', 'قلم الشاشه', 'خلني اكتب على الشاشه', 'خلني ارسم على الشاشه', 'ابي اكتب على الشاشه', 'ابي ارسم على الشاشه', 'الكتابه على الشاشه', 'الرسم على الشاشه', 'فعل القلم', 'افتح القلم', 'وضع القلم', 'قلم سامسونج', 'سبوره على الشاشه', 'اكتب بيدي']);
const PEN_OFF = S(['وقف القلم', 'سكر القلم', 'طفي القلم', 'خلاص القلم', 'اقفل القلم', 'اطلع من القلم', 'شيل القلم']);
const SCREEN_CLEAR = S(['امسح الشاشه', 'امسح الرسم', 'امسح الكتابه', 'امسح اللي على الشاشه', 'نظف الشاشه', 'امسح كل شي على الشاشه', 'امسح الخطوط', 'شيل الرسم', 'شيل الكتابه', 'امسح سطح المكتب']);
const CIRCLE_SEL = S(['دور عليه', 'دور عليها', 'حط دايره عليه', 'حط دايره عليها', 'حط عليه دايره', 'حط عليها دايره', 'حوطه بدايره', 'حوطها بدايره', 'دايره حول المحدد', 'دايره على المحدد', 'ارسم دايره حوله', 'ارسم دايره حولها', 'ارسم دايره على المحدد', 'ارسم دايره حول المحدد', 'علم عليه', 'علم عليها', 'حط دايره حوله', 'حط دايره حولها', 'سو دايره عليه', 'سو دايره حوله']);
// «حط دايرة على المحدد», «ارسم دايرة حمرا حول الكلام المحدد», «حوط المحدد».
const CIRCLE_RE = /^(?:(?:حط|ارسم|سو|سوي|ضع|دير|اعمل|ابي|ابغي|اريد)\s+)?(?:لي\s+)?(?:(?:دايره|دوايره|حلقه|اطار)(?:\s+(?:حمرا|حمراء|احمر|حمره))?\s+(?:علي|عل|حول|حوالين|ع)|حوط|حوط علي)\s+(?:الشي\s+|الكلام\s+|النص\s+|الجمله\s+|الكلمه\s+)?(?:المحدد|المحدده|المختار|المختاره|المظلل|المظلله|اللي محدد|اللي محدده|اللي حددته|اللي حددتها|اللي اخترته|المحددين)$/u;
const DIGITS_AR = S(['الارقام بالعربي', 'اكتب الارقام بالعربي', 'خل الارقام عربي', 'الارقام عربي', 'ارقام عربيه', 'استخدم الارقام العربيه', 'خلي الارقام عربي', 'الارقام الهنديه']);
const DIGITS_EN = S(['الارقام بالانجليزي', 'اكتب الارقام بالانجليزي', 'خل الارقام انجليزي', 'الارقام انجليزي', 'ارقام انجليزيه', 'استخدم الارقام الانجليزيه', 'خلي الارقام انجليزي', 'ارقام لاتينيه']);
const SLIDE_NEW = S(['شريحه جديده', 'سلايد جديد', 'ضيف شريحه', 'اضف شريحه', 'زيد شريحه', 'شريحه ثانيه جديده', 'سو شريحه جديده', 'سوي شريحه جديده', 'افتح شريحه جديده', 'ضيف سلايد', 'اضف سلايد']);
const EXPORT_PDF = S(['حوله pdf', 'حوله بي دي اف', 'حولها pdf', 'حولها بي دي اف', 'احفظه pdf', 'احفظه بي دي اف', 'احفظها pdf', 'احفظها بي دي اف', 'صدره pdf', 'صدره بي دي اف', 'طلع منه pdf', 'طلعه pdf', 'طلعه بي دي اف', 'حول الملف pdf', 'حول الملف بي دي اف', 'سو منه pdf', 'سو منه بي دي اف', 'احفظ الملف pdf', 'احفظ كبي دي اف', 'صدر pdf', 'صدر بي دي اف']);

// «لون القلم أخضر», «خلي القلم أحمر», «غير لون القلم للأزرق», «قلم أصفر», «قلم عريض», «القلم رفيع».
const PEN_COLOR = /^(?:(?:خلي|خل|غير|بدل|حط|اختار|اختر|ابي|ابغي|ابغا|اريد|سو|سوي)\s+)?(?:لون\s+)?(?:ال)?قلم\s+(?:(?:لونه|لون|الي|علي|عل|يكون|يصير)\s+)?(?:اللون\s+)?(\S+)$/u;
const PEN_WIDTH = { عريض: 10, اعرض: 12, غليظ: 12, ثخين: 12, سميك: 12, كبير: 10, رفيع: 3, ارفع: 2, رقيق: 3, دقيق: 3, صغير: 3, عادي: 5, وسط: 6 };
function penStyleOf(text) {
  const m = PEN_COLOR.exec(text);
  if (!m) return null;
  const word = m[1].replace(/^(?:بال|لل|ال|ب|ل)(?=\S{3,})/u, '');
  if (PEN_WIDTH[word]) return { width: PEN_WIDTH[word] };
  const color = colorFromWord(word) || colorFromWord(m[1]);
  return color ? { color } : null;
}

// Finding a word on the screen and marking it where it is:
// «حط دايرة على كلمة الماء», «حط خط تحت كلمة النخلة», «ظلل كلمة الكسور», «وين كلمة ٢٥ في الشاشة».
const WORD_NOUN = '(?:كلمه|الكلمه|جمله|الجمله|عباره|العباره|رقم|الرقم|اسم|كلمة)';
const ON_SCREEN_TAIL = /\s+(?:في|علي|عل|ع)\s+(?:ال)?شاشه$/u;
const FIND_MARK = new RegExp(`^(?:(?:حط|ارسم|سو|سوي|دير|اعمل|ابي|ابغي|اريد)\\s+)?(?:لي\\s+)?(دايره|دوايره|حلقه|اطار|خط|سطر)(?:\\s+(?:حمرا|حمراء|احمر|زرقا|ازرق|خضرا|اخضر))?\\s+(علي|عل|حول|حوالين|تحت)\\s+${WORD_NOUN}\\s+(.+)$`, 'u');
const FIND_ACT = new RegExp(`^(?:(ظلل|ظلللي|لون|علم|علم علي|اشر علي|اشر|حوط|حوط علي|دور|دور علي|ابحث عن|ابحث|وين|فين|اين|طلعلي|بين لي|بين|لقيلي|شوف وين)\\s+)(?:لي\\s+)?${WORD_NOUN}\\s+(.+)$`, 'u');
function screenFindOf(text, raw) {
  const t = text.replace(ON_SCREEN_TAIL, '');
  let mark = null;
  let said = null;
  const m = FIND_MARK.exec(t);
  if (m) { mark = m[2] === 'تحت' || /^(?:خط|سطر)$/.test(m[1]) ? 'underline' : 'circle'; said = m[3]; }
  const a = !m && FIND_ACT.exec(t);
  if (a) { mark = /^ظلل|^لون/.test(a[1]) ? 'highlight' : 'circle'; said = a[2]; }
  if (!said) return null;
  const words = said.split(' ');
  if (words.length > 5) return null;
  const color = /حمرا|احمر/.test(t) ? 'red' : /زرقا|ازرق/.test(t) ? 'blue' : /خضرا|اخضر/.test(t) ? 'green' : mark === 'highlight' ? 'yellow' : 'red';
  return { text: fromRaw(text, raw, said).replace(/[«»"“”.؟?!،]/gu, '').trim().slice(0, 60), mark, color };
}

/** «لون الخط احمر», «خلي الكلام ازرق», «لونه اخضر» → {op:'color', value}; «حجم الخط ٢٠» → {op:'size'}. */
function formatValue(text) {
  const color = /^(?:خلي\s+)?(?:لون\s+)?(?:الخط|الكلام|النص|الكتابه|لونه|لونها|خليه|خليها|لون)\s+(?:لونه\s+|لون\s+|باللون\s+)?(\S+)$/u.exec(text);
  if (color && colorFromWord(color[1].replace(/^ال/, ''))) return { op: 'color', value: colorFromWord(color[1].replace(/^ال/, '')) };
  const size = /^(?:خلي\s+)?(?:حجم\s+)?(?:الخط|الكلام|النص)\s+(?:حجمه\s+|حجم\s+|مقاس\s+)?(\d{1,3}|[٠-٩]{1,3})$/u.exec(text);
  if (size) {
    const n = numOf(size[1]);
    if (n >= 6 && n <= 120) return { op: 'size', value: n };
  }
  return null;
}

/**
 * @param {string} text normalized, filler-free
 * @param {string} raw as said
 * @returns {[string, object, number] | null}
 */
export function recognizeOffice(text, raw) {
  if (!text) return null;
  // ---- writing and drawing on the screen itself (like a pen on a Samsung tablet)
  if (PEN_ON.has(text)) return ['screen_pen', { on: true }, 0.95];
  const penStyle = penStyleOf(text);
  if (penStyle) return ['screen_pen', { on: true, ...penStyle }, 0.94];
  if (PEN_OFF.has(text)) return ['screen_pen', { on: false }, 0.95];
  if (SCREEN_CLEAR.has(text)) return ['screen_clear', {}, 0.95];
  if (CIRCLE_SEL.has(text) || CIRCLE_RE.test(text)) return ['office_circle', {}, 0.92];
  const find = screenFindOf(text, raw);
  if (find) return ['screen_find', find, 0.93];
  if (DIGITS_AR.has(text)) return ['set_digits', { digits: 'arabic' }, 0.95];
  if (DIGITS_EN.has(text)) return ['set_digits', { digits: 'latin' }, 0.95];
  const onScreen = /^(?:اكتب|اكتبي|اكتبلي|كتب)\s+(?:لي\s+)?(?:علي|عل|في|ع)\s+(?:الشاشه|سطح المكتب|الديسكتوب)\s*[:：]?\s*(.+)$/u.exec(text)
    || /^(?:اكتب|اكتبي|اكتبلي|كتب)\s+(.+?)\s+(?:علي|عل|في|ع)\s+(?:الشاشه|سطح المكتب|الديسكتوب)$/u.exec(text);
  if (onScreen) {
    const said = verbatimFrom(raw) ?? fromRaw(text, raw, onScreen[1]);
    return ['screen_write', { text: (looksLikeMath(said) ? spokenMath(said) : said).slice(0, 200) }, 0.93];
  }
  const drawScreen = /^(?:ارسم|ارسملي|رسم|حط)\s+(?:لي\s+)?(?:علي|عل|في|ع)\s+(?:الشاشه|سطح المكتب)\s+(.+)$/u.exec(text)
    || /^(?:ارسم|ارسملي|رسم|حط)\s+(?:لي\s+)?(.+?)\s+(?:علي|عل|في|ع)\s+(?:الشاشه|سطح المكتب)$/u.exec(text);
  if (drawScreen) {
    const shape = parseShape(drawScreen[1]);
    if (shape) return ['screen_draw', { ...shape }, 0.93];
  }
  // ---- equations: «اكتب معادله س زائد اثنين يساوي خمسه», «معادله: ٣/٤ + ١/٤ = ١»
  const eq = /^(?:(?:اكتب|اكتبي|اكتبلي|حط|ضيف|اضف|سو)\s+(?:لي\s+)?)?(?:معادله|المعادله|مساله|المساله|عمليه|العمليه)\s*[:：]?\s+(.+)$/u.exec(text);
  if (eq) {
    const where = splitApp(eq[1]);
    const body = where ? where.rest : eq[1];
    const said = verbatimFrom(raw) ?? fromRaw(text, raw, body);
    const written = spokenMath(said);
    if (looksLikeMath(said) || /[=+×÷−-]/.test(said)) return ['office_equation', { text: written.slice(0, 300), app: where?.app && where.app !== 'pdf' ? where.app : null }, 0.93];
  }
  if (SLIDE_NEW.has(text)) return ['office_slide', { op: 'new' }, 0.95];
  const slideTitled = /^(?:شريحه جديده|ضيف شريحه|اضف شريحه|سلايد جديد)\s+(?:عنوانها|بعنوان|اسمها|عنوان)\s+(.+)$/u.exec(text);
  if (slideTitled) return ['office_slide', { op: 'new', title: rawTail(raw, 3).replace(/^(?:عنوانها|بعنوان|اسمها|عنوان)\s+/u, '').slice(0, 120) }, 0.92];
  if (EXPORT_PDF.has(text)) return ['office_pdf', {}, 0.95];
  for (const [op, set] of FORMAT) if (set.has(text)) return ['office_format', { op }, 0.9];
  const fv = formatValue(text);
  if (fv) return ['office_format', fv, 0.9];

  // «اكتب في الوورد: نص» / «اكتب في البوربوينت عنوان درس الكسور»: the words as said.
  const intoApp = /^(?:اكتب|اكتبي|كتب|حط|اكتبلي)\s+(?:لي\s+)?(?:في|ب|بال|علي)\s*(?:ال)?(?:ملف\s+)?(وورد|ورد|بوربوينت|باوربوينت|اكسل|الوورد|الورد|البوربوينت|الاكسل|العرض|الشريحه)\s*[:：]?\s*(.*)$/u.exec(text);
  // «اكتب في الوورد قصة عن الأمانة» asks for writing, not for those exact words (a «:» means exact words).
  const asksWriting = intoApp && !/[:：]/.test(String(raw)) && ((leadingKind(intoApp[2]) && !/^(?:عنوان|العنوان)\s/u.test(intoApp[2])) || /^(?:عن|حول)\s/u.test(intoApp[2]));
  if (intoApp && !asksWriting) {
    const app = splitApp(`في ${intoApp[1]}`)?.app;
    const said = verbatimFrom(raw) ?? rawTail(raw, raw.trim().split(/\s+/).length - intoApp[2].split(' ').filter(Boolean).length);
    if (app && intoApp[2]) {
      const heading = /^(?:عنوان|العنوان)\s+/u.test(intoApp[2]);
      return ['office_write', { app, text: said.replace(/^(?:عنوان|العنوان)\s+/u, '').slice(0, 4000), style: heading ? 'heading' : 'normal' }, 0.92];
    }
  }

  // Drawing a shape: «ارسم دايرة حمرا», «ارسم ٣ نجوم صفرا في البوربوينت».
  const draw = DRAW.exec(text);
  if (draw) {
    const where = splitApp(draw[1]);
    const what = where ? where.rest : draw[1];
    const shape = parseShape(what);
    if (shape) {
      const w = /(?:مكتوب|مكتوبه|عليه|عليها)\s+(?:فيه|فيها|عليه|عليها)?\s*(.+)$/u.exec(String(raw));
      return ['draw_shape', { ...shape, text: w ? w[1].replace(/\s+(?:في|ب)\s+\S+$/u, '').replace(/^[«"]|[»"]$/g, '').slice(0, 80) : shape.text, app: where?.app || null }, 0.92];
    }
  }

  // Composing: «اكتب فقرة عن النخلة في الوورد», «سو عرض عن الكسور من ٥ شرائح», «ارسم دورة الماء».
  const make = MAKE.exec(text);
  if (make) {
    const verb = text.slice(0, text.length - make[1].length).trim();
    const drawing = /ارسم|رسم|ترسم/.test(verb);
    const where = splitAppAnywhere(make[1]);
    let body = where ? where.rest : make[1];
    if (/^(?:حرفيا|حرفي|زي ما اقول|مثل ما اقول|نفس كلامي)\b/u.test(body)) return null; // «اكتب حرفياً ...» types as said
    const countM = COUNT_ANY.exec(body);
    const count = countM ? Math.min(15, numOf(countM[1]) || 0) || null : null;
    if (countM) body = body.replace(countM[0], ' ').replace(/\s+/g, ' ').trim();
    // «٥ اسئله عن الجمع»: the count named the kind.
    let kindHit = leadingKind(body);
    if (!kindHit && countM) {
      const unit = countM[0].trim().split(' ').at(-1);
      kindHit = { kind: /شرايح|شريحه|سلايد/.test(unit) ? 'slides' : /اسيله|سوال|تمارين|مسايل/.test(unit) ? 'quiz' : 'text', word: '', rest: body };
    }
    // «فقرة قصيرة عن النخلة»: the describing word is how to write it (the prompt keeps the whole sentence), not the topic.
    const STYLE = /^(?:(?:قصيره|قصير|طويله|طويل|مختصره|مختصر|بسيطه|بسيط|سهله|سهل|صغيره|صغير|كبيره|كبير|جميله|جميل|حلوه|حلو|مفصله|مفصل|ممتعه|ممتع|شامله|شامل|واضحه|واضح|جدا|شوي|مره)\s+)+/u;
    const topicFrom = (s) => s.replace(STYLE, '').replace(ABOUT, '').trim();
    // «سولي اختبار رياضيات» is the quick maths game; a written quiz names its topic («عن ...»), an app or a count.
    if (kindHit && kindHit.kind === 'quiz' && !where && !countM && !ABOUT.test(kindHit.rest)) return null;
    if (kindHit) {
      let kind = kindHit.kind;
      let topic = topicFrom(kindHit.rest);
      // «جدول ضرب», «دوره الماء», «مراحل نمو النبات»: the kind word is part of the topic.
      if (/^(?:دوره|مراحل|خطوات|هرم|شجره|جدول ضرب)$/u.test(kindHit.word) || (!topic && kindHit.word.includes(' ') && kind === 'table')) topic = `${kindHit.word} ${topic}`.trim();
      // «هات جدول الحصص» is the timetable, not a new spreadsheet.
      if (kind === 'table' && /^(?:الحصص|حصصي|حصص اليوم|اليوم|الحصص اليوم|حصص)$/u.test(topic)) return null;
      // «ارسم دوره الماء»: a drawing; «اكتب جدول» in Word stays a Word table.
      if (drawing && kind !== 'table') kind = 'diagram';
      if (kind === 'text' && where?.app === 'powerpoint' && /عرض|شرايح/.test(kindHit.word)) kind = 'slides';
      // «سو عرض» alone or «اكتب عرض» with no topic is too vague.
      if (!topic || topic.length < 2) return ['compose', { kind, topic: '', app: where?.app || KINDS[kind].app, count, fresh: where?.fresh || false, raw: String(raw).slice(0, 400), vague: true }, 0.85];
      return ['compose', { kind, topic: fromRaw(text, raw, topic).slice(0, 200), app: where?.app || KINDS[kind].app, count, fresh: where?.fresh || false, raw: String(raw).slice(0, 400) }, 0.92];
    }
    // «اكتب عن النخلة», «ارسم شكل يوضح ...», «اكتب لي شي عن الماء في الوورد»
    const about = /^(?:شي\s+|شيء\s+|كلام\s+)?(?:عن|حول|بخصوص)\s+(.+)$/u.exec(body);
    if (about) {
      const kind = drawing ? 'diagram' : where?.app === 'powerpoint' ? 'slides' : where?.app === 'excel' ? 'table' : 'text';
      return ['compose', { kind, topic: fromRaw(text, raw, about[1]).slice(0, 200), app: where?.app || KINDS[kind].app, count, fresh: where?.fresh || false, raw: String(raw).slice(0, 400) }, 0.9];
    }
    // «ارسم دوره الماء» without a kind word but clearly a picture to explain.
    if (drawing && /^(?:دوره|مراحل|خطوات|اجزاء|تصنيف|انواع)\s+/u.test(body)) {
      return ['compose', { kind: 'diagram', topic: fromRaw(text, raw, body).slice(0, 200), app: where?.app || 'powerpoint', count, fresh: where?.fresh || false, raw: String(raw).slice(0, 400) }, 0.88];
    }
    // «اكتب السلام عليكم في الوورد»: the words as said, into that app.
    if (where && where.app !== 'pdf' && /^(?:اكتب|اكتبي|كتب|اكتبلي)$/.test(verb.split(' ').at(-1)) && body) {
      const words = String(raw).trim().split(/\s+/);
      const appWords = text.split(' ').length - body.split(' ').length - verb.split(' ').length;
      const said = words.slice(verb.split(' ').length, words.length - appWords).join(' ');
      return ['office_write', { app: where.app, text: said.slice(0, 4000), style: 'normal' }, 0.88];
    }
  }
  return null;
}

export { COLORS };
