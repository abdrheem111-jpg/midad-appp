// Khalfoun X: attendance by voice, riddles, the name wheel, the camel race, class stars,
// celebrations and screen effects, the noise meter, class mode, the camera, the reading check,
// taught multi-step commands and the spreadsheet export.
import test from 'node:test';
import assert from 'node:assert/strict';
import { recognize, splitCommands, parseTeach } from '../src/core/intents.js';
import { Brain } from '../src/core/brain.js';
import { defaultMemory } from '../src/core/memory.js';
import { Attendance, namesIn, toCsv, dayKey } from '../src/core/attendance.js';
import { RIDDLES, checkRiddle, nextRiddle, CamelRace, crossedMilestones, nextMilestone, wheelSpin, teamNumber, STAR_MILESTONES } from '../src/core/classfun.js';
import { compareReading, readingVerdict, readingWords } from '../src/core/reading.js';
import { validateAction, createExecutor } from '../src/main/actions/index.js';
import { decide } from '../src/core/permissions.js';
import { TEMPLATES } from '../src/core/templates/ar-om.js';
import { ANIMATIONS } from '../src/renderer/animations.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const START = Date.UTC(2026, 10, 18, 6, 0, 0);
function makeBrain(extra = {}) {
  let now = START;
  const brain = new Brain({ memoryData: { ...defaultMemory(START), onboarded: true, level: 3, name: 'عبدالرحيم', ...extra }, clock: () => now, rng: () => 0.1 });
  return { brain, advance: (ms) => { now += ms; } };
}
const withClass = () => makeBrain({ classroom: { students: ['أحمد', 'مريم', 'سالم', 'فاطمة', 'عبد الله'], points: {}, picked: [] } });

// ------------------------------------------------------------------ understanding
test('classroom-joy sentences are understood', () => {
  const cases = [
    ['غايب أحمد ومريم', 'attendance'], ['أحمد وسالم غايبين', 'attendance'], ['سجل غياب سعيد', 'attendance'], ['سالم متأخر', 'attendance'],
    ['حضر أحمد', 'attendance'], ['منو غايب اليوم', 'attendance_today'], ['صدر كشف الغياب', 'export_sheet'], ['صدّر النقاط', 'export_sheet'],
    ['كم مرة غاب أحمد', 'attendance_student'], ['كلهم حاضرين', 'attendance_clear'],
    ['عطني لغز', 'riddle'], ['حزورة', 'riddle'], ['لف العجلة', 'wheel'], ['ابدأ سباق الهجن', 'race_start'], ['نقطة للفريق الثاني', 'race_advance'],
    ['قدم جمل الفريق الثالث', 'race_advance'], ['وقف السباق', 'race_stop'], ['نجمة للصف', 'class_star'], ['كم نجمة عند الصف', 'class_stars'],
    ['احتفل', 'celebrate'], ['ألعاب نارية', 'effect'], ['خلها تمطر', 'effect'], ['زينة العيد الوطني', 'effect'], ['شيل الزينة', 'effect_stop'],
    ['مقياس الهدوء', 'noise'], ['وقف مقياس الهدوء', 'noise'], ['وضع الصف', 'class_mode'], ['صغر نفسك', 'class_mode'],
    ['حل من الكاميرا', 'camera'], ['اختبر السمع', 'voice_test'], ['افتح اختبار القراءة', 'open_tool'], ['تمشى', 'walk_windows'],
    ['اسمع هالنكتة واحد نسى نفسه في البيت هههه', 'user_joke'],
  ];
  for (const [text, intent] of cases) assert.equal(recognize(text).intent, intent, text);
  // Old commands keep their meaning.
  for (const [text, intent] of [['نقطة لأحمد', 'award'], ['اعط احمد نجمة', 'award'], ['قسمهم ٤ مجموعات', 'groups'], ['افتح الحاسبة', 'open'], ['قول نكتة', 'joke'],
    ['ارفع الصوت', 'volume'], ['اختبرني', 'quiz'], ['ارقص', 'dance'], ['انا وصلت', 'unknown'], ['اختار طالب', 'pick_student'], ['افتح الدفتر', 'open_tool']]) {
    assert.equal(recognize(text).intent, intent, text);
  }
  assert.deepEqual(recognize('سباق الهجن بين ٣ فرق').slots, { teams: 3 });
  assert.equal(recognize('خطوتين للفريق ٢').slots.steps, 2);
  assert.equal(recognize('الشمس غابت').slots.soft, true);
});

