// Rule-based understanding of spoken Omani/Gulf Arabic commands.
// Input is whatever the speech recognizer (or keyboard) produced; output is an
// intent name plus slots. The rules run offline and in well under a millisecond.

import { normalize, hasPhrase, parseMinutes, parseClock, parseNumberToken } from './arabic.js';
import { swapDistance as levenshtein } from './wake.js';
import { calculate } from './calc.js';
import { keyFor } from './keys.js';
import { parseClassEntry } from './schedule.js';
import { recognizeClassroom } from './class-intents.js';
import { recognizeOffice } from './office-intents.js';

const N = (list) => list.map(normalize).sort((a, b) => b.length - a.length);

const FILLERS = N([
  'يا خلفون', 'خلفون', 'يا حلفون', 'حلفون', 'يا خالفون', 'خالفون', 'لو سمحت', 'لوسمحت', 'من فضلك', 'الله يخليك', 'الله يعافيك',
  'بليز', 'يا', 'ممكن', 'تقدر', 'ابا', 'ابي', 'ابغى', 'ابغا', 'اريد', 'ودي', 'بغيت',
  'ابغاك', 'ابيك', 'اباك', 'ابغيك', 'عاد', 'طال عمرك', 'لو تكرمت', 'بسرعه', 'الحين', 'هسه', 'خلنا',
  'يا الغالي', 'الغالي', 'يا ريال', 'يا رجال', 'يا اخوي', 'اخوي', 'يا بعدي', 'بعد عمري', 'اذا ممكن', 'اذا سمحت',
]);
/** Words that mean «I want»: «ابي الحاسبة» opens it. */
const WANT = N(['ابا', 'ابي', 'ابغى', 'ابغا', 'اريد', 'ودي', 'بغيت', 'عطني', 'هات', 'جيب لي', 'جيبلي']);

/** Apps and sites the assistant knows by name. `kind` decides how main opens it. */
export const APPS = [
  { id: 'browser', kind: 'app', names: ['المتصفح', 'متصفح', 'الانترنت', 'النت', 'كروم', 'جوجل كروم', 'الكروم', 'ايدج', 'الايدج', 'فايرفوكس', 'البراوزر', 'براوزر', 'chrome', 'edge', 'firefox', 'browser'] },
  { id: 'google', kind: 'url', url: 'https://www.google.com', names: ['جوجل', 'قوقل', 'غوغل', 'google'] },
  { id: 'youtube', kind: 'url', url: 'https://www.youtube.com', names: ['يوتيوب', 'اليوتيوب', 'يوتيب', 'youtube'] },
  { id: 'whatsapp', kind: 'url', url: 'https://web.whatsapp.com', names: ['الواتساب', 'واتساب', 'الواتس', 'واتس اب', 'whatsapp'] },
  { id: 'calculator', kind: 'app', names: ['الحاسبه', 'حاسبه', 'الاله الحاسبه', 'الكالكوليتر', 'الحاسبة', 'calculator', 'calc'] },
  { id: 'notepad', kind: 'app', names: ['المفكره', 'مفكره', 'النوتباد', 'نوت باد', 'النوت باد', 'نوتباد', 'الملاحظات', 'المذكره', 'notepad'] },
  { id: 'paint', kind: 'app', names: ['الرسام', 'برنامج الرسم', 'بينت', 'البينت', 'paint'] },
  { id: 'explorer', kind: 'app', names: ['الملفات', 'مستكشف الملفات', 'المستكشف', 'ملفاتي', 'المجلدات'] },
  { id: 'downloads', kind: 'folder', names: ['التنزيلات', 'التحميلات', 'الداونلود', 'مجلد التنزيلات'] },
  { id: 'documents', kind: 'folder', names: ['المستندات', 'مستنداتي', 'الوثايق', 'مجلد المستندات'] },
  { id: 'desktop', kind: 'folder', names: ['سطح المكتب', 'الديسكتوب', 'ديسكتوب', 'مجلد سطح المكتب'] },
  { id: 'pictures', kind: 'folder', names: ['الصور', 'صوري', 'مجلد الصور'] },
  { id: 'word', kind: 'app', names: ['الوورد', 'وورد', 'الورد', 'word'] },
  { id: 'excel', kind: 'app', names: ['الاكسل', 'اكسل', 'الاكسيل', 'excel'] },
  { id: 'powerpoint', kind: 'app', names: ['البوربوينت', 'بوربوينت', 'الباوربوينت', 'باوربوينت', 'العروض التقديميه', 'powerpoint'] },
  { id: 'settings', kind: 'app', names: ['اعدادات الجهاز', 'اعدادات الكمبيوتر', 'اعدادات ويندوز', 'الاعدادات'] },
].map((a) => ({ ...a, names: N(a.names) }));

