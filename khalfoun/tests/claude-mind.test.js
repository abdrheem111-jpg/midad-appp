// The Claude mind (Khalfoun 2): the session with a fake Claude Agent SDK, the tools Claude
// uses, the picture ↔ screen coordinates, the persona, installing Claude's program, signing
// in, and the new actions' double check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { ClaudeBrain, brainError } from '../src/main/brain/claude-brain.js';
import { khalfounTools } from '../src/main/brain/tools.js';
import { screenMap, pictureScale } from '../src/main/brain/eyes.js';
import { extractFromTgz, installClaude } from '../src/main/brain/claude-setup.js';
import { parseAuthStatus, childEnv, createClaudeMind } from '../src/main/brain/index.js';
import { personaPrompt, userTurn, keysNeedConsent, speakable, FEELINGS } from '../src/core/claude-persona.js';
import { validateAction, createExecutor, KEY_COMBO } from '../src/main/actions/index.js';
import { decide } from '../src/core/permissions.js';
import { yesNo, isStop, FEELING_LOOK, MindClient } from '../src/renderer/mind-ui.js';
import { ANIMATIONS } from '../src/renderer/animations.js';

// ------------------------------------------------------------------ a fake Claude Agent SDK

/** Answers each user message with `script(text)` → list of SDK messages. */
function fakeSdk(script) {
  const calls = [];
  return {
    calls,
    tool: (name, description, schema, handler) => ({ name, description, schema, handler }),
    createSdkMcpServer: (o) => ({ type: 'sdk', name: o.name, tools: o.tools }),
    query({ prompt, options }) {
      calls.push(options);
      let closed = false;
      const it = prompt[Symbol.asyncIterator]();
      async function* run() {
        yield { type: 'system', subtype: 'init', session_id: 'sess-1', model: options.model };
        for (;;) {
          const { value, done } = await it.next();
          if (done || closed) return;
          const text = typeof value.message.content === 'string' ? value.message.content : value.message.content.at(-1).text;
          for (const m of await script(text, options)) yield m;
        }
      }
      const gen = run();
      gen.interrupt = async () => {};
      gen.close = () => { closed = true; };
      return gen;
    },
  };
}
const say = (t) => [
  { type: 'stream_event', event: { type: 'message_start' } },
  { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: t } } },
  { type: 'assistant', message: { content: [{ type: 'text', text: t }] } },
  { type: 'result', subtype: 'success', is_error: false, result: t, total_cost_usd: 0.001, duration_ms: 900 },
];

const brainWith = (sdk, extra = {}) => new ClaudeBrain({
  sdk, makeServer: () => ({ fake: true }), toolNames: ['feel', 'click'], persona: () => 'أنت خلفون', cwd: '/tmp', env: { PATH: '/bin', ANTHROPIC_API_KEY: 'sk-x' }, ...extra,
});

test('a sentence goes to Claude and its words come back, streamed as they are written', async () => {
  const events = [];
  const sdk = fakeSdk(async (t) => say(`سمعتك: ${t.split('\n').at(-1)}`));
  const b = brainWith(sdk, { onEvent: (e) => events.push(e) });
  const r = await b.ask(userTurn('افتح الوورد', { now: new Date(2026, 10, 23, 9, 5), name: 'شاهر' }));
  assert.deepEqual([r.ok, r.text], [true, 'سمعتك: افتح الوورد']);
  assert.ok(events.some((e) => e.type === 'delta'));
  assert.ok(events.some((e) => e.type === 'text' && e.text === 'سمعتك: افتح الوورد'));
  // the subscription pays: no API key reaches Claude's program, only Khalfoun's tools and web search
  const o = sdk.calls[0];
  assert.equal(o.env.ANTHROPIC_API_KEY, undefined);
  assert.deepEqual(o.tools, ['WebSearch', 'WebFetch']);
  assert.deepEqual(o.settingSources, []);
  assert.equal(o.systemPrompt, 'أنت خلفون');
  assert.equal((await o.canUseTool('Bash', {})).behavior, 'deny');
  assert.equal((await o.canUseTool('mcp__khalfoun__click', { x: 1 })).behavior, 'allow');
  assert.equal((await o.canUseTool('mcp__other__x', {})).behavior, 'deny');
  // the same session keeps the conversation
  assert.equal((await b.ask('وبعدين؟')).ok, true);
  assert.equal(sdk.calls.length, 1);
  b.close();
});

test('sentences said quickly one after another wait their turn, in order', async () => {
  const order = [];
  const sdk = fakeSdk(async (t) => { await new Promise((r) => setTimeout(r, t.includes('أولى') ? 30 : 1)); order.push(t); return say(`تم ${t}`); });
  const b = brainWith(sdk);
  const [a, c] = await Promise.all([b.ask('الأولى'), b.ask('الثانية')]);
  assert.deepEqual(order, ['الأولى', 'الثانية']);
  assert.deepEqual([a.text, c.text], ['تم الأولى', 'تم الثانية']);
  b.close();
});

