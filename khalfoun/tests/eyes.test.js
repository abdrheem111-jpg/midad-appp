// Khalfoun's eyes: the selected text, the screen (Windows OCR), the program in
// front, and what he does with what he reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Brain } from '../src/core/brain.js';
import { defaultMemory } from '../src/core/memory.js';
import { recognize, parseSee } from '../src/core/intents.js';
import { createPlatform, SEARCH_URLS } from '../src/main/actions/platform.js';
import { validateAction } from '../src/main/actions/index.js';
import { ocrScript, parseOcrOutput, ocrImage } from '../src/main/ocr.js';
import { buildTaskMessages, cleanTaskReply, TASK_MODES } from '../src/core/chat-prompt.js';
import { ChatClient } from '../src/main/chat.js';

function makeBrain(overrides = {}) {
  let now = new Date(2026, 10, 18, 10, 0).getTime();
  const brain = new Brain({ memoryData: { ...defaultMemory(now), onboarded: true, level: 3, ...overrides }, clock: () => now, rng: () => 0.3 });
  return { brain, advance: (ms) => { now += ms; } };
}
/** Says something that reads the screen or the selection, and answers with `text`. */
function see(brain, sentence, text) {
  const r = brain.hear(sentence);
  return { asked: r, answer: brain.actionResult(r.action.id, { ok: true, data: { text } }) };
}

const LESSON = 'الماء يغلي عند مئة درجة مئوية ويتجمد عند صفر درجة. يتكون الماء من الهيدروجين والأكسجين.';

test('what people say to his eyes', () => {
  const cases = [['شو مكتوب', 'read', 'selection'], ['اقرأ اللي محدد', 'read', 'selection'], ['لخص هذا', 'summarize', 'selection'], ['لخصه', 'summarize', 'selection'],
    ['اشرح لي هذا', 'explain', 'selection'], ['سو أسئلة من هذا', 'questions', 'selection'], ['طلع أسئلة عن الدرس', 'questions', 'selection'], ['حل المسألة', 'solve', 'selection'],
    ['احسبها', 'solve', 'selection'], ['دور عنه', 'search', 'selection'], ['ترجمه', 'translate', 'selection'], ['شو معنى هذي الكلمة', 'meaning', 'selection'],
    ['كم كلمة', 'count', 'selection'], ['اقرأ الشاشة', 'read', 'screen'], ['شو تشوف', 'read', 'screen'], ['لخص اللي في الشاشة', 'summarize', 'screen'],
    ['سو أسئلة من الشاشة', 'questions', 'screen']];
  for (const [text, op, source] of cases) assert.deepEqual([recognize(text).intent, recognize(text).slots.op, recognize(text).slots.source], ['see', op, source], text);
  assert.equal(recognize('اكتبها').intent, 'type_last');
  assert.equal(recognize('شو أقدر أسوي هنا').intent, 'context_help');
  for (const text of ['دور عن مطاعم في مسقط', 'اكتب السلام عليكم', 'كم الساعة', 'اختبرني', 'افتح الحاسبة']) assert.equal(parseSee(recognize(text).text), null, text);
});

test('«شو مكتوب» copies the selection and shows it, with what he can do next', () => {
  const { brain } = makeBrain();
  const { asked, answer } = see(brain, 'شو مكتوب', LESSON);
  assert.equal(asked.action.type, 'read_selection');
  assert.equal(asked.situation, 'see_looking');
  assert.equal(answer.situation, 'see_read');
  assert.ok(answer.say.includes('الماء يغلي'), answer.say);
  assert.equal(see(brain, 'شو مكتوب', '   ').answer.situation, 'see_nothing');
});

test('summaries, explanations and questions go to the local model; «اكتبها» types the answer', () => {
  const { brain } = makeBrain();
  brain.setChatAvailable(true);
  const { answer } = see(brain, 'سو أسئلة من هذا', LESSON);
  assert.equal(answer.situation, 'see_thinking');
  assert.deepEqual(answer.ask, { mode: 'questions', text: LESSON });
  const done = brain.taskReply('questions', { ok: true, text: '١. عند كم درجة يغلي الماء؟\nالإجابات:\n١. مئة' });
  assert.equal(done.situation, 'task_answer');
  assert.equal(done.long, true);
  assert.ok(done.say.includes('يغلي') && done.say.includes('اكتبها'));
  const typed = brain.hear('اكتبها');
  assert.equal(typed.action.type, 'type_text');
  assert.ok(typed.action.params.text.startsWith('١. عند كم درجة'));
  assert.equal(brain.taskReply('summarize', { ok: false, error: 'timeout' }).situation, 'task_failed');
});