const L = {
  stopExact: N(['وقف', 'بس', 'خلاص', 'اسكت', 'وقف وقف', 'خلاص بس', 'كفايه', 'الغي', 'كنسل', 'بس بس', 'استوب']),
  yesExact: N(['نعم', 'اي', 'ايوه', 'ايوا', 'اكيد', 'تمام', 'اوكي', 'اوك', 'يب', 'صح', 'زين', 'ماشي', 'نفذ', 'سوها', 'سويها', 'يلا', 'يالله', 'طيب', 'اي نعم', 'اكيد سوها', 'ok', 'yes']),
  noExact: N(['لا', 'لا لا', 'لا خلاص', 'لا لا خلاص', 'خلاص لا', 'لا ما بغيت', 'ما بغيت', 'ما ابغى', 'ما ابغا', 'لاء', 'خلها', 'خليها', 'بلاش', 'ما ابا', 'ما ابي', 'لا تسوي', 'لا تسويها', 'مب لازم', 'لا شكرا', 'لا خلها', 'لا خليها', 'لا بلاش', 'لا ما ابا', 'لا ما ابي', 'لا مب لازم', 'ما يحتاج', 'لا ما يحتاج', 'no']),
  soundsOff: N(['اسكت الاصوات', 'بدون اصوات', 'بلا اصوات', 'وقف الاصوات', 'سكت الاصوات', 'اكتم صوتك', 'لا تطلع اصوات', 'طفي الاصوات']),
  soundsOn: N(['شغل الاصوات', 'رجع الاصوات', 'شغل صوتك', 'ابا الاصوات', 'خل الاصوات']),
  pdfSign: N(['وقع الملف', 'وقع البي دي اف', 'وقع ملف البي دي اف', 'حط توقيعي', 'حط اسمي في الملف', 'وقع لي الملف', 'وقعلي الملف']),
  cancelReminders: N(['الغ التذكير', 'الغي التذكير', 'الغ التذكيرات', 'الغي التذكيرات', 'وقف التذكير', 'وقف التذكيرات', 'شيل التذكير', 'شيل التذكيرات', 'لا تذكرني', 'بلاش التذكير']),
  clearRoutines: N(['الغ العادات', 'لا تفتح شي لحالك', 'لا تفتح شي بروحك', 'انس العادات', 'وقف العادات']),
  remind: N(['ذكرني', 'نبهني', 'فكرني', 'ذكرني بعد', 'سولي تذكير', 'سو تذكير', 'حط تذكير', 'حط منبه']),
  type: N(['تكتب لي', 'تكتبلي', 'تكتب', 'اكتب لي', 'اكتبلي', 'اكتب', 'كتب لي', 'دون لي', 'دون']),
  search: N(['تدور لي عن', 'تدور لي على', 'تدورلي عن', 'تدور لي', 'تدورلي', 'تدور عن', 'تدور على', 'تدور', 'تبحث عن', 'تبحث لي عن', 'دور لي عن', 'دور لي على', 'دورلي عن', 'دورلي على', 'دور لي', 'دورلي', 'دور عن', 'دور على', 'دور', 'ابحث لي عن', 'ابحث عن', 'ابحث', 'فتش عن', 'فتش على', 'فتش', 'سيرش', 'سيرش عن']),
  open: N(['خذني على', 'خذني الى', 'خذني', 'وديني على', 'ودني على', 'تفتح لي', 'تفتحلي', 'تفتح', 'تفج', 'تشغل', 'تشغل لي', 'افتح لي', 'افتحلي', 'افتح', 'فتح لي', 'فتحلي', 'فتح', 'نفتح', 'فج لي', 'فجلي', 'فج', 'فك لي', 'فك', 'شغل لي', 'شغللي', 'شغل', 'نشغل', 'وديني', 'ودني', 'روح على', 'دخلني', 'دخل على']),
  close: N(['قفل', 'قفل لي', 'صك', 'صك لي', 'سد', 'سكر', 'سكرلي', 'سكر لي', 'تسكر', 'اقفل', 'اقفل لي', 'تقفل', 'بند', 'اغلق', 'طفي', 'طفي لي', 'طفي البرنامج', 'سكر البرنامج']),
  typeLast: N(['اكتبها', 'اكتبه', 'اكتبهم', 'اكتب الجواب', 'اكتب الاسئله', 'اكتب الاسيله', 'اكتب الملخص', 'اكتب الشرح', 'حطها في الملف', 'حطه في الملف', 'الصقها في الملف', 'اكتبها في الملف', 'اكتبها هني', 'اكتبها هنا']),
  contextHelp: N(['شو اقدر اسوي هنا', 'ايش اقدر اسوي هنا', 'ساعدني هنا', 'وين انا', 'شو البرنامج اللي مفتوح', 'شو مفتوح', 'شو اسوي هنا', 'كيف تساعدني هنا', 'شو تقدر تسوي هنا']),
  closeIt: N(['قفله', 'قفلها', 'صكه', 'صكها', 'سكره', 'سكرها', 'سكرهم', 'سكرة', 'اقفله', 'اقفلها', 'بنده', 'بندها', 'طفيه', 'طفيها', 'اغلقه', 'اغلقها', 'سكره خلاص', 'سكرها خلاص']),
  openIt: N(['افتحه', 'افتحها', 'افتحه مره ثانيه', 'افتحها مره ثانيه', 'رجعه', 'رجعها', 'شغله', 'شغلها', 'فجه', 'فجها']),
  repeat: N(['مره ثانيه', 'مرة ثانيه', 'عيدها', 'عيد', 'كمان مره', 'كمان', 'سوها مره ثانيه', 'سويها مره ثانيه', 'زيد', 'بعد', 'زيد بعد', 'اكثر', 'زياده', 'بعد زيد', 'نفس الشي', 'كرر', 'كررها', 'ثاني مره', 'مره ثاني']),
  volumeWord: N(['الصوت', 'الصوط', 'الساوند']),
  volumeUp: N(['ارفع', 'علي', 'كبر', 'زيد', 'عل', 'ارفعه', 'عليه', 'زوده', 'زود', 'ما اسمع', 'ما اسمعه', 'اعلى']),
  volumeDown: N(['وطي', 'نزل', 'قصر', 'صغر', 'خفض', 'خفف', 'نقص', 'قلل', 'هد', 'هدي', 'اخفض', 'وطيه', 'نزله', 'واطي', 'مزعج', 'عالي', 'واجد عالي', 'ادنى']),
  volumeMute: N(['اكتم', 'كتم', 'سكت', 'طفي', 'اقفل', 'سكر']),
  screenshot: N(['صور الشاشه', 'صورلي الشاشه', 'لقطه شاشه', 'لقطه للشاشه', 'سكرين شوت', 'سكرينشوت', 'صوره للشاشه', 'خذ صوره للشاشه', 'خذ لقطه']),
  time: N(['شو الساعه', 'ايش الساعه', 'وش الساعه', 'كم صارت الساعه', 'الساعه كم صارت', 'كم الساعه معك', 'كم الساعه عندك', 'كم الساعه', 'الساعه كم', 'كم الوقت', 'الوقت كم', 'شو الوقت', 'ايش الوقت', 'كم الساعه الحين', 'الساعه الحين']),
  date: N(['اليوم ايش', 'اليوم شو', 'كم تاريخ اليوم', 'شو يومنا', 'اليوم اي يوم', 'كم التاريخ', 'شو التاريخ', 'التاريخ اليوم', 'اليوم كم', 'شو اليوم', 'اي يوم اليوم', 'ايش اليوم', 'تاريخ اليوم']),
  joke: N(['نكته', 'نكت', 'ضحكني', 'قول نكته', 'عطني نكته', 'قول شي يضحك', 'سو شي يضحك', 'نكته ثانيه', 'وحده ثانيه']),
  organize: N(['رتب', 'نظم', 'رتبلي', 'نظف']),
  undo: N(['تراجع', 'رجع', 'رجعها', 'رجع الترتيب', 'تراجع عن الترتيب', 'الغ الترتيب']),
  sleep: N(['نام', 'روح نام', 'نوم', 'تصبح على خير', 'وقت النوم']),
  wake: N(['اصحى', 'قوم', 'صح النوم', 'اصح', 'قم']),
  come: N(['تعال', 'تعال هني', 'تعال هنا', 'وينك', 'تعال عندي', 'اظهر']),
  moveRight: N(['روح يمين', 'امش يمين', 'يمين', 'على اليمين', 'روح اليمين', 'روح على اليمين', 'شوي يمين', 'زح يمين', 'تحرك يمين']),
  moveLeft: N(['روح يسار', 'امش يسار', 'يسار', 'على اليسار', 'روح اليسار', 'روح على اليسار', 'شوي يسار', 'زح يسار', 'تحرك يسار', 'روح شمال', 'شمال']),
  edgeRight: N(['روح اقصى اليمين', 'روح اخر اليمين', 'اخر اليمين', 'اقصى اليمين']),
  edgeLeft: N(['روح اقصى اليسار', 'روح اخر اليسار', 'اخر اليسار', 'اقصى اليسار']),
  center: N(['تعال الوسط', 'روح الوسط', 'روح النص', 'تعال النص', 'الوسط', 'روح نص الشاشه', 'روح وسط الشاشه']),
  climbUp: N(['اطلع فوق', 'نط فوق', 'اطلع فوق النافذه', 'اطلع على النافذه', 'اقفز فوق النافذه', 'اطلع على البرنامج', 'اطلع فوق البرنامج', 'اطلع']),
  climbDown: N(['انزل تحت', 'انزل', 'نزل تحت', 'انزل من النافذه', 'انزل من فوق', 'نط تحت', 'انزل الارض']),
  stay: N(['اثبت', 'اثبت مكانك', 'لا تتحرك', 'قف هنا', 'قف هني', 'خلك هني', 'خلك هنا', 'خلك مكانك', 'وقف مكانك', 'لا تتحرك من مكانك', 'ثبت']),
  free: N(['تحرك براحتك', 'امش براحتك', 'تمشى', 'تمشي', 'تحرك', 'روح العب', 'خذ راحتك', 'تحرك على راحتك', 'تجول']),
  run: N(['اركض', 'اركض شوي', 'روح اركض']),
  turn: N(['التفت', 'التفت ورا', 'لف وجهك', 'دور وجهك', 'التفت الجهه الثانيه']),
  toMouse: N(['تعال عند الماوس', 'روح عند الماوس', 'روح عند المؤشر', 'تعال عند المؤشر', 'تعال هني عند الماوس']),
  away: N(['روح الزاويه', 'ابعد', 'روح بعيد', 'خلني اركز', 'وضع التركيز', 'لا تزعجني', 'اختفي', 'روح ورا']),
  dance: N(['ارقص', 'رقصه', 'رقص', 'سو رقصه']),
  jump: N(['اقفز', 'نط', 'قفز']),
  humorUp: N(['زيد المزاح', 'خلك مجنون', 'ضحكني اكثر', 'زيد الضحك', 'كن مضحك']),
  humorDown: N(['خفف المزاح', 'خلك هادي', 'بلا مزح', 'بدون مزح', 'خلك جدي', 'قلل المزاح']),
  greet: N(['مسا الخير', 'مسا النور', 'مساء النور', 'صباحو', 'صبحك الله بالخير', 'مساك الله بالخير', 'مساكم الله بالخير', 'صبحكم الله بالخير', 'السلام عليكم', 'سلام عليكم', 'السلام', 'مرحبا', 'مرحبه', 'هلا', 'هلا والله', 'اهلين', 'اهلا', 'صباح الخير', 'مساء الخير', 'صباح النور', 'هاي', 'حياك', 'هلو']),
  howareyou: N(['شحالك', 'شخبارك', 'كيفك', 'كيف حالك', 'شو اخبارك', 'عساك بخير', 'شلونك', 'كيف الحال', 'شحالكم']),
  who: N(['من انت', 'منو انت', 'شو اسمك', 'ايش اسمك', 'عرف عن نفسك', 'عرفني بنفسك', 'من تكون']),
  thanks: N(['شكرا', 'مشكور', 'تسلم', 'يعطيك العافيه', 'ما قصرت', 'تسلم يدك', 'ثانكيو', 'شكرا لك', 'يسلمو']),
  praise: N(['شاطر', 'احسنت', 'برافو', 'ما شاء الله عليك', 'زين عليك', 'عفيه', 'كفو', 'انت ذكي', 'حبيبي', 'احبك', 'انت رهيب', 'وايد زين']),
  scold: N(['غبي', 'مب زين', 'ما تفهم', 'فاشل', 'سيء', 'خايس', 'ما تعرف شي']),
  setName: N(['انا اسمي', 'اسمي', 'ناديني', 'سمني']),
  help: N(['ايش تسوي', 'وش تسوي', 'ايش تعرف تسوي', 'شو تعرف تسوي', 'شو اقدر اقول', 'ايش اقدر اقول', 'شو الاوامر', 'علمني الاوامر', 'شو تقدر تسوي', 'ايش تقدر تسوي', 'ساعدني', 'مساعده', 'الاوامر', 'شو تعرف', 'وش تعرف', 'شو تسوي']),
  settings: N(['اعداداتك', 'الصلاحيات', 'غير الصلاحيات', 'اعدادات خلفون', 'افتح اعداداتك']),
  weather: N(['شو الجو', 'ايش الجو', 'كيف الجو', 'الجو اليوم', 'درجه الحراره', 'درجة الحرارة', 'الطقس اليوم', 'شو الطقس', 'كيف الطقس', 'بتمطر', 'بيمطر', 'في مطر اليوم']),
  prayer: N(['متى صلاه', 'متى الصلاه', 'مواقيت الصلاه', 'اوقات الصلاه', 'متى الاذان', 'كم باقي على الاذان', 'كم باقي على الصلاه', 'متى اذان', 'وقت الصلاه', 'وقت صلاه']),
  hearCheck: N(['تسمعني', 'هل تسمعني', 'انت تسمعني', 'تسمعني ولا لا', 'تسمعني او لا', 'سامعني', 'انت سامعني', 'تسمع صوتي', 'وصلك صوتي', 'تسمعني زين', 'تشتغل', 'انت شغال', 'شغال', 'موجود', 'انت موجود', 'انت هنا', 'هل انت موجود', 'الو', 'الو الو']),
  fine: N(['الحمدلله', 'الحمد لله', 'بخير', 'ابخير', 'ماشي الحال', 'كله تمام', 'تمام الحمدلله', 'زين الحمدلله', 'طيب الحمدلله', 'زين وانت', 'بخير وانت', 'تمام وانت', 'كلش زين', 'في نعمه']),
  goodbye: N(['فمان الله', 'بامان الله', 'الله يحفظك', 'يلا باي', 'اشوفك بعدين', 'نشوفك بعدين', 'مع السلامه', 'باي', 'في امان الله', 'الله معك', 'نشوفك']),
  costumeOff: N(['شيل البشت', 'فسخ البشت', 'نزل العلم', 'شيل العلم', 'شيل الفانوس', 'شيل الزي', 'رجع لبسك العادي', 'البس العادي']),
  bisht: N(['البس البشت', 'لبس البشت', 'البس بشتك', 'وين البشت', 'البشت']),
  flag: N(['ارفع العلم', 'شيل علم عمان', 'ارفع علم عمان', 'وين العلم', 'العلم']),
  lantern: N(['الفانوس', 'شيل فانوس', 'جيب الفانوس', 'ولع الفانوس']),
  quiz: N(['سولي اختبار', 'سو لي اختبار', 'سو اختبار', 'اختبار رياضيات', 'سولي مسابقه', 'سو مسابقه', 'سولي سؤال', 'سو لي سؤال', 'اختبرني', 'اسالني', 'اسالني سوال', 'اسالني سؤال', 'سؤال رياضيات', 'سوال رياضيات', 'خلنا نلعب', 'نلعب', 'العب معي', 'مسابقه', 'سؤال حساب', 'نتحدى', 'تحداني', 'نراجع رياضيات', 'لعبه رياضيات']),
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

/** Khalfoun's own windows: the maths whiteboard «مِداد» and the AI notebook. */
export const TOOLS = [
  { id: 'board', names: N(['السبوره', 'سبوره', 'السبوره الذكيه', 'سبوره الرياضيات', 'سبوره رياضيات', 'مداد', 'سبوره مداد', 'اللوح', 'لوح الرياضيات', 'الوايت بورد', 'وايت بورد', 'السبوره حقتك', 'سبورتك']) },
  { id: 'reading', names: N(['اختبار القراءه', 'اختبار قراءه', 'تقييم القراءه', 'قيم القراءه', 'القراءه الجهريه', 'اختبار القراءه الجهريه', 'قياس القراءه', 'اسمع قراءه الطالب', 'اسمع الطالب يقرا', 'نافذه القراءه', 'اداه القراءه', 'تحدي القراءه']) },
  { id: 'notebook', names: N(['الدفتر', 'دفتري', 'الدفتر الذكي', 'دفتر خلفون', 'دفتر الملاحظات', 'النوت بوك', 'نوت بوك', 'دفترك', 'مذكرتي', 'البطاقات', 'بطاقات المراجعه', 'راجع البطاقات', 'المراجعه']) },
];

export function findTool(normalizedText) {
  const padded = ` ${normalizedText} `;
  let best = null;
  for (const tool of TOOLS) for (const name of tool.names) if (hasPhrase(padded, name) && (!best || name.length > best.name.length)) best = { tool, name };
  return best;
}

/** True when the text is just an app's name, maybe with «برنامج/مجلد» or a want-word. */
function APP_NAME_ONLY(text, app) {
  const rest = WANT.reduce((t, w) => (t.startsWith(`${w} `) ? t.slice(w.length + 1) : t), text).replace(/^(برنامج|مجلد|موقع) /, '');
  return app.names.includes(rest);
}

// ------------------------------------------------------------- PDF pages
const ORDINALS = new Map([
  ['الاولى', 1], ['الاولي', 1], ['الاول', 1], ['الثانيه', 2], ['الثاني', 2], ['الثالثه', 3], ['الثالث', 3], ['الرابعه', 4], ['الرابع', 4],
  ['الخامسه', 5], ['الخامس', 5], ['السادسه', 6], ['السابعه', 7], ['الثامنه', 8], ['التاسعه', 9], ['العاشره', 10], ['الاخيره', 2000], ['الاخير', 2000],
].map(([w, n]) => [normalize(w), n]));

/** «في الصفحة الثانية» / «صفحة ٣» inside a sentence → {page, rest without it}. */
export function takePage(rawText) {
  const words = String(rawText).split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i += 1) {
    if (!/^(ال)?صفح(ه|ة)$/u.test(normalize(words[i]).replace('ة', 'ه'))) continue;
    const nxt = normalize(words[i + 1] || '');
    const page = ORDINALS.get(nxt) ?? (parseMinutesNumber(nxt));
    if (!page) continue;
    let from = i;
    if (from > 0 && /^(في|ف|على|بـ?)$/u.test(normalize(words[from - 1]))) from -= 1;
    const rest = [...words.slice(0, from), ...words.slice(i + 2)];
    // «من البي دي اف» after the page words
    return { page, rest: rest.join(' ').replace(/\s*(من|في)\s*(ال)?(ملف\s*)?(pdf|بي\s*دي\s*اف)\s*$/iu, '').trim() };
  }
  return { page: null, rest: String(rawText).trim() };
}
function parseMinutesNumber(token) {
  if (/^\d+$/.test(token)) return Number(token);
  const map = { واحد: 1, اثنين: 2, ثلاث: 3, ثلاثه: 3, اربع: 4, اربعه: 4, خمس: 5, خمسه: 5, ست: 6, سته: 6, سبع: 7, سبعه: 7, ثمان: 8, ثمانيه: 8, تسع: 9, تسعه: 9, عشر: 10, عشره: 10 };
  return map[token] || null;
}

