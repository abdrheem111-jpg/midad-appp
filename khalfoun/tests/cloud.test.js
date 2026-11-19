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
  // A model that refuses the thinking setting is asked again without it.
  let n = 0;
  const think = new GeminiAgent({ key: 'k', model: 'gemini-3.8-flash', fetchFn: async (u, init) => { n += 1; const b = JSON.parse(init.body); return b.generationConfig.thinkingConfig ? reply(400, { error: { message: 'thinking budget is not supported' } }) : reply(200, { candidates: [{ content: { parts: [{ text: '{"addressed":false,"say":"","commands":[]}' }] } }] }); } });
  const t = await think.respond({ text: 'x' });
  assert.deepEqual([t.ok, t.addressed, n], [true, false, 2]);
});

test('keys: a Gemini key works alone; Claude wins when both are set', async () => {
  const store = { read: async () => DEFAULT_CLOUD, write: async () => {} };
  const s = await new CloudSecrets(store, fakeSafe()).load();
  assert.equal(await s.update({ geminiKey: 'AIzaWRONG' }), 'bad_gemini_key');
  await s.update({ geminiKey: `AIza${'g'.repeat(35)}` });
  assert.equal(s.brain, 'gemini');
  assert.equal(s.status().gemini, true);
  await s.update({ claudeKey: `sk-ant-api03-${'c'.repeat(40)}` });
  assert.equal(s.brain, 'claude');
});
