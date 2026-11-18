import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArabicNumber, makeQuestion, Quiz } from '../src/core/quiz.js';
import { occasionFor, hijriDate } from '../src/core/occasions.js';
import { recognize } from '../src/core/intents.js';
import { Brain } from '../src/core/brain.js';
import { defaultMemory } from '../src/core/memory.js';
import { toArabicDigits } from '../src/core/arabic.js';

const seeded = (seed = 5) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const HOUR = 3600e3;

function makeBrain(overrides = {}, start = new Date(2026, 10, 17, 9, 0, 0).getTime()) {
  let now = start;
  const brain = new Brain({ memoryData: { ...defaultMemory(start), onboarded: true, level: 2, name: 'مريم', humor: 1, ...overrides }, clock: () => now, rng: seeded(11) });
  return { brain, advance: (ms) => { now += ms; }, setNow: (t) => { now = t; } };
}

// ------------------------------------------------------------------ numbers

for (const [text, n] of [['12', 12], ['١٢', 12], ['خمسة', 5], ['خمسة وعشرين', 25], ['مية واثنين', 102], ['اثنعش', 12], ['الجواب سبعة', 7], ['ناقص ثلاثة', -3], ['ثمانين', 80], ['العشرين', 20], ['ما اعرف', null], ['', null]]) {
  test(`parseArabicNumber("${text}") = ${n}`, () => assert.equal(parseArabicNumber(text), n));
}

test('questions at every level are well formed', () => {
  const rng = seeded(3);
  for (let level = 1; level <= 5; level += 1) {
    for (let i = 0; i < 300; i += 1) {
      const q = makeQuestion(level, rng);
      assert.ok(Number.isInteger(q.answer) && q.answer >= 0, `${level}: ${q.text} = ${q.answer}`);
      assert.match(q.text, /[٠-٩]/);
      assert.match(q.text, /؟/);
      if (level === 1) assert.ok(q.answer <= 10);
    }
  }
});

test('quiz rises after three right answers and drops after two wrong, within 1..5', () => {
  const q = new Quiz({ level: 1, rng: seeded(2) });
  for (let i = 0; i < 3; i += 1) { q.next(); q.answer(q.current.answer); }
  assert.equal(q.level, 2);
  for (let i = 0; i < 2; i += 1) { q.next(); q.answer(-999); }
  assert.equal(q.level, 1);
  for (let i = 0; i < 4; i += 1) { q.next(); q.answer(-1); }
  assert.equal(q.level, 1, 'never below 1');
  const top = new Quiz({ level: 5, rng: seeded(2) });
  for (let i = 0; i < 6; i += 1) { top.next(); top.answer(top.current.answer); }
  assert.equal(top.level, 5, 'never above 5');
  assert.equal(new Quiz({ level: 99 }).level, 5);
});

test('quiz never repeats the same question twice in a row', () => {
  const q = new Quiz({ level: 1, rng: seeded(9) });
  let prev = q.next().text;
  for (let i = 0; i < 100; i += 1) { const t = q.next().text; assert.notEqual(t, prev); prev = t; }
});

// --------------------------------------------------------------- quiz in brain

test('a whole quiz conversation: hint, reveal, skip, other commands, end with score', () => {
  const { brain } = makeBrain();
  const start = brain.hear('اختبرني');
  assert.equal(start.situation, 'quiz_start');
  assert.ok(brain.quiz);
  const right = brain.hear(toArabicDigits(brain.quiz.current.answer));
  assert.equal(right.situation, 'quiz_right');
  const ans = brain.quiz.current.answer;
  const hint = brain.hear(String(ans + 1));
  assert.equal(hint.situation, 'quiz_try_again');
  assert.match(hint.say, /أصغر/);
  const reveal = brain.hear(String(ans + 2));
  assert.equal(reveal.situation, 'quiz_wrong');
  assert.ok(reveal.say.includes(toArabicDigits(ans)), reveal.say);
  const skip = brain.hear('ما اعرف');
  assert.equal(skip.situation, 'quiz_skip');
  const time = brain.hear('كم الساعة');
  assert.equal(time.situation, 'time', 'commands still work during a quiz');
  assert.ok(brain.quiz, 'quiz goes on after a command');
  const end = brain.hear('وقف');
  assert.equal(end.situation, 'quiz_end');
  assert.match(end.say, /١ من ٣/);
  assert.equal(brain.quiz, null);
});

