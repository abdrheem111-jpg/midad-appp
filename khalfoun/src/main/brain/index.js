// The Claude mind, put together for main.js: Claude's program (installed once), signing in
// with the teacher's own Claude subscription (Claude's own sign-in in the browser, nothing to
// copy or paste), the session, Khalfoun's tools, and the page round-trips the tools need
// (ink, feelings, questions, classroom features, memory).

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import * as realSdk from '@anthropic-ai/claude-agent-sdk';
import { ClaudeBrain, MODELS } from './claude-brain.js';
import { providerEnv, providerKind } from './provider.js';
import { khalfounTools, khalfounServer } from './tools.js';
import { createEyes } from './eyes.js';
import { installClaude, claudeExePath, claudeInstalled, CLAUDE_PROGRAM } from './claude-setup.js';
import { personaPrompt, userTurn, speakable, needsScreen } from '../../core/claude-persona.js';
import { TeacherNotes } from './teacher-notes.js';
import { normalize } from '../../core/arabic.js';

/** The environment Claude's program runs in, decided by the provider layer (subscription by default). */
export function childEnv(base = process.env, kind = 'subscription', creds = {}) {
  return providerEnv(kind, creds, base).env;
}

/** Reads `claude auth status --json`. */
export function parseAuthStatus(out) {
  try {
    const j = JSON.parse(String(out).slice(String(out).indexOf('{')));
    return {
      loggedIn: Boolean(j.loggedIn), method: j.authMethod || null,
      email: j.email || j.account?.email || null,
      plan: j.subscriptionType || j.subscription || j.account?.subscriptionType || null,
    };
  } catch { return { loggedIn: false, method: null, email: null, plan: null }; }
}

/**
 * @param {{userData: string, electron: object, run: Function, ocrImage?: Function, activeWindow?: Function,
 *   hideWhile: Function, send: (channel: string, payload: object) => void, log: Function,
 *   getSettings: () => object, fetchFn?: typeof fetch, sdk?: object, spawnFn?: typeof spawn, platform?: string}} deps
 */
