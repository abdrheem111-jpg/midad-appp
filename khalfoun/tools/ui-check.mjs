// End-to-end check of the overlay page in a real Chromium (browser preview
// mode, where actions are simulated). Usage: node tools/ui-check.mjs [outDir]
// Needs Playwright: npm i -D playwright && npx playwright install chromium

import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeWav } from '../src/renderer/wav.js';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright غير مثبت. ثبّته بـ: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const outDir = process.argv[2] || 'ui-shots';
await mkdir(outDir, { recursive: true });
const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}/`;
// A simulated microphone lets the voice path run for real: Chromium plays a
// generated file with speech-length sounds (about a second) separated by pauses.
const RATE = 16000;
const pattern = [];
for (let k = 0; k < 6; k += 1) pattern.push([1200, 0], [1000, 0.22]);
const total = pattern.reduce((n, [ms]) => n + (RATE * ms) / 1000, 0);
const samples = new Float32Array(total);
let pos = 0;
for (const [ms, amp] of pattern) {
  const n = (RATE * ms) / 1000;
  for (let i = 0; i < n; i += 1) samples[pos + i] = amp * Math.sin((2 * Math.PI * 200 * i) / RATE) * (0.6 + 0.4 * Math.sin(i / 300));
  pos += n;
}
const micFile = join(tmpdir(), `khalfoun-mic-${process.pid}.wav`);
await writeFile(micFile, encodeWav(samples, RATE));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${micFile}`] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));

let step = 0;
async function check(name, fn) {
  step += 1;
  try {
    await fn();
    console.log(`ok ${step} - ${name}`);
  } catch (err) {
    problems.push(`${name}: ${err.message}`);
    console.log(`not ok ${step} - ${name}\n  ${err.message}`);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const bubble = () => page.locator('#bubble-text').textContent();
const ready = () => page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 10000 });
const hear = async (text, wait = 900) => { await page.evaluate((t) => window.__khalfoun.hear(t), text); await page.waitForTimeout(wait); };

await page.goto(base);
await ready();

await check('first run shows the permission screen with Khalfoun knocking', async () => {
  assert(await page.locator('#onboarding').isVisible(), 'onboarding hidden');
  await page.waitForTimeout(1500);
  assert((await bubble()).includes('أدخل'), `bubble: ${await bubble()}`);
  await page.screenshot({ path: `${outDir}/1-onboarding.png` });
});

await check('finishing onboarding stores name and level and greets by name', async () => {
  await page.fill('#ob-name', 'عبدالرحيم');
  await page.check('input[name="ob-level"][value="3"]');
  await page.click('input[name="ob-humor"][value="2"] + span');
  await page.click('#ob-go');
  await page.waitForTimeout(1500);
  assert(!(await page.locator('#onboarding').isVisible()), 'onboarding still visible');
  assert((await bubble()).includes('عبدالرحيم'), `bubble: ${await bubble()}`);
  const level = await page.evaluate(() => window.__khalfoun.brain.memory.data.level);
  assert(level === 3, `level ${level}`);
});

await check('open command runs an action and talks about it', async () => {
  await hear('افتح الحاسبة');
  assert((await bubble()).includes('الحاسبة'), `bubble: ${await bubble()}`);
  const last = await page.evaluate(() => window.__khalfoun.bridge._actions.at(-1));
  assert(last.type === 'open_app' && last.params.app === 'calculator', JSON.stringify(last));
  await page.screenshot({ path: `${outDir}/2-open.png` });
});

await check('two commands in one sentence run one after the other, and «سكرها» closes the last one', async () => {
  const before = await page.evaluate(() => window.__khalfoun.bridge._actions.length);
  await page.evaluate(() => window.__khalfoun.hear('افتح المفكرة وبعدين الرسام'));
  await page.waitForTimeout(2600);
  const acts = await page.evaluate((n) => window.__khalfoun.bridge._actions.slice(n), before);
  assert(acts.length === 2 && acts[0].params.app === 'notepad' && acts[1].params.app === 'paint', JSON.stringify(acts));
  await page.evaluate(() => window.__khalfoun.hear('سكرها'));
  await page.waitForTimeout(600);
  const last = await page.evaluate(() => window.__khalfoun.bridge._actions.at(-1));
  assert(last.type === 'close_app' && last.params.app === 'paint', JSON.stringify(last));
});

await check('dictation: badge, every sentence typed with punctuation, «خلاص» ends it', async () => {
  await page.evaluate(() => window.__khalfoun.hear('ابدأ الإملاء'));
  await page.waitForTimeout(400);
  assert(!(await page.evaluate(() => document.getElementById('dictation').hidden)), 'badge hidden');
  await page.screenshot({ path: `${outDir}/13-dictation.png` });
  const before = await page.evaluate(() => window.__khalfoun.bridge._actions.length);
  await page.evaluate(() => window.__khalfoun.hear('السلام عليكم فاصلة كيف حالك علامة استفهام'));
  await page.evaluate(() => window.__khalfoun.hear('افتح الحاسبة'));
  await page.waitForTimeout(800);
  const acts = await page.evaluate((n) => window.__khalfoun.bridge._actions.slice(n), before);
  assert(acts.length === 2 && acts[0].params.text === 'السلام عليكم، كيف حالك؟ ' && acts[1].type === 'type_text', JSON.stringify(acts));
  await page.evaluate(() => window.__khalfoun.hear('خلاص'));
  await page.waitForTimeout(400);
  assert(await page.evaluate(() => document.getElementById('dictation').hidden), 'badge still shown');
});

await check('movement on command: right, stay, free', async () => {
  const x0 = await page.evaluate(() => { window.__khalfoun.motion.paused = false; return window.__khalfoun.motion.x; });
  await page.evaluate(() => window.__khalfoun.hear('روح يسار'));
  await page.waitForTimeout(3500);
  const x1 = await page.evaluate(() => window.__khalfoun.motion.x);
  assert(x1 < x0 - 150, `x ${x0} → ${x1}`);
  await page.evaluate(() => window.__khalfoun.hear('اثبت مكانك'));
  await page.waitForTimeout(300);
  assert((await page.evaluate(() => window.__khalfoun.motion.mode)) === 'focus', 'not staying');
  await page.evaluate(() => window.__khalfoun.hear('تحرك براحتك'));
  await page.waitForTimeout(300);
  assert(!(await page.evaluate(() => window.__khalfoun.motion.focus)), 'still focused');
});

await check('classroom: class list, random student, timer on screen, stars', async () => {
  await page.evaluate(() => window.__khalfoun.hear('أسماء الطلاب: أحمد، سعيد، مريم، فاطمة'));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__khalfoun.hear('اختار طالب'));
  await untilOn(page, () => /أحمد|سعيد|مريم|فاطمة/.test(document.getElementById('bubble-text').textContent), 4000);
  await page.evaluate(() => window.__khalfoun.hear('مؤقت دقيقة'));
  await untilOn(page, () => !document.getElementById('timer').hidden && /٠٠:٥٩|٠١:٠٠/.test(document.getElementById('timer').textContent), 3000);
  await page.screenshot({ path: `${outDir}/15-classroom-timer.png` });
  await page.evaluate(() => window.__khalfoun.hear('وقف المؤقت'));
  await untilOn(page, () => document.getElementById('timer').hidden, 2000);
  await page.evaluate(() => window.__khalfoun.hear('نجمة لمريم'));
  await untilOn(page, () => /مريم/.test(document.getElementById('bubble-text').textContent), 3000);
});