test('team numbers in words, digits and ordinals', () => {
  assert.equal(teamNumber('الفريق الثاني جاوب'), 2);
  assert.equal(teamNumber('نقطه للمجموعه الرابعه'), 4);
  assert.equal(teamNumber('جمل الفريق ٣'), 3);
  assert.equal(teamNumber('الفريق رقم 5'), 5);
  assert.equal(teamNumber('قدم جمل الفريق الاول'), 1);
  assert.equal(teamNumber('الفريق حلو'), null);
});

// ------------------------------------------------------------------ attendance
test('attendance: marking, late replaces absent, present clears, and a summary', () => {
  const a = new Attendance();
  assert.deepEqual(a.mark('2026-11-18', ['أحمد', 'مريم'], 'absent'), ['أحمد', 'مريم']);
  a.mark('2026-11-18', ['أحمد'], 'late');
  assert.deepEqual(a.days['2026-11-18'], { absent: ['مريم'], late: ['أحمد'] });
  a.mark('2026-11-18', ['مريم'], 'present');
  assert.deepEqual(a.days['2026-11-18'].absent, []);
  a.mark('2026-11-19', ['مريم'], 'absent');
  const sum = a.summary();
  assert.equal(sum['مريم'].absent, 1);
  assert.equal(sum['أحمد'].late, 1);
  const rows = a.rows(['أحمد', 'مريم', 'سالم']);
  assert.deepEqual(rows[0], ['الطالب', '2026-11-18', '2026-11-19', 'أيام الغياب', 'مرات التأخر']);
  assert.deepEqual(rows.find((r) => r[0] === 'سالم'), ['سالم', 'حاضر', 'حاضر', '0', '0']);
  assert.deepEqual(rows.find((r) => r[0] === 'مريم'), ['مريم', 'حاضر', 'غائب', '1', '0']);
  // Survives a save and load, and rejects junk.
  const again = new Attendance(JSON.parse(JSON.stringify(a.toJSON())));
  assert.deepEqual(again.days, a.days);
  assert.deepEqual(new Attendance({ days: { bad: { absent: ['x'] } } }).days, {});
});

test('names in a sentence: two-word names, «و» joined, unknown ones kept apart', () => {
  const list = ['أحمد', 'مريم', 'عبد الله', 'سالم'];
  const find = (n) => list.find((x) => x.replace(/\s/g, '') === n.replace(/\s/g, '').replace(/^ال/, '')) || null;
  const r = namesIn('أحمد وعبد الله ومريم وزيد', find);
  assert.deepEqual(r.found, ['أحمد', 'عبد الله', 'مريم']);
  assert.deepEqual(r.unknown, ['زيد']);
});

test('the spreadsheet is CSV with a BOM so Excel shows Arabic, and quotes commas', () => {
  const csv = toCsv([['الطالب', 'ملاحظة'], ['أحمد', 'جيد، ممتاز']]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"جيد، ممتاز"|جيد، ممتاز/);
  assert.equal(toCsv([['a,b', 'c"d']]), '\uFEFF"a,b","c""d"\r\n');
});