export function createClaudeMind(deps) {
  const platform = deps.platform || process.platform;
  const sdk = deps.sdk || realSdk;
  const spawnFn = deps.spawnFn || spawn;
  const log = deps.log;
  const exe = () => (deps.exePath !== undefined ? deps.exePath : claudeExePath(deps.userData, platform));
  let brain = null;
  let login = null; // { child, output }
  let auth = { loggedIn: false, method: null, email: null, plan: null, checked: 0 };
  const pending = new Map(); // page round-trips
  let nextUi = 1;
  let warmed = false;

  const emit = (e) => deps.send('mind:event', e);

  /** Asks the page to do something (draw, feel, ask the teacher...) and waits for its answer. */
  function ui(kind, payload, timeoutMs = 8000) {
    const id = nextUi++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { pending.delete(id); resolve(null); }, timeoutMs);
      pending.set(id, (result) => { clearTimeout(timer); resolve(result); });
      deps.send('mind:ui', { id, kind, payload });
    });
  }

  function uiReply(id, result) {
    const done = pending.get(id);
    if (done) { pending.delete(id); done(result); }
  }

  const eyes = deps.eyes || createEyes({ electron: deps.electron, ocrImage: deps.ocrImage, hands: deps.hands, hideWhile: deps.hideWhile, sensitiveRects: deps.sensitiveRects, log: deps.log, activeWindow: async () => {
    const r = await deps.activeWindow?.();
    return r?.ok ? r.data : null;
  }, platform, log });
  // Anything done on the screen makes the last reading of it stale.
  const runAction = async (action) => { eyes.changed(); return deps.run(action); };
  // What Khalfoun has learned about the teacher (notes + habits), on his computer.
  const notes = deps.notes || new TeacherNotes(join(deps.userData, 'teacher-notes.json'));
  const notesReady = notes.load().catch(() => notes);
  let turnSteps = null; // the tools Claude used in the current turn, to learn habits from
  const tools = khalfounTools({
    digits: () => deps.getSettings().digits || 'arabic', run: runAction, look: eyes.look, find: eyes.find, screen: eyes.screen, snap: eyes.snap,
    ui: (k, p, ms) => { if (k === 'ink') eyes.changed(); return ui(k, p, ms); }, log,
    learn: async (kind, note) => { await notesReady; const n = await notes.add(kind, note); if (n) log('learned', kind, `«${n.text.slice(0, 80)}»`); return n; },
  }).map((t) => ({ ...t, handler: async (a) => { const r = await t.handler(a); turnSteps?.push({ name: t.name, input: a, ok: !r?.isError }); return r; } }));
  const toolByName = new Map(tools.map((t) => [t.name, t]));

  function makeBrain() {
    const s = deps.getSettings();
    return new ClaudeBrain({
      sdk,
      exePath: exe(),
      makeServer: () => khalfounServer(sdk, tools),
      toolNames: tools.map((t) => t.name),
      persona: () => {
        const st = deps.getSettings();
        return personaPrompt({ kidsMode: !!st.kidsMode, level: st.level || 1, digits: st.digits || 'arabic', learned: notes.promptBlock() });
      },
      model: MODELS[s.mindModel] || MODELS.smart,
      effort: 'low',
      cwd: join(deps.userData, 'claude-work'),
      env: childEnv(process.env, providerKind(s), { apiKey: deps.getApiKey?.() || null }),
      apiKeyChosen: providerKind(s) === 'apikey',
      log,
      onEvent: (e) => {
        if (e.type === 'tool') log('claude tool', e.name, JSON.stringify(e.input || {}).slice(0, 160));
        emit(e);
      },
    });
  }

  async function run(args, timeoutMs = 20000) {
    const file = exe();
    if (!file) return { ok: false, out: '', error: 'unsupported' };
    return new Promise((resolve) => {
      let out = '';
      let child;
      try { child = spawnFn(file, args, { windowsHide: true, env: childEnv() }); } catch (err) { resolve({ ok: false, out: '', error: String(err?.message || err) }); return; }
      const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } resolve({ ok: false, out, error: 'timeout' }); }, timeoutMs);
      child.stdout?.on('data', (d) => { out += d; });
      child.stderr?.on('data', (d) => { out += d; });
      child.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, out, error: String(err?.message || err) }); });
      child.on('exit', (code) => { clearTimeout(timer); resolve({ ok: code === 0, out, error: code === 0 ? null : `exit_${code}` }); });
    });
  }

  async function checkAuth() {
    if (!(await claudeInstalled(deps.userData, platform)) && deps.exePath === undefined) return auth;
    const r = await run(['auth', 'status', '--json'], 15000);
    auth = { ...parseAuthStatus(r.out), checked: Date.now() };
    log('claude auth', auth.loggedIn ? `in (${auth.method}${auth.plan ? `, ${auth.plan}` : ''})` : 'out');
    return auth;
  }

  async function status() {
    const installed = deps.exePath !== undefined ? Boolean(deps.exePath) : await claudeInstalled(deps.userData, platform);
    if (installed && Date.now() - auth.checked > 60000 && !login) await checkAuth();
    const s = deps.getSettings();
    return {
      supported: Boolean(CLAUDE_PROGRAM[platform]) || deps.exePath !== undefined,
      installed, loggedIn: installed && auth.loggedIn, email: auth.email, plan: auth.plan, method: auth.method,
      on: s.mind === 'claude', model: s.mindModel || 'smart', busy: Boolean(brain?.busy), signingIn: Boolean(login),
    };
  }

  async function install(onProgress) {
    try {
      await installClaude({ userData: deps.userData, platform, fetchFn: deps.fetchFn, onProgress });
      await mkdir(join(deps.userData, 'claude-work'), { recursive: true });
      return { ok: true };
    } catch (err) {
      log('claude install failed', String(err?.message || err));
      return { ok: false, error: String(err?.message || err) };
    }
  }

  /** Claude's own sign-in: the browser opens on claude.ai; the session is kept by Claude's program. */
  function signIn() {
    if (login) return Promise.resolve({ ok: false, error: 'busy' });
    const file = exe();
    if (!file) return Promise.resolve({ ok: false, error: 'not_installed' });
    return new Promise((resolve) => {
      let child;
      try { child = spawnFn(file, ['auth', 'login', '--claudeai'], { windowsHide: true, env: childEnv() }); } catch (err) { resolve({ ok: false, error: String(err?.message || err) }); return; }
      login = { child, output: '' };
      const onData = (d) => {
        login.output += String(d);
        const url = /https:\/\/claude\.ai\/oauth\/authorize\S*/.exec(login.output)?.[0];
        if (url && !login.url) { login.url = url; emit({ type: 'login', step: 'browser', url }); }
        if (/paste code/i.test(login.output) && !login.askedCode) { login.askedCode = true; emit({ type: 'login', step: 'code' }); }
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, 10 * 60000);
      const end = async (ok, error) => {
        clearTimeout(timer);
        login = null;
        const a = await checkAuth();
        emit({ type: 'login', step: a.loggedIn ? 'done' : 'failed' });
        if (brain) brain.restart();
        resolve(a.loggedIn ? { ok: true, auth: a } : { ok: false, error: error || 'not_signed_in' });
      };
      child.on('error', (err) => end(false, String(err?.message || err)));
      child.on('exit', (code) => end(code === 0, code === 0 ? null : `exit_${code}`));
    });
  }

  /** The code claude.ai shows when the browser cannot hand it over by itself. */
  function signInCode(code) {
    const c = String(code || '').trim();
    if (!login || !c || c.length > 500 || /\s/.test(c)) return { ok: false };
    try { login.child.stdin.write(`${c}\n`); return { ok: true }; } catch { return { ok: false }; }
  }

  async function signOut() {
    brain?.close();
    brain = null;
    const r = await run(['auth', 'logout'], 15000);
    await checkAuth();
    return { ok: r.ok };
  }

  /**
   * One sentence for Claude. Resolves when Claude has finished; its words are already
   * streamed to the page as they come.
   */
  // A screenshot started when the teacher stopped talking (while his words are recognised).
  let early = null;
  function prefetch() {
    if (early && Date.now() - early.at < 5000) return;
    early = { at: Date.now(), promise: eyes.look().catch(() => null) };
  }

  // Commands done at once from his habits, told to Claude in his next message (so it knows).
  let doneAlone = [];
  let lastAlone = null;

  /** A command he gives often, done again exactly as Claude did it: no waiting for Claude. */
  async function fromHabit(text, image) {
    await notesReady;
    const said = normalize(text);
    // «لا / مو كذا / غلط» right after one: that habit was wrong, Claude takes it from here.
    if (lastAlone && Date.now() - lastAlone.at < 30000 && /^(لا|مو كذا|مب كذا|غلط|خطا|مو هذا|مب هذا)( |$)/.test(said)) {
      await notes.forgetHabit(lastAlone.text);
      log('habit forgotten (he corrected it)', `«${lastAlone.text.slice(0, 60)}»`);
      lastAlone = null;
      return null;
    }
    const h = image || needsScreen(said) ? null : notes.habitFor(text);
    if (!h) return null;
    const t0 = Date.now();
    for (const step of h.plan) {
      const tool = toolByName.get(step.name);
      const r = tool ? await tool.handler(step.input).catch(() => ({ isError: true })) : { isError: true };
      if (r?.isError) {
        log('habit failed, asking Claude', step.name);
        await notes.forgetHabit(text);
        return null;
      }
    }
    await notes.used(text);
    doneAlone.push(`«${String(text).slice(0, 80)}» → ${h.plan.map((p) => p.name).join('، ')}`);
    lastAlone = { text, at: Date.now() };
    log('habit done at once', `«${String(text).slice(0, 60)}»`, `${Date.now() - t0} ms`);
    const words = ['[happy] تم.', '[happy] حاضر، تم.', '[proud] سويتها.'];
    return { ok: true, say: speakable(words[Math.floor(Math.random() * words.length)]), ms: Date.now() - t0, habit: true };
  }

  async function ask(text, ctx = {}, image = null) {
    if (!warmed && deps.hands && platform === 'win32') { warmed = true; deps.hands.call('ocr_init', {}, 30000).catch(() => {}); }
    const quick = await fromHabit(text, image);
    if (quick) return quick;
    if (!brain) {
      await mkdir(join(deps.userData, 'claude-work'), { recursive: true }).catch(() => {});
      brain = makeBrain();
    }
    const t0 = Date.now();
    // «اكتب هنا», «كمل وراي», «حل هذي»: the screen goes with the sentence (one round trip less).
    let turn = userTurn(text, ctx);
    if (doneAlone.length) { turn = `[سويتها لحالي من عاداته قبل شوي: ${doneAlone.join(' | ')}]\n${turn}`; doneAlone = []; }
    let pic = image;
    const ready = early && Date.now() - early.at < 15000 ? early : null;
    early = null;
    if (!pic && needsScreen(normalize(text))) {
      const seen = ready ? await ready.promise : await eyes.look().catch(() => null);
      if (ready) log('claude look ready from when he stopped talking', `${Date.now() - ready.at} ms ago`);
      if (seen?.ok) {
        pic = { data: seen.data, mime: seen.mime };
        turn += `\n\n[صورة الشاشة الحين مرفقة: ${seen.width}×${seen.height}${seen.window ? ` · النافذة: ${seen.window}` : ''}${seen.cursor ? ` · الماوس عند (${seen.cursor.x},${seen.cursor.y})` : ''}]${seen.layout ? `\nالنص في الشاشة ومواقعه:\n${seen.layout}` : ''}`;
        log('claude look (with the sentence)', `${seen.width}x${seen.height}`, `${Date.now() - t0} ms`);
      }
    }
    turnSteps = [];
    const res = await brain.ask(turn, pic ? { image: pic } : {});
    const steps = turnSteps;
    turnSteps = null;
    if (res.ok) {
      const h = await notes.record(text, steps).catch(() => null);
      if (h?.count === 2) log('habit learned', `«${String(text).slice(0, 60)}»`, h.plan.map((p) => p.name).join(', '));
    }
    log('claude turn', `«${String(text).slice(0, 80)}»`, '→', res.ok ? `ok ${((Date.now() - t0) / 1000).toFixed(1)} s «${String(res.text).slice(0, 120)}»` : `failed: ${res.error}`);
    if (!res.ok && res.error === 'auth') auth = { ...auth, loggedIn: false, checked: Date.now() };
    return res.ok ? { ok: true, say: speakable(res.text), ms: Date.now() - t0 } : { ok: false, error: res.error };
  }

  /** Starts Claude's program ahead of the first sentence, so the first answer is quick. */
  async function warm() {
    if (brain || !(await claudeInstalled(deps.userData, platform)) && deps.exePath === undefined) return;
    await mkdir(join(deps.userData, 'claude-work'), { recursive: true }).catch(() => {});
    brain = makeBrain();
    brain.start();
    if (deps.hands && platform === 'win32' && !warmed) { warmed = true; deps.hands.call('ocr_init', {}, 30000).catch(() => {}); }
  }

  return {
    status, install, signIn, signInCode, signOut, ask, prefetch, ui, uiReply, checkAuth, warm,
    learned: async () => { await notesReady; return notes.list(); },
    forget: async (id) => { await notesReady; return notes.remove(id); },
    stop: () => brain?.stop(),
    reset: () => brain?.reset(),
    setModel: (m) => brain?.setModel(m),
    close: () => { brain?.close(); brain = null; try { login?.child.kill(); } catch { /* gone */ } },
    tools,
  };
}