test('three right answers raise the level, which is remembered next time', () => {
  const { brain } = makeBrain();
  brain.hear('خلنا نلعب');
  let last;
  for (let i = 0; i < 3; i += 1) last = brain.hear(String(brain.quiz.current.answer));
  assert.equal(last.situation, 'quiz_level_up');
  assert.equal(brain.emotions.current.emotion, 'proud');
  brain.hear('خلاص');
  assert.equal(brain.memory.data.quizLevel, 2);
  brain.hear('اختبرني');
  assert.equal(brain.quiz.level, 2);
  assert.equal(brain.memory.data.quizRight, 3);
});

test('stopping a quiz before answering anything', () => {
  const { brain } = makeBrain();
  brain.hear('اسألني سؤال');
  assert.equal(brain.hear('وقف').situation, 'quiz_end_none');
});

test('spoken number words are accepted as answers', () => {
  const { brain } = makeBrain({ quizLevel: 1 });
  brain.hear('اختبرني');
  brain.quiz.current = { text: 'كم ٣ + ٤؟', answer: 7 };
  assert.equal(brain.hear('سبعة').situation, 'quiz_right');
});

// ----------------------------------------------------------------- feelings

for (const [text, kind] of [['انا تعبان', 'tired'], ['والله تعبت اليوم', 'tired'], ['زعلان شوي', 'sad'], ['مب مرتاح', 'sad'], ['انا مرتاح', 'happy'], ['عندي امتحان بكرة', 'stressed'], ['متوتر', 'stressed'], ['نجحت يا خلفون', 'success'], ['جبت الدرجة الكاملة', 'success'], ['طفشان', 'bored'], ['راسي يعورني', 'sick'], ['جوعان', 'hungry'], ['نعسان', 'sleepy'], ['فرحان واجد', 'happy']]) {
  test(`feeling: "${text}" -> ${kind}`, () => {
    const r = recognize(text);
    assert.equal(r.intent, 'feeling');
    assert.equal(r.slots.kind, kind);
  });
}

test('he cares when you are tired and asks about it the next day', () => {
  const { brain, advance } = makeBrain({}, new Date(2026, 10, 10, 9, 0, 0).getTime()); // an ordinary Tuesday
  const r = brain.hear('انا تعبان');
  assert.equal(r.situation, 'feel_tired');
  assert.equal(r.emotion.emotion, 'grateful');
  advance(20 * HOUR);
  const next = brain.start();
  assert.equal(next.situation, 'feel_followup');
  assert.match(next.say, /تعبان/);
  advance(HOUR);
  assert.notEqual(brain.start().situation, 'feel_followup', 'asks only once');
});

test('no follow-up too soon, and good news is celebrated with a dance', () => {
  const { brain, advance } = makeBrain();
  brain.hear('زعلان');
  advance(HOUR);
  assert.notEqual(brain.start().situation, 'feel_followup');
  const win = brain.hear('نجحت في الامتحان');
  assert.equal(win.behavior, 'dance');
  assert.equal(win.emotion.emotion, 'excited');
});

// ---------------------------------------------------------------- occasions

