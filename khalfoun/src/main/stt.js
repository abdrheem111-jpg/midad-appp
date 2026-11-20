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

/** Seconds of audio in a 16 kHz mono 16-bit WAV. */
export function wavSeconds(wav) {
  return Math.max(0, (wav.length - 44) / 32000);
}

/**
 * @param {{bin: string, model: string, wakeModel?: string}} whisper
 * @param {Uint8Array} wav 16 kHz mono WAV
 * @param {{run?: typeof execFile, threads?: number, purpose?: 'command'|'wake'|'reading', words?: string[],
 *   fast?: boolean, now?: () => number}} [opts] fast: use the small, quick model and greedy decoding
 * @returns {Promise<{ok: true, text: string, ms: number, model: string} | {ok: false, error: string}>}
 */
export async function transcribe(whisper, wav, opts = {}) {
  if (!whisper?.bin || !whisper?.model) return { ok: false, error: 'stt_unavailable' };
  if (!(wav instanceof Uint8Array) || wav.length < 44 || wav.length > 8 * 1024 * 1024) return { ok: false, error: 'bad_audio' };
  const run = opts.run || execFile;
  const dir = await mkdtemp(join(tmpdir(), 'khalfoun-'));
  const file = join(dir, 'speech.wav');
  try {
    await writeFile(file, wav);
    const now = opts.now || (() => Date.now());
    const started = now();
    const quick = whisper.wakeModel || whisper.model;
    const fast = opts.purpose === 'wake' || opts.fast;
    const model = fast ? quick : whisper.model;
    // Short sentences finish in seconds; the limit only stops a stuck process. A longer
    // clip on a slow computer gets more time.
    const limit = Math.round(Math.min(120000, 30000 + wavSeconds(wav) * 6000));
    // The person's own words (taught phrases) help whisper spell them the same way.
    const extra = (opts.words || []).filter((w) => typeof w === 'string' && w.trim()).slice(0, 12).join('، ');
    const prompt = extra ? `${PROMPT} ${extra}.`.slice(0, 400) : PROMPT;
    const args = (m) => ['-m', m, '-l', 'ar', '-f', file, '-nt', '-np'];
    // Greedy decoding (one candidate instead of five) is several times faster on a CPU.
    const greedy = ['-bs', '1', '-bo', '1'];
    const once = (a, ms) => new Promise((resolve, reject) => {
      const t0 = now();
      run(whisper.bin, a, { windowsHide: true, timeout: ms, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          // Keep why it failed: «Command failed» alone does not say.
          const tail = String(stderr || '').replace(/\s+/g, ' ').trim().slice(-300);
          const secs = ((now() - t0) / 1000).toFixed(1);
          const why = err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'output too long'
            : err.killed ? `too slow, stopped after ${secs} s` : `exit ${err.code ?? '?'} after ${secs} s`;
          reject(new Error(`${why}${tail ? `: ${tail}` : ''}`));
        } else resolve(String(stdout || ''));
      });
    });
    let text;
    let used = model;
    try {
      // A student reading a passage is not a command: no command hints for whisper.
      const hint = opts.purpose === 'reading' ? [] : ['--prompt', prompt];
      text = await once([...args(model), ...(fast ? greedy : []), '-t', String(opts.threads || 4), ...hint], limit);
    } catch (first) {
      // Seen on a teacher's PC: the accurate model was too slow and every sentence was lost.
      // Try again with the quick model, greedy and without the prompt before giving up.
      used = quick;
      try {
        text = await once([...args(quick), ...greedy, '-t', String(opts.threads || 4)], limit);
      } catch (second) {
        throw new Error(`${first.message} | retry: ${second.message}`);
      }
    }
    const clean = cleanTranscript(text);
    return { ok: true, text: ECHO.test(clean) || isHallucination(clean) ? '' : clean, ms: now() - started, model: used };
  } catch (err) {
    return { ok: false, error: `stt_failed: ${err?.message || err}` };
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
