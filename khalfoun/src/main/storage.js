// Small JSON file store with atomic writes (write to a temp file, then rename)
// so a crash or power cut never leaves a half-written file.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export class JsonStore {
  /**
   * @param {string} dir folder (normally app.getPath('userData'))
   * @param {string} name file name, e.g. "memory.json"
   * @param {object} fallback value used when the file is missing or broken
   */
  constructor(dir, name, fallback) {
    this.file = join(dir, name);
    this.fallback = fallback;
    this.queue = Promise.resolve();
  }

  async read() {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      return data && typeof data === 'object' ? data : structuredClone(this.fallback);
    } catch {
      return structuredClone(this.fallback);
    }
  }

  /** Writes are serialized so two saves never interleave. */
  write(data) {
    this.queue = this.queue.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
      await rename(tmp, this.file);
    }).catch((err) => {
      console.error(`Could not save ${this.file}:`, err);
    });
    return this.queue;
  }
}
