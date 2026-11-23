// Getting Claude's program onto the computer, once, with a button: the official Windows build
// of the Claude Agent SDK (the same `claude` program as Claude Code) from the npm registry,
// pinned to a version and checked against its SHA-256 before it is unpacked. It is too big
// (388 MB) to ship inside Khalfoun's installer.

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createGunzip } from 'node:zlib';
import { downloadVerified } from '../setup.js';

export const CLAUDE_PROGRAM = {
  version: '0.3.330', // Claude Code 2.1.330
  win32: {
    url: 'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-win32-x64/-/claude-agent-sdk-win32-x64-0.3.330.tgz',
    sha256: 'dc35f4a7826cfa5297b99836cba971058b0590c670c03a3d04e9f78b0df33243',
    size: 178243062,
    entry: 'package/claude.exe',
    file: 'claude.exe',
  },
};

/** Where Khalfoun keeps Claude's program. */
export function claudeDir(userData) {
  return join(userData, 'claude', CLAUDE_PROGRAM.version);
}

export function claudeExePath(userData, platform = process.platform) {
  const p = CLAUDE_PROGRAM[platform];
  return p ? join(claudeDir(userData), p.file) : null;
}

export async function claudeInstalled(userData, platform = process.platform) {
  const exe = claudeExePath(userData, platform);
  if (!exe) return false;
  try { return (await stat(exe)).size > 50e6; } catch { return false; }
}

/**
 * Streams one file out of a .tgz to `dest` (no whole archive in memory).
 * Plain ustar/pax entries, as npm packs them.
 */
export function extractFromTgz(tgzPath, entryName, dest) {
  return new Promise((resolve, reject) => {
    const gunzip = createGunzip();
    const src = createReadStream(tgzPath);
    let buf = Buffer.alloc(0);
    let skip = 0; // bytes of the current entry still to skip (data + padding)
    let out = null;
    let left = 0; // bytes of the wanted entry still to write
    let pad = 0;
    let found = false;
    let finished = false;
    let longName = null;
    const fail = (err) => { if (finished) return; finished = true; src.destroy(); gunzip.destroy(); out?.destroy(); reject(err); };
    const done = () => {
      if (finished) return;
      finished = true;
      src.destroy(); gunzip.destroy();
      out.end(() => resolve(dest));
    };
    gunzip.on('data', (chunk) => {
      if (finished) return;
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      for (;;) {
        if (out && left > 0) {
          if (!buf.length) return;
          const take = Math.min(left, buf.length);
          if (!out.write(buf.subarray(0, take))) { gunzip.pause(); out.once('drain', () => gunzip.resume()); }
          buf = buf.subarray(take);
          left -= take;
          if (left > 0) return;
          done();
          return;
        }
        if (skip > 0) {
          const take = Math.min(skip, buf.length);
          buf = buf.subarray(take);
          skip -= take;
          if (skip > 0) return;
        }
        if (buf.length < 512) return;
        const header = buf.subarray(0, 512);
        buf = buf.subarray(512);
        if (header.every((b) => b === 0)) { fail(new Error('entry_not_found')); return; }
        const field = (o, l) => header.subarray(o, o + l).toString('utf8').replace(/\0.*$/s, '');
        const size = parseInt(field(124, 12).trim() || '0', 8);
        const type = String.fromCharCode(header[156] || 48);
        const prefix = field(345, 155);
        let name = longName || (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
        longName = null;
        pad = (512 - (size % 512)) % 512;
        if (type === 'L') {
          // GNU long name: the next entry's name is the data of this one
          if (buf.length < size + pad) { buf = Buffer.concat([header, buf]); return; }
          longName = buf.subarray(0, size).toString('utf8').replace(/\0.*$/s, '');
          buf = buf.subarray(size + pad);
          continue;
        }
        if ((type === '0' || type === '\0') && name === entryName) {
          found = true;
          out = createWriteStream(dest, { mode: 0o755 });
          out.on('error', fail);
          left = size;
          if (!size) { done(); return; }
          continue;
        }
        skip = size + pad;
        name = null;
      }
    });
    gunzip.on('end', () => { if (!found) fail(new Error('entry_not_found')); });
    gunzip.on('error', fail);
    src.on('error', fail);
    src.pipe(gunzip);
  });
}

/**
 * Downloads (resuming), checks and unpacks Claude's program.
 * @param {{userData: string, platform?: string, fetchFn?: typeof fetch, signal?: AbortSignal,
 *   onProgress?: (done: number, total: number, phase: string) => void, program?: object}} o
 */
export async function installClaude(o) {
  const platform = o.platform || process.platform;
  const p = o.program || CLAUDE_PROGRAM[platform];
  if (!p) throw new Error('unsupported');
  const dir = claudeDir(o.userData);
  await mkdir(dir, { recursive: true });
  const exe = join(dir, p.file);
  if (await claudeInstalled(o.userData, platform) && !o.program) return exe;
  const tgz = join(dir, 'package.tgz');
  await downloadVerified({
    url: p.url, dest: tgz, sha256: p.sha256, size: p.size, fetchFn: o.fetchFn, signal: o.signal,
    onProgress: (d, t) => o.onProgress?.(d, t, 'download'),
  });
  o.onProgress?.(p.size, p.size, 'unpack');
  const tmp = `${exe}.part`;
  await extractFromTgz(tgz, p.entry, tmp);
  await rename(tmp, exe);
  await rm(tgz, { force: true });
  return exe;
}
