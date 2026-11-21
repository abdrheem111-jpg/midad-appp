// The fast cloud path: Azure hearing and voice, the Claude brain, and the encrypted keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribeAzure, speakAzure, verifyAzure, ClaudeAgent, cleanAgentAnswer, agentSystem, AZURE_VOICES } from '../src/main/cloud.js';
import { CloudSecrets, DEFAULT_CLOUD, WAKE_SECONDS_PER_DAY } from '../src/main/secrets.js';
import { VoiceOut } from '../src/renderer/voice-out.js';
import { encodeWav } from '../src/renderer/wav.js';

const AZ = { key: 'a'.repeat(32), region: 'uaenorth' };
const reply = (status, body, raw) => ({ ok: status >= 200 && status < 300, status, json: async () => body, arrayBuffer: async () => raw || new ArrayBuffer(0) });

test('Azure hearing: the right address, Omani Arabic, the WAV as it is, the text back', async () => {
  const calls = [];
  const fetchFn = async (url, init) => { calls.push({ url, init }); return reply(200, { RecognitionStatus: 'Success', DisplayText: 'افتح الحاسبة.' }); };
  const wav = encodeWav(new Float32Array(16000), 16000);
  const r = await transcribeAzure(AZ, wav, { fetchFn });
  assert.equal(r.ok, true);
  assert.equal(r.text, 'افتح الحاسبة');
  assert.match(calls[0].url, /^https:\/\/uaenorth\.stt\.speech\.microsoft\.com\/.*language=ar-OM/);
  assert.equal(calls[0].init.headers['Ocp-Apim-Subscription-Key'], AZ.key);
  assert.equal(calls[0].init.body, wav);
});

test('Azure hearing: silence is empty, bad key / quota / offline / slow are reported, not thrown', async () => {
  const wav = encodeWav(new Float32Array(160), 16000);
  assert.deepEqual((({ ok, text }) => ({ ok, text }))(await transcribeAzure(AZ, wav, { fetchFn: async () => reply(200, { RecognitionStatus: 'NoMatch' }) })), { ok: true, text: '' });
  assert.equal((await transcribeAzure(AZ, wav, { fetchFn: async () => reply(401, {}) })).error, 'bad_key');
  assert.equal((await transcribeAzure(AZ, wav, { fetchFn: async () => reply(429, {}) })).error, 'quota');
  assert.equal((await transcribeAzure(AZ, wav, { fetchFn: async () => { throw new TypeError('fetch failed'); } })).error, 'offline');
  const slow = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  assert.equal((await transcribeAzure(AZ, wav, { fetchFn: slow, timeoutMs: 30 })).error, 'timeout');
  assert.equal((await transcribeAzure({ key: 'x', region: 'bad region!' }, wav)).error, 'not_configured');
});

test('Azure voice: Omani voice first, the next voice if a region lacks it, text escaped', async () => {
  const bodies = [];
  const fetchFn = async (url, init) => { bodies.push(init.body); return bodies.length === 1 ? reply(400, {}) : reply(200, {}, new Uint8Array([1, 2, 3]).buffer); };
  const r = await speakAzure(AZ, 'هلا <والله> & مرحبا', { fetchFn });
  assert.equal(r.ok, true);
  assert.equal(r.voice, AZURE_VOICES[1]);
  assert.deepEqual([...r.audio], [1, 2, 3]);
  assert.match(bodies[0], /ar-OM-AbdullahNeural/);
  assert.match(bodies[0], /&lt;والله&gt; &amp;/);
  assert.equal((await verifyAzure(AZ, { fetchFn: async () => reply(200, {}) })).ok, true);
  assert.equal((await verifyAzure(AZ, { fetchFn: async () => reply(401, {}) })).error, 'bad_key');
});