test('not signed in, out of usage, overloaded and offline are told apart', async () => {
  const sdk = fakeSdk(async () => [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Not logged in · Please run /login' }] }, error: 'authentication_failed' },
    { type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' },
  ]);
  assert.deepEqual(await brainWith(sdk).ask('هلا'), { ok: false, error: 'auth', text: 'Not logged in · Please run /login' });
  assert.equal(brainError('Claude usage limit reached. Your limit will reset at 5pm'), 'limit');
  assert.equal(brainError('Overloaded (529)'), 'busy');
  assert.equal(brainError('getaddrinfo ENOTFOUND api.anthropic.com'), 'offline');
  assert.equal(brainError('spawn C:\\x\\claude.exe ENOENT'), 'no_program');
});

test('the session dying fails the sentence; the next one starts again where it was (resume)', async () => {
  let n = 0;
  const sdk = {
    calls: [],
    query({ options }) {
      sdk.calls.push(options);
      n += 1;
      if (n === 1) {
        return (async function* () { yield { type: 'system', subtype: 'init', session_id: 'abc' }; throw new Error('process exited'); }());
      }
      return fakeSdk(async () => say('رجعت')).query({ prompt: { [Symbol.asyncIterator]: () => ({ next: async () => ({ value: { message: { content: 'x' } }, done: false }) }) }, options });
    },
  };
  const b = brainWith(sdk);
  const r1 = await b.ask('هلا');
  assert.equal(r1.ok, false);
  const r2 = await b.ask('هلا مرة ثانية');
  assert.equal(r2.ok, true);
  assert.equal(sdk.calls[1].resume, 'abc');
  b.close();
});

test('a long silence starts a fresh conversation; «انسى» too', async () => {
  let now = 1000;
  const sdk = fakeSdk(async () => say('ok'));
  const b = brainWith(sdk, { now: () => now, idleResetMs: 60000 });
  await b.ask('١');
  now += 120000;
  await b.ask('٢');
  assert.equal(sdk.calls.length, 2);
  assert.equal(sdk.calls[1].resume, undefined);
  b.close();
});

// ------------------------------------------------------------------ the tools

function toolsWith(over = {}) {
  const ran = [];
  const ui = [];
  const ctx = {
    run: async (a) => { ran.push(a); return over.run ? over.run(a) : { ok: true, data: { mode: 'inserted' } }; },
    look: async () => ({ ok: true, data: 'AAAA', mime: 'image/jpeg', width: 1568, height: 882, full: { width: 1568, height: 882 }, cursor: { x: 10, y: 20 }, layout: '(10,20 100×20) السلام عليكم', window: 'مستند1 - Word — WINWORD' }),
    find: async () => ({ ok: true, boxes: [{ x: 700, y: 300, w: 80, h: 24, text: 'الماء' }] }),
    screen: { ...screenMap({ bounds: { x: 0, y: 0, width: 1280, height: 720 }, workArea: { x: 0, y: 0 }, scaleFactor: 2 }) },
    ui: async (kind, payload) => { ui.push([kind, payload]); return over.ui ? over.ui(kind, payload) : { ok: true }; },
    sleep: async () => {},
  };
  const tools = Object.fromEntries(khalfounTools(ctx).map((t) => [t.name, t]));
  return { tools, ran, ui, ctx };
}

test('Claude clicks in the picture; Khalfoun clicks the same spot on the real screen', async () => {
  const { tools, ran } = toolsWith();
  // 2560×1440 physical screen, picture 1568×882: scale 1.633
  const r = await tools.click.handler({ x: 784, y: 441, clicks: 2 });
  assert.equal(r.isError, undefined);
  assert.deepEqual(ran[0], { type: 'mouse_click', params: { x: 1280, y: 720, clicks: 2 } });
  assert.equal(validateAction(ran[0]), null);
  await tools.drag.handler({ from_x: 0, from_y: 0, to_x: 1567, to_y: 881 });
  assert.deepEqual(ran[1].params, { x1: 0, y1: 0, x2: 2558, y2: 1438 });
});

test('looking returns the picture and the words with their places', async () => {
  const { tools } = toolsWith();
  const r = await tools.look_screen.handler({});
  assert.equal(r.content[0].type, 'image');
  assert.match(r.content[1].text, /السلام عليكم/);
  assert.match(r.content[1].text, /1568×882/);
  assert.match(r.content[1].text, /Word/);
  const f = await tools.find_text.handler({ text: 'الماء' });
  assert.match(f.content[0].text, /x=700 y=300 w=80 h=24/);
});

test('closing or deleting shortcuts ask the teacher first; «لا» means nothing is pressed', async () => {
  const { tools, ran, ui } = toolsWith({ ui: (kind) => (kind === 'ask' ? { answer: 'no' } : { ok: true }) });
  const r = await tools.press_keys.handler({ keys: 'Alt+F4' });
  assert.match(r.content[0].text, /ما وافق/);
  assert.equal(ran.length, 0);
  assert.equal(ui[0][0], 'ask');
  await tools.press_keys.handler({ keys: 'ctrl+s' });
  assert.deepEqual(ran[0], { type: 'key_combo', params: { keys: 'ctrl+s' } });
  assert.equal(keysNeedConsent('ctrl + w'), true);
  assert.equal(keysNeedConsent('shift+delete'), true);
  assert.equal(keysNeedConsent('ctrl+z'), false);
});

test('writing on the screen lands exactly where Claude pointed (overlay pixels)', async () => {
  const { tools, ui } = toolsWith();
  await tools.screen_write.handler({ text: 'أحسنت', x: 784, y: 100, color: 'green' });
  const [kind, p] = ui[0];
  assert.equal(kind, 'ink');
  assert.deepEqual(p.at, { x: 640, y: 82 }); // picture → physical ×1.633 → overlay ÷2
  assert.equal(p.color, 'green');
  await tools.screen_mark.handler({ x: 700, y: 300, w: 80, h: 24, kind: 'circle' });
  assert.deepEqual(ui[1][1].boxes[0], { x: 571, y: 245, w: 65, h: 20 });
});

test('Claude writes a worksheet into Word as a checked plan, through the same double check', async () => {
  const { tools, ran } = toolsWith();
  const r = await tools.office_write.handler({ app: 'word', title: 'الكسور', blocks: [{ type: 'paragraph', text: 'حل الأسئلة:' }], questions: [{ q: '١/٢ + ١/٤ = ؟', choices: ['٣/٤', '٢/٦'], answer: '٣/٤' }] });
  assert.match(r.content[0].text, /انكتب/);
  assert.equal(ran[0].type, 'office_put');
  assert.equal(ran[0].params.plan.kind, 'worksheet');
  assert.equal(validateAction(ran[0]), null);
  const fail = await tools.office_write.handler({ app: 'word' });
  assert.equal(fail.isError, true);
});

test('an action that fails is explained to Claude so it can try another way', async () => {
  const { tools } = toolsWith({ run: () => ({ ok: false, error: 'no_office' }) });
  const r = await tools.office_equation.handler({ text: 'س + ٢ = ٥' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /ما فيه وورد/);
});

test('classroom features, memory and questions go through the page', async () => {
  const { tools, ui } = toolsWith({ ui: (kind) => (kind === 'classroom' ? { understood: true, say: 'لفيت العجلة' } : kind === 'ask' ? { answer: 'yes' } : { ok: true }) });
  assert.match((await tools.classroom.handler({ command: 'لف العجلة' })).content[0].text, /لفيت العجلة/);
  assert.match((await tools.ask_user.handler({ question: 'أحذف الملف؟' })).content[0].text, /نعم/);
  await tools.remember.handler({ fact: 'يدرّس رياضيات للصف الخامس' });
  assert.deepEqual(ui.map((u) => u[0]), ['classroom', 'ask', 'remember']);
});

// ------------------------------------------------------------------ coordinates

test('picture, physical screen and overlay coordinates agree (scaled displays too)', () => {
  assert.equal(pictureScale(1366, 768), 1);
  const m = screenMap({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0 }, scaleFactor: 1.25 });
  assert.deepEqual(m.physical, { width: 2400, height: 1350 });
  assert.deepEqual(m.picture, { width: 1568, height: 882 });
  const p = m.toPhysical(1000, 500);
  const back = m.fromPhysical(p.x, p.y);
  assert.ok(Math.abs(back.x - 1000) <= 1 && Math.abs(back.y - 500) <= 1);
  // a taskbar on top shifts the overlay
  const top = screenMap({ bounds: { x: 0, y: 0, width: 1366, height: 768 }, workArea: { x: 0, y: 40 }, scaleFactor: 1 });
  assert.deepEqual(top.toOverlay(100, 100), { x: 100, y: 60 });
  assert.deepEqual(m.toPhysical(99999, -5), { x: 2399, y: 0 });
});

// ------------------------------------------------------------------ persona and context

test('the persona: Omani, short spoken replies, feelings, looks before clicking, asks before risk', () => {
  const p = personaPrompt({ level: 3 });
  for (const must of ['العُمانية', 'look_screen', 'ask_user', 'feel', 'office_write', 'screen_write', 'classroom', 'كلمات سر']) assert.ok(p.includes(must), must);
  assert.match(personaPrompt({ kidsMode: true }), /أطفال/);
  const turn = userTurn('اكتب هنا السلام', { now: new Date(2026, 10, 23, 7, 30), name: 'أ. شاهر', window: 'الدرس.pdf - Edge', students: ['أحمد', 'مريم'] });
  assert.match(turn, /الاثنين 07:30/);
  assert.match(turn, /أ\. شاهر/);
  assert.match(turn, /الدرس\.pdf/);
  assert.match(turn, /أحمد، مريم/);
  assert.ok(turn.endsWith('اكتب هنا السلام'));
  assert.equal(speakable('**تم** فتح الصفحة https://x.y'), 'تم فتح الصفحة');
  assert.equal(speakable('- أول\n- ثاني'), 'أول\nثاني');
  assert.ok(speakable('كلام. '.repeat(200)).length <= 421);
  for (const f of FEELINGS) {
    assert.ok(FEELING_LOOK[f], f);
    if (FEELING_LOOK[f][1]) assert.ok(ANIMATIONS[FEELING_LOOK[f][1]], `${f} → ${FEELING_LOOK[f][1]}`);
  }
});

test('yes, no and stop are understood by voice while Claude waits or works', () => {
  assert.equal(yesNo('ايه سوها'), 'yes');
  assert.equal(yesNo('نعم'), 'yes');
  assert.equal(yesNo('لا خلها'), 'no');
  assert.equal(yesNo('افتح الوورد'), null);
  assert.equal(isStop('وقف!'), true);
  assert.equal(isStop('وقف الموسيقى'), false);
});

test('the page client: a question waits for «نعم», a stop stops, a failure falls back to the classic engine', async () => {
  const replies = [];
  const shown = [];
  let stopped = 0;
  let askResult = { ok: false, error: 'offline' };
  const client = new MindClient({
    bridge: { mind: { ask: async () => askResult, reply: (id, r) => replies.push([id, r]), stop: () => { stopped += 1; } } },
    brain: { memory: { data: { name: 'شاهر' }, set() {} } },
    ink: {}, character: { setEmotion() {} }, animator: { play() {} }, voiceOut: { enabled: false, speaking: false, stop() {} },
    showBubble: (t) => shown.push(t), showChoices() {}, hideChoices() {}, localHear: () => null,
  });
  clearInterval(client.timer);
  await client.onUi({ id: 7, kind: 'ask', payload: { question: 'أسكّر الوورد؟' } });
  assert.equal(await client.ask('ايه'), true);
  assert.deepEqual(replies[0], [7, { answer: 'yes' }]);
  assert.equal(await client.ask('افتح الحاسبة'), false); // offline: the classic engine takes it
  askResult = { ok: true, say: 'فتحت الحاسبة', ms: 1200 };
  assert.equal(await client.ask('افتح الحاسبة'), true);
  assert.equal(shown.at(-1), 'فتحت الحاسبة');
  client.busy = true;
  assert.equal(await client.ask('وقف'), true);
  assert.equal(stopped, 1);
});

// ------------------------------------------------------------------ installing and signing in

/** A tiny .tgz like npm's (ustar), for the extractor. */
function tgz(files) {
  const blocks = [];
  for (const [name, data] of Object.entries(files)) {
    const h = Buffer.alloc(512);
    h.write(name, 0, 'utf8');
    h.write('0000755\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
    h.write('00000000000\0', 136);
    h.write('        ', 148);
    h.write('0', 156);
    h.write('ustar\0', 257); h.write('00', 263);
    let sum = 0; for (const b of h) sum += b;
    h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

test('Claude\'s program is taken out of the official package, checked first', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kh-claude-'));
  const exe = Buffer.alloc(70000, 7);
  const pkg = tgz({ 'package/README.md': Buffer.from('hello'), 'package/claude.exe': exe });
  await writeFile(join(dir, 'p.tgz'), pkg);
  await extractFromTgz(join(dir, 'p.tgz'), 'package/claude.exe', join(dir, 'c.exe'));
  assert.deepEqual(await readFile(join(dir, 'c.exe')), exe);
  await assert.rejects(extractFromTgz(join(dir, 'p.tgz'), 'package/none', join(dir, 'x')), /entry_not_found/);
  // the whole install with a fake download: a wrong checksum is refused
  const sha256 = createHash('sha256').update(pkg).digest('hex');
  const fetchFn = async () => new Response(pkg, { status: 200, headers: { 'content-length': String(pkg.length) } });
  const program = { url: 'https://registry.npmjs.org/x.tgz', sha256, size: pkg.length, entry: 'package/claude.exe', file: 'claude.exe' };
  const out = await installClaude({ userData: dir, platform: 'win32', fetchFn, program });
  assert.deepEqual(await readFile(out), exe);
  await assert.rejects(installClaude({ userData: join(dir, 'b'), platform: 'win32', fetchFn, program: { ...program, sha256: '0'.repeat(64) } }), /checksum_mismatch/);
});

test('sign-in status is read from Claude\'s own program; API keys never reach it', () => {
  assert.deepEqual(parseAuthStatus('{"loggedIn": true, "authMethod": "claude.ai", "email": "t@x.om", "subscriptionType": "pro"}'),
    { loggedIn: true, method: 'claude.ai', email: 't@x.om', plan: 'pro' });
  assert.equal(parseAuthStatus('garbage').loggedIn, false);
  const env = childEnv({ PATH: 'p', ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'u' });
  assert.deepEqual([env.PATH, env.ANTHROPIC_API_KEY, env.ANTHROPIC_BASE_URL], ['p', undefined, undefined]);
});

test('signing in runs «claude auth login», shows the browser step, and the code when asked', async () => {
  const { EventEmitter } = await import('node:events');
  const sent = [];
  const runs = [];
  let stdin = '';
  const spawnFn = (file, args) => {
    runs.push(args.join(' '));
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { write: (d) => { stdin += d; } };
    child.kill = () => {};
    setTimeout(() => {
      if (args[1] === 'login') {
        child.stdout.emit('data', 'Opening browser to sign in…\nIf the browser didn\'t open, visit:\nhttps://claude.ai/oauth/authorize?code=1\nPaste code here if prompted > ');
        setTimeout(() => child.emit('exit', 0), 20);
      } else {
        child.stdout.emit('data', '{"loggedIn": true, "authMethod": "claude.ai", "subscriptionType": "pro"}');
        child.emit('exit', 0);
      }
    }, 5);
    return child;
  };
  const mind = createClaudeMind({
    userData: '/tmp/kh', exePath: '/tmp/claude.exe', platform: 'win32', spawnFn, sdk: fakeSdk(async () => say('هلا')),
    electron: { screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1280, height: 720 }, workArea: { x: 0, y: 0 }, scaleFactor: 1 }) }, desktopCapturer: {} },
    run: async () => ({ ok: true }), hideWhile: (fn) => fn(), send: (ch, p) => sent.push([ch, p]), log: () => {}, getSettings: () => ({ level: 3, mind: 'claude' }),
  });
  const p = mind.signIn();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(mind.signInCode('abc123'), { ok: true });
  const r = await p;
  assert.equal(r.ok, true);
  assert.equal(stdin, 'abc123\n');
  assert.deepEqual(runs, ['auth login --claudeai', 'auth status --json']);
  const steps = sent.filter(([ch, e]) => ch === 'mind:event' && e.type === 'login').map(([, e]) => e.step);
  assert.deepEqual(steps, ['browser', 'code', 'done']);
  const st = await mind.status();
  assert.deepEqual([st.loggedIn, st.plan, st.on], [true, 'pro', true]);
  const a = await mind.ask('هلا', { name: 'شاهر' });
  assert.deepEqual([a.ok, a.say], [true, 'هلا']);
  mind.close();
});

