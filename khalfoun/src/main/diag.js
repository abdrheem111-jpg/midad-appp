// A small diagnostics log on the person's own computer (never sent anywhere):
// what Khalfoun heard, what he decided, how each action went, and any errors.
// It lets the person open it from the tray and share it when something does
// not work. The file is capped; the previous part is kept as .old.

import { appendFile, rename, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';

const LIMIT = 512 * 1024;

export class DiagLog {
  /** @param {string} dir */
  constructor(dir, name = 'khalfoun-log.txt') {
    this.file = join(dir, name);
    this.queue = Promise.resolve();
  }

  /** Adds one line; never throws. */
  write(...parts) {
    const text = parts.map((p) => (typeof p === 'string' ? p : safeJson(p))).join(' ').replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 2000);
    const line = `${new Date().toISOString()} ${text}\n`;
    this.queue = this.queue.then(() => this.append(line)).catch(() => {});
    return this.queue;
  }

  async append(line) {
    try {
      if ((await stat(this.file)).size > LIMIT) {
        await rm(`${this.file}.old`, { force: true });
        await rename(this.file, `${this.file}.old`);
      }
    } catch { /* no file yet */ }
    await appendFile(this.file, line, 'utf8');
  }
}

function safeJson(value) {
  try { return JSON.stringify(value); } catch { return String(value); }
}
