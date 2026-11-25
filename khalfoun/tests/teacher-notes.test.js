import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TeacherNotes, habitKey } from '../src/main/brain/teacher-notes.js';
import { createClaudeMind } from '../src/main/brain/index.js';
import { screenMap } from '../src/main/brain/eyes.js';
import { personaPrompt } from '../src/core/claude-persona.js';

const tmp = () => mkdtemp(join(tmpdir(), 'kh-notes-'));

test('notes: Khalfoun learns the teacher, the same thing twice gets stronger, not repeated', async () => {
  const file = join(await tmp(), 'teacher-notes.json');
  const n = await new TeacherNotes(file).load();
  await n.add('word', '«الكتاب» يعني ملف كتاب الطالب PDF حق الصف العاشر');
  await n.add('like', 'يحب الرسم باللون الأزرق والخط العريض');
  await n.add('word', '«الكتاب» يعني ملف كتاب الطالب PDF حق الصف العاشر');
  await n.add('fix', 'الوسيط مو المتوسط');
  assert.equal(n.list().notes.length, 3);
  assert.equal(n.data.notes.find((x) => x.kind === 'word').uses, 2);
  // kept on his computer and read back next time
  const again = await new TeacherNotes(file).load();
  assert.equal(again.list().notes.length, 3);
  const block = again.promptBlock();
  assert.match(block, /كلماته:\n- «الكتاب»/);
  assert.match(block, /طريقته المفضلة:\n- يحب الرسم باللون الأزرق/);
  assert.match(personaPrompt({ learned: block }), /## اللي تعلمته عن المعلم\nكلماته:/);
  // forgetting one
  const id = again.list().notes.find((x) => x.kind === 'fix').id;
  assert.equal(await again.remove(id), true);
  assert.equal(again.list().notes.length, 2);
  assert.equal(await again.remove(999), false);
});

test('habits: the same simple steps twice make a habit; anything that needs the screen never does', async () => {
  const n = await new TeacherNotes(join(await tmp(), 'n.json')).load();
  const open = [{ name: 'open_file', input: { path: 'C:/Users/t/Desktop/كتاب العاشر.pdf' }, ok: true }];
  assert.equal(habitKey('يا خلفون، افتح الكتاب لو سمحت!'), habitKey('افتح الكتاب'));
  await n.record('افتح الكتاب', open);
  assert.equal(n.habitFor('افتح الكتاب'), null); // once is not a habit
  await n.record('يا خلفون افتح الكتاب', open);
  assert.equal(n.habitFor('افتح الكتاب لو سمحت').plan[0].name, 'open_file');
  assert.equal(n.list().habits.length, 1);
  // a different way the next time starts again
  await n.record('افتح الكتاب', [{ name: 'open_file', input: { path: 'C:/other.pdf' }, ok: true }]);
  assert.equal(n.habitFor('افتح الكتاب'), null);
  // steps that depend on what is on the screen, or failed, are not learned
  await n.record('اكتب الجواب', [{ name: 'type_text', input: { text: '٥' }, ok: true }]);
  await n.record('اكتب الجواب', [{ name: 'type_text', input: { text: '٥' }, ok: true }]);
  assert.equal(n.habitFor('اكتب الجواب'), null);
  await n.record('افتح الوورد', [{ name: 'open_app', input: { name: 'word' }, ok: false }]);
  await n.record('افتح الوورد', [{ name: 'open_app', input: { name: 'word' }, ok: false }]);
  assert.equal(n.habitFor('افتح الوورد'), null);
});

function fakeSdk(answer) {
  const turns = [];
  return {
    turns,
    tool: (name, description, schema, handler) => ({ name, handler }),
    createSdkMcpServer: ({ tools }) => ({ tools }),
    query: ({ prompt, options }) => {
      const server = options.mcpServers.khalfoun;
      return (async function* gen() {
        yield { type: 'system', subtype: 'init', session_id: 's1', model: 'm' };
        for await (const msg of prompt) {
          const text = typeof msg.message.content === 'string' ? msg.message.content : msg.message.content.map((c) => c.text || '').join('');
          turns.push(text);
          const out = await answer(text, server);
          yield { type: 'assistant', message: { content: [{ type: 'text', text: out }] } };
          yield { type: 'result', subtype: 'success', result: out, session_id: 's1' };
        }
      })();
    },
  };
}

test('habits: the third time «افتح الكتاب» is done at once, without Claude; «لا» right after forgets it', async () => {
  const userData = await tmp();
  const ran = [];
  const sdk = fakeSdk(async (text, server) => {
    if (/افتح الكتاب/.test(text)) {
      const t = server.tools.find((x) => x.name === 'open_file');
      await t.handler({ path: 'C:/Users/t/Desktop/كتاب.pdf' });
      return '[happy] فتحته.';
    }
    return '[happy] تمام.';
  });
  const eyes = { look: async () => ({ ok: false }), find: async () => ({ ok: true, boxes: [] }), changed() {}, screen: screenMap({ bounds: { x: 0, y: 0, width: 1280, height: 720 }, workArea: { x: 0, y: 0 }, scaleFactor: 1 }) };
  const mind = createClaudeMind({ userData, exePath: '/tmp/claude.exe', platform: 'linux', sdk, eyes,
    run: async (a) => { ran.push(a); return { ok: true }; }, hideWhile: (fn) => fn(), send() {}, log() {}, getSettings: () => ({ level: 3, mind: 'claude' }) });
  await mind.ask('افتح الكتاب', {});
  await mind.ask('يا خلفون افتح الكتاب', {});
  assert.equal(sdk.turns.length, 2);
  const r = await mind.ask('افتح الكتاب', {});
  assert.equal(r.habit, true);
  assert.equal(sdk.turns.length, 2); // Claude was not asked
  assert.deepEqual(ran.at(-1), { type: 'open_file', params: { path: 'C:/Users/t/Desktop/كتاب.pdf' } });
  // Claude hears about it in the next message
  await mind.ask('لا مو هذا، قصدي كتاب النشاط', {});
  assert.match(sdk.turns.at(-1), /سويتها لحالي من عاداته/);
  // and the wrong habit is gone: next time Claude is asked again
  const before = sdk.turns.length;
  await mind.ask('افتح الكتاب', {});
  assert.equal(sdk.turns.length, before + 1);
  const saved = JSON.parse(await readFile(join(userData, 'teacher-notes.json'), 'utf8'));
  assert.ok(saved.habits);
  mind.close();
});

test('learn tool: what Claude learns is kept and shown in settings', async () => {
  const userData = await tmp();
  const sdk = fakeSdk(async (text, server) => {
    await server.tools.find((x) => x.name === 'learn').handler({ kind: 'like', note: 'يحب الخطوات مرقمة وبالأسهم' });
    return '[happy] تمام.';
  });
  const eyes = { look: async () => ({ ok: false }), find: async () => ({ ok: true, boxes: [] }), changed() {}, screen: screenMap({ bounds: { x: 0, y: 0, width: 1280, height: 720 }, workArea: { x: 0, y: 0 }, scaleFactor: 1 }) };
  const mind = createClaudeMind({ userData, exePath: '/tmp/claude.exe', platform: 'linux', sdk, eyes, run: async () => ({ ok: true }), hideWhile: (fn) => fn(), send() {}, log() {}, getSettings: () => ({ level: 3 }) });
  await mind.ask('ارسم بالخطوات وبالأسهم دايماً', {});
  const l = await mind.learned();
  assert.equal(l.notes[0].kind, 'like');
  assert.match(l.notes[0].text, /بالأسهم/);
  assert.equal(await mind.forget(l.notes[0].id), true);
  assert.equal((await mind.learned()).notes.length, 0);
  mind.close();
});
