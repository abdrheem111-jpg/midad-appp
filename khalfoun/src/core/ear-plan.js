// What the teacher records to train Khalfoun's own ear (a small model that knows only
// «يا خلفون» and runs on his computer without the internet), and what Azure's voices add.

/** «يا خلفون» said in many ways: how a teacher really calls him in class. */
export const EAR_CALLS = [
  ['يا خلفون', 'بصوتك العادي'], ['يا خلفون', 'عادي مرة ثانية'], ['يا خلفون', 'بسرعة'], ['يا خلفون', 'على مهلك'],
  ['يا خلفون', 'بصوت واطي'], ['يا خلفون', 'بصوت عالي كأنك تنادي من آخر الصف'], ['خلفون', 'الاسم بس بدون «يا»'], ['خلفون', 'الاسم بس، بسرعة'],
  ['يا خلفون', 'وأنت مبتسم'], ['يا خلفون', 'كأنك تسأل: يا خلفون؟'], ['يا خلفون', 'وأنت بعيد خطوتين عن الجهاز'], ['يا خلفون', 'وأنت بعيد خطوتين، بصوت عالي'],
  ['يا خلفون افتح الوورد', 'الاسم وبعده أمر'], ['يا خلفون كمل وراي', 'الاسم وبعده أمر'], ['يا خلفون تعال', 'الاسم وبعده أمر'], ['خلفون ارسم مثلث', 'الاسم بدون «يا» وبعده أمر'],
  ['يا خلفون', 'وأنت ملتفت للسبورة'], ['يا خلفون', 'بصوت تعبان شوي'], ['يا خلفون', 'بحماس'], ['يا خلفون', 'كأنك مستعجل'],
  ['يا خلفون', 'بصوتك العادي'], ['يا خلفون', 'بصوت واطي'], ['خلفون', 'الاسم بس'], ['يا خلفون', 'بصوت عالي'],
  ['يا خلفون شوف هذا', 'الاسم وبعده كلام'], ['يا خلفون حل المسألة', 'الاسم وبعده كلام'], ['يا خلفون', 'وأنت ماشي في الصف'], ['يا خلفون', 'وفي الغرفة كلام أو صوت'],
  ['يا خلفون', 'بسرعة'], ['يا خلفون', 'على مهلك'], ['يا خلفون', 'كأنك تنادي من آخر الصف'], ['خلفون', 'الاسم بس، على مهلك'],
  ['يا خلفون', 'بصوتك العادي'], ['يا خلفون', 'بصوت واطي'], ['يا خلفون', 'وأنت بعيد عن الجهاز'], ['يا خلفون', 'بحماس'],
  ['يا خلفون سكر النافذة', 'الاسم وبعده أمر'], ['يا خلفون', 'عادي'], ['خلفون', 'الاسم بس'], ['يا خلفون', 'آخر وحدة، عادي'],
];

/** Things that are NOT his name, some of them close to it, and everyday class talk. */
export const EAR_OTHERS = [
  'يا خليفة', 'خلفان وينك', 'خلاص', 'يا خالد', 'خلف الباب', 'افتحوا الكتاب صفحة عشرين', 'يلا يا شباب', 'الحين نبدأ الدرس',
  'كم الساعة', 'يا فلان تعال', 'خلك هنا', 'النخلة طويلة', 'خفيف', 'خلفية الشاشة', 'يا خوي', 'أحسنتم يا أبطال',
  'اكتبوا في الدفتر', 'من يعرف الجواب', 'خلف ورا', 'يا حلو', 'الكسر نص', 'خلفه خطوتين', 'فهمتوا', 'السلام عليكم',
];

/** Arabic voices in Azure (a region may not offer some: they are skipped). */
export const EAR_VOICES = [
  'ar-OM-AbdullahNeural', 'ar-OM-AyshaNeural', 'ar-AE-HamdanNeural', 'ar-AE-FatimaNeural', 'ar-SA-HamedNeural', 'ar-SA-ZariyahNeural',
  'ar-KW-FahedNeural', 'ar-KW-NouraNeural', 'ar-QA-MoazNeural', 'ar-QA-AmalNeural', 'ar-BH-AliNeural', 'ar-BH-LailaNeural',
  'ar-YE-SalehNeural', 'ar-YE-MaryamNeural', 'ar-JO-TaimNeural', 'ar-JO-SanaNeural', 'ar-IQ-BasselNeural', 'ar-IQ-RanaNeural',
  'ar-EG-ShakirNeural', 'ar-EG-SalmaNeural',
];

/** With short vowels, so the voices say «خَلْفُون» the Omani way. */
export const EAR_TTS_CALLS = ['يا خَلْفُون', 'خَلْفُون', 'يا خَلْفُون!', 'يا خَلْفُون؟', 'يا خَلْفُون افتح الوورد', 'خَلْفُون تعال'];
export const EAR_TTS_OTHERS = ['يا خَلِيفَة', 'خَلْفَان', 'خَلاص', 'يا خَالِد', 'خَلْف الباب', 'يلا يا شباب', 'خَلِّك هنا', 'خَلْفِيَّة الشاشة', 'نَخْلَة', 'يا خُوي'];

const PROSODY = [['-12%', '-6%'], ['+0%', '+0%'], ['+18%', '+10%'], ['+8%', '-12%']];

/**
 * The list of synthetic clips to ask Azure for: every voice says each phrase with a different
 * speed and pitch. Deterministic, so a half-finished run can continue.
 * @returns {{kind: 'tts-call'|'tts-other', voice: string, text: string, rate: string, pitch: string, name: string}[]}
 */
export function earTtsPlan(voices = EAR_VOICES) {
  const out = [];
  voices.forEach((voice, v) => {
    EAR_TTS_CALLS.forEach((text, i) => {
      const [rate, pitch] = PROSODY[(v + i) % PROSODY.length];
      out.push({ kind: 'tts-call', voice, text, rate, pitch, name: `${voice}-c${i}` });
    });
    EAR_TTS_OTHERS.forEach((text, i) => {
      const [rate, pitch] = PROSODY[(v + i + 1) % PROSODY.length];
      out.push({ kind: 'tts-other', voice, text, rate, pitch, name: `${voice}-o${i}` });
    });
  });
  return out;
}

/** Where each kind of clip is kept (folders under userData/wake-data). */
export const EAR_KINDS = ['call', 'other', 'room', 'tts-call', 'tts-other'];

/** A recorded call is usable: he spoke, and it is the length of a name (with a command after it, longer). */
export function goodCall(ms, spoke, withCommand) {
  return Boolean(spoke) && ms >= 350 && ms <= (withCommand ? 6000 : 3500);
}