// ------------------------------------------------------------- classroom
const SCHEDULE_TODAY = new Set(N(['شو عندي اليوم', 'ايش عندي اليوم', 'وش عندي اليوم', 'جدول اليوم', 'حصص اليوم', 'حصصي اليوم', 'كم حصه عندي اليوم', 'شو حصصي اليوم']));
const SCHEDULE_NEXT = new Set(N(['الحصه الجايه', 'شو الحصه الجايه', 'متى الحصه الجايه', 'الحصه اللي بعدها', 'ايش الحصه الجايه', 'الدرس الجاي', 'متى حصتي الجايه', 'شو حصتي الجايه', 'ايش حصتي الجايه', 'حصتي الجايه', 'وش حصتي الجايه', 'شو الحصه اللي بعدها', 'شو بعد هذي الحصه']));
const SCHEDULE_SHOW = new Set(N(['جدولي', 'ورني الجدول', 'الجدول', 'جدول الحصص', 'ورني جدولي', 'شو جدولي']));
const SCHEDULE_CLEAR = new Set(N(['امسح الجدول', 'الغ الجدول', 'صفر الجدول', 'امسح جدولي']));
const SPEAK_ON = new Set(N(['تكلم', 'تكلم بصوت', 'تكلم بصوتك', 'اتكلم', 'خلك تتكلم', 'شغل الكلام', 'قول بصوتك', 'تكلم معي بصوت', 'ابغاك تتكلم', 'اقرا بصوتك', 'رد علي بصوت', 'كلمني بصوت']));
const SPEAK_OFF = new Set(N(['لا تتكلم', 'بدون كلام', 'اسكت عن الكلام', 'وقف الكلام', 'طفي الكلام', 'بلا كلام', 'لا تتكلم بصوت', 'اكتب بس لا تتكلم', 'خلك ساكت']));
const GAME_CHASE = new Set(N(['طاردني', 'الحقني', 'امسك الماوس', 'لعبه المطارده', 'العب مطارده', 'امسكني', 'نلعب مطارده', 'الحق الماوس', 'العب ويا الماوس']));
const GAME_HIDE = new Set(N(['غميضه', 'العب غميضه', 'نلعب غميضه', 'تخبا', 'اختبي', 'استغمايه', 'العب استغمايه', 'نلعب استغمايه', 'تخبى']));
const PICK = new Set(N(['اختر طالب عشوائي', 'اختار طالب عشوائي', 'طالب عشوائي', 'اختار اسم', 'اختر اسم', 'اختار طالب عشوائيا', 'اختار طالب', 'اختر طالب', 'اختار طالبه', 'اختار واحد', 'اختار احد', 'منو يجاوب', 'مين يجاوب', 'منو الدور عليه', 'منو عليه الدور',
  'عطني اسم', 'اعطني اسم', 'قرعه', 'سو قرعه', 'اسحب اسم', 'اختار لي طالب', 'اختار لنا طالب', 'منو يطلع', 'منو يقرا']));