// ------------------------------------------------------------------ the new actions' double check

test('mouse, key combos and web pages are checked twice like every action', async () => {
  assert.equal(validateAction({ type: 'mouse_click', params: { x: 10, y: 20 } }), null);
  assert.equal(validateAction({ type: 'mouse_click', params: { x: 10.5, y: 20 } }), 'bad_point');
  assert.equal(validateAction({ type: 'mouse_click', params: { x: 1, y: 2, modifiers: 'ctrl; rm' } }), 'bad_point');
  assert.equal(validateAction({ type: 'key_combo', params: { keys: 'ctrl+shift+n' } }), null);
  assert.equal(validateAction({ type: 'key_combo', params: { keys: 'ctrl+$(calc)' } }), 'bad_key');
  assert.ok(!KEY_COMBO.test('ctrl+a+b+c+d'));
  assert.equal(validateAction({ type: 'open_web', params: { url: 'https://moe.gov.om/x' } }), null);
  for (const url of ['http://x.om', 'file:///c:/x', 'javascript:alert(1)', 'https://user:pw@x.om']) assert.equal(validateAction({ type: 'open_web', params: { url } }), 'bad_url', url);
  assert.equal(validateAction({ type: 'mouse_scroll', params: { x: 1, y: 1, direction: 'down', amount: 3 } }), null);
  // level 1 cannot click or type
  assert.equal(decide({ type: 'mouse_click', params: { x: 1, y: 1 } }, { level: 1 }).allowed, false);
  assert.equal(decide({ type: 'mouse_click', params: { x: 1, y: 1 } }, { level: 3 }).allowed, true);
  // the executor hands mouse and keys to the hands process
  const calls = [];
  const exec = createExecutor({ platform: {}, getSettings: () => ({ level: 3 }), hands: { call: async (op, args) => { calls.push([op, args]); return { ok: true }; } } });
  await exec.run({ type: 'mouse_click', params: { x: 5, y: 6, clicks: 2 } });
  await exec.run({ type: 'key_combo', params: { keys: 'ctrl+s' } });
  assert.deepEqual(calls, [['click', { x: 5, y: 6, button: 'left', double: true, triple: false, modifiers: '' }], ['keys', { keys: 'ctrl+s', times: 1 }]]);
});

