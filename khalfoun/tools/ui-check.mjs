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
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${micFile}`] });
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
  await page.evaluate(() => window.__khalfoun.preview.move('notes', 140, 520));
  await page.waitForTimeout(1600);
  const st = await page.evaluate(() => ({ support: window.__khalfoun.motion.support, mode: window.__khalfoun.motion.mode }));
  assert(!st.support || st.support.y !== 300, JSON.stringify(st));
  const text = await bubble();
  assert(/النافذة|فوق|حرّك|وااا|آخ|سلام|شفت/.test(text), `bubble: ${text}`);
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
  assert(/سلامتك|العافية|استراحة|ارتاح|تمشّى|التعب/.test(await bubble()), `tired: ${await bubble()}`);
  await hear('نجحت في الامتحان', 1200);
  assert(/مبروك|بطل|تبارك/.test(await bubble()), `success: ${await bubble()}`);
  await page.evaluate(() => window.__khalfoun.motion.paused = false);
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
  await vpage.evaluate(() => { window.__fakeTranscripts = ['يا خلفون', 'كم الساعة']; window.__khalfoun.bridge._transcribeCalls.length = 0; });
  const ok = await until("window.__khalfoun.bridge._transcribeCalls.some((c) => c.purpose === 'command')", 25000);
  assert(ok, `never listened for a command: ${JSON.stringify(await vpage.evaluate(() => window.__khalfoun.bridge._transcribeCalls))}`);
  await vpage.waitForTimeout(1500);
  assert(/[٠-٩]/.test(await vbubble()), `bubble: ${await vbubble()}`);
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
  assert(/فهمت|وصلتني|تعلمتها|أذني|وضّح|وضح|صعب/.test(await cbubble()), `fallback: ${await cbubble()}`);
});

await browser.close();
server.close();
if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`\nكل الفحوصات نجحت (${step}). الصور في ${outDir}/`);