test('without the local model he says so, and still searches, translates and counts', () => {
  const { brain } = makeBrain();
  assert.equal(see(brain, 'لخص هذا', LESSON).answer.situation, 'see_need_brain');
  assert.equal(brain.hear('اكتبها').situation, 'type_last_none');
  const tr = see(brain, 'ترجمه', 'photosynthesis').answer;
  assert.deepEqual(tr.action.params, { query: 'photosynthesis', engine: 'translate' });
  const mean = see(brain, 'شو معنى هذي الكلمة', 'الاستدامة').answer;
  assert.deepEqual(mean.action.params, { query: 'الاستدامة', engine: 'meaning' });
  const count = see(brain, 'كم كلمة', LESSON).answer;
  assert.equal(count.situation, 'see_count');
  assert.ok(count.say.includes('١٥'), count.say);
  const srch = see(brain, 'دور عنه', 'الخليج العربي').answer;
  assert.deepEqual(srch.action.params, { query: 'الخليج العربي', engine: 'google' });
});

test('«حل هذا» on a selected calculation answers right away; a word problem needs the model', () => {
  const { brain } = makeBrain();
  const r = see(brain, 'حل هذا', '٢٥ × ٤ =').answer;
  assert.equal(r.situation, 'calc_result');
  assert.ok(r.say.includes('١٠٠'));
  assert.equal(brain.hear('اكتبها').action.params.text, '٢٥ × ٤ = ١٠٠');
  assert.equal(see(brain, 'حل المسألة', 'عند أحمد ٥ تفاحات وأكل ٢، كم بقي؟').answer.situation, 'solve_need_brain');
  brain.setChatAvailable(true);
  assert.equal(see(brain, 'حل المسألة', 'عند أحمد ٥ تفاحات وأكل ٢، كم بقي؟').answer.ask.mode, 'solve');
});

test('a follow-up without a new selection uses what he read a moment ago', () => {
  const { brain, advance } = makeBrain();
  brain.setChatAvailable(true);
  see(brain, 'شو مكتوب', LESSON);
  assert.equal(see(brain, 'لخصه', '').answer.ask.text, LESSON);
  advance(11 * 60000);
  assert.equal(see(brain, 'لخصه', '').answer.situation, 'see_nothing');
});

test('reading the screen, and its failures', () => {
  const { brain } = makeBrain();
  const r = brain.hear('اقرأ الشاشة');
  assert.equal(r.action.type, 'read_screen');
  assert.equal(brain.actionResult(r.action.id, { ok: true, data: { text: 'الدرس الثالث: الكسور\nتمرين ١' } }).situation, 'screen_read');
  const u = brain.hear('شو تشوف');
  assert.equal(brain.actionResult(u.action.id, { ok: false, error: 'unsupported' }).situation, 'screen_unsupported');
  const l = brain.hear('اقرأ الشاشة');
  assert.equal(brain.actionResult(l.action.id, { ok: false, error: 'no_ocr_language' }).situation, 'screen_no_language');
});

test('«شو أقدر أسوي هنا» suggests things for the program in front', () => {
  const { brain } = makeBrain();
  const ask = (proc, title) => { const r = brain.hear('شو اقدر اسوي هنا'); return brain.actionResult(r.action.id, { ok: true, data: { process: proc, title } }).situation; };
  assert.equal(ask('WINWORD', 'الدرس.docx - Word'), 'ctx_word');
  assert.equal(ask('msedge', 'ورقة عمل.pdf - Microsoft Edge'), 'ctx_pdf');
  assert.equal(ask('chrome', 'Google'), 'ctx_browser');
  assert.equal(ask('POWERPNT', 'عرض'), 'ctx_powerpoint');
  assert.equal(ask('Spotify', 'Spotify'), 'ctx_other');
});

