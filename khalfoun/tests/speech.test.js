import test from 'node:test';
import assert from 'node:assert/strict';
import { spokenMath, stripTashkeel, sentenceChunks, VOICE_IDS } from '../src/core/speech-text.js';
import { speakableText } from '../src/renderer/voice-out.js';
import { turnContext, personaPrompt } from '../src/core/claude-persona.js';
import { speakAzure, AZURE_VOICES } from '../src/main/cloud.js';

test('speech: maths is read as words, like a teacher reads the board', () => {
  assert.equal(spokenMath('س² + ٣ = ١٢'), 'سين تربيع زائد 3 يساوي 12');
  assert.equal(spokenMath('٢س - ٤ = ٠'), '2 سين ناقص 4 يساوي 0');
  assert.equal(spokenMath('الجواب ٣/٤ يعني ٧٥%'), 'الجواب 3 على 4 يعني 75 بالمئة');
  assert.equal(spokenMath('√١٦ = ٤ و ٣ × ٥ = ١٥'), 'الجذر التربيعي لـ 16 يساوي 4 و 3 ضرب 5 يساوي 15');
  assert.equal(spokenMath('س = -٢'), 'سين يساوي سالب 2');
  assert.equal(spokenMath('٢س ≥ ٨'), '2 سين أكبر من أو يساوي 8');
  assert.equal(spokenMath('الزاوية ٩٠° والعدد ٣٫٥'), 'الزاوية 90 درجة والعدد 3.5');
  // ordinary words are left alone (a hyphen inside words is not «minus»)
  assert.equal(spokenMath('هلا والله، شحالك؟ كلمة-كلمة'), 'هلا والله، شحالك؟ كلمة-كلمة');
});

test('speech: the bubble drops tashkeel; the voice keeps it', () => {
  assert.equal(stripTashkeel('هَلَا وَاللّٰه، رَسَمْتُ الْمُنْحَنَى'), 'هلا والله، رسمت المنحنى');
  assert.match(speakableText('[happy] هَلَا وَاللّٰه'), /هَلَا/);
  assert.doesNotMatch(speakableText('[happy] هلا'), /happy/);
});

test('speech: a long reply becomes whole sentences (no pause after every word)', () => {
  const short = 'هلا والله. فهمتوا؟ ممتاز.';
  assert.deepEqual(sentenceChunks(short), [short]); // short: one go
  const long = Array.from({ length: 8 }, (_, i) => `هذي الجملة رقم ${i + 1} في الشرح وهي طويلة شوي عشان نختبر التقسيم الصحيح للكلام.`).join(' ');
  const parts = sentenceChunks(long);
  assert.ok(parts.length >= 3 && parts.every((p) => p.length <= 240 && p.length >= 40), parts.map((p) => p.length).join(','));
  assert.equal(parts.join(' ').replace(/\s+/g, ' '), long.replace(/\s+/g, ' '));
});

test('speech: Claude is asked for tashkeel only when the voice is on', () => {
  assert.match(turnContext({ voice: true }), /صوتك شغال/);
  assert.doesNotMatch(turnContext({}), /صوتك شغال/);
  assert.match(personaPrompt({}), /مشكّل تشكيل كامل/);
});

test('speech: the chosen voice is asked first, a natural pace, little pitch shift', async () => {
  assert.equal(VOICE_IDS[0], 'ar-SA-HamedNeural');
  assert.equal(AZURE_VOICES[0], 'ar-SA-HamedNeural');
  let body = '';
  const fetchFn = async (url, init) => { body = init.body; return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) }; };
  const r = await speakAzure({ key: 'k', region: 'uaenorth' }, 'هَلَا', { fetchFn, voices: ['ar-OM-AbdullahNeural'] });
  assert.equal(r.voice, 'ar-OM-AbdullahNeural');
  assert.match(body, /<prosody rate="\+0%" pitch="\+4%">هَلَا<\/prosody>/);
});
