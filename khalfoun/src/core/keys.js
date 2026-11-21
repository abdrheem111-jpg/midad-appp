// Keyboard control by voice: the fixed list of keys and shortcuts Khalfoun may
// press, what people call them, and which ones change content (those need a
// yes at the assistant level). Shared by the brain and the main process.

import { normalize } from './arabic.js';

/** id → {ar: name he says, edits: changes content?, phrases: what people say} */
export const KEYS = {
  enter: { ar: 'إنتر', edits: true, phrases: ['انتر', 'انتير', 'اضغط انتر', 'دوس انتر', 'ادخال', 'اضغط ادخال', 'انزل سطر', 'نزل سطر', 'سطر جديد', 'سطر ثاني', 'انزل سطر جديد', 'فقره جديده', 'روح السطر الجاي', 'السطر اللي بعده', 'انزل تحت سطر'] },
  tab: { ar: 'تاب', edits: false, phrases: ['تاب', 'اضغط تاب'] },
  escape: { ar: 'إسكيب', edits: false, phrases: ['اسكيب', 'اضغط اسكيب', 'اسكب'] },
  space: { ar: 'مسافة', edits: true, phrases: ['مسافه', 'اضغط مسافه', 'سبيس'] },
  backspace: { ar: 'مسح حرف', edits: true, phrases: ['امسح حرف', 'امسح اخر حرف', 'باك سبيس', 'اضغط باك سبيس'] },
  delete_word: { ar: 'مسح كلمة', edits: true, phrases: ['امسح كلمه', 'امسح اخر كلمه', 'امسح الكلمه', 'امسح الكلمه الاخيره'] },
  copy: { ar: 'نسخ', edits: false, phrases: ['انسخ', 'انسخه', 'انسخها', 'انسخ هذا', 'كوبي'] },
  paste: { ar: 'لصق', edits: true, phrases: ['الصق', 'الصقه', 'الصقها', 'لصق', 'بيست', 'الصق هني', 'الصق هنا'] },
  cut: { ar: 'قص', edits: true, phrases: ['قص', 'قصها', 'قص هذا', 'كت'] },
  select_all: { ar: 'تحديد الكل', edits: false, phrases: ['حدد الكل', 'ظلل الكل', 'حدد كل شي', 'ظلل كل شي', 'حدد الكلام كله'] },
  save: { ar: 'حفظ', edits: false, phrases: ['احفظ', 'احفظ الملف', 'احفظه', 'احفظها', 'سيف', 'حفظ'] },
  print: { ar: 'طباعة', edits: false, phrases: ['اطبع', 'اطبع الملف', 'اطبعه', 'اطبعها', 'برنت'] },
  undo: { ar: 'تراجع', edits: true, phrases: ['تراجع', 'تراجع عن اخر شي', 'رجع اللي سويته', 'اندو', 'كنسل اخر شي'] },
  redo: { ar: 'إعادة', edits: true, phrases: ['اعاده', 'رجع اللي مسحته', 'رجع اللي تراجعت عنه', 'ريدو'] },
  find: { ar: 'بحث في الصفحة', edits: false, phrases: ['دور في الصفحه', 'ابحث في الصفحه', 'دور في الملف', 'فايند'] },
  slideshow: { ar: 'بدء العرض', edits: false, phrases: ['ابدا العرض', 'شغل العرض', 'ابدا عرض الشرائح', 'شغل عرض الشرائح', 'شغل الشرائح', 'ابدا الشرائح', 'اعرض الشرائح', 'سلايد شو'] },
  next_slide: { ar: 'الشريحة التالية', edits: false, phrases: ['الشريحه الجايه', 'الشريحه اللي بعدها', 'الشريحه التاليه', 'السلايد الجاي', 'السلايد اللي بعده', 'الشريحه الثانيه', 'قدم الشريحه', 'شريحه جايه'] },
  prev_slide: { ar: 'الشريحة السابقة', edits: false, phrases: ['الشريحه اللي قبل', 'الشريحه اللي قبلها', 'ارجع الشريحه اللي قبل', 'الشريحه السابقه', 'السلايد اللي قبل', 'ارجع شريحه', 'رجع الشريحه'] },
  end_show: { ar: 'إنهاء العرض', edits: false, phrases: ['وقف العرض', 'سكر العرض', 'اطلع من العرض', 'خلص العرض', 'انهي العرض', 'نهي العرض'] },
  new_file: { ar: 'ملف جديد', edits: false, phrases: ['ملف جديد', 'افتح ملف جديد', 'سو ملف جديد', 'سولي ملف جديد', 'مستند جديد', 'افتح مستند جديد', 'صفحه جديده', 'افتح صفحه جديده', 'جديد'] },
  new_tab: { ar: 'تبويب جديد', edits: false, phrases: ['تبويب جديد', 'تاب جديد', 'افتح تبويب جديد', 'افتح تاب جديد'] },
  close_tab: { ar: 'إغلاق التبويب', edits: false, phrases: ['سكر التبويب', 'سكر التاب', 'اقفل التبويب', 'اقفل التاب', 'سكر هالتبويب', 'سكر هالتاب'] },
  next_tab: { ar: 'التبويب التالي', edits: false, phrases: ['التبويب الجاي', 'التاب الجاي', 'التبويب اللي بعده', 'التاب اللي بعده', 'التبويب التالي'] },
  prev_tab: { ar: 'التبويب السابق', edits: false, phrases: ['التبويب اللي قبل', 'التاب اللي قبل', 'التبويب السابق', 'التاب السابق'] },
  reopen_tab: { ar: 'إرجاع التبويب', edits: false, phrases: ['رجع التبويب', 'رجع التاب', 'رجع التبويب اللي سكرته'] },
  page_down: { ar: 'نزول في الصفحة', edits: false, phrases: ['انزل في الصفحه', 'نزل الصفحه', 'نزل في الصفحه', 'سكرول تحت', 'نزل تحت في الصفحه', 'انزل تحت في الصفحه', 'نزل شوي في الصفحه'] },
  page_up: { ar: 'طلوع في الصفحة', edits: false, phrases: ['اطلع في الصفحه', 'اطلع فوق في الصفحه', 'طلع الصفحه', 'سكرول فوق', 'طلع في الصفحه'] },
  top: { ar: 'أول الصفحة', edits: false, phrases: ['اول الصفحه', 'روح اول الصفحه', 'بدايه الصفحه'] },
  bottom: { ar: 'آخر الصفحة', edits: false, phrases: ['اخر الصفحه', 'روح اخر الصفحه', 'نهايه الصفحه'] },
  // Formatting shortcuts (used when no Office program answers; «خلي الخط عريض» goes through Office first).
  bold: { ar: 'خط عريض', edits: true, phrases: [] },
  italic: { ar: 'خط مائل', edits: true, phrases: [] },
  underline: { ar: 'خط تحت الكلام', edits: true, phrases: [] },
  align_center: { ar: 'توسيط', edits: true, phrases: [] },
  zoom_in: { ar: 'تكبير', edits: false, phrases: ['كبر الشاشه', 'زووم', 'قرب الشاشه', 'كبر الصفحه'] },
  zoom_out: { ar: 'تصغير', edits: false, phrases: ['صغر الشاشه', 'بعد الشاشه', 'صغر الصفحه'] },
  zoom_reset: { ar: 'الحجم الطبيعي', edits: false, phrases: ['رجع الحجم', 'الحجم الطبيعي', 'رجع الخط طبيعي'] },
  switch_window: { ar: 'تبديل النافذة', edits: false, phrases: ['بدل النافذه', 'غير النافذه', 'النافذه الثانيه', 'روح النافذه الثانيه', 'بدل البرنامج'] },
  show_desktop: { ar: 'سطح المكتب', edits: false, phrases: ['سطح المكتب', 'وريني سطح المكتب', 'نزل كل النوافذ', 'خفي النوافذ', 'روح سطح المكتب'] },
  fullscreen: { ar: 'ملء الشاشة', edits: false, phrases: ['شاشه كامله', 'ملء الشاشه', 'فل سكرين', 'كبر النافذه'] },
  refresh: { ar: 'تحديث', edits: false, phrases: ['حدث الصفحه', 'ريفرش', 'حدث', 'تحديث الصفحه', 'سو ريفرش'] },
};

const PHRASE_TO_KEY = new Map();
for (const [id, k] of Object.entries(KEYS)) for (const p of k.phrases) PHRASE_TO_KEY.set(normalize(p), id);

/** The key a whole (normalized, filler-free) sentence asks for, or null. */
export function keyFor(text) {
  return PHRASE_TO_KEY.get(text) || null;
}

export const KEY_IDS = new Set(Object.keys(KEYS));
export const isEditingKey = (id) => Boolean(KEYS[id]?.edits);
