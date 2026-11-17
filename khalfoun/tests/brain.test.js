import test from 'node:test';
import assert from 'node:assert/strict';
import { EmotionEngine, EMOTIONS } from '../src/core/emotions.js';
import { decide, LEVELS, isKidsSafeUrl } from '../src/core/permissions.js';
import { Memory, defaultMemory } from '../src/core/memory.js';
import { ResponseEngine } from '../src/core/responses.js';
import { Brain, durationPhrase } from '../src/core/brain.js';
import { TEMPLATES } from '../src/core/templates/ar-om.js';

const seeded = (seed = 42) => () => {
  // mulberry32: deterministic random numbers for repeatable tests
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function makeBrain(overrides = {}, start = Date.UTC(2026, 10, 17, 6, 0, 0)) {
  let now = start;
  const clock = () => now;
  const advance = (ms) => { now += ms; };
  const memoryData = { ...defaultMemory(start), onboarded: true, level: 2, name: 'عبدالرحيم', ...overrides };
  const brain = new Brain({ memoryData, clock, rng: seeded(7) });
  return { brain, advance, clock };
}

// ---------------------------------------------------------------- emotions

test('there are 16 emotions plus calm', () => {
  assert.equal(EMOTIONS.length, 17);
});

test('events change emotion and gauges; feelings fade back', () => {
  const e = new EmotionEngine({ now: 0, mood: 0 });
  const s = e.feel('praise', 0);
  assert.equal(s.emotion, 'shy');
  assert.equal(s.secondary, 'happy');
  assert.ok(e.mood > 0);
  e.tick(60 * 1000);
  assert.ok(['calm', 'happy'].includes(e.current.emotion));
});

test('long idle brings boredom then sleep', () => {
  const e = new EmotionEngine({ now: 0 });
  assert.equal(e.tick(3 * 60 * 1000 + 1).emotion, 'bored');
  const s = e.tick(10 * 60 * 1000 + 1);
  assert.equal(s.emotion, 'sleepy');
  assert.equal(s.asleep, true);
  assert.equal(e.feel('wake', 10 * 60 * 1000 + 2).asleep, false);
});

test('intensity grows with a very good mood', () => {
  const e = new EmotionEngine({ now: 0, mood: 90 });
  assert.equal(e.feel('success', 0).intensity, 3);
  const low = new EmotionEngine({ now: 0, mood: 0, energy: 10 });
  assert.equal(low.feel('success', 0).intensity, 1);
});

test('unknown events are ignored safely', () => {
  const e = new EmotionEngine({ now: 0 });
  assert.equal(e.feel('nonsense', 0).emotion, 'calm');
});

// ------------------------------------------------------------- permissions

test('permission levels gate actions', () => {
  const open = { type: 'open_app', params: { app: 'calculator' } };
  const type = { type: 'type_text', params: { text: 'x' } };
  const del = { type: 'delete_files', params: {} };
  assert.equal(decide(open, { level: LEVELS.ACQUAINT }).allowed, false);
  assert.deepEqual(decide(open, { level: LEVELS.ASSISTANT }), { allowed: true, confirm: false, reason: 'ok' });
  assert.equal(decide(type, { level: LEVELS.ASSISTANT }).confirm, true);
  assert.equal(decide(type, { level: LEVELS.TRUSTED }).confirm, false);
  assert.equal(decide(del, { level: LEVELS.TRUSTED }).confirm, true);
  assert.equal(decide({ type: 'reminder' }, { level: 0 }).allowed, true);
  assert.equal(decide({ type: 'rm_rf' }, { level: 3 }).allowed, false);
});

test('kids mode blocks changes and unsafe sites', () => {
  const kids = { level: 3, kidsMode: true };
  assert.equal(decide({ type: 'type_text', params: {} }, kids).reason, 'kids_mode');
  assert.equal(decide({ type: 'open_url', params: { url: 'https://example.com' } }, kids).reason, 'kids_mode');
  assert.equal(decide({ type: 'open_url', params: { url: 'https://www.youtube.com' } }, kids).allowed, true);
  assert.equal(isKidsSafeUrl('http://www.youtube.com'), false);
  assert.equal(isKidsSafeUrl('not a url'), false);
});

// ------------------------------------------------------------------ memory

test('memory learns preferences within bounds and survives bad data', () => {
  const m = new Memory({ level: 9, humor: 'x', likes: null });
  assert.equal(m.data.level, 3);
  assert.equal(m.data.humor, 1);
  for (let i = 0; i < 20; i += 1) m.feedback('joke:pun', true);
  assert.equal(m.preference('joke:pun'), 2.98);
  for (let i = 0; i < 20; i += 1) m.feedback('joke:pun', false);
  assert.equal(m.preference('joke:pun'), 0.25);
  for (let i = 0; i < 250; i += 1) m.log({ action: 'x' });
  assert.equal(m.data.log.length, 200);
  m.set({ name: 'سالم' });
  m.forget();
  assert.equal(m.data.name, '');
  assert.equal(m.data.level, 3);
});

// --------------------------------------------------------------- responses

test('template bank is well formed', () => {
  const ids = new Set();
  for (const t of TEMPLATES) {
    assert.ok(t.id && t.s && t.t, `bad template ${JSON.stringify(t)}`);
    assert.ok(!ids.has(t.id), `duplicate ${t.id}`);
    ids.add(t.id);
    assert.ok(!/\{minutes\}/.test(t.t), `${t.id} uses removed variable`);
    if (t.h !== undefined) assert.ok([0, 1, 2].includes(t.h));
  }
  assert.ok(TEMPLATES.length >= 180, `only ${TEMPLATES.length} templates`);
});

test('every situation the brain can produce has replies', () => {
  const engine = new ResponseEngine({ templates: TEMPLATES });
  const situations = ['greet', 'greet_morning', 'greet_evening', 'return_long', 'how_are_you', 'who', 'thanks', 'praise', 'scold',
    'goodbye', 'set_name', 'call', 'joke', 'not_understood', 'help', 'listening', 'stt_unavailable', 'stt_empty', 'open_ok',
    'open_unknown', 'search_ok', 'search_empty', 'volume_up', 'volume_down', 'volume_mute', 'screenshot_ok', 'type_ok',
    'type_empty', 'reminder_set', 'reminder_no_time', 'reminder_fire', 'time', 'date', 'organize_ok', 'organize_empty',
    'undo_ok', 'undo_none', 'failed', 'feature_soon', 'need_level', 'kids_blocked', 'confirm_ask', 'confirmed', 'cancelled',
    'level_set', 'settings_open', 'stop', 'sleep', 'wake', 'come', 'away', 'dance', 'jump', 'humor_up', 'humor_down',
    'humor_max', 'humor_min', 'slip', 'hop_window', 'thinking', 'sounds_on', 'sounds_off', 'pdf_ok', 'pdf_none', 'pdf_empty', 'pdf_need_name', 'reminder_set_repeat', 'reminder_too_often', 'reminders_cancelled', 'reminders_none', 'routine_offer', 'routine_saved', 'routines_cleared', 'routines_none', 'mic_error', 'onboard_knock', 'idle_bored', 'idle_comment', 'poke', 'tickle', 'drag', 'dropped', 'onboard_done'];
  for (const s of situations) {
    for (const humor of [0, 2]) {
      const r = engine.say(s, { humor, emotion: 'calm', vars: { app: 'x', query: 'x', target: 'x', duration: 'x', noteSuffix: '', time: 'x', date: 'x', day: 'x', count: '1', what: 'x', level: 'x', days: '3' } });
      assert.ok(r && r.text, `no reply for ${s} at humor ${humor}`);
      assert.ok(!/\{\w+\}/.test(r.text), `unfilled variable in ${r.id}: ${r.text}`);
    }
  }
});

test('responses avoid repeating and fill the name correctly', () => {
  const engine = new ResponseEngine({ templates: TEMPLATES, rng: seeded(1) });
  const seen = new Set();
  for (let i = 0; i < 20; i += 1) seen.add(engine.say('joke', { humor: 2 }).id);
  assert.equal(seen.size, 20, 'twenty jokes in a row should all differ');
  const noName = engine.fill('تشرفنا يا {name}!', {}, '');
  assert.ok(!noName.includes('يا يا'), noName);
  assert.equal(engine.fill('هلا {name}', {}, 'سعيد'), 'هلا سعيد');
});

test('learned preferences shift what is chosen', () => {
  const m = new Memory();
  for (let i = 0; i < 6; i += 1) m.feedback('joke:oman', true);
  for (let i = 0; i < 6; i += 1) m.feedback('joke:pun', false);
  const engine = new ResponseEngine({ templates: TEMPLATES, rng: seeded(3), memory: m });
  let oman = 0;
  let pun = 0;
  for (let i = 0; i < 300; i += 1) {
    engine.recent = [];
    const r = engine.say('joke', { humor: 2 });
    if (r.cat === 'joke:oman') oman += 1;
    if (r.cat === 'joke:pun') pun += 1;
  }
  assert.ok(oman > pun * 3, `oman ${oman} vs pun ${pun}`);
});

test('durationPhrase follows Arabic number agreement', () => {
  assert.equal(durationPhrase(1), 'دقيقة');
  assert.equal(durationPhrase(2), 'دقيقتين');
  assert.equal(durationPhrase(5), '٥ دقايق');
  assert.equal(durationPhrase(15), '١٥ دقيقة');
  assert.equal(durationPhrase(60), 'ساعة');
  assert.equal(durationPhrase(120), 'ساعتين');
  assert.equal(durationPhrase(180), '٣ ساعات');
});

// ------------------------------------------------------------------- brain

test('open command returns an action and an immediate reply', () => {
  const { brain } = makeBrain();
  const r = brain.hear('افتح الحاسبة');
  assert.equal(r.action.type, 'open_app');
  assert.equal(r.action.params.app, 'calculator');
  assert.match(r.say, /الحاسبة/);
  assert.equal(r.emotion.emotion, 'focused');
  const done = brain.actionResult(r.action.id, { ok: true });
  assert.equal(done, null, 'open says its line at start, nothing on success');
  assert.equal(brain.memory.data.log.at(-1).ok, true);
});

test('youtube opens as a url, downloads as a folder', () => {
  const { brain } = makeBrain();
  assert.deepEqual(brain.hear('شغل يوتيوب').action.params, { url: 'https://www.youtube.com' });
  assert.equal(brain.hear('افتح التنزيلات').action.type, 'open_folder');
});

test('level 1 refuses actions politely', () => {
  const { brain } = makeBrain({ level: 1 });
  const r = brain.hear('افتح المتصفح');
  assert.equal(r.action, null);
  assert.equal(r.situation, 'need_level');
});

test('modify actions ask for a spoken yes at level 2', () => {
  const { brain } = makeBrain();
  const ask = brain.hear('اكتب السلام عليكم');
  assert.equal(ask.awaitingConfirm, true);
  assert.equal(ask.action, null);
  assert.match(ask.say, /السلام عليكم/);
  const go = brain.hear('ايوه');
  assert.equal(go.action.type, 'type_text');
  assert.equal(go.action.params.text, 'السلام عليكم');
  const done = brain.actionResult(go.action.id, { ok: true });
  assert.equal(done.situation, 'type_ok');
});

test('saying no cancels a pending action', () => {
  const { brain } = makeBrain();
  brain.hear('رتب التنزيلات');
  const r = brain.hear('لا');
  assert.equal(r.situation, 'cancelled');
  assert.equal(r.action, null);
  assert.equal(brain.pending, null);
});

test('a different command replaces a pending confirmation', () => {
  const { brain } = makeBrain();
  brain.hear('رتب التنزيلات');
  const r = brain.hear('كم الساعة');
  assert.equal(r.situation, 'time');
  assert.equal(brain.pending, null);
});

test('trusted level runs modify actions directly; results are reported', () => {
  const { brain } = makeBrain({ level: 3 });
  const r = brain.hear('رتب التنزيلات');
  assert.equal(r.action.type, 'organize_downloads');
  assert.equal(r.say, null);
  const ok = brain.actionResult(r.action.id, { ok: true, data: { moved: 12 } });
  assert.equal(ok.situation, 'organize_ok');
  assert.match(ok.say, /١٢/);
  const r2 = brain.hear('رتب التنزيلات');
  assert.equal(brain.actionResult(r2.action.id, { ok: true, data: { moved: 0 } }).situation, 'organize_empty');
});

test('failed actions make him sad and say so', () => {
  const { brain } = makeBrain();
  const r = brain.hear('صور الشاشة');
  const fail = brain.actionResult(r.action.id, { ok: false, error: 'boom' });
  assert.equal(fail.situation, 'failed');
  assert.equal(fail.emotion.emotion, 'sad');
  assert.equal(brain.actionResult(999, { ok: true }), null);
});

test('three quick successes make him proud', () => {
  const { brain, advance } = makeBrain();
  for (let i = 0; i < 3; i += 1) {
    const r = brain.hear('ارفع الصوت');
    advance(1000);
    brain.actionResult(r.action.id, { ok: true });
  }
  assert.equal(brain.emotions.current.emotion, 'proud');
});

test('reminder with and without a time', () => {
  const { brain } = makeBrain({ level: 1 });
  const r = brain.hear('ذكرني بعد خمس دقايق بالاجتماع');
  assert.equal(r.action.type, 'reminder', 'reminders are allowed at every level');
  assert.deepEqual(r.action.params, { minutes: 5, note: 'الاجتماع', repeat: false });
  assert.match(r.say, /٥ دقايق/);
  assert.match(r.say, /الاجتماع/);
  assert.equal(brain.hear('ذكرني بالدواء').situation, 'reminder_no_time');
  const fire = brain.event('reminder_fire', { note: 'الاجتماع' });
  assert.match(fire.say, /الاجتماع/);
});

test('time and date are spoken in Arabic', () => {
  const { brain } = makeBrain();
  const t = brain.hear('كم الساعة');
  assert.match(t.say, /[٠-٩]/);
  const d = brain.hear('شو التاريخ اليوم');
  assert.match(d.say, /نوفمبر|تشرين/);
});

test('laughing after a joke teaches him that kind of joke', () => {
  const { brain, advance } = makeBrain({ humor: 2 });
  const j = brain.hear('قول نكتة');
  const cat = brain.lastHumorous.cat;
  assert.ok(cat.startsWith('joke:'), j.templateId);
  advance(3000);
  brain.hear('هههههه');
  assert.equal(brain.memory.data.likes[cat], 1);
});

test('asking for less humor after a joke counts as dislike', () => {
  const { brain } = makeBrain({ humor: 2 });
  brain.hear('قول نكتة');
  const cat = brain.lastHumorous.cat;
  const r = brain.hear('خفف المزاح');
  assert.equal(r.situation, 'humor_down');
  assert.equal(brain.memory.data.humor, 1);
  assert.ok(brain.memory.data.likes[cat] < 0);
});

test('kids mode blocks typing but allows jokes and youtube', () => {
  const { brain } = makeBrain({ level: 3, kidsMode: true });
  assert.equal(brain.hear('اكتب مرحبا').situation, 'kids_blocked');
  assert.equal(brain.hear('شغل يوتيوب').action.type, 'open_url');
  assert.ok(brain.hear('قول نكتة').say);
});

test('setting a name is remembered and used', () => {
  const { brain } = makeBrain({ name: '' });
  const r = brain.hear('اسمي سعيد');
  assert.equal(brain.memory.data.name, 'سعيد');
  assert.match(r.say, /سعيد/);
});

test('sleep, call to wake, and behaviors for the shell', () => {
  const { brain } = makeBrain();
  assert.equal(brain.hear('روح نام').behavior, 'sleep');
  assert.equal(brain.emotions.asleep, true);
  const w = brain.hear('يا خلفون');
  assert.equal(w.behavior, 'wake');
  assert.equal(brain.hear('خلني اركز').behavior, 'away');
  assert.equal(brain.focus, true);
  assert.equal(brain.hear('تعال').behavior, 'come');
  assert.equal(brain.focus, false);
  assert.equal(brain.hear('وقف').behavior, 'stop');
});

test('start greets returning users and waits during onboarding', () => {
  const fresh = new Brain({ memoryData: defaultMemory(0), clock: () => 0 });
  assert.equal(fresh.start(), null);
  const day = 24 * 60 * 60 * 1000;
  const back = new Brain({ memoryData: { ...defaultMemory(0), onboarded: true, level: 2, lastSeen: 0 }, clock: () => 5 * day, rng: seeded(2) });
  const r = back.start();
  assert.equal(r.situation, 'return_long');
  assert.equal(back.emotions.current.emotion, 'longing');
});

test('onboarding stores choices and clamps them', () => {
  const b = new Brain({ memoryData: defaultMemory(0), clock: () => 0 });
  const r = b.completeOnboarding({ name: '  مريم  ', level: 7, kidsMode: 1, humor: 2 });
  assert.equal(r.situation, 'onboard_done');
  assert.match(r.say, /مريم/);
  assert.deepEqual([b.memory.data.level, b.memory.data.kidsMode, b.memory.data.name], [3, true, 'مريم']);
  const lv = b.updateSettings({ level: 2 });
  assert.match(lv.say, /المساعد/);
});

test('idle ticks bring boredom, remarks, then sleep', () => {
  const { brain, advance } = makeBrain({ humor: 1 });
  brain.hear('هلا');
  advance(3 * 60 * 1000 + 10);
  assert.equal(brain.tick().situation, 'idle_bored');
  advance(7 * 60 * 1000);
  const s = brain.tick();
  assert.equal(s.behavior, 'sleep');
  assert.equal(brain.tick(), null);
});

test('memory changes are reported for saving', () => {
  let saved = 0;
  const b = new Brain({ memoryData: { ...defaultMemory(0), onboarded: true, level: 2 }, onMemoryChange: () => { saved += 1; }, clock: () => 0 });
  b.hear('شكرا');
  assert.ok(saved > 0);
});

test('unknown sentences are kept for a future chat model', () => {
  const { brain } = makeBrain();
  const r = brain.hear('شو رأيك في الفلسفة الوجودية');
  assert.equal(r.situation, 'not_understood');
  assert.equal(r.unknownText, 'شو رأيك في الفلسفة الوجودية');
});

test('stress: 2000 random sentences never throw and always answer in Arabic', () => {
  const { brain, advance } = makeBrain({ level: 3, humor: 2 });
  const words = ['افتح', 'دور', 'اكتب', 'ذكرني', 'بعد', 'خمس', 'الصوت', 'نكتة', 'شكرا', 'لا', 'ايوه', 'يوتيوب', 'الحاسبة', '!!', '٣', 'رتب', 'التنزيلات', 'خلفون', 'يا', 'هلا'];
  const rng = seeded(99);
  for (let i = 0; i < 2000; i += 1) {
    const len = 1 + Math.floor(rng() * 6);
    const s = Array.from({ length: len }, () => words[Math.floor(rng() * words.length)]).join(' ');
    const r = brain.hear(s);
    if (r && r.action) brain.actionResult(r.action.id, { ok: rng() > 0.2, data: { moved: 1, restored: 1 } });
    if (r && r.say) assert.match(r.say, /[؀-ۿ]/);
    advance(500);
    brain.tick();
  }
});
