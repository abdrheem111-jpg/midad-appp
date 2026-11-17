// One-click setup of Khalfoun's optional parts, started only by a button the
// person presses in the settings panel:
//   - the listening program (whisper.cpp) and a speech model, downloaded from
//     their official pages at pinned versions and checked by SHA-256 before use;
//   - a local chat model pulled through Ollama's own API on this computer.
// The page only sends a pack id; every address and checksum lives here.

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile, readFile, open } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const HF = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1';

/** whisper.cpp v1.8.2 for 64-bit Windows; only the files the command-line tool needs are kept. */
export const WHISPER_PROGRAM = {
  url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.2/whisper-bin-x64.zip',
  sha256: 'b1514ebc099765e39fa37eb780b92a140a94c86bb0b3b3d98226b38825979732',
  size: 3832432,
  files: ['whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu.dll'],
};

export const WHISPER_MODELS = {
  'ggml-base.bin': { url: `${HF}/ggml-base.bin`, sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe', size: 147951465 },
  'ggml-small.bin': { url: `${HF}/ggml-small.bin`, sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b', size: 487601967 },
  'ggml-large-v3-turbo-q5_0.bin': { url: `${HF}/ggml-large-v3-turbo-q5_0.bin`, sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2', size: 574041195 },
};

/** Choices shown to the person. The base model always comes along: it spots «يا خلفون» quickly. */
export const VOICE_PACKS = {
  light: { label: 'خفيف', models: ['ggml-base.bin'] },
  balanced: { label: 'متوازن', models: ['ggml-small.bin', 'ggml-base.bin'] },
  accurate: { label: 'دقيق', models: ['ggml-large-v3-turbo-q5_0.bin', 'ggml-base.bin'] },
};

export const BRAIN_MODELS = {
  standard: { model: 'qwen2.5:3b', label: 'عادي', approxMB: 1900 },
  strong: { model: 'qwen2.5:7b', label: 'قوي', approxMB: 4700 },
};

export const OLLAMA_URL = 'http://127.0.0.1:11434';
export const OLLAMA_DOWNLOAD_PAGE = 'https://ollama.com/download';

/** Total megabytes a voice pack downloads, counting only what is still missing. */
export function packSizeMB(packId, { haveProgram = false, haveModels = [] } = {}) {
  const pack = VOICE_PACKS[packId];
  if (!pack) return 0;
  let bytes = haveProgram ? 0 : WHISPER_PROGRAM.size;
  for (const m of pack.models) if (!haveModels.includes(m)) bytes += WHISPER_MODELS[m].size;
  return Math.round(bytes / 1e6);
}

async function fileSize(p) {
  try { return (await stat(p)).size; } catch { return -1; }
}

async function hashFile(p, hash) {
  const fh = await open(p, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, null);
      if (!bytesRead) break;
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    await fh.close();
  }
}

/**
 * Downloads `url` to `dest`, resuming a half-finished `.part` file when the
 * server allows it, and only renames it into place once the SHA-256 matches.
 * @param {{url: string, dest: string, sha256: string, size?: number, fetchFn?: typeof fetch,
 *   signal?: AbortSignal, onProgress?: (done: number, total: number) => void}} o
 */
export async function downloadVerified(o) {
  if (!/^https:\/\//.test(o.url) && !/^http:\/\/127\.0\.0\.1[:/]/.test(o.url)) throw new Error('insecure_url');
  const fetchFn = o.fetchFn || fetch;
  const part = `${o.dest}.part`;
  const hash = createHash('sha256');
  let have = Math.max(0, await fileSize(part));
  if (o.size && have > o.size) { await rm(part, { force: true }); have = 0; }
  const headers = have ? { range: `bytes=${have}-` } : {};
  const res = await fetchFn(o.url, { headers, signal: o.signal, redirect: 'follow' });
  if (res.status === 416 && have) {
    // Already complete on disk; the checksum below decides.
  } else if (!res.ok) {
    throw new Error(`http_${res.status}`);
  }
  const resumed = res.status === 206 && have > 0;
  if (resumed) await hashFile(part, hash);
  else if (res.status !== 416) have = 0;
  const lengthHeader = Number(res.headers.get('content-length')) || 0;
  const total = o.size || (resumed ? have + lengthHeader : lengthHeader) || 0;
  if (res.status !== 416) {
    const out = createWriteStream(part, { flags: resumed ? 'a' : 'w' });
    const done = new Promise((resolve, reject) => { out.on('finish', resolve); out.on('error', reject); });
    let got = have;
    let lastReport = 0;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        hash.update(value);
        got += value.length;
        if (!out.write(value)) await new Promise((r) => out.once('drain', r));
        const now = Date.now();
        if (o.onProgress && now - lastReport > 250) { lastReport = now; o.onProgress(got, total); }
      }
    } finally {
      out.end();
      await done;
    }
    o.onProgress?.(got, total);
  } else {
    await hashFile(part, hash);
  }
  const digest = hash.digest('hex');
  if (digest !== o.sha256) {
    await rm(part, { force: true });
    throw new Error('checksum_mismatch');
  }
  await rename(part, o.dest);
  return o.dest;
}

/**
 * Reads the file list of a .zip held in memory (stored or deflated entries).
 * @param {Buffer} buf
 * @returns {Array<{name: string, read: () => Buffer}>}
 */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('bad_zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad_zip');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({
      name,
      read: () => {
        if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('bad_zip');
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const data = buf.subarray(start, start + compSize);
        if (method === 0) return Buffer.from(data);
        if (method === 8) return inflateRawSync(data);
        throw new Error('zip_method');
      },
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Writes the wanted files from a zip into `dir`, flattening folders. Returns the names written. */
export async function extractFiles(zipBuf, wanted, dir) {
  await mkdir(dir, { recursive: true });
  const written = [];
  for (const entry of readZip(zipBuf)) {
    const name = basename(entry.name.replace(/\\/g, '/'));
    if (!wanted.includes(name) || written.includes(name)) continue;
    await writeFile(join(dir, name), entry.read());
    written.push(name);
  }
  const missing = wanted.filter((w) => !written.includes(w));
  if (missing.length) throw new Error(`zip_missing:${missing.join(',')}`);
  return written;
}

/**
 * Downloads whatever the chosen voice pack still lacks into `dir`.
 * @param {{dir: string, pack: string, platform?: string, fetchFn?: typeof fetch, signal?: AbortSignal,
 *   onProgress?: (p: {step: string, done: number, total: number}) => void,
 *   program?: typeof WHISPER_PROGRAM, models?: typeof WHISPER_MODELS}} o
 */
export async function setupVoice(o) {
  const pack = VOICE_PACKS[o.pack];
  if (!pack) throw new Error('unknown_pack');
  const program = o.program || WHISPER_PROGRAM;
  const models = o.models || WHISPER_MODELS;
  const platform = o.platform || process.platform;
  await mkdir(o.dir, { recursive: true });
  const haveProgram = (await fileSize(join(o.dir, program.files[0]))) > 0;
  if (!haveProgram && platform !== 'win32') throw new Error('unsupported_platform');
  const jobs = [];
  if (!haveProgram) jobs.push({ step: 'program', ...program, dest: join(o.dir, 'whisper-bin.zip') });
  for (const m of pack.models) {
    const spec = models[m];
    if ((await fileSize(join(o.dir, m))) === spec.size) continue;
    jobs.push({ step: m, ...spec, dest: join(o.dir, m) });
  }
  const total = jobs.reduce((s, j) => s + (j.size || 0), 0);
  let before = 0;
  for (const job of jobs) {
    await downloadVerified({
      url: job.url, dest: job.dest, sha256: job.sha256, size: job.size, fetchFn: o.fetchFn, signal: o.signal,
      onProgress: (done) => o.onProgress?.({ step: job.step, done: before + done, total }),
    });
    if (job.step === 'program') {
      await extractFiles(await readFile(job.dest), program.files, o.dir);
      await rm(job.dest, { force: true });
    }
    before += job.size || 0;
  }
  o.onProgress?.({ step: 'done', done: total, total });
  return { downloaded: jobs.map((j) => j.step) };
}

/** Is Ollama running here, and which models does it have? */
export async function ollamaStatus({ fetchFn = fetch, base = OLLAMA_URL, timeoutMs = 1500 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${base}/api/tags`, { signal: ctrl.signal });
    if (!res.ok) return { running: false, models: [] };
    const data = await res.json();
    return { running: true, models: (data?.models || []).map((m) => m?.name).filter(Boolean) };
  } catch {
    return { running: false, models: [] };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Asks the local Ollama to download a model, reporting progress from its
 * line-by-line JSON stream.
 * @param {{model: string, fetchFn?: typeof fetch, base?: string, signal?: AbortSignal,
 *   onProgress?: (p: {step: string, done: number, total: number}) => void}} o
 */
export async function pullOllamaModel(o) {
  const fetchFn = o.fetchFn || fetch;
  const res = await fetchFn(`${o.base || OLLAMA_URL}/api/pull`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: o.model, stream: true }), signal: o.signal,
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let success = false;
  const layers = new Map();
  const handleLine = (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.error) throw new Error(`ollama: ${msg.error}`);
    if (msg.digest && msg.total) layers.set(msg.digest, { total: msg.total, done: msg.completed || 0 });
    let total = 0; let done = 0;
    for (const l of layers.values()) { total += l.total; done += l.done; }
    if (msg.status === 'success') success = true;
    o.onProgress?.({ step: success ? 'done' : String(msg.status || ''), done, total });
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffered.indexOf('\n')) >= 0) {
      handleLine(buffered.slice(0, nl));
      buffered = buffered.slice(nl + 1);
    }
  }
  handleLine(buffered);
  if (!success) throw new Error('pull_incomplete');
  return { model: o.model };
}

/** Short Arabic explanation of a setup error, for the speech bubble and the panel. */
export function setupErrorText(err) {
  const m = String(err?.message || err || '');
  if (err?.name === 'AbortError' || /abort/i.test(m)) return 'وقّفت التنزيل. تقدر تكمله بعدين من نفس المكان.';
  if (m === 'checksum_mismatch') return 'الملف وصل ناقص أو متغير، فما استخدمته. جرّب مرة ثانية.';
  if (m === 'unsupported_platform') return 'التجهيز التلقائي للاستماع متوفر على ويندوز فقط حالياً.';
  if (/ENOSPC/.test(m)) return 'ما في مساحة كافية على القرص.';
  if (/^http_|fetch failed|ENOTFOUND|ECONN|ERR_INTERNET|ERR_NAME|network/i.test(m)) return 'ما قدرت أوصل للإنترنت. تأكد من الاتصال وجرّب مرة ثانية.';
  if (/^ollama:/.test(m)) return `Ollama رفض: ${m.slice(8)}`;
  return 'صار خطأ أثناء التجهيز. جرّب مرة ثانية.';
}
