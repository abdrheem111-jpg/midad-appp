import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLexicon, pausal, forVoice, pronounceCommand, howDoYouSay, wordKey, BUILTIN } from '../src/core/pronounce.js';
import { speakableText } from '../src/renderer/voice-out.js';
import { speakAzure } from '../src/main/cloud.js';

test('pronunciation dictionary: English names, Omani words and school words are said right, prefixes kept', () => {
  assert.equal(applyLexicon('افتح ملف PDF في الوورد'), 'افتح ملف بي دي إف في الوُورْد');
  assert.equal(applyLexicon('تو وايد زين'), 'تُو وَايِد زِين');
  assert.equal(applyLexicon('والمعادلة للطلاب بالرياضيات'), 'والمُعَادَلَة لِلطُّلَّاب بالرِّيَاضِيَّات');
  assert.equal(applyLexicon('وبعدين'), 'وبَعْدِين');
  assert.equal(applyLexicon('كلمة ما نعرفها'), 'كلمة ما نعرفها'); // unknown words untouched
  // the teacher's correction wins over the built-in one
  assert.equal(applyLexicon('المعادلة', { [wordKey('المعادلة')]: 'المُعادَلَه' }), 'المُعادَلَه');
  assert.equal(wordKey('المُعَادَلَةُ'), 'المعادله');
  for (const v of Object.values(BUILTIN)) assert.ok(v.trim().length > 0);
});

test('the natural stop: no case ending before a pause', () => {
  assert.equal(pausal('ذَهَبَ الطَّالِبُ إِلَى الصَّفِّ.'), 'ذَهَبَ الطَّالِبُ إِلَى الصَّفّ.');
  assert.equal(pausal('شُكْراً'), 'شُكْرا');
  assert.equal(pausal('أَنَا خَلْفُونُ، وَهٰذَا صَوْتِي'), 'أَنَا خَلْفُون، وَهٰذَا صَوْتِي');
  assert.equal(forVoice('هلا، تو نحل المعادلة.'), 'هَلَا، تُو نحل المُعَادَلَة.');
});

test('the voice text: maths as words, then the dictionary (the bubble keeps the words as written)', () => {
  const s = speakableText('[happy] تو نحل: س² = ٩ 🎉');
  assert.match(s, /تُو/);
  assert.match(s, /سِين تَرْبِيع يُسَاوِي 9/);
  assert.doesNotMatch(s, /🎉|\[happy\]/);
  assert.match(speakableText('افتح الطابعة', { [wordKey('الطابعة')]: 'الطّابِعَة' }), /الطّابِعَة/);
});

test('the teacher teaches a word: «انطق X كذا: Y», «X تنقال Y», «كيف تنطق X؟»', () => {
  assert.deepEqual(pronounceCommand('انطق الطابعة كذا: الطّابِعَة'), { word: 'الطابعة', say: 'الطّابِعَة' });
  assert.deepEqual(pronounceCommand('يا خلفون قل كلمة الفلج مثل الفَلَج'), { word: 'الفلج', say: 'الفَلَج' });
  assert.deepEqual(pronounceCommand('نزوى تنقال نِزْوَى'), { word: 'نزوى', say: 'نِزْوَى' });
  assert.equal(pronounceCommand('افتح الوورد'), null);
  assert.equal(howDoYouSay('كيف تنطق المعادلة؟'), 'المعادلة');
  assert.equal(howDoYouSay('كيف حالك'), null);
});

test('Azure gets a calm, clear pace (and the teacher\'s choice)', async () => {
  const bodies = [];
  const fetchFn = async (url, o) => { bodies.push(o.body); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
  await speakAzure({ key: 'k', region: 'uaenorth' }, 'هلا', { fetchFn, voices: ['ar-SA-HamedNeural'] });
  assert.match(bodies[0], /rate="-5%" pitch="\+2%"/);
  await speakAzure({ key: 'k', region: 'uaenorth' }, 'هلا', { fetchFn, voices: ['ar-SA-HamedNeural'], rate: -14 });
  assert.match(bodies[1], /rate="-14%"/);
});
