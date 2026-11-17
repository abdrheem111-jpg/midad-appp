// Launches the real desktop app in self-test mode with a throwaway profile and
// reports each step. On Linux without a display it uses xvfb-run if present.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('..', import.meta.url));
const electron = createRequire(import.meta.url)('electron');
const userData = await mkdtemp(join(tmpdir(), 'khalfoun-smoke-'));
const env = { ...process.env, KHALFOUN_SMOKE: '1', KHALFOUN_USER_DATA: userData };
delete env.NODE_OPTIONS;
const args = [root];
let cmd = electron;
if (process.platform === 'linux') {
  args.push('--no-sandbox', '--disable-gpu');
  if (!process.env.DISPLAY) { args.unshift('-a', '-s', '-screen 0 1280x800x24', electron); cmd = 'xvfb-run'; }
}
const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { out += d; });
const timer = setTimeout(() => child.kill('SIGKILL'), 90000);
child.on('close', async (code) => {
  clearTimeout(timer);
  await rm(userData, { recursive: true, force: true });
  const line = out.split('\n').find((l) => l.startsWith('KHALFOUN_SMOKE '));
  if (!line) { console.error(out.slice(-3000)); console.error('لم يكتمل الفحص.'); process.exit(1); }
  const report = JSON.parse(line.slice('KHALFOUN_SMOKE '.length));
  for (const s of report.steps) console.log(`${s.ok ? 'ok' : 'not ok'} - ${s.name}`);
  for (const e of report.errors) console.log(`error: ${e}`);
  console.log(report.ok ? '\nالتطبيق الحقيقي اشتغل ونجحت كل الخطوات.' : '\nفي خطوات فشلت.');
  process.exit(report.ok && code === 0 ? 0 : 1);
});
