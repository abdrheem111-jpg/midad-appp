import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { deflateRawSync, crc32 } from 'node:zlib';
import { mkdtemp, readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  downloadVerified, readZip, extractFiles, setupVoice, packSizeMB, pullOllamaModel, ollamaStatus,
  setupErrorText, VOICE_PACKS, WHISPER_MODELS, WHISPER_PROGRAM,
} from '../src/main/setup.js';

const sha = (b) => createHash('sha256').update(b).digest('hex');

/** Builds a small zip: entries are [name, content, deflate?]. */
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content, deflate] of entries) {
    const data = Buffer.from(content);
    const comp = deflate ? deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(deflate ? 8 : 0, 10); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, comp);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** A tiny file server that understands Range requests and counts hits. */
async function serve(files, { ignoreRange = false } = {}) {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push({ url: req.url, range: req.headers.range });
    const body = files[req.url];
    if (!body) { res.writeHead(404); res.end(); return; }
    const m = /^bytes=(\d+)-$/.exec(req.headers.range || '');
    if (m && !ignoreRange) {
      const from = Number(m[1]);
      if (from >= body.length) { res.writeHead(416); res.end(); return; }
      res.writeHead(206, { 'content-length': body.length - from });
      res.end(body.subarray(from));
      return;
    }
    res.writeHead(200, { 'content-length': body.length });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, hits, close: () => new Promise((r) => server.close(r)) };
}

const tmp = () => mkdtemp(join(tmpdir(), 'khalfoun-setup-'));

test('readZip and extractFiles flatten folders and handle stored and deflated entries', async () => {
  const zip = makeZip([
    ['Release/whisper-cli.exe', 'CLI', true],
    ['Release/whisper.dll', 'DLL', false],
    ['Release/stream.exe', 'not wanted', true],
  ]);
  assert.deepEqual(readZip(zip).map((e) => e.name), ['Release/whisper-cli.exe', 'Release/whisper.dll', 'Release/stream.exe']);
  const dir = await tmp();
  const written = await extractFiles(zip, ['whisper-cli.exe', 'whisper.dll'], dir);
  assert.deepEqual(written.sort(), ['whisper-cli.exe', 'whisper.dll']);
  assert.equal(await readFile(join(dir, 'whisper-cli.exe'), 'utf8'), 'CLI');
  assert.equal(await readFile(join(dir, 'whisper.dll'), 'utf8'), 'DLL');
  assert.deepEqual((await readdir(dir)).sort(), ['whisper-cli.exe', 'whisper.dll']);
  await assert.rejects(extractFiles(zip, ['ggml.dll'], dir), /zip_missing:ggml.dll/);
  assert.throws(() => readZip(Buffer.from('not a zip at all, really not a zip')), /bad_zip/);
});

test('downloadVerified saves a file only when its checksum matches', async () => {
  const body = Buffer.alloc(300000, 7);
  const srv = await serve({ '/m.bin': body });
  const dir = await tmp();
  try {
    const seen = [];
    await downloadVerified({ url: `${srv.base}/m.bin`, dest: join(dir, 'm.bin'), sha256: sha(body), size: body.length, onProgress: (d, t) => seen.push([d, t]) });
    assert.equal((await stat(join(dir, 'm.bin'))).size, body.length);
    assert.deepEqual(seen.at(-1), [body.length, body.length]);
    await assert.rejects(
      downloadVerified({ url: `${srv.base}/m.bin`, dest: join(dir, 'bad.bin'), sha256: 'f'.repeat(64) }),
      /checksum_mismatch/,
    );
    await assert.rejects(stat(join(dir, 'bad.bin')));
    await assert.rejects(stat(join(dir, 'bad.bin.part')));
    await assert.rejects(downloadVerified({ url: `${srv.base}/missing`, dest: join(dir, 'x'), sha256: 'a' }), /http_404/);
    await assert.rejects(downloadVerified({ url: 'http://example.com/m.bin', dest: join(dir, 'y'), sha256: 'a' }), /insecure_url/);
  } finally {
    await srv.close();
  }
});

