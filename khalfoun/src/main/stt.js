// Speech to text with whisper.cpp, fully offline. The program and a model file
// are looked for in this order:
//   1. KHALFOUN_WHISPER_BIN and KHALFOUN_WHISPER_MODEL environment variables
//   2. <userData>/voice/  (whisper-cli[.exe] or main[.exe], and any ggml-*.bin)
//   3. <app>/voice/       (same names, for a bundled install)
// Without them, voice is reported as unavailable and Khalfoun asks to type.

import { execFile } from 'node:child_process';
import { access, readdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN_NAMES = ['whisper-cli.exe', 'whisper-cli', 'main.exe', 'main', 'whisper.exe', 'whisper'];
const MODEL_PREFERENCE = ['ggml-large-v3-turbo.bin', 'ggml-medium.bin', 'ggml-small.bin', 'ggml-base.bin', 'ggml-tiny.bin'];

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function findIn(dir) {
  let bin = null;
  for (const n of BIN_NAMES) if (await exists(join(dir, n))) { bin = join(dir, n); break; }
  let model = null;
  let files = [];
  try { files = await readdir(dir); } catch { /* missing folder */ }
  for (const n of MODEL_PREFERENCE) if (files.includes(n)) { model = join(dir, n); break; }
  if (!model) {
    const any = files.find((f) => /^ggml-.*\.bin$/i.test(f));
    if (any) model = join(dir, any);
  }
  return { bin, model };
}

/**
 * @param {{dirs: string[], env?: NodeJS.ProcessEnv}} opts
 * @returns {Promise<{available: boolean, bin: string|null, model: string|null}>}
 */
export async function findWhisper({ dirs, env = process.env }) {
  let bin = env.KHALFOUN_WHISPER_BIN || null;
  let model = env.KHALFOUN_WHISPER_MODEL || null;
  if (bin && !(await exists(bin))) bin = null;
  if (model && !(await exists(model))) model = null;
  for (const dir of dirs) {
    if (bin && model) break;
    const found = await findIn(dir);
    bin = bin || found.bin;
    model = model || found.model;
  }
  return { available: Boolean(bin && model), bin, model };
}

/** Removes whisper's bracketed noise tags like [موسيقى] or (applause). */
export function cleanTranscript(text) {
  return String(text || '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {{bin: string, model: string}} whisper
 * @param {Uint8Array} wav 16 kHz mono WAV
 * @param {{run?: typeof execFile, threads?: number}} [opts]
 * @returns {Promise<{ok: true, text: string} | {ok: false, error: string}>}
 */
export async function transcribe(whisper, wav, opts = {}) {
  if (!whisper?.bin || !whisper?.model) return { ok: false, error: 'stt_unavailable' };
  if (!(wav instanceof Uint8Array) || wav.length < 44 || wav.length > 8 * 1024 * 1024) return { ok: false, error: 'bad_audio' };
  const run = opts.run || execFile;
  const dir = await mkdtemp(join(tmpdir(), 'khalfoun-'));
  const file = join(dir, 'speech.wav');
  try {
    await writeFile(file, wav);
    const args = ['-m', whisper.model, '-l', 'ar', '-f', file, '-nt', '-np', '-t', String(opts.threads || 4)];
    const text = await new Promise((resolve, reject) => {
      run(whisper.bin, args, { windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err) reject(err);
        else resolve(String(stdout || ''));
      });
    });
    return { ok: true, text: cleanTranscript(text) };
  } catch (err) {
    return { ok: false, error: `stt_failed: ${err?.message || err}` };
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
