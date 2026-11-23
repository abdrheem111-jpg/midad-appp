// Windows CI: installs Claude's program exactly as the «نزّل مخ Claude» button does (the
// pinned official package from npm, SHA-256 checked, unpacked), then runs it.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { installClaude, claudeInstalled } from '../src/main/brain/claude-setup.js';

const userData = await mkdtemp(join(tmpdir(), 'kh-claude-install-'));
let last = 0;
const exe = await installClaude({
  userData,
  onProgress: (done, total, phase) => {
    const pct = total ? Math.floor((done / total) * 10) * 10 : 0;
    if (pct !== last || phase === 'unpack') { last = pct; console.log(phase, `${pct}%`); }
  },
});
if (!(await claudeInstalled(userData))) { console.error('not installed'); process.exit(1); }
const version = execFileSync(exe, ['--version'], { encoding: 'utf8', env: { ...process.env, DISABLE_AUTOUPDATER: '1' } }).trim();
console.log('installed', exe, version);
// Not signed in exits with 1 and still prints the JSON (Khalfoun reads it either way).
const status = spawnSync(exe, ['auth', 'status', '--json'], { encoding: 'utf8', env: { ...process.env, DISABLE_AUTOUPDATER: '1' } });
console.log('auth status', status.status, String(status.stdout).replace(/\s+/g, ' ').slice(0, 200));
if (!/"loggedIn"/.test(String(status.stdout))) process.exit(1);
if (!/Claude Code/.test(version)) process.exit(1);
await rm(userData, { recursive: true, force: true });
console.log('ok');