test('downloadVerified resumes a half-finished download', async () => {
  const body = Buffer.from(Array.from({ length: 50000 }, (_, i) => i % 251));
  const srv = await serve({ '/m.bin': body });
  const dir = await tmp();
  try {
    await writeFile(join(dir, 'm.bin.part'), body.subarray(0, 20000));
    await downloadVerified({ url: `${srv.base}/m.bin`, dest: join(dir, 'm.bin'), sha256: sha(body), size: body.length });
    assert.equal(srv.hits.at(-1).range, 'bytes=20000-');
    assert.ok((await readFile(join(dir, 'm.bin'))).equals(body));
    // A complete .part left behind (server answers 416) is checked and kept.
    await writeFile(join(dir, 'n.bin.part'), body);
    await downloadVerified({ url: `${srv.base}/m.bin`, dest: join(dir, 'n.bin'), sha256: sha(body), size: body.length });
    assert.ok((await readFile(join(dir, 'n.bin'))).equals(body));
  } finally {
    await srv.close();
  }
});

test('downloadVerified starts over when the server ignores the resume request', async () => {
  const body = Buffer.from('the whole file content, from the start');
  const srv = await serve({ '/m.bin': body }, { ignoreRange: true });
  const dir = await tmp();
  try {
    await writeFile(join(dir, 'm.bin.part'), Buffer.from('the whole'));
    await downloadVerified({ url: `${srv.base}/m.bin`, dest: join(dir, 'm.bin'), sha256: sha(body), size: body.length });
    assert.ok((await readFile(join(dir, 'm.bin'))).equals(body));
  } finally {
    await srv.close();
  }
});

test('setupVoice installs the program and the pack models, then skips what is already there', async () => {
  const zip = makeZip([['Release/whisper-cli.exe', 'CLI', true], ['Release/whisper.dll', 'DLL', true]]);
  const small = Buffer.from('small model');
  const base = Buffer.from('base model!');
  const srv = await serve({ '/w.zip': zip, '/small': small, '/base': base });
  const dir = await tmp();
  const program = { url: `${srv.base}/w.zip`, sha256: sha(zip), size: zip.length, files: ['whisper-cli.exe', 'whisper.dll'] };
  const models = {
    'ggml-small.bin': { url: `${srv.base}/small`, sha256: sha(small), size: small.length },
    'ggml-base.bin': { url: `${srv.base}/base`, sha256: sha(base), size: base.length },
  };
  try {
    const progress = [];
    const first = await setupVoice({ dir, pack: 'balanced', platform: 'win32', program, models, onProgress: (p) => progress.push(p) });
    assert.deepEqual(first.downloaded, ['program', 'ggml-small.bin', 'ggml-base.bin']);
    assert.deepEqual((await readdir(dir)).sort(), ['ggml-base.bin', 'ggml-small.bin', 'whisper-cli.exe', 'whisper.dll']);
    const last = progress.at(-1);
    assert.equal(last.step, 'done');
    assert.equal(last.done, last.total);
    assert.equal(last.total, zip.length + small.length + base.length);
    // Running again downloads nothing; the light pack only needs the base model, already present.
    assert.deepEqual((await setupVoice({ dir, pack: 'balanced', platform: 'win32', program, models })).downloaded, []);
    assert.deepEqual((await setupVoice({ dir, pack: 'light', platform: 'win32', program, models })).downloaded, []);
    await assert.rejects(setupVoice({ dir, pack: 'nope', program, models }), /unknown_pack/);
    await assert.rejects(setupVoice({ dir: await tmp(), pack: 'light', platform: 'linux', program, models }), /unsupported_platform/);
  } finally {
    await srv.close();
  }
});