test('brain: attendance by voice and the day list', () => {
  const { brain } = withClass();
  const r = brain.hear('غايب أحمد ومريم');
  assert.equal(r.situation, 'attendance_absent_many');
  assert.match(r.say, /أحمد/);
  assert.match(r.say, /مريم/);
  assert.equal(brain.hear('فاطمه متأخرة').situation, 'attendance_late');
  const list = brain.hear('منو غايب اليوم');
  assert.equal(list.situation, 'attendance_list');
  assert.match(list.say, /الغياب \(٢\): أحمد، مريم/);
  assert.match(list.say, /التأخير \(١\): فاطمة/);
  assert.equal(brain.hear('حضر أحمد').situation, 'attendance_present');
  assert.deepEqual(brain.memory.data.attendance.days[dayKey(START)].absent, ['مريم']);
  // An unknown name is said back, not silently dropped.
  const odd = brain.hear('غايب زيد');
  assert.equal(odd.situation, 'attendance_not_found');
  // «الشمس غابت» is not attendance at all.
  assert.notEqual(brain.hear('الشمس غابت').situation, 'attendance_not_found');
  assert.equal(brain.hear('كم مرة غاب مريم').situation, 'attendance_student');
});

test('brain: attendance without a class list asks for the names first', () => {
  const { brain } = makeBrain();
  assert.equal(brain.hear('غايب أحمد').situation, 'attendance_no_list');
});

test('brain: exporting attendance and points makes a save_sheet action that passes both checks', () => {
  const { brain } = withClass();
  assert.equal(brain.hear('صدر كشف الغياب').situation, 'attendance_export_empty');
  brain.hear('غايب سالم');
  const r = brain.hear('صدر كشف الغياب');
  assert.equal(r.action.type, 'save_sheet');
  assert.equal(validateAction(r.action), null);
  assert.match(r.action.params.name, /^الغياب 2026-11-18$/);
  assert.match(r.action.params.csv, /سالم,غائب/);
  assert.deepEqual(decide(r.action, { level: 2 }), { allowed: true, confirm: false, reason: 'ok' });
  assert.equal(decide(r.action, { level: 1 }).allowed, false);
  brain.hear('نقطة لأحمد');
  const pts = brain.hear('صدر النقاط');
  assert.match(pts.action.params.csv, /أحمد,1/);
});

