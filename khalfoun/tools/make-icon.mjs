// Renders Khalfoun's face to assets/icon.png (256x256, transparent). Needs Playwright.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const out = fileURLToPath(new URL('../assets/icon.png', import.meta.url));
const server = await startServer(0);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
await page.goto(`http://127.0.0.1:${server.address().port}/tools/icon.html`);
await page.waitForFunction(() => document.body.dataset.ready === '1');
await page.locator('#c').screenshot({ path: out, omitBackground: true });
await browser.close();
server.close();
console.log(`saved ${out}`);
