import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:https';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import selfsigned from 'selfsigned';
import { createPhoneMic, lanAddresses, isPrivate, signPhone } from '../src/main/phone-mic.js';

// Khalfoun 3: requests after the page are signed with the pairing key (as the phone page does)
function signed(url, method, headers) {
  const u = new URL(url); const k = u.searchParams.get('k');
  if (k === null || (method === 'GET' && u.pathname === '/')) return url;
  u.searchParams.delete('k');
  const ts = Date.now();
  headers['x-kh-ts'] = String(ts); headers['x-kh-sig'] = signPhone(k, method, u.pathname, u.searchParams, ts);
  return u.toString();
}

function call(url, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const target = signed(url, method, headers);
    const req = request(target, { method, rejectUnauthorized: false, headers }, (res) => {
      const parts = [];
      res.on('data', (c) => parts.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(parts).toString('utf8'), headers: res.headers }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function wav(n) {
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.write('WAVE', 8);
  return b;
}

test('phone mic: the page and the sound need the pairing key from the QR code', async () => {
  const got = { audio: [], say: [], status: [] };
  const mic = createPhoneMic({
    dir: await mkdtemp(join(tmpdir(), 'kh-phone-')),
    pagePath: new URL('../src/phone/index.html', import.meta.url),
    makeCert: (a, o) => selfsigned.generate(a, o),
    toQr: async (u) => `qr:${u}`,
    onAudio: (pcm, meta) => got.audio.push([pcm.length, meta.seq]),
    onSay: (w) => got.say.push(w.length),
    onStatus: (s) => got.status.push(s),
    addresses: () => [{ address: '127.0.0.1' }],
    ports: [0],
  });
  const info = await mic.start();
  try {
    assert.equal(info.ok, true);
    assert.match(info.url, /^https:\/\/127\.0\.0\.1:\d+\/\?k=[\w-]{12}$/);
    assert.equal(info.qr, `qr:${info.url}`);
    const base = info.url.split('?')[0];
    const key = new URL(info.url).searchParams.get('k');
    // without the key or with a wrong one: nothing
    assert.equal((await call(base)).status, 403);
    assert.equal((await call(`${base}?k=wrong-key-xxx`)).status, 403);
    assert.equal((await call(`${base}audio?k=nope`, { method: 'POST', body: Buffer.alloc(100) })).status, 403);
    // with it: the page, then sound and a push-to-talk command reach Khalfoun
    const page = await call(info.url);
    assert.equal(page.status, 200);
    assert.match(page.text, /مايك خلفون/);
    assert.match(page.headers['content-security-policy'], /connect-src 'self'/);
    assert.equal((await call(`${base}hello?k=${key}`, { method: 'POST' })).status, 200);
    assert.equal((await call(`${base}audio?k=${key}&seq=4`, { method: 'POST', body: Buffer.alloc(6400) })).status, 204);
    assert.deepEqual(got.audio, [[6400, 4]]);
    assert.equal(mic.status().streaming, true);
    assert.equal((await call(`${base}say?k=${key}`, { method: 'POST', body: wav(16000) })).status, 204);
    assert.deepEqual(got.say, [32044]);
    // what is not sound, or too much of it, is refused
    assert.equal((await call(`${base}say?k=${key}`, { method: 'POST', body: Buffer.from('not a wav file at all, no no no no no no no') })).status, 400);
    assert.equal((await call(`${base}audio?k=${key}`, { method: 'POST', body: Buffer.alloc(65000) })).status, 413);
    assert.equal((await call(`${base}audio?k=${key}`, { method: 'POST', body: Buffer.alloc(101) })).status, 400);
    assert.equal((await call(`${base}../../main/main.js?k=${key}`)).status, 404);
    assert.ok(got.status.some((s) => s.connected && s.streaming));
  } finally {
    mic.stop();
  }
  assert.equal(mic.on, false);
  // a new start gives a new key: the old QR code no longer works
  const again = await mic.start();
  assert.notEqual(new URL(again.url).searchParams.get('k'), new URL(info.url).searchParams.get('k'));
  mic.stop();
});

test('phone mic: only private-network addresses, a phone hotspot first', () => {
  for (const ip of ['192.168.1.4', '10.0.0.7', '172.20.10.2', '127.0.0.1', '::ffff:192.168.0.9']) assert.ok(isPrivate(ip), ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '', 'x', '100.64.0.1']) assert.equal(isPrivate(ip), false, ip);
  const list = lanAddresses({
    'vEthernet (WSL)': [{ family: 'IPv4', address: '172.22.0.1', internal: false }],
    'Wi-Fi': [{ family: 'IPv4', address: '192.168.1.20', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
    'Wi-Fi 2': [{ family: 'IPv4', address: '172.20.10.3', internal: false }],
    Loopback: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    Public: [{ family: 'IPv4', address: '5.6.7.8', internal: false }],
  });
  assert.deepEqual(list.map((a) => a.address), ['172.20.10.3', '192.168.1.20']);
});

test('Khalfoun 3: a phone request must be signed, fresh, and never replayed; the inbox works through it', async () => {
  const acts = [];
  const items = [{ id: 'grade-1', kind: 'grade', title: 'تصحيح', status: 'new', actions: [{ id: 'approve', label: 'اعتمد' }] }];
  const mic = createPhoneMic({
    dir: await mkdtemp(join(tmpdir(), 'kh-phone3-')), pagePath: new URL('../src/phone/index.html', import.meta.url),
    makeCert: (a, o) => selfsigned.generate(a, o), toQr: async (u) => u, onAudio() {}, onSay() {}, onStatus() {},
    getInbox: () => items, onInbox: (id, action) => { acts.push([id, action]); return id === 'grade-1'; },
    addresses: () => [{ address: '127.0.0.1' }], ports: [0],
  });
  const info = await mic.start();
  const base = info.url.split('?')[0];
  const key = new URL(info.url).searchParams.get('k');
  const raw = (path, headers) => new Promise((resolve, reject) => {
    const req = request(`${base}${path.slice(1)}`, { method: 'POST', rejectUnauthorized: false, headers }, (res) => { const p = []; res.on('data', (c) => p.push(c)); res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(p).toString() })); });
    req.on('error', reject); req.end();
  });
  try {
    assert.equal((await raw(`/hello?k=${key}`, {})).status, 403); // the key alone is not enough any more
    const ts = Date.now();
    const sig = signPhone(key, 'POST', '/hello', new URLSearchParams(), ts);
    assert.equal((await raw('/hello', { 'x-kh-ts': String(ts), 'x-kh-sig': sig })).status, 200);
    assert.equal((await raw('/hello', { 'x-kh-ts': String(ts), 'x-kh-sig': sig })).status, 403); // replayed
    const old = Date.now() - 120000;
    assert.equal((await raw('/hello', { 'x-kh-ts': String(old), 'x-kh-sig': signPhone(key, 'POST', '/hello', new URLSearchParams(), old) })).status, 403); // stale
    assert.equal((await raw('/hello', { 'x-kh-ts': String(ts + 1), 'x-kh-sig': signPhone('another-key', 'POST', '/hello', new URLSearchParams(), ts + 1) })).status, 403);
    const inbox = JSON.parse((await call(`${base}inbox?k=${key}`, { method: 'POST' })).text);
    assert.equal(inbox.items[0].id, 'grade-1');
    assert.equal((await call(`${base}inbox/act?k=${key}&id=grade-1&action=approve`, { method: 'POST' })).status, 200);
    assert.equal((await call(`${base}inbox/act?k=${key}&id=nope&action=approve`, { method: 'POST' })).status, 404);
    assert.equal((await call(`${base}inbox/act?k=${key}&id=bad id!&action=approve`, { method: 'POST' })).status, 400);
    assert.deepEqual(acts, [['grade-1', 'approve'], ['nope', 'approve']]);
    // a new pairing key: the old one stops working
    mic.stop();
    const again = await mic.start();
    const key2 = new URL(again.url).searchParams.get('k');
    assert.notEqual(key2, key);
  } finally { mic.stop(); }
});