test('the hands script only knows fixed operations and checks every key and point', async () => {
  const ps = await readFile(new URL('../src/main/brain/hands.ps1', import.meta.url), 'utf8');
  assert.match(ps, /SetProcessDPIAware/);
  assert.match(ps, /default \{ throw 'bad_op' \}/);
  assert.match(ps, /throw 'bad_key'/);
  assert.match(ps, /throw 'off_screen'/);
  assert.doesNotMatch(ps, /Invoke-Expression|iex |Start-Process|\[scriptblock\]/i);
});

test('on Windows: the hands script parses, and really moves the mouse and reads it back', { skip: process.platform !== 'win32' }, async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const file = fileURLToPath(new URL('../src/main/brain/hands.ps1', import.meta.url));
  const check = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${file.replace(/'/g, "''")}', [ref]$null, [ref]$e); if ($e.Count) { $e | ForEach-Object { $_.Message }; exit 1 }`], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stdout + check.stderr);
  const { OfficeHost } = await import('../src/main/office/office-host.js');
  const host = new OfficeHost({ tempDir: join(tmpdir(), 'kh-hands-test'), scriptPath: file, copyName: 'khalfoun-hands-test.ps1', sta: false, timeoutMs: 20000 });
  try {
    assert.deepEqual(await host.call('ping'), { ok: true, data: 'pong' });
    assert.equal((await host.call('move', { x: 37, y: 41 })).ok, true);
    const at = await host.call('cursor');
    assert.deepEqual(at, { ok: true, data: { x: 37, y: 41 } });
    assert.deepEqual(await host.call('keys', { keys: 'ctrl+$(calc)', times: 1 }), { ok: false, error: 'bad_key' });
    assert.deepEqual(await host.call('move', { x: 999999, y: 5 }), { ok: false, error: 'off_screen' });
    assert.deepEqual(await host.call('nope'), { ok: false, error: 'bad_op' });
  } finally {
    host.stop();
  }
});

test('live test fix: Claude\'s typing goes where it clicked, never back to the window before Khalfoun', async () => {
  // On the teacher's PC the text went to the Downloads window (the one before the command box).
  const { tools, ran } = toolsWith();
  await tools.type_text.handler({ text: 'السلام عليكم' });
  assert.deepEqual(ran[0], { type: 'type_text', params: { text: 'السلام عليكم', here: true } });
  assert.equal(validateAction(ran[0]), null);
  const order = [];
  const { createPlatform } = await import('../src/main/actions/platform.js');
  let clip = 'قديم';
  const platform = createPlatform({ platform: 'win32', clipboard: { readText: () => clip, writeText: (t) => { order.push(`clip:${t}`); clip = t; } }, beforeType: () => { order.push('activate-old-window'); return 1234; } });
  const exec = createExecutor({ platform, getSettings: () => ({ level: 3 }), hands: { call: async (op, args) => { order.push(`${op}:${args.keys}`); return { ok: true }; } } });
  const r = await exec.run({ type: 'type_text', params: { text: 'السلام عليكم', here: true } });
  assert.equal(r.ok, true);
  assert.deepEqual(order, ['clip:السلام عليكم', 'keys:ctrl+v', 'clip:قديم']);
});

test('live test fix: «فوق في النص» writes centred where Claude points, letters sized in picture pixels', async () => {
  const { tools, ui } = toolsWith();
  await tools.screen_write.handler({ text: 'أحسنتم يا أبطال', x: 784, y: 80, size: 40, color: 'green' });
  const p = ui[0][1];
  assert.equal(p.anchor, 'center');
  assert.deepEqual(p.at, { x: 640, y: 65 });
  assert.equal(p.size, 33); // 40 picture px × 1.633 physical ÷ 2 (scale factor)
  const persona = personaPrompt();
  assert.match(persona, /السرعة/);
  assert.match(persona, /نص الكلام \(الوسط\)/);
});

test('live test fix: the feeling comes with the words (one trip to Claude instead of two)', async () => {
  const { splitFeeling } = await import('../src/core/claude-persona.js');
  assert.deepEqual(splitFeeling('[happy] هلا والله'), { feeling: 'happy', text: 'هلا والله' });
  assert.deepEqual(splitFeeling('هلا'), { feeling: null, text: 'هلا' });
  assert.equal(splitFeeling('[weird] هلا').feeling, null);
  assert.equal(speakable('[proud] كتبت الفقرة.'), 'كتبت الفقرة.');
  assert.match(personaPrompt(), /\[happy\]/);
  const feelings = [];
  const shown = [];
  const client = new MindClient({
    bridge: { mind: {} }, brain: { memory: { data: {} } }, ink: {}, animator: { play() {} },
    character: { setEmotion: (e) => feelings.push(e.emotion) }, voiceOut: { enabled: false },
    showBubble: (t) => shown.push(t), localHear: () => null,
  });
  clearInterval(client.timer);
  client.onEvent({ type: 'text', text: '[excited] يلا نبدأ!' });
  assert.deepEqual([feelings.at(-1), shown.at(-1)], ['excited', 'يلا نبدأ!']);
});

test('on Windows: the focus helper brings back the exact window, without sending Alt', { skip: process.platform !== 'win32' }, async () => {
  const { spawn } = await import('node:child_process');
  const { FG_SCRIPT } = await import('../src/main/foreground-script.js');
  assert.doesNotMatch(FG_SCRIPT, /keybd_event\(0x12/); // no Alt tap (Notepad menu mode ate the paste)
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(FG_SCRIPT, 'utf16le').toString('base64')], { stdio: ['pipe', 'pipe', 'ignore'] });
  child.stdout.setEncoding('utf8');
  let buf = '';
  const waiters = [];
  child.stdout.on('data', (d) => { buf += d; let nl; while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); waiters.shift()?.(line); } });
  const ask = (req) => new Promise((r) => { waiters.push(r); child.stdin.write(`${req}\n`); });
  const parse = (l) => { const [pid, proc, hwnd, ...t] = l.split('\t'); return { pid: Number(pid), proc, hwnd, title: t.join(' ') }; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const opened = [];
  try {
    // two windows of two programs: mspaint/charmap are absent on Server, so two Notepads by file
    const dir = await mkdtemp(join(tmpdir(), 'kh-fg-'));
    await writeFile(join(dir, 'first.txt'), 'first');
    await writeFile(join(dir, 'second.txt'), 'second');
    opened.push(spawn('notepad.exe', [join(dir, 'first.txt')], { detached: true, stdio: 'ignore' }));
    await sleep(2500);
    const first = parse(await ask('fg'));
    opened.push(spawn('notepad.exe', [join(dir, 'second.txt')], { detached: true, stdio: 'ignore' }));
    await sleep(2500);
    const second = parse(await ask('fg'));
    if (!/first/i.test(first.title) || !/second/i.test(second.title)) { console.log('no interactive desktop:', first.title, '|', second.title); return; }
    assert.notEqual(first.hwnd, second.hwnd);
    const back = parse(await ask(`acth ${first.hwnd}`));
    assert.equal(back.hwnd, first.hwnd, `foreground is «${back.title}»`);
  } finally {
    child.stdin.end();
    child.kill();
    spawn('taskkill', ['/IM', 'notepad.exe', '/F'], { stdio: 'ignore' });
  }
});

// ------------------------------------------------------------ maths teacher, PDF, windows

test('maths drawing: one call draws a triangle, a fraction and a ✓ where Claude pointed', async () => {
  const { tools, ui } = toolsWith();
  const r = await tools.screen_draw.handler({ items: [
    { type: 'polygon', points: [[100, 100], [300, 100], [200, 250]], labels: ['أ', 'ب', 'ج'] },
    { type: 'fraction', x: 784, y: 441, top: '٣', bottom: '٤' },
    { type: 'check', x: 784, y: 100 },
    { type: 'bogus', x: 1, y: 1 },
  ] });
  assert.equal(r.isError, undefined);
  assert.match(r.content[0].text, /رسمت 3/);
  const [kind, p] = ui[0];
  assert.equal(kind, 'ink');
  assert.equal(p.op, 'sketch');
  assert.equal(p.shapes.length, 3);
  assert.deepEqual({ x: p.shapes[1].x, y: p.shapes[1].y }, { x: 640, y: 360 }); // picture centre → overlay centre
  assert.equal(p.shapes[0].labels.length, 3);
});

test('maths text looks like maths on the screen', async () => {
  const { mathText } = await import('../src/core/math-sketch.js');
  assert.equal(mathText('x^2 + y^2'), 'x² + y²');
  assert.equal(mathText('sqrt(16) * 2 >= pi'), '√(16) × 2 ≥ π');
  assert.equal(mathText('a_1 != a_2'), 'a₁ ≠ a₂');
  const { tools, ui } = toolsWith();
  await tools.screen_write.handler({ text: 'س^2 = 9', x: 500, y: 100 });
  assert.equal(ui[0][1].text, 'س\uE000٢\uE001 = ٩');
});

test('sentences about the screen take the screenshot along; others do not', async () => {
  const { needsScreen } = await import('../src/core/claude-persona.js');
  const { normalize } = await import('../src/core/arabic.js');
  for (const t of ['كمل وراي', 'اكتب الجواب هنا', 'حل المسألة اللي قدامك', 'ارسم دائرة فوق الشكل', 'صحح هذا']) assert.equal(needsScreen(normalize(t)), true, t);
  for (const t of ['افتح الوورد', 'هلا خلفون', 'شو الوقت', 'سكر الكروم']) assert.equal(needsScreen(normalize(t)), false, t);
});

test('window list from the hands process, without Khalfoun itself', async () => {
  const { parseWindows } = await import('../src/main/brain/tools.js');
  const w = parseWindows('123\tAcroRd32\tmax\t0,0,1920,1040\tدرس الكسور.pdf - Adobe Acrobat\n456\tKhalfoun\tnormal\t0,0,10,10\tKhalfoun\nbad line\n789\tnotepad\tmin\t5,5,800,600\t*بدون عنوان - Notepad');
  assert.deepEqual(w.map((x) => x.id), ['123', '789']);
  assert.equal(w[0].title, 'درس الكسور.pdf - Adobe Acrobat');
  assert.equal(w[1].state, 'min');
});

test('window control goes through the double check; closing unsaved work asks first', async () => {
  const list = '123\tAcroRd32\tnormal\t0,0,800,600\tدرس.pdf - Adobe Acrobat\n789\tnotepad\tnormal\t0,0,800,600\t*ملاحظات - Notepad';
  const { tools, ran, ui } = toolsWith({
    run: (a) => (a.type === 'window_list' ? { ok: true, data: list } : { ok: true }),
    ui: (kind) => (kind === 'ask' ? { answer: 'no' } : { ok: true }),
  });
  const l = await tools.windows.handler({ action: 'list' });
  assert.match(l.content[0].text, /id=123 · AcroRd32/);
  await tools.windows.handler({ action: 'maximize', id: '123' });
  assert.deepEqual(ran.at(-1), { type: 'window_op', params: { hwnd: '123', op: 'maximize' } });
  for (const a of ran) assert.equal(validateAction(a), null);
  const before = ran.length;
  const c = await tools.windows.handler({ action: 'close', id: '789' });
  assert.match(c.content[0].text, /ما وافق/);
  assert.equal(ui.at(-1)[0], 'ask');
  assert.equal(ran.slice(before).some((a) => a.type === 'window_op'), false);
  // the double check refuses a made-up handle or operation
  assert.equal(validateAction({ type: 'window_op', params: { hwnd: 'abc', op: 'close' } }), 'bad_window');
  assert.equal(validateAction({ type: 'window_op', params: { hwnd: '1', op: 'format_disk' } }), 'bad_window');
  assert.equal(decide({ type: 'window_op', params: {} }, { level: 3 }).allowed, true);
  assert.equal(decide({ type: 'window_list', params: {} }, { level: 0 }).allowed, true);
});

test('persona teaches the maths-teacher way: after his line, never over text, PDF ink is cleared on a new page', () => {
  const p = personaPrompt({});
  for (const must of ['وراي', 'screen_draw', 'PDF', 'screen_clear', 'windows', 'fraction']) assert.ok(p.includes(must), must);
});

test('MindClient draws a sketch on the ink layer', () => {
  const drawn = [];
  const ink = { sketch: (sh, o) => drawn.push([sh, o]) };
  const m = new MindClient({ ink, character: { setPenColor() {} }, animator: { play() {} }, colorHex: () => '#C0392B' });
  clearInterval(m.timer);
  assert.deepEqual(m.ink({ op: 'sketch', shapes: [{ type: 'point', x: 1, y: 2 }], color: 'red' }), { ok: true });
  assert.equal(drawn.length, 1);
  assert.equal(drawn[0][1].color, 'red');
});

test('Omani maths by default: Arabic digits, س ص ع, small raised Arabic powers on the screen', async () => {
  const { mathText, mathRuns, tickText, MARK } = await import('../src/core/math-sketch.js');
  const ar = mathText('2x^2 + 3y = 10', { digits: 'arabic' });
  assert.equal(ar, `٢س${MARK.supOpen}٢${MARK.supClose} + ٣ص = ١٠`);
  assert.deepEqual(mathRuns(ar).map((r) => r.kind), ['base', 'sup', 'base']);
  assert.equal(mathText('x² - 4 = 0', { digits: 'arabic', office: true }), 'س² - ٤ = ٠');
  assert.equal(mathText('3.5 * 2 = 7, z?', { digits: 'arabic' }), '٣٫٥ × ٢ = ٧، ع؟');
  assert.equal(mathText('max + box', { digits: 'arabic' }), 'max + box'); // only lone x y z are unknowns
  assert.equal(tickText(12), '١٢');
  assert.match(tickText(-3), /-٣/);
  // the tools use the teacher's setting: Arabic unless he chose Latin
  const { tools, ui } = toolsWith();
  await tools.screen_write.handler({ text: 'x = 5', x: 500, y: 100 });
  assert.equal(ui.at(-1)[1].text, 'س = ٥');
  await tools.screen_draw.handler({ items: [{ type: 'axes', x: 700, y: 400 }, { type: 'fraction', x: 300, y: 300, top: '3', bottom: '4' }] });
  const sk = ui.at(-1)[1].shapes;
  assert.equal(sk[0].digits, 'arabic');
  assert.deepEqual([sk[1].top, sk[1].bottom], ['٣', '٤']);
  const latin = toolsWith();
  latin.ctx.digits = () => 'latin';
  const lt = Object.fromEntries(khalfounTools(latin.ctx).map((t) => [t.name, t]));
  await lt.screen_write.handler({ text: 'x = 5', x: 500, y: 100 });
  assert.equal(latin.ui.at(-1)[1].text, 'x = 5');
});

test('the persona tells Claude: Arabic digits and س ص ع always, even over an English page', () => {
  const p = personaPrompt({});
  assert.match(p, /س، ص، ع/);
  assert.match(p, /حتى لو الصفحة/);
  assert.doesNotMatch(p, /إلا إذا الكتاب اللي قدامه بالإنجليزي/);
});
