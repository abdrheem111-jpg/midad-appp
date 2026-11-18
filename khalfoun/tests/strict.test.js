// Strict checks: thousands of odd sentences must never break him, every reply he can
// give must read cleanly, and every command he plans must pass the main-process checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Brain } from '../src/core/brain.js';
import { defaultMemory } from '../src/core/memory.js';
import { TEMPLATES } from '../src/core/templates/ar-om.js';
import { validateAction } from '../src/main/actions/index.js';
import { recognize } from '../src/core/intents.js';
import { ANIMATIONS } from '../src/renderer/animations.js';

const seeded = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const WORDS = ['افتح', 'سكر', 'الحاسبة', 'المفكرة', 'يوتيوب', 'دور', 'عن', 'اكتب', 'ذكرني', 'بعد', 'ساعة', 'ونص', 'خمسة', 'وعشرين', 'دقيقة',
  'كم', 'ضرب', '٧', '12', 'الصوت', 'ارفع', 'نقص', 'يا', 'خلفون', 'لو', 'سمحت', 'الطلاب', 'نجمة', 'لمريم', 'مؤقت', 'اختبرني', 'السلام', 'عليكم',
  'شحالك', 'زين', 'الحمدلله', 'لا', 'اي', 'خلاص', 'وقف', 'الشريحة', 'الجاية', 'العرض', 'التاريخ', 'رقم', 'من', 'الى', 'نرد', 'بكرة', 'الساعة',
  'الصبح', 'كل', 'احد', 'حصة', 'رياضيات', 'اسمي', 'هذا', 'لخص', 'الشاشة', 'pdf', 'في', 'الصفحة', 'الثانية', 'و', 'بعدين', 'ثم', '؟', '!', '،'];
const NOISE = ['', ' ', '؟؟؟', '...', '😀👍', 'aaaa', 'ـــــ', 'ً ٌ ٍ', '\n\t', '{name}', '[[x|y]]', 'undefined', '<script>', '١٢٣٤٥٦٧٨٩٠'.repeat(30), 'ا'.repeat(600)];

function sentence(rng) {
  if (rng() < 0.12) return NOISE[Math.floor(rng() * NOISE.length)];
  const n = 1 + Math.floor(rng() * 7);
  return Array.from({ length: n }, () => WORDS[Math.floor(rng() * WORDS.length)]).join(' ');
}

const echoed = new Set();
function cleanText(say) {
  if (typeof say !== 'string') return false;
  // What the person typed may be repeated back word for word; only the bank's own text must be clean.
  let t = say;
  for (const e of echoed) t = t.split(e).join(' ');
  return !/\{\w+\}|\[\[|\]\]|undefined|NaN|null|\[object/.test(t);
}

test('3000 random sentences: no crash, a clean reply every time, every command passes main', () => {
  const rng = seeded(2026);
  let now = new Date(2026, 10, 19, 9, 0).getTime();
  for (const level of [1, 2, 3]) {
    for (const kidsMode of [false, true]) {
      const brain = new Brain({ memoryData: { ...defaultMemory(now), onboarded: true, level, kidsMode, name: 'مريم' }, clock: () => now, rng });
      for (let i = 0; i < 250; i += 1) {
        const text = sentence(rng);
        if (/[{}\[\]]|undefined/.test(text)) echoed.add(text.trim());
        let r;
        assert.doesNotThrow(() => { r = brain.hear(text); }, `hear «${text}»`);
        now += 1500 + Math.floor(rng() * 4000);
        if (!r) continue;
        if (r.say !== undefined && r.say !== null) assert.ok(cleanText(r.say), `«${text}» → «${r.say}»`);
        if (r.action) {
          assert.equal(validateAction(r.action), null, `«${text}» → ${JSON.stringify(r.action)}`);
          // Answer the action like the shell would, sometimes failing: still no crash.
          const ok = rng() < 0.8;
          let after;
          assert.doesNotThrow(() => { after = brain.actionResult(r.action.id, ok ? { ok: true, data: {} } : { ok: false, error: 'not_running' }); });
          if (after?.say) assert.ok(cleanText(after.say), `result of «${text}» → «${after.say}»`);
        }
        if (rng() < 0.05) assert.doesNotThrow(() => brain.tick());
      }
    }
  }
});

test('every situation the brain can ask for has replies, and every reply uses a real animation', async () => {
  const src = await readFile(new URL('../src/core/brain.js', import.meta.url), 'utf8');
  const asked = new Set([...src.matchAll(/reply\('([a-z_]+)'/g)].map((m) => m[1]));
  const have = new Set(TEMPLATES.map((t) => t.s));
  const missing = [...asked].filter((s) => !have.has(s));
  assert.deepEqual(missing, []);
  for (const t of TEMPLATES) if (t.a) assert.ok(ANIMATIONS[t.a], `${t.id}: animation «${t.a}»`);
});

test('recognize never throws and always gives an intent', () => {
  const rng = seeded(7);
  for (let i = 0; i < 4000; i += 1) {
    const s = sentence(rng);
    const r = recognize(s);
    assert.equal(typeof r.intent, 'string', s);
  }
});

test('the local model is told the date, today\'s classes and how the person feels', () => {
  const now = new Date(2026, 10, 19, 7, 30).getTime(); // Thursday
  const brain = new Brain({ memoryData: { ...defaultMemory(now), onboarded: true, level: 3, name: 'عبدالرحيم' }, clock: () => now, rng: () => 0.1 });
  brain.hear('كل خميس الساعة ٨ عندي حصة رياضيات');
  brain.hear('انا تعبان');
  const ctx = brain.chatContext(now);
  assert.match(ctx, /٢٠٢٦/);
  assert.match(ctx, /رياضيات/);
  assert.match(ctx, /الجاية/);
  assert.match(ctx, /تعبان/);
});

test('a slow whisper is retried with the quick model and greedy decoding', async () => {
  const { transcribe } = await import('../src/main/stt.js');
  const { encodeWav } = await import('../src/renderer/wav.js');
  const calls = [];
  const run = (bin, args, opts, cb) => {
    calls.push({ args, timeout: opts.timeout });
    if (calls.length === 1) cb(Object.assign(new Error('Command failed'), { killed: true }), '', '');
    else cb(null, 'كم الساعة\n', '');
  };
  const r = await transcribe({ bin: 'w.exe', model: 'ggml-small.bin', wakeModel: 'ggml-base.bin' }, encodeWav(new Float32Array(16000 * 4), 16000), { run });
  assert.equal(r.text, 'كم الساعة');
  assert.equal(r.model, 'ggml-base.bin');
  assert.equal(calls[1].args[calls[1].args.indexOf('-m') + 1], 'ggml-base.bin');
  assert.ok(calls[1].args.includes('-bs'));
  assert.ok(calls[0].timeout >= 30000);
  const fast = await transcribe({ bin: 'w.exe', model: 'ggml-small.bin', wakeModel: 'ggml-base.bin' }, encodeWav(new Float32Array(1600), 16000), { run: (b, a, o, cb) => { calls.push({ args: a }); cb(null, 'هلا', ''); }, fast: true });
  assert.equal(fast.model, 'ggml-base.bin');
});

test('a failed recognition says so instead of «تكلم قريب من الميكروفون»', () => {
  const brain = new Brain({ memoryData: { ...defaultMemory(0), onboarded: true, level: 3 }, clock: () => 0, rng: () => 0.1 });
  const r = brain.event('stt_failed');
  assert.equal(r.situation, 'stt_failed');
  assert.ok(!/الميكروفون|تهمس/.test(r.say));
});