test('save_sheet refuses paths and junk, and writes only inside Documents\\خلفون', async () => {
  for (const name of ['../evil', 'a/b', 'c:\\x', '.hidden', 'x'.repeat(81), '']) assert.equal(validateAction({ type: 'save_sheet', params: { name, csv: 'a' } }), 'bad_sheet', name);
  assert.equal(validateAction({ type: 'save_sheet', params: { name: 'ok', csv: '' } }), 'bad_sheet');
  const dir = await mkdtemp(join(tmpdir(), 'kh-sheet-'));
  try {
    let opened = null;
    const exec = createExecutor({ platform: { openPath: async (p) => { opened = p; return ''; } }, getSettings: () => ({ level: 2 }), documentsDir: dir });
    const res = await exec.run({ type: 'save_sheet', params: { name: 'الغياب 2026-11-18', csv: '\uFEFFالطالب\r\n' } });
    assert.equal(res.ok, true);
    assert.equal(res.data.file, join(dir, 'خلفون', 'الغياب 2026-11-18.csv'));
    assert.equal(opened, res.data.file);
    assert.equal(await readFile(res.data.file, 'utf8'), '\uFEFFالطالب\r\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ riddles
test('riddles: right answers with small slips, giving up, and fresh riddles', () => {
  const comb = RIDDLES.find((r) => r.show === 'المشط');
  assert.equal(checkRiddle(comb, 'المشط'), 'right');
  assert.equal(checkRiddle(comb, 'هو المشط'), 'right');
  assert.equal(checkRiddle(comb, 'الجواب مشط'), 'right');
  assert.equal(checkRiddle(comb, 'القلم'), 'wrong');
  assert.equal(checkRiddle(comb, 'استسلمنا'), 'give_up');
  const egg = RIDDLES.find((r) => r.show === 'البيضة');
  assert.equal(checkRiddle(egg, 'البيضة'), 'right');
  assert.notEqual(nextRiddle([0, 1, 2], () => 0), 0);
  for (const r of RIDDLES) assert.ok(r.q && r.a.length && r.show, r.q);
});

test('brain: a riddle round — wrong, wrong, then the answer; a command in between ends it', () => {
  const { brain } = makeBrain();
  const ask = brain.hear('عطني لغز');
  assert.equal(ask.situation, 'riddle_ask');
  const riddle = RIDDLES[brain.riddle.index];
  assert.equal(brain.hear('ما ادري يمكن السيارة').situation, 'riddle_wrong');
  assert.equal(brain.hear('الطاوله').situation, 'riddle_wrong_last');
  const end = brain.hear('الكرسي');
  assert.equal(end.situation, 'riddle_answer');
  assert.ok(end.say.includes(riddle.show));
  brain.hear('لغز');
  const r2 = RIDDLES[brain.riddle.index];
  const right = brain.hear(r2.a[0]);
  assert.equal(right.situation, 'riddle_right');
  assert.equal(right.effect, 'confetti');
  brain.hear('لغز');
  assert.equal(brain.hear('افتح الحاسبة').action.type, 'open_app');
  assert.equal(brain.riddle, null);
});

// ------------------------------------------------------------------ wheel, race, stars
test('the wheel lands on the chosen slice', () => {
  const names = ['أ', 'ب', 'ج', 'د'];
  const spin = wheelSpin(names, 'ج', () => 0);
  assert.equal(spin.index, 2);
  const final = spin.angle % 360;
  // Slice 2 spans 180°..270°; turning by `final` brings its middle (225°) to the top (0°).
  assert.equal((225 + final) % 360, 0);
  assert.ok(spin.angle >= 4 * 360);
});

test('brain: the wheel needs two names and returns the spin', () => {
  assert.equal(makeBrain().brain.hear('لف العجلة').situation, 'pick_need_names');
  const { brain } = withClass();
  const r = brain.hear('لف العجلة');
  assert.equal(r.situation, 'wheel_result');
  assert.ok(r.wheel.names.includes(r.wheel.chosen));
  assert.ok(r.say.includes(r.wheel.chosen));
});

test('camel race: steps, a winner, and no moves after the win', () => {
  const race = new CamelRace({ teams: 3, goal: 3 });
  race.advance(2);
  race.advance(2);
  assert.equal(race.leader(), 2);
  assert.equal(race.advance(2).winner, 2);
  assert.equal(race.advance(1), null);
  assert.equal(new CamelRace({ teams: 9 }).teams, 6);
});

test('brain: the race starts by itself on «نقطة للفريق الثاني», widens for a third team, and ends with fireworks', () => {
  const { brain } = makeBrain();
  const first = brain.hear('نقطة للفريق الثاني');
  assert.equal(first.race.teams, 2);
  assert.deepEqual(first.race.positions, [0, 1]);
  const third = brain.hear('نقطة للفريق الثالث');
  assert.equal(third.race.teams, 3);
  let last;
  for (let i = 0; i < 9; i += 1) last = brain.hear('نقطة للفريق الثاني');
  assert.equal(last.situation, 'race_win');
  assert.equal(last.effect, 'fireworks');
  assert.equal(last.race.winner, 2);
  assert.equal(brain.hear('وقف السباق').race, null);
});

test('class stars: milestones unlock outfits, dances and effects', () => {
  assert.deepEqual(crossedMilestones(4, 5).map((m) => m.id), ['cane_dance']);
  assert.deepEqual(crossedMilestones(9, 21).map((m) => m.id), ['flag', 'bisht']);
  assert.equal(nextMilestone(5).at, 10);
  assert.equal(nextMilestone(999), null);
  for (const m of STAR_MILESTONES) {
    if (m.kind === 'dance') assert.ok(ANIMATIONS[m.id], m.id);
  }
  const { brain } = makeBrain({ classStars: 9 });
  const r = brain.hear('نجمة للصف');
  assert.equal(r.situation, 'star_unlock');
  assert.equal(r.costume, 'flag');
  assert.equal(brain.memory.data.classStars, 10);
  const s = brain.hear('نجمة للصف');
  assert.equal(s.situation, 'star_added');
  assert.match(s.say, /١١/);
  assert.equal(brain.hear('كم نجمة عند الصف').situation, 'stars_status');
});

test('brain: celebrations, effects, noise meter, class mode, camera and voice test carry their instructions for the page', () => {
  const { brain, advance } = makeBrain();
  assert.equal(brain.hear('احتفل').effect, 'confetti');
  const flags = brain.hear('زينة العيد الوطني');
  assert.equal(flags.effect, 'national');
  assert.equal(flags.costume, 'flag');
  assert.equal(brain.hear('سو مطر').effect, 'rain');
  assert.equal(brain.hear('شيل الزينة').effect, 'none');
  assert.equal(brain.hear('مقياس الهدوء').noise, true);
  assert.equal(brain.hear('وقف مقياس الهدوء').noise, false);
  assert.equal(brain.hear('وضع الصف').classMode, true);
  assert.deepEqual(brain.hear('حل من الكاميرا').camera, { mode: 'solve' });
  assert.equal(brain.hear('اختبر السمع').behavior, 'voice_test');
  // Noise remarks are spaced out; a long quiet earns a star.
  assert.equal(brain.event('noise_loud', {}).situation, 'noise_loud');
  assert.equal(brain.event('noise_loud', {}), null);
  advance(30000);
  assert.equal(brain.event('noise_loud', { level: 'very' }).situation, 'noise_very_loud');
  const quiet = brain.event('noise_quiet', {});
  assert.equal(quiet.effect, 'stars');
  assert.equal(brain.memory.data.classStars, 1);
  assert.equal(brain.event('noise_quiet', {}), null);
  assert.equal(brain.event('camera_result', { ok: false, reason: 'no_cloud' }).situation, 'camera_no_cloud');
  assert.equal(brain.event('camera_result', { ok: true, text: 'الحل', saved: true }).situation, 'camera_solved_saved');
  assert.equal(brain.event('voice_test_done', { score: 92 }).situation, 'voice_test_good');
  assert.equal(brain.event('voice_test_done', { score: 30 }).situation, 'voice_test_bad');
});

test('a joke from the person gets a laugh', () => {
  const { brain } = makeBrain();
  const r = brain.hear('اسمع هالنكتة واحد نسى نفسه في البيت هههه');
  assert.equal(r.situation, 'user_joke');
});

// ------------------------------------------------------------------ reading check
test('reading check: right words, misses, extras, recognizer slips and speed', () => {
  const passage = 'ذهب أحمد مع أبيه إلى البحر يوم الجمعة.';
  const exact = compareReading(passage, 'ذهب احمد مع ابيه الى البحر يوم الجمعه', 30);
  assert.equal(exact.accuracy, 100);
  assert.equal(exact.total, 8);
  assert.equal(exact.wpm, 16);
  const missed = compareReading(passage, 'ذهب احمد مع الى البحر يوم الجمعه', 20);
  assert.deepEqual(missed.missed, ['ابيه']);
  assert.equal(missed.correct, 7);
  const extra = compareReading('القطة نائمة', 'القطة القطة نائمة', 5);
  assert.equal(extra.accuracy, 100);
  assert.deepEqual(extra.extra, ['القطه']);
  // «والبحر» heard as «البحر», «الجمعة» as «الجمعه»: still right.
  assert.equal(compareReading('ذهبنا والبحر جميل', 'ذهبنا البحر جميل', 6).accuracy, 100);
  assert.equal(readingWords('قَالَ: «نَعَمْ»!').join(' '), 'قال نعم');
  assert.equal(readingVerdict({ total: 10, accuracy: 96 }), 'قراءة ممتازة!');
  assert.equal(compareReading('', 'شي', 3).accuracy, 0);
});

test('the reading tool opens through both checks', () => {
  const { brain } = makeBrain();
  const r = brain.hear('افتح اختبار القراءة');
  assert.deepEqual(r.action.params, { tool: 'reading' });
  assert.equal(validateAction(r.action), null);
  assert.equal(r.situation, 'tool_open_reading');
  const done = brain.event('tool_event', { tool: 'reading', what: 'reading_done', count: 97 });
  assert.equal(done.situation, 'reading_great');
});

// ------------------------------------------------------------------ taught routines
test('teaching a phrase with a colon and several steps, then running them in order', () => {
  assert.deepEqual(parseTeach('لما أقول بداية الحصة: افتح الحاسبة وبعدين شغل مؤقت ٤٠ دقيقة'), { phrase: 'بداية الحصة', command: 'افتح الحاسبة وبعدين شغل مؤقت ٤٠ دقيقة' });
  assert.deepEqual(splitCommands('افتح العرض وبعدين شغل مؤقت ٤٠ دقيقة واختار طالب', { force: true }), ['افتح العرض', 'شغل مؤقت ٤٠ دقيقة', 'اختار طالب']);
  const { brain } = makeBrain();
  const saved = brain.hear('لما أقول بداية الحصة: افتح الحاسبة وبعدين شغل مؤقت ٤٠ دقيقة وبعدين احتفل');
  assert.equal(saved.situation, 'learn_saved');
  const first = brain.hear('بداية الحصة');
  assert.equal(first.action.type, 'open_app');
  assert.equal(first.more, true);
  const second = brain.continueQueue();
  assert.equal(second.situation, 'timer_started');
  const third = brain.continueQueue();
  assert.equal(third.effect, 'confetti');
  // A step Khalfoun does not know is refused when teaching.
  assert.equal(brain.hear('لما أقول يلا: افتح الحاسبة وبعدين طير للقمر').situation, 'teach_bad');
});

// ------------------------------------------------------------------ templates
test('every new situation has a reply, and the replies follow the template rules', () => {
  const situations = ['attendance_absent', 'attendance_absent_many', 'attendance_late', 'attendance_late_many', 'attendance_present', 'attendance_present_many',
    'attendance_list', 'attendance_none_today', 'attendance_cleared', 'attendance_student', 'attendance_no_list', 'attendance_not_found', 'attendance_export_empty', 'sheet_saved',
    'riddle_ask', 'riddle_right', 'riddle_wrong', 'riddle_wrong_last', 'riddle_answer', 'wheel_result', 'race_start', 'race_step', 'race_close', 'race_win', 'race_stopped',
    'star_added', 'star_added_max', 'star_unlock', 'stars_status', 'stars_status_max', 'celebrate', 'effect_stopped', 'noise_on', 'noise_off', 'noise_loud', 'noise_very_loud',
    'noise_reward', 'class_mode_on', 'class_mode_off', 'camera_open', 'camera_no_cloud', 'camera_none', 'camera_failed', 'camera_solved', 'camera_solved_saved',
    'voice_test_open', 'voice_test_good', 'voice_test_ok', 'voice_test_bad', 'walk_windows', 'user_joke', 'tool_open_reading', 'reading_great', 'reading_good', 'reading_practice',
    ...['confetti', 'fireworks', 'national', 'rain', 'snow', 'lanterns', 'balloons', 'stars', 'hearts', 'bubbles'].map((e) => `effect_${e}`)];
  for (const s of situations) {
    const list = TEMPLATES.filter((t) => t.s === s);
    assert.ok(list.some((t) => !t.h), `${s} has a reply for calm humor`);
    for (const t of list) {
      assert.ok(!t.t.includes('{minutes}'), t.id);
      if (t.a) assert.ok(ANIMATIONS[t.a], `${t.id}: ${t.a}`);
    }
  }
});