const STUDENT_COUNT = new Set(N(['كم طالب عندي', 'كم عدد الطلاب', 'كم طالب في الصف', 'كم عدد طلابي', 'كم طالب', 'كم الطلاب', 'كم طالبه عندي', 'كم عدد الطالبات']));
const DICE = new Set(N(['ارمي نرد', 'ارم نرد', 'ارمي النرد', 'ارم النرد', 'نرد', 'زهر', 'ارمي الزهر', 'دحرج النرد']));
const BOARD = new Set(N(['النتائج', 'منو الاول', 'لوحه النقاط', 'النقاط', 'كم النقاط', 'ترتيب الطلاب', 'منو الفايز', 'الترتيب', 'ورني النقاط']));
const RESET_POINTS = new Set(N(['صفر النقاط', 'امسح النقاط', 'ابدا النقاط من جديد', 'الغ النقاط', 'صفر الترتيب']));
const TIMER_STOP = new Set(N(['وقف المؤقت', 'الغ المؤقت', 'الغي المؤقت', 'وقف العداد', 'الغ العداد', 'شيل المؤقت']));
const GROUPS_RE = /^(?:قسم|وزع|قسمهم|وزعهم|قسم الصف|وزع الصف|قسم الطلاب|وزع الطلاب|سو)(?: الصف| الطلاب)?(?: الي| علي| ل)? ?(\S+) (مجموعات|مجموعه|فرق|فريق|قروبات|قروب)$/;
const GROUPS_SIZE_RE = /^(?:قسمهم|قسم الصف|قسم الطلاب|وزعهم|سو)? ?(?:مجموعات|فرق|قروبات) (?:من|كل وحده|كل مجموعه) (\S+)(?: طلاب| طالب)?$/;
const AWARD_RE = /^(?:اعط|اعطي|عط|عطي|ادي|حط|زيد|سجل)?\s*(?:(\S+) )?(نجمه|نقطه|نجمتين|نقطتين|(\S+) (?:نجوم|نقاط|نجمات))(?: (?:ل|لـ|الى|حق))? ?(\S+(?: \S+)?)?$/;