test('main: reading actions are allowed shapes; translate and meaning use fixed sites', () => {
  for (const type of ['read_selection', 'read_screen', 'active_window']) assert.equal(validateAction({ type, params: {} }), null);
  assert.equal(validateAction({ type: 'search', params: { query: 'x', engine: 'translate' } }), null);
  assert.equal(validateAction({ type: 'search', params: { query: 'x', engine: 'evil' } }), 'bad_search');
  assert.match(SEARCH_URLS.translate('hello'), /^https:\/\/translate\.google\.com\/.*tl=ar.*text=hello/);
  assert.match(SEARCH_URLS.translate('مرحبا'), /tl=en/);
  assert.equal(SEARCH_URLS.meaning('الاستدامة كلمة'), `https://www.almaany.com/ar/dict/ar-ar/${encodeURIComponent('الاستدامة')}/`);
});

test('platform: reading the selection copies it and puts the clipboard back', async () => {
  const calls = [];
  const clipboard = { text: 'قديم', readText() { return this.text; }, writeText(t) { this.text = t; } };
  const run = async (cmd, args) => { calls.push(args.join(' ')); clipboard.text = 'النص المحدد'; return { ok: true, code: 0, stdout: '' }; };
  const p = createPlatform({ platform: 'win32', run, wait: async () => {}, clipboard, beforeType: () => 77, shell: { openExternal: async () => {}, openPath: async () => '' }, paths: {} });
  assert.deepEqual(await p.readSelection(), { ok: true, data: { text: 'النص المحدد' } });
  assert.ok(calls.at(-1).includes('AppActivate(77)') && calls.at(-1).includes("SendKeys('^c')"));
  assert.equal(clipboard.text, 'قديم');
});

test('OCR: the PowerShell script and how its output is read', async () => {
  const script = ocrScript("C:\\tmp\\it's.png");
  assert.ok(script.includes("GetFileFromPathAsync('C:\\tmp\\it''s.png')"));
  assert.ok(script.includes("Language]::new('ar')") && script.includes('TryCreateFromUserProfileLanguages'));
  assert.deepEqual(parseOcrOutput('#LANG ar\r\nالدرس الأول\r\n\r\nتمرين\r\n'), { ok: true, data: { text: 'الدرس الأول\nتمرين', language: 'ar' } });
  assert.deepEqual(parseOcrOutput('#NOENGINE\n'), { ok: false, error: 'no_ocr_language' });
  assert.deepEqual(await ocrImage('x.png', { platform: 'linux' }), { ok: false, error: 'unsupported' });
  let args = null;
  const out = await ocrImage('x.png', { platform: 'win32', run: (cmd, a, o, cb) => { args = a; cb(null, '#LANG en-US\nHello\n'); } });
  assert.deepEqual(out, { ok: true, data: { text: 'Hello', language: 'en-US' } });
  assert.ok(args.includes('-EncodedCommand'));
});

test('model tasks: clear instructions, clean answers, ChatClient.task', async () => {
  assert.deepEqual(TASK_MODES.sort(), ['explain', 'questions', 'solve', 'summarize']);
  const msgs = buildTaskMessages({ mode: 'questions', text: LESSON, kidsMode: true });
  assert.ok(msgs[1].content.includes('خمسة أسئلة') && msgs[1].content.includes(LESSON));
  assert.ok(msgs[0].content.includes('طفل'));
  assert.equal(cleanTaskReply('<think>x</think>**النقطة** الأولى\n\n\n- ثانية'), 'النقطة الأولى\n\n- ثانية');
  const fetchFn = async (url, init) => new Response(JSON.stringify({ choices: [{ message: { content: '- الماء يغلي عند مئة درجة\n- ويتجمد عند الصفر' } }] }), { status: 200 });
  const client = new ChatClient({ endpoint: 'http://127.0.0.1:11434/v1', model: 'm', fetchFn });
  assert.deepEqual(await client.task({ mode: 'summarize', text: LESSON }), { ok: true, text: '- الماء يغلي عند مئة درجة\n- ويتجمد عند الصفر' });
});