await check('living: a newly opened PDF gets a remark; chase and hide-and-seek games', async () => {
  await page.evaluate(() => window.__khalfoun.hear('تعال'));
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const k = window.__khalfoun;
    k.desktop.lastAny = -Infinity;
    k.desktop.lastByKind.clear();
    k.desktop.known = null;
    k.noticeWindows([{ id: 'n', x: 140, y: 250, w: 460, h: 300, t: 'المفكرة' }]);
    k.noticeWindows([{ id: 'n', x: 140, y: 250, w: 460, h: 300, t: 'المفكرة' }, { id: 'p', x: 700, y: 120, w: 500, h: 400, t: 'ورقة عمل.pdf - Adobe Acrobat' }]);
  });
  await untilOn(page, () => window.__khalfoun.lastReply?.situation === 'win_pdf', 3000);
  await page.evaluate(() => window.__khalfoun.hear('طاردني'));
  await untilOn(page, () => window.__khalfoun.game?.name === 'chase', 2000);
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.move(box.x - 300, box.y + 50);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await untilOn(page, () => window.__khalfoun.game?.score >= 1, 3000);
  await page.mouse.move(10, 10);
  await page.evaluate(() => window.__khalfoun.hear('غميضة'));
  await untilOn(page, () => document.getElementById('stage').classList.contains('hiding'), 8000);
  await page.screenshot({ path: `${outDir}/16-hide-and-seek.png` });
  const hid = await page.locator('#stage').boundingBox();
  await page.mouse.click(hid.x + hid.width / 2, hid.y + hid.height / 2);
  await untilOn(page, () => window.__khalfoun.lastReply?.situation === 'game_found', 3000);
  assert(!(await page.evaluate(() => document.getElementById('stage').classList.contains('hiding'))), 'still hiding');
});

await check('search and typing at full trust', async () => {
  await hear('دور لي عن مطاعم في مسقط');
  let last = await page.evaluate(() => window.__khalfoun.bridge._actions.at(-1));
  assert(last.type === 'search' && last.params.query === 'مطاعم في مسقط', JSON.stringify(last));
  await hear('اكتب السلام عليكم');
  last = await page.evaluate(() => window.__khalfoun.bridge._actions.at(-1));
  assert(last.type === 'type_text', JSON.stringify(last));
});

await check('reminder fires and he comes to say it', async () => {
  await hear('ذكرني بعد دقيقة بالصلاة', 2600);
  assert((await bubble()).includes('الصلاة'), `bubble: ${await bubble()}`);
});

await check('dragging him up and letting go makes him fall back to the floor', async () => {
  await page.waitForTimeout(800);
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 120, box.y - 250, { steps: 12 });
  const mid = await page.evaluate(() => ({ mode: window.__khalfoun.motion.mode, y: window.__khalfoun.motion.y }));
  assert(mid.mode === 'drag', `mode ${mid.mode}`);
  await page.mouse.up();
  await page.waitForTimeout(1600);
  const end = await page.evaluate(() => {
    const m = window.__khalfoun.motion;
    return { y: m.y, floor: m.floor, mode: m.mode, support: m.support, h: m.size.height };
  });
  const onFloor = Math.abs(end.y - end.floor) < 1 && !end.support;
  const onWindow = end.support && Math.abs(end.y + end.h - end.support.y) < 1;
  assert(onFloor || onWindow, `not standing anywhere: ${JSON.stringify(end)}`);
});

await check('double-click opens the command box; typed commands work', async () => {
  await page.waitForTimeout(3000);
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(500);
  assert(await page.locator('#command').isVisible(), 'command box hidden');
  await page.fill('#command-input', 'كم الساعة');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  assert(/[٠-٩]/.test(await bubble()), `bubble: ${await bubble()}`);
  await page.screenshot({ path: `${outDir}/3-command.png` });
  await page.keyboard.press('Escape');
});

await check('voice button explains that speech is not installed in preview', async () => {
  await page.evaluate(() => window.__khalfoun.bridge._emit({ type: 'ptt' }));
  await page.waitForTimeout(1200);
  assert((await bubble()).length > 5, 'no reply');
});

await check('settings open by voice and show the action log', async () => {
  await hear('الصلاحيات');
  assert(await page.locator('#settings').isVisible(), 'settings hidden');
  const items = await page.locator('#st-log li').count();
  assert(items >= 3, `log items ${items}`);
  await page.screenshot({ path: `${outDir}/4-settings.png` });
  await page.click('#st-close');
});

await check('emotion and animation commands do not break anything', async () => {
  for (const t of ['قول نكتة', 'هههههه', 'ارقص', 'شاطر', 'انت غبي', 'روح نام', 'يا خلفون', 'خلني اركز', 'تعال', 'وقف']) await hear(t, 500);
  assert(await page.evaluate(() => typeof window.__khalfoun.brain.emotions.mood === 'number'), 'brain broken');
  await page.screenshot({ path: `${outDir}/5-after.png` });
});

