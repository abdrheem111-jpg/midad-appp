// The Claude mind, put together for main.js: Claude's program (installed once), signing in
// with the teacher's own Claude subscription (Claude's own sign-in in the browser, nothing to
// copy or paste), the session, Khalfoun's tools, and the page round-trips the tools need
// (ink, feelings, questions, classroom features, memory).

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import * as realSdk from '@anthropic-ai/claude-agent-sdk';
import { ClaudeBrain, MODELS } from './claude-brain.js';
import { khalfounTools, khalfounServer } from './tools.js';
import { createEyes } from './eyes.js';
import { installClaude, claudeExePath, claudeInstalled, CLAUDE_PROGRAM } from './claude-setup.js';
import { personaPrompt, userTurn, speakable } from '../../core/claude-persona.js';

/** The environment Claude's program runs in: the person's own, minus API keys (the subscription pays). */
export function childEnv(base = process.env) {
  const env = { ...base };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_BASE_URL;
  env.DISABLE_AUTOUPDATER = '1';
  return env;
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

  const eyes = createEyes({ electron: deps.electron, ocrImage: deps.ocrImage, hands: deps.hands, hideWhile: deps.hideWhile, activeWindow: async () => {
    const r = await deps.activeWindow?.();
    return r?.ok ? r.data : null;
  }, platform, log });
  // Anything done on the screen makes the last reading of it stale.
  const runAction = async (action) => { eyes.changed(); return deps.run(action); };
  const tools = khalfounTools({ run: runAction, look: eyes.look, find: eyes.find, screen: eyes.screen, ui: (k, p, ms) => { if (k === 'ink') eyes.changed(); return ui(k, p, ms); }, log });

  function makeBrain() {
    const s = deps.getSettings();
    return new ClaudeBrain({
      sdk,
      exePath: exe(),
      makeServer: () => khalfounServer(sdk, tools),
      toolNames: tools.map((t) => t.name),
      persona: () => {
        const st = deps.getSettings();
        return personaPrompt({ kidsMode: !!st.kidsMode, level: st.level || 1, digits: st.digits || 'arabic' });
      },
      model: MODELS[s.mindModel] || MODELS.smart,
      effort: 'low',
      cwd: join(deps.userData, 'claude-work'),
      env: childEnv(),
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
  async function ask(text, ctx = {}, image = null) {
    if (!warmed && deps.hands && platform === 'win32') { warmed = true; deps.hands.call('ocr_init', {}, 30000).catch(() => {}); }
    if (!brain) {
      await mkdir(join(deps.userData, 'claude-work'), { recursive: true }).catch(() => {});
      brain = makeBrain();
    }
    const t0 = Date.now();
    const res = await brain.ask(userTurn(text, ctx), image ? { image } : {});
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
    status, install, signIn, signInCode, signOut, ask, ui, uiReply, checkAuth, warm,
    stop: () => brain?.stop(),
    reset: () => brain?.reset(),
    setModel: (m) => brain?.setModel(m),
    close: () => { brain?.close(); brain = null; try { login?.child.kill(); } catch { /* gone */ } },
    tools,
  };
}
