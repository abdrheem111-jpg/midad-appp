import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { buildMessages, cleanReply, isSafe, isLocalEndpoint } from '../src/core/chat-prompt.js';
import { ChatClient, findLocalModel } from '../src/main/chat.js';
import { Brain } from '../src/core/brain.js';
import { defaultMemory } from '../src/core/memory.js';

test('the system prompt sets the Omani persona, short replies, honesty and kids safety', () => {
  const m = buildMessages({ text: 'شو رأيك في البحر؟', name: 'مريم', kidsMode: true, humor: 2, history: [{ user: 'هلا', khalfoun: 'هلا والله' }] });
  const sys = m[0].content;
  assert.equal(m[0].role, 'system');
  for (const s of ['خلفون', 'العُمانية', 'جملتين', 'لا تقول إنك فتحت', 'مريم', 'طفل', 'مبالغ']) assert.ok(sys.includes(s), s);
  assert.equal(m.at(-1).content, 'شو رأيك في البحر؟');
  assert.equal(m.filter((x) => x.role === 'user').length, 3, 'example + history + question');
  const many = buildMessages({ text: 'x', history: Array.from({ length: 10 }, (_, i) => ({ user: `u${i}`, khalfoun: `k${i}` })) });
  assert.equal(many.length, 1 + 2 + 8 + 1, 'only the last four exchanges are sent');
  assert.ok(!buildMessages({ text: 'x' })[0].content.includes('طفل'));
});

test('replies are cleaned to one or two short plain lines', () => {
  assert.equal(cleanReply('<think>تحليل طويل</think>**هلا والله!** 😀'), 'هلا والله!');
  assert.equal(cleanReply('خلفون: ابشر يا الغالي'), 'ابشر يا الغالي');
  assert.equal(cleanReply('«زين واجد»'), 'زين واجد');
  const long = cleanReply(`${'كلام طويل واجد عن البحر والسفن والصيادين في صور. '.repeat(10)}`);
  assert.ok(long.length <= 221, long.length);
  assert.ok(/[.…]$/.test(long));
  assert.equal(cleanReply(null), '');
});

test('safety: harmful words blocked, kids mode stricter, must be Arabic', () => {
  assert.ok(isSafe('البحر في عُمان حلو واجد', false));
  assert.ok(!isSafe('هذا عن المخدرات', false));
  assert.ok(isSafe('القصة فيها دم كثير', false));
  assert.ok(!isSafe('القصة فيها دم كثير', true));
  assert.ok(isSafe('تقدم واجد يا بطل', true), 'no false match inside words');
  assert.ok(isSafe('جنسيتي عمانية', true));
  assert.ok(!isSafe('I am an AI language model', false));
  assert.ok(!isSafe('', false));
});

test('only addresses on this computer are accepted', () => {
  assert.ok(isLocalEndpoint('http://127.0.0.1:11434/v1'));
  assert.ok(isLocalEndpoint('http://localhost:8080/v1'));
  assert.ok(!isLocalEndpoint('https://api.example.com/v1'));
  assert.ok(!isLocalEndpoint('http://192.168.1.5:11434/v1'));
  assert.ok(!isLocalEndpoint('file:///etc/passwd'));
  assert.throws(() => new ChatClient({ endpoint: 'https://evil.example/v1', model: 'x' }), /endpoint_not_local/);
});

const okJson = (data) => ({ ok: true, status: 200, json: async () => data });

test('finds a local model server, skipping dead ports and embedding models', async () => {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    if (url.startsWith('http://127.0.0.1:11434')) throw new Error('ECONNREFUSED');
    return okJson({ data: [{ id: 'nomic-embed-text' }, { id: 'qwen2.5:7b' }] });
  };
  const found = await findLocalModel({ fetchFn });
  assert.deepEqual([found.endpoint, found.model], ['http://127.0.0.1:8080/v1', 'qwen2.5:7b']);
  assert.equal(calls.length, 2);
  assert.equal(await findLocalModel({ fetchFn: async () => { throw new Error('no'); } }), null);
  assert.equal((await findLocalModel({ fetchFn, preferred: 'nomic-embed-text' })).model, 'nomic-embed-text');
});

test('chat client: good reply, unsafe reply, timeout, busy', async () => {
  let body;
  const good = new ChatClient({ endpoint: 'http://127.0.0.1:1/v1', model: 'm', fetchFn: async (url, init) => { body = JSON.parse(init.body); return okJson({ choices: [{ message: { content: 'هلا والله! شحالك اليوم؟' } }] }); } });
  assert.deepEqual(await good.reply({ text: 'هلا', kidsMode: false }), { ok: true, text: 'هلا والله! شحالك اليوم؟' });
  assert.equal(body.model, 'm');
  assert.equal(body.stream, false);
  const bad = new ChatClient({ endpoint: 'http://127.0.0.1:1/v1', model: 'm', fetchFn: async () => okJson({ choices: [{ message: { content: 'خلنا نتكلم عن المخدرات' } }] }) });
  assert.equal((await bad.reply({ text: 'x' })).error, 'unsafe_or_empty');
  const slow = new ChatClient({ endpoint: 'http://127.0.0.1:1/v1', model: 'm', timeoutMs: 50, fetchFn: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); })) });
  assert.equal((await slow.reply({ text: 'x' })).error, 'timeout');
  const busy = new ChatClient({ endpoint: 'http://127.0.0.1:1/v1', model: 'm', fetchFn: () => new Promise((r) => setTimeout(() => r(okJson({ choices: [{ message: { content: 'زين واجد' } }] })), 50)) });
  const first = busy.reply({ text: 'a' });
  assert.equal((await busy.reply({ text: 'b' })).error, 'busy');
  assert.equal((await first).ok, true);
  assert.equal((await good.reply({ text: '' })).error, 'bad_text');
});

test('end to end with a real local server that speaks the OpenAI-style API', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      seen.push({ url: req.url, method: req.method });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: 'khalfoun-mini' }] })); return; }
      const body = JSON.parse(raw);
      const q = body.messages.at(-1).content;
      res.end(JSON.stringify({ choices: [{ message: { content: `سؤالك «${q}» حلو! البحر في صور يجنن.` } }] }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
  const found = await findLocalModel({ endpoints: [endpoint] });
  assert.equal(found.model, 'khalfoun-mini');
  const client = new ChatClient(found);
  const r = await client.reply({ text: 'وين أحسن بحر؟' });
  assert.equal(r.ok, true);
  assert.match(r.text, /وين أحسن بحر/);
  assert.deepEqual(seen.map((s) => s.url), ['/v1/models', '/v1/chat/completions']);
  server.close();
});

test('brain keeps a short chat history and reacts to the model reply', () => {
  const b = new Brain({ memoryData: { ...defaultMemory(0), onboarded: true, level: 2 }, clock: () => 0 });
  for (let i = 0; i < 8; i += 1) b.chatReply(`سؤال ${i}`, 'زين واجد يا الغالي');
  assert.equal(b.chatHistory.length, 6);
  const q = b.chatReply('شو تحب؟', 'أحب البحر، وأنت شو تحب؟');
  assert.equal(q.situation, 'chat');
  assert.equal(q.animation, 'think');
  assert.equal(q.emotion.emotion, 'curious');
});
