// The teacher's phone as Khalfoun's wireless microphone. While he turns it on in settings,
// Khalfoun serves one small page on the local network (HTTPS: phones only give a page the
// microphone over a secure connection; the certificate is Khalfoun's own). He opens it by
// scanning a QR code that carries a one-time pairing key; every request must carry that key and
// come from a private-network address. The phone sends only sound: words still go through
// Khalfoun's normal hearing and checks.

import { createServer } from 'node:https';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';

export const PHONE_PORTS = [47823, 47824, 47825, 47826];
const MAX_CHUNK = 64000; // 2 s of 16 kHz 16-bit sound
const MAX_SAY = 1_300_000; // a 40 s push-to-talk recording
const MAX_PHOTO = 9_000_000; // a phone photo, already made smaller on the phone
/** The phone's control buttons (anything else is refused). */
export const PHONE_COMMANDS = ['step_next', 'step_back', 'mute', 'bubble', 'random_student', 'timer_1', 'timer_3', 'timer_5', 'celebrate', 'fireworks', 'clear', 'stop'];
export const PHOTO_PURPOSES = ['pick', 'doc', 'grade', 'key'];
const isJpegOrPng = (b) => (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47);

/** Private IPv4 addresses (home/school network, a phone's hotspot) of this computer. */
export function lanAddresses(ifaces = networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(ifaces || {})) {
    if (/vethernet|virtualbox|vmware|hyper-v|wsl|loopback|docker|tailscale|zerotier/i.test(name)) continue;
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || !isPrivate(a.address)) continue;
      out.push({ name, address: a.address });
    }
  }
  // A phone hotspot first (iPhone 172.20.10.x, Android 192.168.43.x / 10.x), then the rest.
  const rank = (ip) => (/^172\.20\.10\./.test(ip) ? 0 : /^192\.168\.(43|137)\./.test(ip) ? 1 : /^192\.168\./.test(ip) ? 2 : /^10\./.test(ip) ? 3 : 4);
  return out.sort((a, b) => rank(a.address) - rank(b.address));
}

export function isPrivate(ip) {
  const m = /^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(String(ip || ''));
  if (!m) return ip === '::1';
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

function sameKey(given, key) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Khalfoun's own certificate for the page, kept in userData and renewed when the address changes. */
async function certificate(dir, ips, makeCert) {
  const file = join(dir, 'phone-cert.json');
  try {
    const c = JSON.parse(await readFile(file, 'utf8'));
    if (c.cert && c.key && ips.every((ip) => (c.ips || []).includes(ip))) return c;
  } catch { /* first time */ }
  const pems = makeCert([{ name: 'commonName', value: 'Khalfoun' }], {
    days: 3650, keySize: 2048, algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, ...ips.map((ip) => ({ type: 7, ip }))] }],
  });
  const c = { cert: pems.cert, key: pems.private, ips };
  await mkdir(dir, { recursive: true });
  await writeFile(file, JSON.stringify(c));
  return c;
}

/**
 * @param {{dir: string, pagePath: string, makeCert: Function, toQr: (url: string) => Promise<string>,
 *   onAudio: (pcm: Uint8Array, meta: {seq: number}) => void, onSay: (wav: Uint8Array) => void,
 *   onStatus: (s: {connected: boolean, streaming: boolean}) => void, log?: Function, ports?: number[], addresses?: () => {address: string}[]}} deps
 */
