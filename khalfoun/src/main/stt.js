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
const WAKE_PREFERENCE = ['ggml-base.bin', 'ggml-tiny.bin'];
/**
 * Words given to whisper as context so it expects common commands. The name is
 * deliberately left out: whisper can echo its prompt on noise, and an echoed
 * name would wake him by mistake.
 */
export const PROMPT = 'افتح، دور لي عن، اكتب، ذكرني، كم الساعة، شغل يوتيوب.';
const ECHO = /افتح\s*،?\s*دور لي عن\s*،?\s*اكتب/;

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
  // A small, fast model is used for spotting the wake word when one is present.
  let wakeModel = model;
  for (const dir of dirs) {
    let files = [];
    try { files = await readdir(dir); } catch { continue; }
    const small = WAKE_PREFERENCE.find((n) => files.includes(n));
    if (small) { wakeModel = join(dir, small); break; }
  }
  return { available: Boolean(bin && model), bin, model, wakeModel: model ? wakeModel : null };
}

/**
 * Sentences whisper is known to invent from silence or background noise in Arabic
 * (subtitle credits and channel outros it learned from videos). Heard alone, they
 * are noise, not something the person said.
 */
const HALLUCINATIONS = [
  /اشتركو?ا? (?:في|ب)\s*(?:ال)?قنا[ةه]/u, /لا تنسوا? (?:ال)?اشتراك/u, /نانسي\s*قنقر/u, /ترجم[ةه]\s*(?:نانسي|و?تدقيق)/u,
  /^شكر[اًا]* (?:لكم )?(?:على|لل)\s*(?:ال)?مشاهد[ةه]/u, /^(?:ال)?مترجم\s*[:：]/u, /amara\.org/i, /subtitles? by/i,
  /^(?:موسيقى|موسيقي)[\s.!،]*$/u, /^[\s.!،؟?…-]*$/u,
];

/** True when the whole transcript is one of whisper's made-up noise sentences. */
export function isHallucination(text) {
  const t = String(text || '').trim();
  return HALLUCINATIONS.some((re) => re.test(t));
}

/** Removes whisper's bracketed noise tags like [موسيقى] or (applause). */
export function cleanTranscript(text) {
  return String(text || '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {{bin: string, model: string, wakeModel?: string}} whisper
 * @param {Uint8Array} wav 16 kHz mono WAV
 * @param {{run?: typeof execFile, threads?: number, purpose?: 'command'|'wake', words?: string[]}} [opts]
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
    const model = opts.purpose === 'wake' && whisper.wakeModel ? whisper.wakeModel : whisper.model;
    // The person's own words (taught phrases) help whisper spell them the same way.
    const extra = (opts.words || []).filter((w) => typeof w === 'string' && w.trim()).slice(0, 12).join('، ');
    const prompt = extra ? `${PROMPT} ${extra}.`.slice(0, 400) : PROMPT;
    const args = ['-m', model, '-l', 'ar', '-f', file, '-nt', '-np', '-t', String(opts.threads || 4), '--prompt', prompt];
    const text = await new Promise((resolve, reject) => {
      run(whisper.bin, args, { windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err) reject(err);
        else resolve(String(stdout || ''));
      });
    });
    const clean = cleanTranscript(text);
    return { ok: true, text: ECHO.test(clean) || isHallucination(clean) ? '' : clean };
  } catch (err) {
    return { ok: false, error: `stt_failed: ${err?.message || err}` };
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