test('voice packs point at pinned, checksummed downloads', () => {
  for (const pack of Object.values(VOICE_PACKS)) {
    assert.ok(pack.models.includes('ggml-base.bin'), 'every pack carries the quick wake-word model');
    for (const m of pack.models) assert.match(WHISPER_MODELS[m].url, /^https:\/\/huggingface\.co\/ggerganov\/whisper\.cpp\/resolve\/[0-9a-f]{40}\//);
  }
  for (const spec of [WHISPER_PROGRAM, ...Object.values(WHISPER_MODELS)]) {
    assert.match(spec.sha256, /^[0-9a-f]{64}$/);
    assert.ok(spec.size > 1e6);
  }
  assert.match(WHISPER_PROGRAM.url, /\/download\/v\d+\.\d+\.\d+\//);
  assert.equal(packSizeMB('light'), 152);
  assert.equal(packSizeMB('balanced'), 639);
  assert.equal(packSizeMB('balanced', { haveProgram: true, haveModels: ['ggml-base.bin'] }), 488);
  assert.equal(packSizeMB('nope'), 0);
});

function streamResponse(lines, { status = 200 } = {}) {
  const enc = new TextEncoder();
  const chunks = lines.map((l) => enc.encode(l));
  return new Response(new ReadableStream({ pull(c) { const next = chunks.shift(); if (next) c.enqueue(next); else c.close(); } }), { status });
}

test('pullOllamaModel follows the progress stream, including lines split across chunks', async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return streamResponse([
      '{"status":"pulling manifest"}\n{"status":"pulling a","digest":"sha256:a","total":100,"compl',
      'eted":40}\n{"status":"pulling b","digest":"sha256:b","total":50,"completed":50}\n',
      '{"status":"pulling a","digest":"sha256:a","total":100,"completed":100}\n{"status":"verifying sha256 digest"}\n',
      '{"status":"success"}',
    ]);
  };
  const seen = [];
  const out = await pullOllamaModel({ model: 'qwen2.5:3b', fetchFn, onProgress: (p) => seen.push(p) });
  assert.deepEqual(out, { model: 'qwen2.5:3b' });
  assert.equal(calls[0].url, 'http://127.0.0.1:11434/api/pull');
  assert.deepEqual(calls[0].body, { model: 'qwen2.5:3b', stream: true });
  assert.deepEqual(seen.find((p) => p.done === 40), { step: 'pulling a', done: 40, total: 100 });
  assert.deepEqual(seen.at(-1), { step: 'done', done: 150, total: 150 });
});

test('pullOllamaModel reports Ollama errors and unfinished pulls', async () => {
  await assert.rejects(
    pullOllamaModel({ model: 'x', fetchFn: async () => streamResponse(['{"error":"pull model manifest: file does not exist"}\n']) }),
    /ollama: pull model manifest/,
  );
  await assert.rejects(pullOllamaModel({ model: 'x', fetchFn: async () => streamResponse(['{"status":"pulling"}\n']) }), /pull_incomplete/);
  await assert.rejects(pullOllamaModel({ model: 'x', fetchFn: async () => streamResponse([], { status: 500 }) }), /http_500/);
});

test('ollamaStatus tells running-with-models from not running', async () => {
  const running = await ollamaStatus({ fetchFn: async () => Response.json({ models: [{ name: 'qwen2.5:3b' }] }) });
  assert.deepEqual(running, { running: true, models: ['qwen2.5:3b'] });
  assert.deepEqual(await ollamaStatus({ fetchFn: async () => { throw new Error('ECONNREFUSED'); } }), { running: false, models: [] });
});

test('setup errors are explained in Arabic', () => {
  assert.match(setupErrorText(new Error('checksum_mismatch')), /ناقص/);
  assert.match(setupErrorText(Object.assign(new Error('x'), { name: 'AbortError' })), /وقّفت/);
  assert.match(setupErrorText(new Error('fetch failed')), /للإنترنت/);
  assert.match(setupErrorText(new Error('ENOSPC: no space')), /مساحة/);
  assert.match(setupErrorText(new Error('unsupported_platform')), /ويندوز/);
  assert.match(setupErrorText(new Error('weird')), /خطأ/);
});