test('Omani occasions on known dates', () => {
  const on = (s) => occasionFor(new Date(`${s}T10:00:00`))?.id ?? null;
  assert.equal(on('2026-11-20'), 'national_day'); // Royal Decree 15/2025: 20 and 21 November
  assert.equal(on('2026-11-21'), 'national_day');
  assert.equal(on('2026-11-18'), null); // the old date is an ordinary day now
  assert.equal(on('2026-03-20'), 'eid_fitr'); // 1 Shawwal 1447
  assert.equal(on('2026-05-26'), 'arafah');
  assert.equal(on('2026-05-27'), 'eid_adha'); // 10 Dhu al-Hijjah 1447
  assert.equal(on('2026-03-01'), 'ramadan');
  assert.equal(on('2026-11-27'), 'friday');
  assert.equal(on('2026-11-17'), null);
  assert.deepEqual(hijriDate(new Date('2026-03-20T10:00:00')), { day: 1, month: 10, year: 1447 });
});

test('an occasion greeting comes first; the follow-up waits for the next visit', () => {
  const { brain, advance } = makeBrain({}, new Date(2026, 10, 19, 9, 0, 0).getTime());
  brain.hear('انا مريض');
  advance(20 * HOUR); // 20 November: National Day
  assert.equal(brain.start().situation, 'occasion_national_day');
  advance(HOUR);
  assert.equal(brain.start().situation, 'feel_followup');
});

test('on National Day he greets for it once, with the flag', () => {
  const { brain, advance } = makeBrain({}, new Date(2026, 10, 20, 8, 0, 0).getTime());
  const r = brain.start();
  assert.equal(r.situation, 'occasion_national_day');
  assert.equal(r.costume, 'flag');
  assert.match(r.say, /عُمان|الوطني/);
  advance(2 * HOUR);
  assert.notEqual(brain.start().situation, 'occasion_national_day');
});

test('outfits on request', () => {
  const { brain } = makeBrain();
  assert.equal(brain.hear('البس البشت').costume, 'bisht');
  assert.equal(brain.hear('ارفع العلم').costume, 'flag');
  assert.equal(brain.hear('شيل العلم').costume, null);
  assert.equal(brain.hear('شيل الفانوس').costume, null);
  assert.equal(recognize('شيل الملف').intent, 'delete', 'other «شيل» sentences are still delete requests');
  assert.equal(brain.hear('افتح الحاسبة').costume, undefined, 'other replies leave the outfit alone');
});

// --------------------------------------------------------- more phrasings

const more = [
  ['ممكن تشغل لي اليوتيوب', 'open'], ['افتح لي الاكسل لو سمحت', 'open'], ['ابغاك تكتب لي مرحبا', 'type_text'],
  ['ارفع الصوت شوي', 'volume'], ['نزل الصوت', 'volume'], ['دورلي عن سعر الذهب', 'search'], ['تقدر تفتح الرسام', 'open'],
  ['ذكرني بعد ساعتين اتصل على امي', 'reminder'], ['يعطيك العافية يا خلفون', 'thanks'], ['كفو عليك', 'praise'],
  ['ما فهمت عليك', 'unknown'], ['خلاص بس', 'stop'], ['تعال يا خلفون', 'come'], ['صباح النور', 'greet'],
  ['شو تقدر تسوي', 'help'], ['افتح مجلد الصور', 'open'], ['وطي الصوت', 'volume'], ['خذ لقطة', 'screenshot'],
];
for (const [text, intent] of more) {
  test(`more phrasing: "${text}" -> ${intent}`, () => assert.equal(recognize(text).intent, intent));
}

test('stress with quiz and feelings mixed in: 3000 turns without errors', () => {
  const { brain, advance } = makeBrain({ level: 3, humor: 2 });
  const words = ['اختبرني', 'خمسة', '١٢', 'ما اعرف', 'سؤال ثاني', 'وقف', 'تعبان', 'نجحت', 'البس البشت', 'شيل البشت', 'كم الساعة', 'قول نكتة', 'افتح الحاسبة', 'ايوه', 'لا', 'عشرين', 'زعلان'];
  const rng = seeded(77);
  for (let i = 0; i < 3000; i += 1) {
    const r = brain.hear(words[Math.floor(rng() * words.length)]);
    if (r?.action) brain.actionResult(r.action.id, { ok: true });
    if (r?.say) assert.ok(!/\{\w+\}/.test(r.say), r.say);
    advance(700);
    brain.tick();
  }
});
