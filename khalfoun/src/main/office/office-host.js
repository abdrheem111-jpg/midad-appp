// The connection to office-host.ps1: one PowerShell process that stays open (the first
// request takes a second or two, later ones are quick). Requests and answers are single
// lines of base64 JSON, matched by id.

import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IDLE_MS = 10 * 60000;

export class OfficeHost {
  /**
   * @param {{tempDir: string, platform?: string, spawnFn?: typeof spawn, log?: (...a: any[]) => void, timeoutMs?: number}} opts
   */
  constructor(opts) {
    this.tempDir = opts.tempDir;
    this.platform = opts.platform || process.platform;
    this.spawnFn = opts.spawnFn || spawn;
    this.log = opts.log || (() => {});
    this.timeoutMs = opts.timeoutMs || 45000;
    this.child = null;
    this.nextId = 1;
    this.waiting = new Map();
    this.buf = '';
    this.scriptPath = opts.scriptPath || join(HERE, 'office-host.ps1');
    this.copyName = opts.copyName || 'khalfoun-office-host.ps1';
    this.sta = opts.sta !== false;
  }

  get available() { return this.platform === 'win32'; }

  async start() {
    if (this.child) return this.child;
    const script = await readFile(this.scriptPath, 'utf8');
    await mkdir(this.tempDir, { recursive: true });
    // PowerShell cannot run a script from inside the app's archive, so it gets its own copy.
    const file = join(this.tempDir, this.copyName);
    await writeFile(file, `﻿${script}`, 'utf8');
    const child = this.spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...(this.sta ? ['-STA'] : []), '-File', file], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => this.onData(d));
    child.stderr?.on('data', (d) => this.log('office host stderr:', String(d).slice(0, 300)));
    const reset = (why) => {
      if (this.child !== child) return;
      this.child = null;
      for (const [, w] of this.waiting) w({ ok: false, error: `host_${why}` });
      this.waiting.clear();
    };
    child.on('exit', () => reset('exit'));
    child.on('error', () => reset('error'));
    this.child = child;
    return child;
  }

  onData(d) {
    this.buf += d;
    let nl;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(Buffer.from(line, 'base64').toString('utf8')); } catch { continue; }
      const w = this.waiting.get(msg.id);
      if (!w) continue;
      this.waiting.delete(msg.id);
      w(msg.ok ? { ok: true, data: msg.data } : { ok: false, error: String(msg.error || 'failed') });
    }
  }

  /** Sends one request; resolves {ok, data} or {ok:false, error}. */
  async call(op, args = {}, timeoutMs = this.timeoutMs) {
    if (!this.available) return { ok: false, error: 'unsupported' };
    let child;
    try { child = await this.start(); } catch (err) { return { ok: false, error: `host_start: ${err?.message || err}` }; }
    const id = this.nextId;
    this.nextId += 1;
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stop(), IDLE_MS);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.waiting.delete(id); resolve({ ok: false, error: 'timeout' }); }, timeoutMs);
      this.waiting.set(id, (res) => { clearTimeout(timer); resolve(res); });
      const line = Buffer.from(JSON.stringify({ id, op, args }), 'utf8').toString('base64');
      try { child.stdin.write(`${line}\n`); } catch { clearTimeout(timer); this.waiting.delete(id); resolve({ ok: false, error: 'host_write' }); }
    });
  }

  stop() {
    clearTimeout(this.idleTimer);
    const c = this.child;
    this.child = null;
    try { c?.stdin.end(); c?.kill(); } catch { /* gone */ }
  }
}
