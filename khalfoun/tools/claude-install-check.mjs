// Windows CI: installs Claude's program exactly as the «نزّل مخ Claude» button does (the
// pinned official package from npm, SHA-256 checked, unpacked), then runs it.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
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
const status = execFileSync(exe, ['auth', 'status', '--json'], { encoding: 'utf8', env: { ...process.env, DISABLE_AUTOUPDATER: '1' } });
console.log('auth status', status.replace(/\s+/g, ' ').slice(0, 200));
if (!/Claude Code/.test(version)) process.exit(1);
await rm(userData, { recursive: true, force: true });
console.log('ok');
