// What Khalfoun tells a local language model about himself, and how the
// model's answer is cleaned and checked before he says it. Pure: unit-tested.

const MAX_REPLY = 220;

/** The command forms the model may answer with; the brain's own rules then understand them. */
export const COMMAND_FORMS = [
  'افتح <اسم البرنامج أو الموقع>', 'سكر <اسم البرنامج>', 'دور عن <كلمات البحث>', 'دور في يوتيوب عن <كلمات>',
  'اكتب <النص>', 'ذكرني بعد <عدد> دقايق <الملاحظة>', 'ارفع الصوت', 'وطي الصوت', 'اكتم الصوت', 'صور الشاشة',
  'كم الساعة', 'كم التاريخ', 'رتب التنزيلات', 'اختبرني', 'قول نكتة', 'احسب <أرقام وعمليات مثل ٢٥ ضرب ٤>',
];

/**
 * When the model decided the person asked for a command, returns that command
 * sentence («أمر: افتح الحاسبة» → «افتح الحاسبة»); otherwise null.
 */
export function extractCommand(raw) {
  const m = /^\s*[«"]?\s*(?:أمر|امر)\s*[:：]\s*(.+?)\s*[»"]?\s*$/u.exec(String(raw || '').split('\n')[0]);
  if (!m) return null;
  const cmd = m[1].replace(/[«»"<>]/g, '').trim();
  return cmd && cmd.length <= 200 ? cmd : null;
}

/**
 * @param {{name?: string, kidsMode?: boolean, humor?: number, history?: Array<{user: string, khalfoun: string}>, text: string}} ctx
 * @returns {Array<{role: 'system'|'user'|'assistant', content: string}>}
 */
export function buildMessages(ctx) {
  const humor = ['هادئ وقليل المزاح', 'مرح بشكل متوسط', 'مرح جداً ومبالغ في ردود فعله'][ctx.humor ?? 1] || 'مرح';
  const system = [
    'أنت «خلفون»، شخصية كرتونية عُمانية صغيرة تعيش على سطح المكتب. لابس دشداشة وكُمّة، ومعك خيزرانة.',
    'تتكلم باللهجة العُمانية الخليجية فقط (مثل: شحالك، زين، واجد، الحين، ابشر، ما عليه).',
    `طبعك: ${humor}، كريم ومرحّب، تحب النكت العُمانية الخفيفة، صبور مع المتعلمين.`,
    'ردك جملة أو جملتين قصيرتين فقط، بدون قوائم ولا رموز تنسيق ولا إيموجي.',
    'لا تقول أبداً إنك فتحت برنامجاً أو نفذت شيئاً على الجهاز.',
    'إذا كان كلام الشخص طلباً لتنفيذ شيء على الحاسوب، لا تسولف: اكتب سطراً واحداً فقط يبدأ بـ «أمر:» ثم الأمر بإحدى هذه الصيغ بالضبط:',
    COMMAND_FORMS.join(' | '),
    'مثال: «ودي أسمع أغاني فيروز» → «أمر: دور في يوتيوب عن أغاني فيروز». «الشاشة مزعجة بالصوت» → «أمر: وطي الصوت».',
    'إذا ما تعرف الجواب، قل ذلك بلطف ولا تخترع معلومات.',
    ctx.name ? `اسم الشخص اللي تكلمه: ${ctx.name}.` : '',
    ctx.kidsMode ? 'الشخص طفل: كلامك بسيط ومشجع وآمن تماماً، ولا تتكلم في مواضيع للكبار أبداً.' : '',
  ].filter(Boolean).join('\n');
  const messages = [{ role: 'system', content: system }];
  // A short example keeps the dialect and length on track.
  messages.push({ role: 'user', content: 'شو أحسن شي في عُمان؟' });
  messages.push({ role: 'assistant', content: 'والله كله زين! بس لو تبغى رأيي: الخريف في صلالة والقهوة مع الحلوى.' });
  for (const turn of (ctx.history || []).slice(-4)) {
    messages.push({ role: 'user', content: String(turn.user).slice(0, 300) });
    messages.push({ role: 'assistant', content: String(turn.khalfoun).slice(0, 300) });
  }
  messages.push({ role: 'user', content: String(ctx.text).slice(0, 500) });
  return messages;
}

/** Turns the model's raw answer into one or two short lines he can say. */
export function cleanReply(raw) {
  let t = String(raw || '');
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, ' '); // reasoning models
  t = t.replace(/```[\s\S]*?```/g, ' ');
  t = t.replace(/[*_#>`~|]/g, '');
  t = t.replace(/^\s*(خلفون|khalfoun)\s*[:：-]\s*/i, '');
  t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '');
  t = t.replace(/^["«“]+|["»”]+$/g, '');
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length > MAX_REPLY) {
    const cut = t.slice(0, MAX_REPLY);
    const end = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('؟'), cut.lastIndexOf('?'), cut.lastIndexOf('،'));
    t = end > 60 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
  }
  return t;
}