export function createPhoneMic(deps) {
  const log = deps.log || (() => {});
  let server = null;
  let key = null;
  let port = null;
  let lastSeen = 0;
  let lastAudio = 0;
  let told = { connected: false, streaming: false };
  let timer = null;

  const status = () => ({ connected: Date.now() - lastSeen < 5000, streaming: Date.now() - lastAudio < 1500 });
  const tell = () => {
    const s = status();
    if (s.connected !== told.connected || s.streaming !== told.streaming) { told = s; deps.onStatus(s); }
  };

  async function body(req, max) {
    const parts = [];
    let n = 0;
    for await (const c of req) {
      n += c.length;
      if (n > max) throw Object.assign(new Error('too big'), { code: 413 });
      parts.push(c);
    }
    return new Uint8Array(Buffer.concat(parts));
  }

  async function handle(req, res) {
    const send = (code, text, type = 'text/plain; charset=utf-8') => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(text);
    };
    if (!isPrivate(req.socket.remoteAddress)) return send(403, 'forbidden');
    const url = new URL(req.url, 'https://khalfoun');
    if (!sameKey(url.searchParams.get('k'), key)) return send(403, 'forbidden');
    lastSeen = Date.now();
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        const html = await readFile(deps.pagePath, 'utf8');
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
          'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
        });
        return res.end(html);
      }
      if (req.method === 'POST' && url.pathname === '/hello') { tell(); return send(200, JSON.stringify({ ok: true, name: 'خلفون', state: deps.getState?.() || {} }), 'application/json'); }
      if (req.method === 'POST' && url.pathname === '/cmd') {
        const name = url.searchParams.get('name');
        if (!PHONE_COMMANDS.includes(name)) return send(400, 'bad command');
        log('phone mic: button', name);
        deps.onCommand?.(name);
        return send(200, JSON.stringify({ ok: true, state: deps.getState?.() || {} }), 'application/json');
      }
      if (req.method === 'POST' && url.pathname === '/whisper') {
        const text = Buffer.from(await body(req, 2000)).toString('utf8').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300);
        if (!text) return send(400, 'empty');
        log('phone mic: a whispered command', `${text.length} chars`);
        deps.onWhisper?.(text);
        return send(204, '');
      }
      if (req.method === 'POST' && url.pathname === '/photo') {
        const purpose = url.searchParams.get('purpose');
        if (!PHOTO_PURPOSES.includes(purpose)) return send(400, 'bad purpose');
        const photo = await body(req, MAX_PHOTO);
        if (photo.length < 100 || !isJpegOrPng(photo)) return send(400, 'not a photo');
        log('phone mic: a photo', purpose, `${Math.round(photo.length / 1024)} KB`);
        deps.onPhoto?.(purpose, photo);
        return send(204, '');
      }
      if (req.method === 'POST' && url.pathname === '/audio') {
        const pcm = await body(req, MAX_CHUNK);
        if (pcm.length % 2) return send(400, 'bad audio');
        lastAudio = Date.now();
        tell();
        deps.onAudio(pcm, { seq: Number(url.searchParams.get('seq')) || 0 });
        return send(204, '');
      }
      if (req.method === 'POST' && url.pathname === '/say') {
        const wav = await body(req, MAX_SAY);
        if (wav.length < 44 || String.fromCharCode(...wav.subarray(0, 4)) !== 'RIFF') return send(400, 'bad audio');
        log('phone mic: a push-to-talk command', `${wav.length} bytes`);
        deps.onSay(wav);
        return send(204, '');
      }
      if (req.method === 'POST' && url.pathname === '/bye') { lastSeen = 0; lastAudio = 0; tell(); return send(204, ''); }
      return send(404, 'not found');
    } catch (err) {
      return send(err.code === 413 ? 413 : 500, 'error');
    }
  }

  return {
    /** Starts serving; returns the address for the QR code. */
    async start() {
      if (server) return this.info();
      const ips = (deps.addresses ? deps.addresses() : lanAddresses()).map((a) => a.address);
      if (!ips.length) return { ok: false, error: 'no_network' };
      const c = await certificate(deps.dir, ips, deps.makeCert);
      key = randomBytes(9).toString('base64url');
      for (const p of deps.ports || PHONE_PORTS) {
        const s = createServer({ cert: c.cert, key: c.key }, (req, res) => { handle(req, res); });
        const ok = await new Promise((resolve) => {
          s.once('error', () => resolve(false));
          s.listen(p, '0.0.0.0', () => resolve(true));
        });
        if (ok) { server = s; port = s.address().port; break; }
      }
      if (!server) return { ok: false, error: 'no_port' };
      timer = setInterval(tell, 1000);
      log('phone mic: serving', ips.join(', '), `port ${port}`);
      return this.info();
    },
    async info() {
      if (!server) return { ok: false, error: 'off' };
      const ips = (deps.addresses ? deps.addresses() : lanAddresses()).map((a) => a.address);
      const urls = ips.map((ip) => `https://${ip}:${port}/?k=${key}`);
      return { ok: true, url: urls[0], urls, qr: urls[0] ? await deps.toQr(urls[0]) : null, port, ...status() };
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      if (server) { server.close(); server.closeAllConnections?.(); log('phone mic: stopped'); }
      server = null; key = null; port = null; lastSeen = 0; lastAudio = 0;
      tell();
    },
    status,
    get on() { return Boolean(server); },
  };
}