test('Claude: forced «respond» tool, alternating turns, his context, answer cleaned', async () => {
  let sent;
  const fetchFn = async (url, init) => {
    sent = { url, init, body: JSON.parse(init.body) };
    return reply(200, { content: [{ type: 'tool_use', name: 'respond', input: { addressed: true, say: 'ابشر', commands: ['افتح الحاسبة', '<script>'] } }] });
  };
  const a = new ClaudeAgent({ key: 'sk-ant-test', fetchFn });
  const r = await a.respond({ text: 'ابغى احسب شي', history: [{ user: 'هلا', khalfoun: 'هلا بك' }, { user: '', khalfoun: 'وانت؟' }], name: 'عبدالرحيم', context: 'اليوم الخميس', level: 3 });
  assert.equal(sent.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(sent.init.headers['x-api-key'], 'sk-ant-test');
  assert.equal(sent.body.model, 'claude-haiku-5-5');
  assert.deepEqual(sent.body.tool_choice, { type: 'tool', name: 'respond' });
  assert.deepEqual(sent.body.messages.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.match(sent.body.system, /عبدالرحيم/);
  assert.match(sent.body.system, /الخميس/);
  assert.deepEqual([r.ok, r.say, r.commands], [true, 'ابشر', ['افتح الحاسبة', 'script']]);
});

test('Claude: not addressed means silent; credit, key and busy errors are named', async () => {
  const quiet = cleanAgentAnswer({ addressed: false, say: 'هلا', commands: ['افتح الحاسبة'] });
  assert.deepEqual(quiet, { addressed: false, say: '', commands: [] });
  assert.deepEqual(cleanAgentAnswer(null), { addressed: true, say: '', commands: [] });
  const err = (status, body) => new ClaudeAgent({ key: 'k', fetchFn: async () => reply(status, body) }).respond({ text: 'x' });
  assert.equal((await err(401, {})).error, 'bad_key');
  assert.equal((await err(400, { error: { message: 'Your credit balance is too low' } })).error, 'no_credit');
  assert.equal((await err(529, {})).error, 'busy');
  assert.match(agentSystem({ level: 1 }), /التعارف/);
  assert.match(agentSystem({ kidsMode: true }), /الأطفال/);
});

function fakeSafe() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc:${s}`),
    decryptString: (b) => String(b).replace(/^enc:/, ''),
  };
}

test('keys: checked, stored encrypted, never handed back to the page, removable', async () => {
  let saved = null;
  const store = { read: async () => saved || DEFAULT_CLOUD, write: async (d) => { saved = structuredClone(d); } };
  const s = await new CloudSecrets(store, fakeSafe()).load();
  assert.equal(await s.update({ claudeKey: 'not-a-key' }), 'bad_claude_key');
  assert.equal(await s.update({ azureRegion: 'uae north!!' }), 'bad_region');
  const claudeKey = `sk-ant-api03-${'x'.repeat(40)}`;
  assert.equal(await s.update({ claudeKey, azureKey: 'b'.repeat(32), azureRegion: 'UAENorth' }), null);
  assert.ok(!JSON.stringify(saved).includes(claudeKey), 'stored encrypted');
  assert.equal(s.claudeKey, claudeKey);
  assert.deepEqual(s.azure, { key: 'b'.repeat(32), region: 'uaenorth' });
  const st = s.status();
  assert.ok(!JSON.stringify(st).includes('xxxx'));
  assert.deepEqual([st.claude, st.azure, st.azureRegion], [true, true, 'uaenorth']);
  await s.update({ claudeKey: '' });
  assert.equal(s.status().claude, false);
});

test('always-on listening uses the cloud only up to its daily share, then whisper', async () => {
  let day = '2026-11-19';
  const s = await new CloudSecrets({ read: async () => DEFAULT_CLOUD, write: async () => {} }, fakeSafe(), () => day).load();
  assert.equal(s.allowWake(), true);
  s.count(WAKE_SECONDS_PER_DAY, true);
  assert.equal(s.allowWake(), false);
  day = '2026-11-20';
  assert.equal(s.allowWake(), true);
});

test('cloud voice plays the audio; if it fails he speaks with the Windows voice', async () => {
  const played = [];
  class FakeAudio { constructor(url) { this.url = url; played.push(this); } play() { setTimeout(() => this.onended?.(), 5); return Promise.resolve(); } pause() {} }
  globalThis.URL.createObjectURL ||= () => 'blob:x';
  globalThis.URL.revokeObjectURL ||= () => {};
  const spoken = [];
  const synth = { getVoices: () => [{ lang: 'ar-SA' }], speak: (u) => { spoken.push(u.text); u.onend?.(); }, cancel() {}, speaking: false };
  function Utterance(text) { this.text = text; }
  const v = new VoiceOut({ synth, Utterance, Audio: FakeAudio });
  v.setEnabled(true);
  let ok = true;
  v.remote = async () => (ok ? { ok: true, audio: new Uint8Array([1]) } : { ok: false, error: 'offline' });
  let ends = 0;
  v.onEnd = () => { ends += 1; };
  assert.equal(v.speak('هلا والله'), true);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(played.length, 1);
  assert.equal(ends, 1);
  ok = false;
  v.speak('مرحبا');
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(spoken, ['مرحبا']);
});

test('he learns to be quiet: ignored idle remarks come less and less often', async () => {
  const { Brain } = await import('../src/core/brain.js');
  const { defaultMemory } = await import('../src/core/memory.js');
  let now = new Date(2026, 10, 19, 10, 0).getTime();
  const brain = new Brain({ memoryData: { ...defaultMemory(now), onboarded: true, level: 3, humor: 2 }, clock: () => now, rng: () => 0.5 });
  brain.hear('هلا');
  const since = now;
  // Keep him awake for the test: only the remark timing is measured.
  brain.emotions.tick = (t) => ({ emotion: 'calm', asleep: false, idleMs: t - since });
  const times = [];
  for (let m = 0; m < 240; m += 1) {
    now += 60e3;
    const r = brain.tick();
    if (r?.situation === 'idle_comment') times.push(m);
  }
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  assert.ok(gaps.length >= 2, JSON.stringify(times));
  assert.ok(gaps[gaps.length - 1] > gaps[0], `gaps should grow: ${gaps}`);
});

test('Gemini (free): JSON answer, alias first, the newest Flash when the alias is rejected, errors named', async () => {
  const { GeminiAgent, pickGeminiModel, GEMINI_ALIAS } = await import('../src/main/cloud.js');
  assert.equal(pickGeminiModel([
    { name: 'models/gemini-3.7-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.9-flash-lite', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-4.0-flash-image', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-9-flash', supportedGenerationMethods: ['embedContent'] },
  ]), 'gemini-3.8-flash');
  const urls = [];
  let sent;
  const fetchFn = async (url, init) => {
    urls.push(url);
    if (url.includes(`${GEMINI_ALIAS}:generateContent`)) return reply(404, { error: { message: 'model not found' } });
    if (url.endsWith('/models?pageSize=200')) return reply(200, { models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }] });
    sent = JSON.parse(init.body);
    return reply(200, { candidates: [{ content: { parts: [{ text: '{"addressed":true,"say":"ابشر","commands":["افتح الحاسبة"]}' }] } }] });
  };
  const g = new GeminiAgent({ key: `AIza${'x'.repeat(35)}`, fetchFn });
  const r = await g.respond({ text: 'ابغى احسب', history: [{ user: 'هلا', khalfoun: 'هلا بك' }], name: 'عبدالرحيم' });
  assert.deepEqual([r.ok, r.say, r.commands, r.model], [true, 'ابشر', ['افتح الحاسبة'], 'gemini-3.8-flash']);
  assert.equal(sent.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(sent.contents.map((c) => c.role), ['user', 'model', 'user']);
  assert.match(sent.systemInstruction.parts[0].text, /عبدالرحيم/);
  const bad = new GeminiAgent({ key: 'k', fetchFn: async () => reply(400, { error: { message: 'API key not valid. Please pass a valid API key.' } }) });
  assert.equal((await bad.respond({ text: 'x' })).error, 'bad_key');
  const quota = new GeminiAgent({ key: 'k', fetchFn: async () => reply(429, {}) });
  assert.equal((await quota.respond({ text: 'x' })).error, 'quota');
  // A model that refuses the thinking settings is asked again with the next one, then without.
  let n = 0;
  const think = new GeminiAgent({ key: 'k', model: 'gemini-3.8-flash', fetchFn: async (u, init) => { n += 1; const b = JSON.parse(init.body); return b.generationConfig.thinkingConfig ? reply(400, { error: { message: 'thinking budget is not supported' } }) : reply(200, { candidates: [{ content: { parts: [{ text: '{"addressed":false,"say":"","commands":[]}' }] } }] }); } });
  const t = await think.respond({ text: 'x' });
  assert.deepEqual([t.ok, t.addressed, n], [true, false, 3]);
});

test('keys: a Gemini key works alone; Claude wins when both are set', async () => {
  const store = { read: async () => DEFAULT_CLOUD, write: async () => {} };
  const s = await new CloudSecrets(store, fakeSafe()).load();
  assert.equal(await s.update({ geminiKey: 'AIzaWRONG' }), 'bad_gemini_key');
  await s.update({ geminiKey: `AIza${'g'.repeat(35)}` });
  assert.equal(s.brain, 'gemini');
  // The new «auth key» format from AI Studio (AQ.…), as the teacher got it.
  assert.equal(await s.update({ geminiKey: `AQ.Ab8RN6${'x'.repeat(40)}_${'y'.repeat(10)}` }), null);
  assert.equal(s.geminiKey.startsWith('AQ.'), true);
  assert.equal(s.status().gemini, true);
  await s.update({ claudeKey: `sk-ant-api03-${'c'.repeat(40)}` });
  assert.equal(s.brain, 'claude');
});

test('Gemini can hear too: the recording goes inline, the words come back, silence is empty', async () => {
  const { GeminiAgent } = await import('../src/main/cloud.js');
  let sent;
  const answers = ['يا خلفون افتح الحاسبة.', '-'];
  const g = new GeminiAgent({ key: 'k', model: 'gemini-3.8-flash', fetchFn: async (url, init) => { sent = JSON.parse(init.body); return reply(200, { candidates: [{ content: { parts: [{ text: answers.shift() }] } }] }); } });
  const wav = encodeWav(new Float32Array(1600), 16000);
  const r = await g.transcribe(wav);
  assert.deepEqual([r.ok, r.text], [true, 'يا خلفون افتح الحاسبة']);
  assert.equal(sent.contents[0].parts[0].inline_data.mime_type, 'audio/wav');
  assert.equal(Buffer.from(sent.contents[0].parts[0].inline_data.data, 'base64').length, wav.length);
  assert.equal((await g.transcribe(wav)).text, '');
  const q = new GeminiAgent({ key: 'k', model: 'm', fetchFn: async () => reply(429, {}) });
  assert.equal((await q.transcribe(wav)).error, 'quota');
});

test('from the teacher\'s log: a Claude key without credit no longer blocks Gemini', async () => {
  const { chainAgents } = await import('../src/main/cloud.js');
  const claude = { respond: async () => ({ ok: false, error: 'no_credit' }) };
  const gemini = { respond: async () => ({ ok: true, addressed: true, say: 'هلا', commands: [] }) };
  assert.equal((await chainAgents([claude, gemini]).respond({ text: 'هلا' })).say, 'هلا');
  const offline = { respond: async () => ({ ok: false, error: 'offline' }) };
  assert.equal((await chainAgents([offline, gemini]).respond({ text: 'x' })).error, 'offline'); // no point trying the next
});

test('from the teacher\'s log: Gemini asks for minimal thinking (it timed out), checks the key by the model list, names Google\'s refusals', async () => {
  const { GeminiAgent } = await import('../src/main/cloud.js');
  let body;
  const ok = new GeminiAgent({ key: 'k', fetchFn: async (url, init) => {
    if (url.includes('/models?')) return reply(200, { models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }] });
    body = JSON.parse(init.body);
    return reply(200, { candidates: [{ content: { parts: [{ text: '{"addressed":true,"say":"هلا","commands":[]}' }] } }] });
  } });
  const v = await ok.verify();
  assert.deepEqual([v.ok, v.model], [true, 'gemini-3.8-flash']);
  assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'MINIMAL' });
  const typed = new GeminiAgent({ key: 'AQ.x', fetchFn: async () => reply(401, { error: { message: 'Expected OAuth 2 access token', details: [{ reason: 'ACCESS_TOKEN_TYPE_UNSUPPORTED' }] } }) });
  assert.equal((await typed.verify()).error, 'key_type');
  const off = new GeminiAgent({ key: 'k', fetchFn: async () => reply(403, { error: { message: 'Generative Language API has not been used in project 1 before or it is disabled.' } }) });
  assert.equal((await off.verify()).error, 'api_disabled');
});

test('Gemini busy or too slow (as on the teacher\'s PC): the next model answers, and is kept', async () => {
  const { GeminiAgent, geminiPool, GEMINI_ALIAS, GEMINI_LITE_ALIAS } = await import('../src/main/cloud.js');
  assert.deepEqual(geminiPool(['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash-lite-tts', 'gemini-3.5-flash', 'gemini-3.0-flash', 'gemini-4-argon']),
    [GEMINI_ALIAS, GEMINI_LITE_ALIAS, 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
  const asked = [];
  const ok = (text) => reply(200, { candidates: [{ content: { parts: [{ text }] } }] });
  const fetchFn = async (url, init) => {
    if (url.endsWith('/models?pageSize=200')) return reply(200, { models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] });
    const model = /models\/([^:]+):/.exec(url)[1];
    asked.push(model);
    if (model === GEMINI_ALIAS) return reply(503, {});
    if (model === GEMINI_LITE_ALIAS) {
      // too slow: wait until the call is cut
      return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    }
    return ok('{"addressed":true,"say":"تم","commands":[]}');
  };
  const g = new GeminiAgent({ key: 'k', fetchFn, timeoutMs: 50 });
  const r = await g.respond({ text: 'هلا' });
  assert.deepEqual([r.ok, r.say, r.model], [true, 'تم', 'gemini-3.5-flash-lite']);
  assert.deepEqual(asked, [GEMINI_ALIAS, GEMINI_LITE_ALIAS, 'gemini-3.5-flash-lite']);
  // the working model is used straight away next time
  asked.length = 0;
  assert.equal((await g.respond({ text: 'هلا' })).ok, true);
  assert.deepEqual(asked, ['gemini-3.5-flash-lite']);
  // writing goes through the same switch
  asked.length = 0;
  const w = await new GeminiAgent({ key: 'k', fetchFn, timeoutMs: 50 }).write({ system: 's', user: 'u', timeoutMs: 50 });
  assert.deepEqual([w.ok, asked.at(-1)], [true, 'gemini-3.5-flash-lite']);
});