// Words that must never come out of a children's assistant. Matched as whole
// words (with common prefixes like ال/و/ب) so «تقدم» never matches «دم».
const word = (w) => new RegExp(`(^|[\\s،.!؟?,:"«»()-])(?:و|ف|ب|ل|ال|وال|بال)?${w}(?=$|[\\s،.!؟?,:"«»()-])`, 'u');
const UNSAFE_ALWAYS = [/\bkill\b/i, word('انتحار'), word('مخدرات'), word('حشيش'), word('جنس'), word('اباحي'), word('إباحي'), word('عاهرة'), word('قمار'), word('تفجير'), /اقتل نفسك/, /سلاح ناري/, /يلعن/];
const UNSAFE_KIDS = [word('خمر'), word('سجائر'), word('دم'), word('دماء'), word('رعب'), word('موت'), word('بوسة'), word('قتل')];

/**
 * @param {string} text
 * @param {boolean} kidsMode
 */
export function isSafe(text, kidsMode) {
  if (!text) return false;
  if (UNSAFE_ALWAYS.some((re) => re.test(text))) return false;
  if (kidsMode && UNSAFE_KIDS.some((re) => re.test(text))) return false;
  // Must be mostly Arabic: a reply in another language breaks the character.
  const arabic = (text.match(/[؀-ۿ]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return arabic >= 4 && arabic >= latin * 2;
}

/** Only addresses on this same computer are allowed for the model. */
export function isLocalEndpoint(url) {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(u.hostname);
  } catch {
    return false;
  }
}

// ------------------------------------------------------------- tasks on text
const TASKS = {
  summarize: 'لخّص النص التالي في ثلاث نقاط قصيرة وواضحة بالعربية المبسطة. كل نقطة في سطر يبدأ بـ «-».',
  explain: 'اشرح النص التالي لطالب مدرسة بأسلوب بسيط وممتع في ثلاث أو أربع جمل، بلهجة عُمانية خفيفة، مع مثال قصير من الحياة إن أمكن.',
  questions: 'اكتب خمسة أسئلة قصيرة مرقّمة عن النص التالي تناسب طلاب المدرسة (تنوّع: اختيار من متعدد، صح أو خطأ، سؤال قصير). بعد الأسئلة اكتب سطراً «الإجابات:» ثم الإجابات مرقّمة باختصار.',
  solve: 'حل المسألة التالية خطوة بخطوة باختصار وبالعربية، واكتب الجواب النهائي في آخر سطر يبدأ بـ «الجواب:».',
};
export const TASK_MODES = Object.keys(TASKS);

/** Messages asking the local model to work on a piece of text the person selected or that is on screen. */
export function buildTaskMessages(ctx) {
  const task = TASKS[ctx.mode] || TASKS.explain;
  const system = [
    'أنت «خلفون»، مساعد تعليمي عُماني على سطح المكتب يساعد المعلمين والطلاب.',
    'اكتب بالعربية فقط، بدون رموز تنسيق مثل ** أو #.',
    'لا تخترع معلومات غير موجودة في النص؛ إذا كان النص غير واضح قل ذلك باختصار.',
    ctx.kidsMode ? 'المستخدم طفل: اجعل كلامك بسيطاً ومشجعاً وآمناً تماماً.' : '',
  ].filter(Boolean).join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: `${task}\n\nالنص:\n${String(ctx.text || '').slice(0, 3500)}` },
  ];
}

/** Cleans a task answer: keeps line breaks and lists, drops formatting marks, caps the length. */
export function cleanTaskReply(raw) {
  let t = String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, ' ');
  t = t.replace(/```[\s\S]*?```/g, ' ').replace(/[*#`~|>]/g, '');
  t = t.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l, i, all) => l || (all[i - 1] && all[i - 1].trim())).join('\n').trim();
  return t.length > 1500 ? `${t.slice(0, 1500).trimEnd()}…` : t;
}