await check('dropped above a window he lands and stands on it', async () => {
  await page.evaluate(() => { const k = window.__khalfoun; k.preview.move('notes', 140, 300); k.preview.move('browser', 900, 420); });
  await page.waitForTimeout(300);
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(370, 40, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(1500);
  const st = await page.evaluate(() => ({ support: window.__khalfoun.motion.support, y: window.__khalfoun.motion.y }));
  assert(st.support && st.support.id === 'notes' && st.y === 300 - 209, JSON.stringify(st));
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${outDir}/7-on-window.png` });
});

await check('yanking the window away makes him fall, complaining', async () => {
  await page.evaluate(() => window.__khalfoun.motion.paused = true);
  await page.evaluate(() => { window.__khalfoun.recentSituations.length = 0; window.__khalfoun.preview.move('notes', 140, 520); });
  await page.waitForTimeout(1600);
  const st = await page.evaluate(() => ({ support: window.__khalfoun.motion.support, mode: window.__khalfoun.motion.mode }));
  assert(!st.support || st.support.y !== 300, JSON.stringify(st));
  // He complains as the window goes; a landing remark may follow, so check what he said, not the last bubble.
  const said = await page.evaluate(() => [...window.__khalfoun.recentSituations]);
  assert(said.includes('slip'), `said: ${said.join(', ')} / bubble: ${await bubble()}`);
});

await check('closing the window under him drops him to what is below', async () => {
  await page.waitForTimeout(2500);
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(1100, 60, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(1500);
  let st = await page.evaluate(() => window.__khalfoun.motion.support);
  assert(st && st.id === 'browser', `should be on the browser window: ${JSON.stringify(st)}`);
  await page.evaluate(() => window.__khalfoun.preview.close('browser'));
  await page.waitForTimeout(1600);
  st = await page.evaluate(() => ({ support: window.__khalfoun.motion.support, y: window.__khalfoun.motion.y, floor: window.__khalfoun.motion.floor }));
  assert(!st.support && Math.abs(st.y - st.floor) < 1, JSON.stringify(st));
});

await check('turning off walking on windows hides them from him', async () => {
  await page.evaluate(() => { const k = window.__khalfoun; k.brain.memory.set({ walkOnWindows: false }); k.updateWindowWatch(); });
  const st = await page.evaluate(() => ({ climb: window.__khalfoun.motion.climb, platforms: window.__khalfoun.motion.platforms.length }));
  assert(st.climb === false && st.platforms === 0, JSON.stringify(st));
  await page.evaluate(() => { const k = window.__khalfoun; k.brain.memory.set({ walkOnWindows: true }); k.updateWindowWatch(); k.motion.paused = false; });
});

await check('maths quiz: question, typed answer, score at the end', async () => {
  await hear('اختبرني', 1200);
  const q = await bubble();
  assert(/[٠-٩]/.test(q) && q.includes('؟'), `question: ${q}`);
  const answer = await page.evaluate(() => window.__khalfoun.brain.quiz.current.answer);
  await page.evaluate(() => window.__khalfoun.motion.paused = true);
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(400);
  await page.fill('#command-input', String(answer));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  assert(/صح|برافو|تمام|ما شاء الله/.test(await bubble()), `after right answer: ${await bubble()}`);
  await page.keyboard.press('Escape');
  await hear('وقف', 1200);
  assert(/١ من ١/.test(await bubble()), `end: ${await bubble()}`);
  await page.screenshot({ path: `${outDir}/8-quiz.png` });
});

await check('outfits: bisht on request, flag for National Day, and off again', async () => {
  await hear('البس البشت', 1000);
  assert(await page.evaluate(() => window.__khalfoun.character.costume) === 'bisht', 'no bisht');
  await page.screenshot({ path: `${outDir}/9-bisht.png` });
  await hear('ارفع العلم', 800);
  assert(await page.evaluate(() => window.__khalfoun.character.costume) === 'flag', 'no flag');
  await hear('شيل العلم', 800);
  assert(await page.evaluate(() => window.__khalfoun.character.costume) === null, 'outfit not removed');
});

await check('he responds kindly to how you feel', async () => {
  await hear('والله تعبان اليوم', 1200);
  const felt = await page.evaluate(() => window.__khalfoun.brain.memory.data.lastFeeling?.kind);
  assert(felt === 'tired' && (await bubble()).length > 10, `tired: ${felt} / ${await bubble()}`);
  await hear('نجحت في الامتحان', 1200);
  const won = await page.evaluate(() => window.__khalfoun.brain.memory.data.lastFeeling?.kind);
  assert(won === 'success' && (await bubble()).length > 10, `success: ${won} / ${await bubble()}`);
  await page.evaluate(() => window.__khalfoun.motion.paused = false);
});

await check('he makes sounds in a real browser and stays silent when muted', async () => {
  const before = await page.evaluate(() => window.__khalfoun.sounds.played);
  await hear('قول نكتة', 900);
  const after = await page.evaluate(() => window.__khalfoun.sounds.played);
  assert(after > before, `no sound played (${before} -> ${after})`);
  await hear('اسكت الأصوات', 900);
  const muted = await page.evaluate(() => window.__khalfoun.sounds.played);
  await hear('قول نكتة', 900);
  assert(await page.evaluate(() => window.__khalfoun.sounds.played) === muted, 'sound played while muted');
  await hear('شغل الأصوات', 600);
  assert(await page.evaluate(() => window.__khalfoun.sounds.enabled), 'sounds not back on');
});

await check('every expression with every animation draws without invalid values', async () => {
  const bad = await page.evaluate(async () => {
    const { FACES } = await import('/src/renderer/character.js');
    const { ANIMATIONS } = await import('/src/renderer/animations.js');
    const k = window.__khalfoun;
    const problems = [];
    for (const emotion of Object.keys(FACES)) {
      for (const intensity of [1, 3]) {
        k.character.setEmotion({ emotion, intensity, secondary: null });
        for (const [name, anim] of Object.entries(ANIMATIONS)) {
          for (const t of [0, anim.dur * 0.5]) k.character.render(1 / 60, anim.pose(t, 1));
          if (/NaN|Infinity|undefined/.test(k.character.el.innerHTML)) { problems.push(`${emotion}/${intensity}/${name}`); break; }
        }
      }
    }
    k.character.setEmotion({ emotion: 'calm', intensity: 1, secondary: null });
    return problems;
  });
  assert(bad.length === 0, `invalid drawing: ${bad.slice(0, 5).join(', ')}`);
});

await check('memory survives a reload (no onboarding the second time)', async () => {
  await page.waitForTimeout(900);
  await page.reload();
  await ready();
  await page.waitForTimeout(1200);
  assert(!(await page.locator('#onboarding').isVisible()), 'onboarding shown again');
  const name = await page.evaluate(() => window.__khalfoun.brain.memory.data.name);
  assert(name === 'عبدالرحيم', `name ${name}`);
});

// ---------------------------------------------------------------- wake word
const vpage = await browser.newPage({ viewport: { width: 1280, height: 760 } });
vpage.on('pageerror', (e) => problems.push(`voice page error: ${e.message}`));
vpage.on('console', (m) => { if (m.type() === 'error') problems.push(`voice console: ${m.text()}`); });
await vpage.goto(`${base}?fakevoice=1`);
await vpage.evaluate(() => {
  localStorage.setItem('khalfoun.settings', JSON.stringify({ onboarded: true, level: 3, kidsMode: false }));
  localStorage.setItem('khalfoun.memory', JSON.stringify({ name: 'عبدالرحيم', alwaysListen: true, humor: 1 }));
});
await vpage.reload();
await vpage.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 15000 });
const vbubble = () => vpage.locator('#bubble-text').textContent();
/** Polls a condition in the page; returns true, or throws with the last error seen. */
async function until(fnSource, ms) {
  const end = Date.now() + ms;
  let lastErr = null;
  while (Date.now() < end) {
    try {
      if (await vpage.evaluate(fnSource)) return true;
    } catch (err) { lastErr = err; }
    await vpage.waitForTimeout(250);
  }
  if (lastErr) throw new Error(`while waiting: ${lastErr.message}`);
  return false;
}

await check('always-listening shows the mic badge and keeps the mic open', async () => {
  await vpage.waitForTimeout(800);
  assert(await vpage.locator('#ear').isVisible(), 'mic badge hidden');
  assert(await vpage.evaluate(() => window.__khalfoun.wake.active), 'listener not active');
});

await check('a sentence without his name is ignored; «يا خلفون افتح الحاسبة» runs at once', async () => {
  await vpage.evaluate(() => { window.__fakeTranscripts = ['كلام عادي عن التلفون', 'يا خلفون افتح الحاسبة']; });
  const ok = await until("window.__khalfoun.bridge._actions.some((a) => a.type === 'open_app' && a.params.app === 'calculator')", 20000);
  const calls = await vpage.evaluate(() => window.__khalfoun.bridge._transcribeCalls);
  assert(ok, `no action; transcribe calls: ${JSON.stringify(calls)}`);
  assert(calls.length >= 2 && calls.every((c) => c.purpose === 'wake' && c.bytes > 44), JSON.stringify(calls));
  const opened = await vpage.evaluate(() => window.__khalfoun.bridge._actions.filter((a) => a.type === 'open_app').length);
  assert(opened === 1, `opened ${opened} times`);
});

await check('just «يا خلفون» makes him answer and listen for the command', async () => {
  await vpage.waitForTimeout(1500);
  await vpage.evaluate(() => { window.__fakeTranscripts = ['يا خلفون', 'كم الساعة', 'خلاص']; window.__khalfoun.bridge._transcribeCalls.length = 0; });
  const ok = await until("window.__khalfoun.bridge._transcribeCalls.some((c) => c.purpose === 'command')", 25000);
  assert(ok, `never listened for a command: ${JSON.stringify(await vpage.evaluate(() => window.__khalfoun.bridge._transcribeCalls))}`);
  // In the session the next sentence is the command: the time comes back.
  const told = await until("/[٠-٩]/.test(document.getElementById('bubble-text').textContent)", 12000);
  assert(told, `bubble: ${await vbubble()}`);
  await vpage.screenshot({ path: `${outDir}/6-wake.png` });
});

await check('turning the setting off releases the microphone', async () => {
  await vpage.evaluate(() => { window.__khalfoun.brain.updateSettings({ alwaysListen: false }); window.__khalfoun.updateWake(); });
  assert(!(await vpage.evaluate(() => window.__khalfoun.wake.active)), 'still listening');
  assert(!(await vpage.locator('#ear').isVisible()), 'badge still shown');
});

// ------------------------------------------------------------- chat brain
const cpage = await browser.newPage({ viewport: { width: 1280, height: 760 } });
cpage.on('pageerror', (e) => problems.push(`chat page error: ${e.message}`));
await cpage.goto(`${base}?fakechat=1`);
await cpage.evaluate(() => {
  localStorage.setItem('khalfoun.settings', JSON.stringify({ onboarded: true, level: 2, kidsMode: false }));
  localStorage.setItem('khalfoun.memory', JSON.stringify({ name: 'عبدالرحيم', humor: 1 }));
});
await cpage.reload();
await cpage.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 15000 });
const cbubble = () => cpage.locator('#bubble-text').textContent();

await check('sentences his rules do not cover go to the local model, with «thinking» first', async () => {
  await cpage.waitForTimeout(1500);
  await cpage.evaluate(() => { window.__fakeChat = ['البحر في صور يجنن، خاصة وقت الغروب!']; window.__khalfoun.hear('شو رأيك في بحر صور؟'); });
  await cpage.waitForTimeout(150);
  const thinking = await cpage.evaluate(() => window.__khalfoun.brain.emotions.current.emotion);
  await cpage.waitForTimeout(1600);
  const text = await cbubble();
  assert(text.includes('الغروب'), `bubble: ${text}`);
  const calls = await cpage.evaluate(() => window.__khalfoun.bridge._chatCalls);
  assert(calls.length === 1 && calls[0].text === 'شو رأيك في بحر صور؟' && calls[0].name === 'عبدالرحيم', JSON.stringify(calls));
  assert(thinking, 'no emotion while thinking');
  await cpage.screenshot({ path: `${outDir}/10-chat.png` });
});

await check('known commands never go to the model; a failed model falls back politely', async () => {
  await cpage.evaluate(() => window.__khalfoun.hear('كم الساعة'));
  await cpage.waitForTimeout(800);
  assert((await cpage.evaluate(() => window.__khalfoun.bridge._chatCalls.length)) === 1, 'command was sent to the model');
  await cpage.evaluate(() => { window.__fakeChat = []; window.__khalfoun.hear('فلسفة الوجود والعدم'); });
  await cpage.waitForTimeout(1800);
  const fb = await cpage.evaluate(() => window.__khalfoun.lastReply?.situation);
  assert(fb === 'not_understood', `fallback situation: ${fb}, bubble: ${await cbubble()}`);
});

// ---- Claude (the person's own key): free speech → his commands, or quiet when not for him
const apage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await apage.goto(`${base}?fakeagent=1`);
await apage.evaluate(() => {
  localStorage.setItem('khalfoun.settings', JSON.stringify({ onboarded: true, level: 3, kidsMode: false }));
  localStorage.setItem('khalfoun.memory', JSON.stringify({ name: 'عبدالرحيم', humor: 1 }));
});
await apage.reload();
await apage.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 15000 });

await check('Claude turns free speech into his own commands, which then run through the usual checks', async () => {
  await apage.waitForTimeout(1200);
  await apage.evaluate(() => { window.__fakeAgent = [{ addressed: true, say: 'ابشر، الحين', commands: ['افتح الحاسبة'] }]; window.__khalfoun.hear('ابغى احسب درجات الطلاب بسرعة'); });
  await apage.waitForTimeout(1500);
  const actions = await apage.evaluate(() => window.__khalfoun.bridge._actions.map((a) => `${a.type}:${a.params?.app || ''}`));
  assert(actions.includes('open_app:calculator'), JSON.stringify(actions));
  const calls = await apage.evaluate(() => window.__khalfoun.bridge._agentCalls);
  assert(calls.length === 1 && calls[0].name === 'عبدالرحيم' && /٢٠٢٦|2026/.test(calls[0].context), JSON.stringify(calls).slice(0, 300));
});

await check('Claude answers chat in his bubble, and stays quiet when the words were not for him', async () => {
  await apage.evaluate(() => { window.__fakeAgent = [{ addressed: true, say: 'جبل شمس أحلى وقت في الشتا!', commands: [] }]; window.__khalfoun.hear('متى أحسن وقت أطلع جبل شمس'); });
  await apage.waitForTimeout(1200);
  const t = await apage.locator('#bubble-text').textContent();
  assert(t.includes('جبل شمس'), `bubble: ${t}`);
  const before = await apage.evaluate(() => window.__khalfoun.lastReply?.say);
  await apage.evaluate(() => { window.__fakeAgent = [{ addressed: false, say: '', commands: [] }]; window.__khalfoun.hear('يا ولد روح جيب الكتاب من السيارة'); });
  await apage.waitForTimeout(1200);
  const after = await apage.evaluate(() => window.__khalfoun.lastReply?.say);
  assert(after === before, `he talked: ${after}`);
});

await check('known commands stay instant and never go to Claude', async () => {
  const n = await apage.evaluate(() => window.__khalfoun.bridge._agentCalls.length);
  await apage.evaluate(() => window.__khalfoun.hear('كم الساعة'));
  await apage.waitForTimeout(500);
  assert((await apage.evaluate(() => window.__khalfoun.bridge._agentCalls.length)) === n, 'sent to Claude');
});

await check('the cloud keys section is in settings; keys are password fields', async () => {
  await apage.evaluate(() => window.__khalfoun.hear('افتح الاعدادات'));
  await apage.evaluate(() => document.getElementById('settings').hidden || true);
  const types = await apage.evaluate(() => [document.getElementById('cl-claude').type, document.getElementById('cl-azure').type]);
  assert(types[0] === 'password' && types[1] === 'password', JSON.stringify(types));
  const state = await apage.evaluate(() => document.getElementById('cl-claude-state').textContent);
  assert(/مضبوط|مفتاح/.test(state), state);
});
await apage.close();

/** Waits until `fn` is true on `pg`, or fails the check after `ms`. */
async function untilOn(pg, fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await pg.evaluate(fn).catch(() => false)) return;
    await pg.waitForTimeout(150);
  }
  throw new Error(`timed out waiting for: ${String(fn).slice(0, 120)}`);
}

await check('a sentence only the model understands becomes a command, after a yes', async () => {
  await cpage.evaluate(() => { window.__fakeChat = ['أمر: دور في يوتيوب عن أناشيد'];  window.__khalfoun.hear('ودي أسمع أناشيد حلوة'); });
  await cpage.waitForTimeout(1500);
  const asked = await cpage.evaluate(() => window.__khalfoun.lastReply?.situation);
  assert(asked === 'model_command', `situation: ${asked}`);
  await cpage.evaluate(() => window.__khalfoun.hear('ايوه'));
  await cpage.waitForTimeout(700);
  const last = await cpage.evaluate(() => window.__khalfoun.bridge._actions.at(-1));
  assert(last?.type === 'search' && last.params.engine === 'youtube' && last.params.query === 'أناشيد', JSON.stringify(last));
});

await check('eyes: «سو أسئلة من هذا» reads the selection, the model writes questions, «اكتبها» types them', async () => {
  await cpage.evaluate(() => {
    window.__fakeSelection = 'الماء يغلي عند مئة درجة ويتجمد عند الصفر.';
    window.__fakeChat = ['١. عند كم درجة يغلي الماء؟\n٢. متى يتجمد؟\nالإجابات:\n١. مئة ٢. صفر'];
    window.__khalfoun.hear('سو أسئلة من هذا');
  });
  await untilOn(cpage, () => window.__khalfoun.lastReply?.situation === 'task_answer', 6000);
  await untilOn(cpage, () => document.getElementById('bubble-text').textContent.includes('اكتبها'), 4000);
  assert(await cpage.evaluate(() => document.getElementById('bubble').classList.contains('long')), 'long bubble');
  await cpage.screenshot({ path: `${outDir}/14-eyes-questions.png` });
  await cpage.evaluate(() => window.__khalfoun.hear('اكتبها'));
  await cpage.waitForTimeout(300);
  assert(await cpage.evaluate(() => window.__khalfoun.lastReply?.awaitingConfirm), 'assistant level asks before typing');
  await cpage.evaluate(() => window.__khalfoun.hear('ايوه'));
  await cpage.waitForTimeout(700);
  const last = await cpage.evaluate(() => window.__khalfoun.bridge._actions.at(-1));
  assert(last.type === 'type_text' && last.params.text.startsWith('١. عند كم درجة'), JSON.stringify(last));
});

await check('AI eyes: «اشرح اللي في الشاشة» goes to the vision model and the answer is shown', async () => {
  const vpage2 = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  vpage2.on('pageerror', (e) => problems.push(`vision page error: ${e.message}`));
  await vpage2.goto(`${base}?fakechat=1&fakevision=1`);
  await vpage2.evaluate(() => {
    localStorage.setItem('khalfoun.settings', JSON.stringify({ onboarded: true, level: 3, kidsMode: false }));
    localStorage.setItem('khalfoun.memory', JSON.stringify({ name: 'عبدالرحيم', humor: 1 }));
  });
  await vpage2.reload();
  await vpage2.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 15000 });
  await vpage2.waitForTimeout(800);
  await vpage2.evaluate(() => { window.__fakeChat = ['في الشاشة رسم لدورة الماء: تبخر ثم تكاثف ثم هطول.']; window.__khalfoun.hear('اشرح اللي في الشاشة'); });
  await untilOn(vpage2, () => window.__khalfoun.lastReply?.situation === 'task_answer', 5000);
  const calls = await vpage2.evaluate(() => window.__khalfoun.bridge._chatCalls);
  assert(calls.some((c) => c.look === 'explain'), JSON.stringify(calls));
  await untilOn(vpage2, () => document.getElementById('bubble-text').textContent.includes('دورة الماء'), 4000);
  await vpage2.close();
});

// ----- one-click setup from the settings panel (simulated downloads)
const spage = await browser.newPage({ viewport: { width: 1280, height: 760 } });
spage.on('pageerror', (e) => problems.push(`setup page error: ${e.message}`));
await spage.goto(`${base}?fakeollama=1`);
await spage.evaluate(() => {
  localStorage.setItem('khalfoun.settings', JSON.stringify({ onboarded: true, level: 2, kidsMode: false }));
  localStorage.setItem('khalfoun.memory', JSON.stringify({ name: 'عبدالرحيم', humor: 1 }));
});
await spage.reload();
await spage.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 15000 });
const sbubble = () => spage.locator('#bubble-text').textContent();

await check('«جهّز الاستماع» opens the setup cards with sizes, balanced chosen', async () => {
  await spage.waitForTimeout(1200);
  await spage.evaluate(() => window.__khalfoun.hear('جهز الاستماع'));
  await untilOn(spage, () => !document.getElementById('settings').hidden);
  await untilOn(spage, () => document.getElementById('su-voice-pack').options.length === 3);
  const info = await spage.evaluate(() => ({
    state: document.getElementById('su-voice-state').textContent,
    pack: document.getElementById('su-voice-pack').value,
    labels: [...document.getElementById('su-voice-pack').options].map((o) => o.textContent),
    brainBtn: document.getElementById('su-brain-go').textContent,
  }));
  assert(info.state === 'غير مركّب', info.state);
  assert(info.pack === 'balanced', info.pack);
  assert(info.labels.some((l) => l.includes('٦٣٩ ميجا')), info.labels.join(' | '));
  assert(info.brainBtn === 'نزّل العقل', info.brainBtn);
  await untilOn(spage, () => /تجهيز خلفون|اختار حجم/.test(document.getElementById('bubble-text').textContent), 4000).catch(async () => { throw new Error(`bubble: ${await sbubble()}`); });
});

await check('pressing «جهّز الاستماع» shows progress, then voice becomes ready', async () => {
  await spage.click('#su-voice-go');
  await untilOn(spage, () => !document.getElementById('su-progress').hidden);
  await untilOn(spage, () => /٪/.test(document.getElementById('su-progress-text').textContent));
  await spage.screenshot({ path: `${outDir}/11-setup-progress.png` });
  assert(await spage.evaluate(() => document.getElementById('su-voice-go').disabled), 'button stays enabled while busy');
  await untilOn(spage, () => document.getElementById('su-voice-state').textContent === 'جاهز', 8000);
  assert(await spage.evaluate(() => document.getElementById('su-progress').hidden), 'progress still shown');
  assert(!(await spage.evaluate(() => document.getElementById('st-listen').disabled)), 'always-listen still disabled');
  await untilOn(spage, () => /أسمعك|آذاني|أسمع/.test(document.getElementById('bubble-text').textContent), 4000).catch(async () => { throw new Error(`bubble: ${await sbubble()}`); });
  const calls = await spage.evaluate(() => window.__khalfoun.bridge._setup.calls);
  assert(JSON.stringify(calls) === '[["voice","balanced"]]', JSON.stringify(calls));
});

await check('the brain is pulled through Ollama, and a download can be stopped', async () => {
  await spage.selectOption('#su-brain-choice', 'standard');
  await spage.click('#su-brain-go');
  await untilOn(spage, () => /العقل/.test(document.getElementById('su-progress-text').textContent));
  await spage.click('#su-cancel');
  await untilOn(spage, () => document.getElementById('su-progress').hidden, 5000);
  await untilOn(spage, () => /وقّفت/.test(document.getElementById('bubble-text').textContent), 4000).catch(async () => { throw new Error(`bubble after stop: ${await sbubble()}`); });
  await spage.waitForTimeout(400);
  await spage.click('#su-brain-go');
  await untilOn(spage, () => document.getElementById('su-brain-state').textContent === 'جاهز', 8000);
  assert(!(await spage.evaluate(() => document.getElementById('st-chat').disabled)), 'chat toggle still disabled');
  assert(/qwen2\.5:3b/.test(await spage.locator('#su-brain-text').textContent()), 'model name missing');
  await spage.screenshot({ path: `${outDir}/12-setup-ready.png` });
});

// ------------------------------------------------------------------ Khalfoun X: classroom joy
const xpage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
xpage.on('pageerror', (e) => problems.push(`X page error: ${e.message}`));
xpage.on('console', (m) => { if (m.type() === 'error') problems.push(`X console: ${m.text()}`); });
await xpage.goto(`${base}?fakevoice=1`);
await xpage.evaluate(() => {
  localStorage.setItem('khalfoun.settings', JSON.stringify({ onboarded: true, level: 3, kidsMode: false }));
  localStorage.setItem('khalfoun.memory', JSON.stringify({ name: 'عبدالرحيم', humor: 1, classroom: { students: ['أحمد', 'مريم', 'سالم', 'فاطمة', 'خالد', 'نورة'], points: {}, picked: [] } }));
});
await xpage.reload();
await xpage.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 15000 });
const xbubble = () => xpage.locator('#bubble-text').textContent();
const xhear = async (t, wait = 600) => { await xpage.evaluate((s) => window.__khalfoun.hear(s), t); await xpage.waitForTimeout(wait); };

await check('X: «احتفل» covers the screen with confetti and the canvas lets clicks through', async () => {
  await xhear('احتفل', 1200);
  const st = await xpage.evaluate(() => ({ on: document.querySelector('.fx-canvas').classList.contains('on'), parts: window.__khalfoun.effects.parts.length, pe: getComputedStyle(document.querySelector('.fx-canvas')).pointerEvents }));
  assert(st.on && st.parts > 50, JSON.stringify(st));
  assert(st.pe === 'none', st.pe);
  await xpage.screenshot({ path: `${outDir}/x1-confetti.png` });
});

await check('X: National Day flags and fireworks, then «شيل الزينة» clears the screen', async () => {
  await xhear('زينة العيد الوطني', 2600);
  const flags = await xpage.evaluate(() => window.__khalfoun.effects.parts.filter((p) => p.kind === 'flag').length);
  assert(flags === 7, `flags: ${flags}`);
  await xpage.screenshot({ path: `${outDir}/x2-national.png` });
  await xhear('شيل الزينة', 400);
  assert(await xpage.evaluate(() => !document.querySelector('.fx-canvas').classList.contains('on')), 'effects still on');
});

await check('X: every effect starts and draws without errors', async () => {
  for (const name of ['fireworks', 'rain', 'snow', 'lanterns', 'balloons', 'stars', 'hearts', 'bubbles']) {
    const ok = await xpage.evaluate((n) => window.__khalfoun.effects.play(n), name);
    assert(ok, name);
    await xpage.waitForTimeout(700);
    if (name === 'lanterns') await xpage.screenshot({ path: `${outDir}/x3-lanterns.png` });
  }
  await xpage.evaluate(() => window.__khalfoun.effects.stop());
});

await check('X: the name wheel spins and names the student only when it stops', async () => {
  await xhear('لف العجلة', 300);
  assert(await xpage.locator('.wheel-box').isVisible(), 'no wheel');
  const early = await xpage.evaluate(() => document.getElementById('bubble').hidden || !/العجلة|الدور|الحظ/.test(document.getElementById('bubble-text').textContent));
  assert(early, 'name said before the wheel stopped');
  await xpage.waitForTimeout(2600);
  await xpage.screenshot({ path: `${outDir}/x4-wheel-spinning.png` });
  await xpage.waitForTimeout(3400);
  const label = await xpage.locator('.wheel-label').textContent();
  const said = await xbubble();
  assert(said.includes(label), `wheel ${label} vs bubble ${said}`);
  await xpage.screenshot({ path: `${outDir}/x5-wheel-done.png` });
  // The slice under the pointer is the chosen name.
  const under = await xpage.evaluate(() => {
    const disc = document.querySelector('.wheel-disc');
    const m = /rotate\(([-\d.]+)deg\)/.exec(disc.style.transform);
    const names = [...disc.querySelectorAll('.wheel-name')].map((t) => t.textContent);
    const deg = ((360 - (Number(m[1]) % 360)) % 360);
    return names[Math.floor(deg / (360 / names.length))];
  });
  assert(under === label, `pointer at ${under}, label ${label}`);
  await xpage.click('.wheel-box');
});

await check('X: the camel race board moves the right camel and crowns the winner', async () => {
  await xhear('ابدأ سباق الهجن', 500);
  assert(await xpage.locator('.race-board').isVisible(), 'no race board');
  await xhear('نقطة للفريق الثاني', 300);
  await xhear('نقطة للفريق الثاني', 300);
  const scores = await xpage.locator('.race-score').allTextContents();
  assert(scores.join(',') === '٠,٢', scores.join(','));
  await xpage.waitForTimeout(900);
  await xpage.screenshot({ path: `${outDir}/x6-race.png` });
  for (let i = 0; i < 8; i += 1) await xpage.evaluate(() => window.__khalfoun.hear('نقطة للفريق الثاني'));
  await xpage.waitForTimeout(800);
  assert(await xpage.locator('.race-lane.winner').count() === 1, 'no winner lane');
  assert(/فاز|أبطال/.test(await xbubble()), await xbubble());
  await xpage.click('.race-board .race-close');
  assert(await xpage.locator('.race-board').count() === 0, 'race board still there');
  await xpage.evaluate(() => window.__khalfoun.effects.stop());
});

await check('X: «وضع الصف» makes Khalfoun big and the bubble bigger, «صغر نفسك» undoes it', async () => {
  await xhear('وضع الصف', 3000);
  const big = await xpage.evaluate(() => ({ cls: document.documentElement.classList.contains('classmode'), tf: document.getElementById('stage').style.transform, h: document.getElementById('stage').getBoundingClientRect().height }));
  assert(big.cls && /scale\(1\.9\)/.test(big.tf) && big.h > 350, JSON.stringify(big));
  await xpage.screenshot({ path: `${outDir}/x7-classmode.png` });
  await xhear('صغر نفسك', 500);
  assert(await xpage.evaluate(() => !document.documentElement.classList.contains('classmode')), 'still class mode');
});

await check('X: the guide lists the commands and a click puts one in the command box', async () => {
  await xhear('الدليل', 500);
  assert(await xpage.locator('#guide').isVisible(), 'guide hidden');
  const n = await xpage.locator('.guide-cmd').count();
  assert(n > 30, `only ${n} commands`);
  await xpage.screenshot({ path: `${outDir}/x8-guide.png` });
  await xpage.locator('.guide-cmd', { hasText: 'لف العجلة' }).click();
  assert(await xpage.locator('#guide').isHidden(), 'guide still open');
  assert((await xpage.inputValue('#command-input')) === 'لف العجلة', await xpage.inputValue('#command-input'));
  await xpage.keyboard.press('Escape');
});

await check('X: «حل من الكاميرا» opens the camera, sends a photo, shows the answer', async () => {
  await xpage.evaluate(() => { window.__fakeCamera = { ok: true, text: 'السؤال: ٢ + ٣\nالحل:\n١. نجمع ٢ و ٣\nالجواب: ٥', saved: true }; });
  await xhear('حل من الكاميرا', 1800);
  assert(await xpage.locator('.camera-panel').isVisible(), 'no camera panel');
  await untilOn(xpage, () => document.querySelector('.camera-video')?.videoWidth > 0, 8000);
  await xpage.click('.camera-panel button.primary');
  await untilOn(xpage, () => document.querySelector('.camera-answer') && !document.querySelector('.camera-answer').hidden, 5000);
  assert(/الجواب: ٥/.test(await xpage.locator('.camera-answer').textContent()), 'no answer');
  const sent = await xpage.evaluate(() => window.__khalfoun.bridge._chatCalls.find((c) => c.camera));
  assert(sent && sent.bytes > 1000, JSON.stringify(sent));
  await xpage.waitForTimeout(1200);
  assert(/دفتر/.test(await xbubble()), await xbubble());
  await xpage.screenshot({ path: `${outDir}/x9-camera.png` });
  await xpage.keyboard.press('Escape');
  assert(await xpage.locator('.camera-panel').count() === 0, 'camera panel still open');
  // The camera is released.
  assert(await xpage.evaluate(() => !window.__khalfoun.cameraPanel.stream), 'camera still on');
});

await check('X: the voice test runs sentence by sentence and scores what was understood', async () => {
  await xpage.evaluate(() => { window.__fakeTranscripts = ['افتح الحاسبة', 'ارفع الصوت', 'شي ثاني']; });
  await xhear('اختبر السمع', 600);
  assert(await xpage.locator('.voice-test').isVisible(), 'no voice test');
  for (let i = 0; i < 3; i += 1) {
    await xpage.click('.voice-test button.primary');
    await untilOn(xpage, new Function(`return document.querySelectorAll('.vt-list li').length >= ${i + 1}`), 20000);
  }
  const items = await xpage.locator('.vt-list li').allTextContents();
  assert(items[0].startsWith('✓') && items[1].startsWith('✓') && items[2].startsWith('✗'), items.join(' | '));
  for (let i = 3; i < 12; i += 1) await xpage.click('.voice-test button:has-text("تخطّ")');
  await xpage.waitForTimeout(400);
  assert(/فهمت ٦٧٪/.test(await xpage.locator('.vt-phrase').textContent()), await xpage.locator('.vt-phrase').textContent());
  await xpage.screenshot({ path: `${outDir}/x10-voicetest.png` });
  await xpage.keyboard.press('Escape');
});

await check('X: push-to-talk beeps and shows «سمعتك» with what was heard', async () => {
  await xpage.evaluate(() => { window.__fakeTranscripts = ['كم الساعة']; window.__khalfoun.sounds.setEnabled(true); window.__khalfoun.sounds.played = 0; });
  await xpage.click('#stage', { position: { x: 85, y: 100 } }).catch(() => {});
  await xpage.evaluate(() => document.getElementById('mic').click());
  await untilOn(xpage, () => !document.getElementById('heard').hidden, 20000);
  assert(/سمعتك: «كم الساعة»/.test(await xpage.locator('#heard').textContent()), await xpage.locator('#heard').textContent());
  assert(await xpage.evaluate(() => window.__khalfoun.sounds.played) >= 4, 'no beeps');
});

await check('X: the noise meter listens, shows a gauge and stops', async () => {
  await xhear('مقياس الهدوء', 1500);
  assert(await xpage.locator('.noise-box').isVisible(), 'no meter');
  assert(await xpage.evaluate(() => window.__khalfoun.noise.active), 'meter not active');
  await xpage.screenshot({ path: `${outDir}/x11-noise.png` });
  await xhear('وقف مقياس الهدوء', 300);
  assert(await xpage.locator('.noise-box').count() === 0, 'meter still shown');
});

await check('X: attendance by voice and the day list', async () => {
  await xhear('غايب أحمد ومريم', 400);
  assert(/أحمد/.test(await xbubble()) && /مريم/.test(await xbubble()), await xbubble());
  await xhear('منو غايب اليوم', 400);
  assert(/الغياب \(٢\)/.test(await xbubble()), await xbubble());
});

// The reading-aloud window (its own page).
const rpage = await browser.newPage({ viewport: { width: 1180, height: 780 } });
rpage.on('pageerror', (e) => problems.push(`reading page error: ${e.message}`));
rpage.on('console', (m) => { if (m.type() === 'error') problems.push(`reading console: ${m.text()}`); });
await rpage.goto(`${base}src/reading/index.html`);
await rpage.waitForFunction(() => window.__readingReady === true, null, { timeout: 10000 });

await check('X: the reading check records a student and marks the words', async () => {
  await rpage.selectOption('#samples', '1');
  await rpage.fill('#student', 'مريم');
  assert(!(await rpage.isDisabled('#go')), 'start disabled with a passage');
  await rpage.click('#go');
  assert(await rpage.locator('#step-read').isVisible(), 'reading step hidden');
  await rpage.click('#rec');
  await rpage.waitForTimeout(3500);
  await rpage.screenshot({ path: `${outDir}/x12-reading-rec.png` });
  await rpage.click('#rec');
  await rpage.waitForFunction(() => !document.getElementById('step-result').hidden, null, { timeout: 10000 });
  const r = await rpage.evaluate(() => window.__rdResult);
  assert(r.total > 20 && r.accuracy < 100 && r.accuracy > 80, JSON.stringify({ total: r.total, acc: r.accuracy }));
  assert(await rpage.locator('#res-words .w.bad').count() >= 2, 'no marked words');
  assert(/مريم/.test(await rpage.locator('#history').textContent()), 'no history');
  await rpage.screenshot({ path: `${outDir}/x13-reading-result.png`, fullPage: true });
});

// ------------------------------------------------------------------ writing, drawing, the voice session
const opage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
opage.on('pageerror', (e) => problems.push(`office page error: ${e.message}`));
opage.on('console', (m) => { if (m.type() === 'error') problems.push(`office console: ${m.text()}`); });
await opage.goto(`${base}?fakevoice=1`);
await opage.evaluate(() => {
  localStorage.setItem('khalfoun.settings', JSON.stringify({ onboarded: true, level: 3, kidsMode: false }));
  localStorage.setItem('khalfoun.memory', JSON.stringify({ name: 'عبدالرحيم', humor: 1 }));
});
await opage.reload();
await opage.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 15000 });
const obubble = () => opage.locator('#bubble-text').textContent();
const ohear = async (t, wait = 700) => { await opage.evaluate((s) => window.__khalfoun.hear(s), t); await opage.waitForTimeout(wait); };
const lastAction = () => opage.evaluate(() => { const a = window.__khalfoun.bridge._actions; return a[a.length - 1] || null; });

await check('W: «اكتب فقرة عن النخلة في الوورد» asks the cloud brain, then writes a Word document', async () => {
  await ohear('اكتب فقرة عن النخلة في الوورد', 2200);
  const call = await opage.evaluate(() => window.__khalfoun.bridge._chatCalls.find((c) => c.compose));
  assert(call && call.compose === 'text' && call.topic === 'النخلة', JSON.stringify(call));
  const a = await lastAction();
  assert(a && a.type === 'office_put' && a.params.app === 'word' && a.params.plan.blocks[0].text.includes('النخلة'), JSON.stringify(a));
  assert(/ملف جديد|الوورد/.test(await obubble()), await obubble());
});

await check('W: «افتح الوورد واكتب فقرة عن الماء» waits for Word before writing', async () => {
  await opage.evaluate(() => { window.__khalfoun.bridge._actions.length = 0; });
  await ohear('افتح الوورد واكتب فقرة عن الماء', 4200);
  const types = await opage.evaluate(() => window.__khalfoun.bridge._actions.map((x) => x.type));
  assert(types[0] === 'open_app' && types.includes('office_put'), types.join(','));
});

await check('W: drawing with no Office open lands on the screen in a hand-drawn style', async () => {
  await ohear('ارسم ٣ نجوم صفرا', 1500);
  const n = await opage.evaluate(() => window.__khalfoun.ink.items.filter((i) => i.kind === 'shape').length);
  assert(n === 3, `shapes on screen: ${n}`);
  assert(await opage.evaluate(() => document.querySelector('.ink-canvas').classList.contains('on')), 'ink hidden');
  await ohear('اكتب على الشاشة مرحبا يا طلاب', 1800);
  await ohear('اكتب معادلة س زائد اثنين يساوي خمسة', 2000);
  const texts = await opage.evaluate(() => window.__khalfoun.ink.items.filter((i) => i.kind === 'text').map((i) => i.text));
  assert(texts.includes('مرحبا يا طلاب') && texts.includes('س + ٢ = ٥'), texts.join(' | '));
  await opage.screenshot({ path: `${outDir}/w1-screen-ink.png` });
});

await check('W: «دور عليه» with no Office circles the spot under the mouse', async () => {
  await opage.mouse.move(900, 300);
  await ohear('دور عليه', 1200);
  const c = await opage.evaluate(() => window.__khalfoun.ink.items.at(-1));
  assert(c.kind === 'shape' && c.outline && Math.abs(c.x - 900) < 2 && Math.abs(c.y - 300) < 2, JSON.stringify(c));
});

await check('W: pen mode: the teacher draws with the mouse, then «امسح الشاشة» clears everything', async () => {
  await ohear('قلم', 600);
  assert(await opage.locator('.ink-bar').isVisible(), 'no pen toolbar');
  await opage.mouse.move(500, 500);
  await opage.mouse.down();
  for (let i = 1; i <= 10; i += 1) await opage.mouse.move(500 + i * 20, 500 - i * 8);
  await opage.mouse.up();
  const strokes = await opage.evaluate(() => window.__khalfoun.ink.items.filter((i) => i.kind === 'stroke').length);
  assert(strokes === 1, `strokes: ${strokes}`);
  await opage.screenshot({ path: `${outDir}/w2-pen.png` });
  await opage.keyboard.press('Escape');
  await opage.waitForTimeout(400);
  assert(await opage.locator('.ink-bar').count() === 0, 'toolbar still open');
  await ohear('امسح الشاشة', 400);
  assert(await opage.evaluate(() => window.__khalfoun.ink.items.length === 0), 'ink not cleared');
});

await check('W: «يا خلفون» opens a voice session: commands follow without his name until «خلاص»', async () => {
  await opage.evaluate(() => { window.__khalfoun.bridge._actions.length = 0; window.__fakeTranscripts = ['يا خلفون', 'افتح الحاسبة', 'ارسم دايرة زرقا', 'خلاص']; });
  const wav = () => opage.evaluate(() => window.__khalfoun.onWakeSentence(new Uint8Array(3200)));
  await wav();
  await opage.waitForTimeout(400);
  assert(await opage.evaluate(() => window.__khalfoun.inSession), 'no session');
  assert(await opage.locator('#session-chip').isVisible(), 'no session chip');
  await opage.screenshot({ path: `${outDir}/w3-session.png` });
  await wav();
  await opage.waitForTimeout(900);
  await wav();
  await opage.waitForTimeout(1200);
  const types = await opage.evaluate(() => window.__khalfoun.bridge._actions.map((x) => x.type));
  assert(types.includes('open_app') && types.includes('office_draw'), types.join(','));
  await wav();
  await opage.waitForTimeout(500);
  assert(await opage.evaluate(() => !window.__khalfoun.inSession), 'session still open after «خلاص»');
  assert(await opage.locator('#session-chip').isHidden(), 'chip still shown');
});

await check('W: words outside a session are only checked for his name', async () => {
  await opage.evaluate(() => { window.__khalfoun.bridge._actions.length = 0; window.__fakeTranscripts = ['افتح الحاسبة']; });
  await opage.evaluate(() => window.__khalfoun.onWakeSentence(new Uint8Array(3200)));
  await opage.waitForTimeout(600);
  const types = await opage.evaluate(() => window.__khalfoun.bridge._actions.map((x) => x.type));
  assert(!types.includes('open_app'), types.join(','));
});

await browser.close();
server.close();
if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`\nكل الفحوصات نجحت (${step}). الصور في ${outDir}/`);
