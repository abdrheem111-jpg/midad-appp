// End-to-end check of the overlay page in a real Chromium (browser preview
// mode, where actions are simulated). Usage: node tools/ui-check.mjs [outDir]
// Needs Playwright: npm i -D playwright && npx playwright install chromium

import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
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
const browser = await chromium.launch();
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
  const end = await page.evaluate(() => ({ y: window.__khalfoun.motion.y, floor: window.__khalfoun.motion.floor, mode: window.__khalfoun.motion.mode }));
  assert(Math.abs(end.y - end.floor) < 1, `not on floor: ${JSON.stringify(end)}`);
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

await browser.close();
server.close();
if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`\nكل الفحوصات نجحت (${step}). الصور في ${outDir}/`);