function parseNamesLoose(raw) {
  return String(raw || '').split(/[،,;؛\n\-–]+|\s+و\s+|\s+/u).map((w) => w.replace(/^و(?=\S{2,})/u, '').replace(/[.!؟?«»"]/g, '').trim())
    .filter((w) => w && w.length <= 30).filter((w, i, all) => all.findIndex((x) => normalize(x) === normalize(w)) === i).slice(0, 60);
}
/** The person's own words after the first `skip` words. */
function rawTail(raw, skip) {
  return String(raw).trim().split(/\s+/).slice(skip).join(' ').replace(/[.!؟?]+$/u, '').trim();
}

/** «نجمة لأحمد», «نقطتين لمريم», «اعط سعيد نجمة», «زيد فاطمة ثلاث نقاط» → {name, delta}. */
export function parseAward(raw, text) {
  const neg = /^(نقص|انقص|شيل من|اخصم)\s/.test(text);
  const t = neg ? text.replace(/^(نقص|انقص|شيل من|اخصم)\s+/, 'زيد ') : text;
  const m = AWARD_RE.exec(t);
  if (!m) return null;
  // «اعط سعيد نجمة» needs a giving verb before the name; «اكتب نقطة» is not an award.
  const verb = /^(?:اعط|اعطي|عط|عطي|ادي|حط|زيد|سجل)\s/.test(t);
  if (m[1] && !verb) return null;
  let delta = /^(نجمتين|نقطتين)$/.test(m[2]) ? 2 : m[3] ? parseNumberToken(m[3]) : 1;
  if (!delta || delta > 20) return null;
  let name = (m[4] || m[1] || '').replace(/^(ل|لـ)(?=\S{2,})/, '');
  if (!name || /^(ال)?(طالب|طالبه|واحد|هو|هي)$/.test(name)) return null;
  // keep the person's spelling from the raw sentence
  const rawWords = String(raw).trim().split(/\s+/);
  const hit = rawWords.find((w) => normalize(w).replace(/^(ل|لـ)(?=\S{2,})/, '') === name.split(' ')[0]);
  if (hit) name = hit.replace(/^(ل|لـ)(?=\S{2,})/u, '').replace(/[.!؟?]/g, '');
  return { name, delta: neg ? -delta : delta };
}

// ------------------------------------------------------------- eyes
const THIS = '(?: (?:هذا|هذي|هذه|النص|الكلام|المحدد|اللي محدد|اللي حددته|المكتوب|الدرس|الفقره|السؤال|المساله|المسأله|المسائل|اللي في الشاشه|الشاشه|اللي على الشاشه))*';
const SEE_OPS = [
  ['summarize', new RegExp(`^(?:لخص|لخصه|لخصها|لخص لي|لخصلي|تلخيص|سو ملخص|اعطني ملخص|عطني ملخص)${THIS}$`)],
  ['explain', new RegExp(`^(?:اشرح|اشرحه|اشرحها|اشرح لي|اشرحلي|فسر|فسره|فسرها|بسط|بسطه|بسطها|وضح|وضحه|وضحها|شو يقصد|ايش يقصد)${THIS}$`)],
  ['questions', new RegExp(`^(?:(?:سو|اكتب|طلع|جيب|اعطني|عطني|حط)(?: لي)? )?(?:اسيله|اسئله|سوال|سؤال|اختبار|كويز|امتحان)(?: (?:من|عن|على|في))?${THIS}$|^اختبرني (?:في|فيه|فيها|على|عن)${THIS}$`)],
  ['solve', new RegExp(`^(?:حل|حلها|حله|حللي|احسب|احسبها|احسبه|كم الجواب|شو الجواب)${THIS}$`)],
  ['search', new RegExp(`^(?:دور عنه|دور عنها|دور عن|ابحث عنه|ابحث عنها|ابحث عن|دورلي عنه|دور لي عنه)${THIS}$`)],
  ['translate', new RegExp(`^(?:ترجم|ترجمه|ترجمها|ترجم لي|ترجملي)${THIS}(?: (?:انجليزي|بالانجليزي|عربي|بالعربي))?$`)],
  ['meaning', new RegExp(`^(?:(?:شو|ايش|وش) )?(?:معنى|معنا|معني)(?: (?:هذا|هذي|هذه|الكلمه|هالكلمه|هذي الكلمه|الكلمه هذي|هذه الكلمه))+$`)],
  ['count', /^كم (?:كلمه|كلمة|حرف|سطر)(?: (?:فيه|فيها|في هذا|في هذي|هنا|في النص|في الشاشه))?$/],
  ['read', new RegExp(`^(?:(?:شو|ايش|وش) (?:مكتوب|المكتوب|هذا)|اقرا|اقرالي|اقرا لي|اقرا لنا)${THIS}(?: هنا)?$`)],
];
const IMAGE_DESCRIBE = /^(?:(?:صف|وصف|اوصف|اوصف لي|صف لي) (?:ال)?(?:شاشه|صوره|رسمه|اللي في الشاشه)|(?:شو|ايش|وش) (?:في |هذي |هذا |هال)?(?:ال)?(?:صوره|رسمه|رسم|شكل|جدول)(?: هذا| هذي)?|اشرح (?:ال)?(?:صوره|رسمه|رسم|شكل|جدول)(?: هذا| هذي| اللي في الشاشه)?|حل (?:ال)?(?:تمرين|سؤال|مساله|مسأله|واجب)(?: اللي)? (?:في|على) (?:ال)?شاشه)$/;
const SCREEN_ONLY = /^(?:(?:اقرا|اقرالي|اقرا لي|شوف|طالع|طالع في) (?:ال)?شاشه|(?:شو|ايش|وش) (?:في|على|مكتوب في|مكتوب على|اللي في) (?:ال)?شاشه|(?:شو|ايش|وش) تشوف|تشوف شي)$/;

/**
 * «شو مكتوب», «لخص هذا», «حل المسألة», «ترجمه», «اقرأ الشاشة», «لخص اللي في الشاشة».
 * @returns {{op: string, source: 'selection'|'screen'} | null}
 */
export function parseSee(text) {
  if (IMAGE_DESCRIBE.test(text)) {
    const op = /^حل/.test(text) ? 'solve' : /^اشرح/.test(text) ? 'explain' : 'describe';
    return { op, source: 'screen' };
  }
  if (SCREEN_ONLY.test(text)) return { op: 'read', source: 'screen' };
  for (const [op, re] of SEE_OPS) {
    if (re.test(text)) return { op, source: / (ال)?شاشه( |$)/.test(` ${text} `) || / شاشه$/.test(text) ? 'screen' : 'selection' };
  }
  return null;
}

// ------------------------------------------------------------- dictation
const DICTATE_START = /^(?:(?:ابدا|نبدا|خلنا نبدا|شغل|فعل)\s+)?(?:(?:ال)?املاء|وضع الاملاء|خلني املي عليك|بملي عليك|املي عليك|بملي|نملي|املي|اكتب اللي (?:اقوله|بقوله|اقول|بقول)|اكتب (?:ورايا|وراي)|اكتب كل (?:شي|اللي) (?:اقوله|بقوله|اقول))(?:\s|$)/;

/** «ابدأ الإملاء», «املي عليك في البي دي اف الصفحة الثانية تحت» → {target, page, position}. */
export function parseDictationStart(text) {
  if (!DICTATE_START.test(text)) return null;
  const pdf = / (البي دي اف|بي دي اف|بيدي اف|pdf|الملف|ملف) /.test(` ${text} `);
  const { page } = takePage(text);
  const position = / (تحت|الاسفل|اسفل) /.test(` ${text} `) ? 'bottom' : / (الوسط|النص|المنتصف|وسط) /.test(` ${text} `) ? 'middle' : 'top';
  return { target: pdf ? 'pdf' : 'window', page: page || 1, position };
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
  const colon = body.search(/[:：]/);
  if (colon > 0 && (!sep || colon < sep.index)) {
    phrase = body.slice(0, colon);
    command = body.slice(colon + 1).replace(/^\s*(?:يعني|معناها|معناه)\s+/u, '');
  } else if (sep) {
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
  if (!phrase || !command || phrase.length > 60 || command.length > 300) return null;
  return { phrase, command };
}

/** The form a sentence is remembered under when the person teaches a phrase. */
export function phraseKey(raw) {
  return stripFillers(normalize(raw));
}

// ------------------------------------------------------- several commands
const THEN = new Set(N(['وبعدين', 'بعدين', 'وبعدها', 'بعدها', 'ثم', 'وثم', 'وبعد كذا', 'بعد كذا']));
const SPLIT_INTENTS = new Set(['open', 'close', 'search', 'type_text', 'pdf_write', 'volume', 'reminder', 'screenshot', 'time', 'date',
  'joke', 'dance', 'jump', 'come', 'away', 'sleep', 'organize_downloads', 'cancel_reminders', 'quiz', 'sounds',
  'timer', 'open_tool', 'close_tool', 'pick_student', 'wheel', 'celebrate', 'effect', 'effect_stop', 'noise', 'class_mode', 'race_start', 'riddle',
  'class_star', 'attendance_today', 'guide', 'attendance', 'race_advance', 'race_stop', 'export_sheet', 'camera', 'voice_test', 'noise', 'compose', 'draw_shape', 'office_write', 'office_format', 'office_slide', 'office_pdf', 'office_equation', 'office_circle', 'screen_write', 'screen_draw', 'screen_pen', 'screen_clear', 'set_digits', 'key', 'speak', 'points_board', 'schedule_today', 'schedule_next']);
const LEAD_VERBS = new Set(N(['افتح', 'فج', 'شغل', 'سكر', 'اقفل', 'طفي', 'دور', 'ابحث', 'اكتب', 'ذكرني', 'ارفع', 'وطي', 'نزل', 'اكتم', 'رتب', 'صور', 'قول', 'ارقص', 'تعال', 'روح', 'اختار', 'اختر', 'لف', 'احتفل', 'سو', 'سوي', 'ابدا', 'حط', 'ارسم', 'خلي', 'جهز', 'حضر', 'ضيف', 'حول']));

/**
 * Splits «افتح الحاسبة وبعدين المفكرة» or «افتح الحاسبة وافتح الوورد» into
 * separate commands. Only splits when every part is a command on its own, so
 * text to type or search («دور عن خبز ثم حليب») stays whole.
 * @param {string} raw
 * @returns {string[]}
 */
export function splitCommands(raw, { force = false } = {}) {
  const tokens = String(raw || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return [String(raw || '').trim()];
  if (force) {
    // A taught list of steps: split on «وبعدين/ثم» and «و» + a command verb only, and trust it.
    const steps = [[]];
    for (let i = 0; i < tokens.length; i += 1) {
      const n = normalize(tokens[i]);
      const two = i + 1 < tokens.length ? `${n} ${normalize(tokens[i + 1])}` : '';
      if (steps.at(-1).length && THEN.has(two)) { steps.push([]); i += 1; continue; }
      if (steps.at(-1).length && THEN.has(n)) { steps.push([]); continue; }
      if (steps.at(-1).length && n.length > 2 && n.startsWith('و') && LEAD_VERBS.has(n.slice(1))) { steps.push([tokens[i].replace(/^و/u, '')]); continue; }
      steps.at(-1).push(tokens[i]);
    }
    const list = steps.map((p) => p.join(' ').replace(/[،,]+$/u, '').trim()).filter(Boolean);
    if (list.length > 1) return list.slice(0, 8);
  }
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

/** «السلام عليكم» is always answered with «وعليكم السلام» first. */
const SALAM = N(['السلام عليكم', 'سلام عليكم', 'السلام عليكم ورحمه الله', 'السلام']);
const MORNING = N(['صباح الخير', 'صباح النور', 'صباحو', 'صبحك الله بالخير', 'صبحكم الله بالخير']);
const EVENING = N(['مساء الخير', 'مسا الخير', 'مسا النور', 'مساء النور', 'مساك الله بالخير', 'مساكم الله بالخير']);
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
  const look = (padded) => {
    let best = null;
    for (const app of APPS) {
      for (const name of app.names) {
        if (hasPhrase(padded, name) && (!best || name.length > best.name.length)) best = { app, name };
      }
    }
    return best ? best.app : null;
  };
  const direct = look(` ${normalizedText} `);
  if (direct) return direct;
  // «خذني لليوتيوب», «ودني للحاسبه», «روح لكروم»: the name glued to «ل» / «لل».
  const unglued = normalizedText.split(' ').map((w) => (w.length > 3 && w.startsWith('لل') ? `ال${w.slice(2)}` : w.length > 3 && w.startsWith('ل') ? w.slice(1) : w)).join(' ');
  return unglued !== normalizedText ? look(` ${unglued} `) : null;
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

const DURATION_WORDS = new Set(['بعد', 'ربع', 'نص', 'نصف', 'ساعه', 'ساعات', 'ساعتين', 'الا', 'دقيقه', 'دقايق', 'دقائق', 'دقيقتين', 'ثانيه', 'ثواني',
  'الساعه', 'ونص', 'وربع', 'وثلث', 'ثلث', 'الصبح', 'الصباح', 'صباحا', 'الفجر', 'الظهر', 'العصر', 'المغرب', 'المسا', 'المساء', 'مساء', 'الليل', 'بالليل',
  'العشا', 'العشاء', 'بكره', 'باكر', 'بكرا', 'غدا', 'اليوم', 'ص', 'م', 'يوم', 'الاحد', 'الاثنين', 'الاتنين', 'الثلاثاء', 'الثلاثا', 'الاربعاء', 'الاربعا',
  'الخميس', 'الجمعه', 'السبت']);

function reminderNote(raw, verbs, repeat = false) {
  const rest = rawRestAfter(raw, verbs) || '';
  const isNum = (n) => parseNumberToken(n) !== null || (n.length > 2 && n.startsWith('و') && parseNumberToken(n.slice(1)) !== null);
  // «خمسه وعشرين دقيقه» / «خمسه و عشرين»: the joined number parts are not part of the note.
  const tokens = rest.split(/\s+/).filter(Boolean);
  const words = tokens.filter((w, i) => {
    const n = normalize(w);
    if (isNum(n)) return false;
    if (n === 'و' && (isNum(normalize(tokens[i + 1] || '')) || DURATION_WORDS.has(normalize(tokens[i + 1] || '')))) return false;
    return true;
  }).filter((w) => {
    const n = normalize(w);
    return n && !DURATION_WORDS.has(n) && !(repeat && n === 'كل') && !/^\d+$/.test(n) && !/^[\d٠-٩]{1,2}[:.٫][\d٠-٩]{2}$/.test(w) && !/^\d+ \d+$/.test(n) && !/^(واحد|اثنين|ثلاث|ثلاثه|اربع|اربعه|خمس|خمسه|ست|سته|سبع|سبعه|ثمان|ثمانيه|تسع|تسعه|عشر|عشره|عشرين|ثلاثين|اربعين|خمسين|ستين)$/.test(n);
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
  // «وكم ٧ ضرب ٨», «طيب افتح الحاسبة», «زين سكرها»: a joining word in front of a command.
  if (exact.intent === 'unknown' || exact.intent === 'open_unknown') {
    const lead = /^\s*(?:و(?=\S{2})|(?:طيب|زين|اوكي|اوك|يلا|يالله|بعدين|ثم|وبعدين|عيل|اجل|خلاص)\s+)/u;
    const bare = String(raw).replace(lead, '');
    if (bare !== String(raw) && bare.trim()) {
      const again = recognize(bare);
      if (!['unknown', 'open_unknown'].includes(again.intent)) return again;
    }
  }
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
const FUZZY_OK = new Set(['see', 'key', 'open', 'close', 'search', 'type_text', 'pdf_write', 'pdf_sign', 'volume', 'reminder', 'cancel_reminders',
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

  // Keyboard by voice («انسخ», «الصق», «احفظ», «سكر التبويب»): whole sentences only.
  const key = keyFor(text) || (text.startsWith('اضغط ') ? keyFor(text.slice(5)) : null);
  if (key) return out('key', { key }, 0.9);
  // «كم ٢٥ ضرب ٤», «احسب ١٥٪ من ٢٠٠»: only when every word belongs to the calculation.
  if (calculate(raw)) return out('calc', { expr: String(raw).trim() }, 0.95);
  if (L.repeat.includes(text)) return out('repeat', {}, 0.85);
  if (L.hearCheck.includes(text)) return out('hear_check', {}, 0.95);
  if (L.closeIt.includes(text)) return out('close', { app: null, it: true }, 0.85);
  if (L.openIt.includes(text)) return out('open_again', {}, 0.85);
  // ---- classroom joy: attendance, riddles, wheel, race, stars, effects, noise meter, camera
  {
    const hit = recognizeClassroom(text, raw);
    if (hit) return out(...hit);
  }
  // ---- classroom tools
  const namesM = /^(?:اسماء|اسامي) (?:الطلاب|الصف|طلابي|الطالبات|طالباتي)\s*(?:هم|هي)?\s*[:：]?\s*(.+)$/u.exec(normalize(String(raw).split(/[:：]/)[0]) === normalize(String(raw)) ? text : `${normalize(String(raw).split(/[:：]/)[0])} ${String(raw).split(/[:：]/).slice(1).join(':')}`);
  if (namesM) {
    const listRaw = String(raw).includes(':') || String(raw).includes('：') ? String(raw).split(/[:：]/).slice(1).join(':') : String(raw).replace(/^\s*\S+\s+\S+\s*(هم|هي)?\s*/u, '');
    return out('students_set', { names: parseNamesLoose(listRaw) }, 0.92);
  }
  const addM = /^(?:اضف|ضيف|زيد|سجل) (?:الطالب|الطالبه|طالب|طالبه) (.+)$/u.exec(text);
  if (addM) return out('student_add', { name: rawTail(raw, 2) || addM[1] }, 0.9);
  const delM = /^(?:احذف|شيل|امسح) (?:الطالب|الطالبه|طالب|طالبه) (.+)$/u.exec(text);
  if (delM) return out('student_remove', { name: rawTail(raw, 2) || delM[1] }, 0.9);
  if (SCHEDULE_TODAY.has(text)) return out('schedule_today', {}, 0.95);
  if (SCHEDULE_NEXT.has(text)) return out('schedule_next', {}, 0.95);
  if (SCHEDULE_SHOW.has(text)) return out('schedule_show', {}, 0.95);
  if (SCHEDULE_CLEAR.has(text)) return out('schedule_clear', {}, 0.95);
  const dropClass = /^(?:الغ|الغي|امسح|احذف|شيل) (?:حصه|حصة|درس) (.+)$/u.exec(text);
  if (dropClass) return out('schedule_remove', { subject: rawTail(raw, 2) || dropClass[1] }, 0.9);
  if (!startsWithPhrase(text, L.remind)) {
    const entry = parseClassEntry(raw);
    if (entry) return out('schedule_add', entry, 0.9);
  }
  if (SPEAK_ON.has(text)) return out('speak', { on: true }, 0.95);
  if (SPEAK_OFF.has(text)) return out('speak', { on: false }, 0.95);
  if (GAME_CHASE.has(text)) return out('game', { name: 'chase' }, 0.95);
  if (GAME_HIDE.has(text)) return out('game', { name: 'hide' }, 0.95);
  if (PICK.has(text)) return out('pick_student', {}, 0.95);
  if (STUDENT_COUNT.has(text)) return out('students_count', {}, 0.95);
  if (DICE.has(text)) return out('random_number', { min: 1, max: 6, dice: true }, 0.95);
  const rnd = /^(?:اعطني |عطني |اختار |اختر |طلع |سو )?(?:لي )?(?:رقم|عدد) (?:عشوايي )?(?:من|بين) (\S+) (?:الى|الي|لين|الين|ل|و) ?(\S+)$/u.exec(text);
  if (rnd) {
    const a = parseNumberToken(rnd[1]);
    const b = parseNumberToken(rnd[2]);
    if (a !== null && b !== null && a !== b) return out('random_number', { min: Math.min(a, b), max: Math.max(a, b) }, 0.92);
  }
  if (BOARD.has(text)) return out('points_board', {}, 0.9);
  if (RESET_POINTS.has(text)) return out('points_reset', {}, 0.9);
  if (TIMER_STOP.has(text)) return out('timer_stop', {}, 0.95);
  const timerM = /^(?:شغل |حط |سو |ابدا |ابدأ )?(?:مؤقت|موقت|عداد|عد تنازلي|تايمر)(?: (?:ل|لـ|مده|لمده))? ?(.*)$/.exec(text);
  if (timerM) {
    const minutes = parseMinutes(timerM[1] ? `بعد ${timerM[1]}` : '');
    return out('timer', { minutes }, minutes ? 0.95 : 0.6);
  }
  const groupsM = GROUPS_RE.exec(text);
  if (groupsM) {
    const count = parseNumberToken(groupsM[1]);
    if (count) return out('groups', { count }, 0.92);
  }
  const groupsS = GROUPS_SIZE_RE.exec(text);
  if (groupsS) {
    const size = parseNumberToken(groupsS[1]);
    if (size) return out('groups', { size }, 0.92);
  }
  const award = parseAward(raw, text);
  if (award) return out('award', award, 0.9);

  const see = parseSee(text);
  if (see) return out('see', see, 0.9);
  if (L.typeLast.includes(text)) return out('type_last', {}, 0.9);
  if (L.contextHelp.includes(text)) return out('context_help', {}, 0.85);
  const dictate = parseDictationStart(text);
  if (dictate) return out('dictate', dictate, 0.92);
  const teach = parseTeach(raw);
  if (teach) return out('teach', teach, 0.9);
  const forget = /^(?:انس|انسى|امسح|شيل|الغ|الغي)\s+(?:كلمه|كلمة|عباره|عبارة|جمله|جملة|الكلمه|العباره)\s+(.+)$/u.exec(normalize(raw).replace(/^(يا )?خلفون /, ''));
  if (forget) return out('forget_phrase', { phrase: forget[1] }, 0.9);

  if (findPhrase(padded, L.cancelReminders)) return out('cancel_reminders');
  if (findPhrase(padded, L.clearRoutines)) return out('clear_routines');
  if (findPhrase(padded, L.remind)) {
    const repeat = / كل (\S+ )?(دقيقه|دقايق|دقائق|دقيقتين|ساعه|ساعات|ساعتين|ربع|نص|نصف)( |$)/.test(` ${text} `);
    // «ذكرني الساعة خمس العصر»: a clock time rather than «بعد خمس دقايق».
    const clock = !repeat && !/ بعد /.test(` ${text} `) ? parseClock(text) : null;
    const minutes = clock ? null : parseMinutes(text);
    return out('reminder', { minutes, clock, note: reminderNote(raw, L.remind, repeat), repeat }, minutes || clock ? 0.92 : 0.6);
  }

  // ---- writing and drawing in Word, PowerPoint, Excel and PDF
  {
    const hit = recognizeOffice(text, raw);
    if (hit) return out(...hit);
  }

  if (findPhrase(padded, L.pdfSign)) {
    return out('pdf_sign', { position: /(فوق|اعلى|الاعلى)/.test(text) ? 'top' : 'bottom' });
  }

  const typeVerb = startsWithPhrase(text, L.type);
  if (typeVerb) {
    let content = rawRestAfter(raw, L.type, N(['هذا', 'هذي', 'هالكلام', 'الكلام', 'التالي'])) || '';
    // «اكتب ... في ملف الـPDF» writes into the newest PDF instead of the active window
    const pdfTail = /\s*(فوق|تحت|في الأعلى|في الاعلى|في الأسفل|في الاسفل|في الوسط|في النص)?\s*(في|ف|على|بـ?|من)\s*(ملف\s*)?(ال)?(pdf|بي\s*دي\s*اف|بيدي\s*اف|بي\s*دي\s*إف|الـ\s*pdf)\s*(فوق|تحت|في الأعلى|في الاعلى|في الأسفل|في الاسفل|في الوسط|في النص)?\s*$/iu;
    // «اكتب في البي دي اف ...» names the PDF first
    const pdfHead = /^\s*(في|ف|على)\s*(ملف\s*)?(ال)?(pdf|بي\s*دي\s*اف|بيدي\s*اف|بي\s*دي\s*إف)\s*[:،,]?\s*/iu;
    // «اكتب في الدفتر» means the notebook, not typing the words «في الدفتر».
    if (/^(?:في|ف|بال|على) ?(?:ال)?(?:دفتر|دفتري|الدفتر)$/u.test(normalize(content))) return out('open_tool', { tool: 'notebook' }, 0.9);
    const paged = takePage(content);
    const pageWords = paged.page ? ` ${content} ` : '';
    if (paged.page) content = paged.rest;
    const where = (w) => (/(تحت|الأسفل|الاسفل)/.test(w) ? 'bottom' : /(الوسط|النص|المنتصف)/.test(w) ? 'middle' : 'top');
    const h = content.match(pdfHead);
    if (h) {
      const rest = content.slice(h[0].length).trim();
      return out('pdf_write', { text: rest, position: 'top', page: paged.page || 1 }, rest ? 0.9 : 0.6);
    }
    const m = content.match(pdfTail);
    if (m || (paged.page && / (pdf|بي دي اف|البي دي اف) /iu.test(pageWords))) {
      const at = m ? `${m[1] || ''} ${m[6] || ''}` : '';
      if (m) content = content.slice(0, m.index).trim();
      return out('pdf_write', { text: content, position: where(at), page: paged.page || 1 }, content ? 0.92 : 0.6);
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

  // «شو الجو اليوم», «متى صلاة الظهر»: answered by a web search the person can read.
  if (findPhrase(padded, L.weather)) return out('search', { query: 'الطقس اليوم', engine: 'google' }, 0.85);
  if (findPhrase(padded, L.prayer)) return out('search', { query: 'مواقيت الصلاة اليوم', engine: 'google' }, 0.85);
  if (startsWithPhrase(text, L.organize) && findApp(text)?.id === 'downloads') return out('organize_downloads');
  if (startsWithPhrase(text, L.undo) && /(ترتيب|رتبت|تنزيلات|التنزيلات)/.test(text)) return out('undo_organize', {}, 0.85);

  // «جهّز الاستماع» / «نزّل عقلك»: shows the one-click setup in the settings panel.
  const setupMatch = /^(جهز|ركب|نزل|ثبت|حمل)( لي| لك)? (ال)?(استماع|سماعه|سماعتك|اذانك|اذنك|عقل|عقلك|مخ|مخك|ذكاء|ذكاءك)( |$)/.exec(text);
  if (setupMatch) return out('setup', { part: /عقل|مخ|ذكاء/.test(setupMatch[4]) ? 'brain' : 'voice' });
  if (findPhrase(padded, L.settings)) return out('open_settings');

  // His own tools: «افتح السبورة», «دفتري», «سكر الدفتر», «راجع البطاقات».
  {
    const hit = findTool(text);
    if (hit) {
      const rest = WANT.reduce((t, w) => (t.startsWith(`${w} `) ? t.slice(w.length + 1) : t), text);
      const closing = startsWithPhrase(text, L.close);
      const opening = startsWithPhrase(text, L.open) || rest === hit.name || /^(راجع|ابدا|خلنا نراجع)/.test(text);
      if (closing) return out('close_tool', { tool: hit.tool.id }, 0.92);
      if (opening) return out('open_tool', { tool: hit.tool.id, review: /بطاقات|مراجعه|راجع/.test(text) }, 0.92);
    }
  }
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
    // «شغل لي سورة الكهف في اليوتيوب»: something to find on YouTube, not just the site.
    if (app && app.id === 'youtube') {
      const what = (rawRestAfter(raw, L.open, N(['لي'])) || '')
        .replace(/\s*(في|ف|على|عل|من)\s*(ال)?(يوتيوب|يوتيب|youtube)\s*$/iu, '')
        .replace(/^\s*(في|ف|على|من)?\s*(ال|لل|ل)?(يوتيوب|يوتيب|youtube)\s*(عن|على)?\s*/iu, '')
        .trim();
      if (what) return out('search', { query: what, engine: 'youtube' }, 0.9);
    }
    if (app) return out('open', { app: app.id, kind: app.kind, url: app.url || null });
    const name = rawRestAfter(raw, L.open, N(['لي', 'برنامج', 'تطبيق', 'شي'])) || '';
    if (!name) return out('open_which', {}, 0.8);
    return out('open_unknown', { name, play: /^(شغل|تشغل|نشغل)/.test(openVerb) }, 0.6);
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
  for (const [list, dir] of [[L.edgeRight, 'edge_right'], [L.edgeLeft, 'edge_left'], [L.moveRight, 'right'], [L.moveLeft, 'left'], [L.center, 'center'],
    [L.climbUp, 'up'], [L.climbDown, 'down'], [L.stay, 'stay'], [L.free, 'free'], [L.run, 'run'], [L.turn, 'turn'], [L.toMouse, 'mouse']]) {
    if (list.includes(text)) return out('move', { dir }, 0.9);
  }
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
    const part = findPhrase(padded, SALAM) ? 'salam' : findPhrase(padded, MORNING) ? 'morning' : findPhrase(padded, EVENING) ? 'evening' : 'any';
    return out('greet', { part });
  }
  if (/ (تسلم|يسلم|يسلمون|تسلمون) (عليك|عليكم) /.test(padded)) return out('greet', { part: 'any' }, 0.8);
  if (findPhrase(padded, L.thanks)) return out('thanks');
  // «زين الحمدلله» / «بخير وانت»: the answer to «شحالك».
  if (findPhrase(padded, L.fine)) return out('fine', {}, 0.85);
  if (findPhrase(padded, L.praise)) return out('praise');
  if (findPhrase(padded, L.scold)) return out('scold');
  if (findPhrase(padded, L.goodbye)) return out('goodbye');
  if (startsWithPhrase(text, N(['وقف']))) return out('stop', {}, 0.85);

  return out('unknown', {}, 0.2);
}
