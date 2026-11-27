// Khalfoun's mind when the teacher links his Claude subscription: one long-lived Claude
// session (the Claude Agent SDK running the official `claude` program) that hears every
// sentence, decides, and acts through Khalfoun's own tools. No built-in file or shell tools:
// only Khalfoun's hands (an in-process MCP server) and web search.
//
// The SDK is passed in (`sdk`) so tests run with a fake one.

import { providerEnv } from './provider.js';
const DEFAULT_MODEL = 'sonnet';
export const MODELS = { fast: 'haiku', smart: 'sonnet', best: 'opus' };

/** Errors as the person should hear about them. */
export function brainError(text = '') {
  const t = String(text);
  if (/login|log in|authenticat|oauth|credential|api key|invalid.*key|401|not logged/i.test(t)) return 'auth';
  if (/usage limit|rate.?limit|quota|limit reached|exceeded|429|credit/i.test(t)) return 'limit';
  if (/overloaded|529|503|unavailable/i.test(t)) return 'busy';
  if (/ENOENT|spawn|executable|not found.*claude/i.test(t)) return 'no_program';
  if (/network|ECONN|ETIMEDOUT|fetch failed|ENOTFOUND|getaddrinfo/i.test(t)) return 'offline';
  if (/aborted|interrupt/i.test(t)) return 'stopped';
  return 'failed';
}

/** An async queue the SDK reads the teacher's sentences from. */
class Inbox {
  constructor() { this.items = []; this.waiters = []; this.closed = false; }
  push(item) {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false }); else this.items.push(item);
  }
  close() {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined, done: true });
  }
  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift(), done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((r) => this.waiters.push(r));
      },
      return: () => { this.close(); return Promise.resolve({ value: undefined, done: true }); },
    };
  }
}

export class ClaudeBrain {
  /**
   * @param {{sdk: {query: Function}, exePath?: string, 
   *   makeServer: () => object, toolNames: string[], persona: () => string, model?: string,
   *   effort?: string, cwd: string, log?: (...a: any[]) => void, onEvent?: (e: object) => void,
   *   env?: object, idleResetMs?: number, turnTimeoutMs?: number, now?: () => number}} o
   */
  constructor(o) {
    this.o = o;
    this.model = o.model || DEFAULT_MODEL;
    this.session = null; // { q, inbox, loop }
    this.sessionId = null;
    this.turns = []; // pending turns: { resolve, text, started }
    this.current = null;
    this.status = 'off';
    this.lastUse = 0;
    this.now = o.now || Date.now;
    this.log = o.log || (() => {});
    this.emit = (e) => { try { o.onEvent?.(e); } catch { /* the UI is gone */ } };
  }

  setModel(model) {
    const m = MODELS[model] || model;
    if (m && m !== this.model) { this.model = m; this.restart(); }
  }

  options() {
    // the provider layer (provider.js) decides subscription or API key; nothing else touches keys
    const env = this.o.env ? { ...this.o.env } : providerEnv('subscription').env;
    // a key reaches Claude's program only when the teacher chose «مفتاح API» (never by accident)
    if (!this.o.apiKeyChosen) { delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN; delete env.CLAUDE_CODE_OAUTH_TOKEN; }
    const allowed = [...this.o.toolNames.map((n) => `mcp__khalfoun__${n}`), 'WebSearch', 'WebFetch'];
    return {
      model: this.model,
      ...(this.o.exePath ? { pathToClaudeCodeExecutable: this.o.exePath } : {}),
      cwd: this.o.cwd,
      systemPrompt: this.o.persona(),
      tools: ['WebSearch', 'WebFetch'],
      mcpServers: { khalfoun: this.o.makeServer() },
      settingSources: [],
      strictMcpConfig: true,
      permissionMode: 'default',
      // Anything not on the list (shell, files, other servers) is refused.
      canUseTool: async (name, input) => (allowed.includes(name)
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: 'هذي الأداة مو متاحة لخلفون.' }),
      includePartialMessages: true,
      // Quick answers for a voice assistant; Haiku has no effort setting.
      ...(this.o.effort && this.model !== 'haiku' ? { effort: this.o.effort } : {}),
      ...(this.sessionId ? { resume: this.sessionId } : {}),
      env,
      stderr: (d) => this.log('claude stderr', String(d).slice(0, 300)),
    };
  }

  start() {
    if (this.session) return this.session;
    const inbox = new Inbox();
    let q;
    try {
      q = this.o.sdk.query({ prompt: inbox, options: this.options() });
    } catch (err) {
      this.status = 'error';
      this.failAll(brainError(err?.message));
      return null;
    }
    this.status = 'starting';
    const session = { q, inbox };
    session.loop = this.read(session);
    this.session = session;
    return session;
  }

  async read(session) {
    let text = '';
    try {
      for await (const msg of session.q) {
        if (this.session !== session) break;
        if (msg.type === 'system' && msg.subtype === 'init') {
          this.sessionId = msg.session_id || this.sessionId;
          this.status = 'ready';
          this.log('claude session', this.sessionId, msg.model || this.model);
        } else if (msg.type === 'stream_event') {
          const ev = msg.event;
          if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            text += ev.delta.text;
            this.emit({ type: 'delta', text: ev.delta.text });
          } else if (ev?.type === 'message_start') {
            text = '';
          }
        } else if (msg.type === 'assistant') {
          for (const block of msg.message?.content || []) {
            if (block.type === 'tool_use') this.emit({ type: 'tool', name: String(block.name).replace(/^mcp__khalfoun__/, ''), input: block.input });
            else if (block.type === 'text' && block.text) this.emit({ type: 'text', text: block.text });
          }
          if (msg.error) this.log('claude assistant error', msg.error);
        } else if (msg.type === 'result') {
          const ok = !msg.is_error && msg.subtype === 'success';
          const err = ok ? null : brainError(`${msg.subtype} ${msg.result || ''} ${(msg.errors || []).join(' ')}`);
          this.finish(ok ? { ok: true, text: String(msg.result || text || '').trim(), cost: msg.total_cost_usd, ms: msg.duration_ms }
            : { ok: false, error: err, text: String(msg.result || '') });
          text = '';
        }
      }
      if (this.session === session) this.lost('ended');
    } catch (err) {
      this.log('claude session failed', String(err?.message || err).slice(0, 300));
      if (this.session === session) this.lost(brainError(err?.message || String(err)));
    }
  }

  /** The session stopped: pending sentences fail, the next one starts a new session (resumed). */
  lost(reason) {
    this.session = null;
    this.status = reason === 'auth' ? 'auth' : 'off';
    this.failAll(reason === 'ended' ? 'failed' : reason);
  }

  failAll(error) {
    const all = [this.current, ...this.turns].filter(Boolean);
    this.current = null;
    this.turns = [];
    for (const t of all) { clearTimeout(t.timer); t.resolve({ ok: false, error }); }
  }

  finish(result) {
    const t = this.current;
    this.current = null;
    if (t) { clearTimeout(t.timer); t.resolve(result); }
    this.next();
  }

  next() {
    if (this.current || !this.turns.length) { if (!this.current) this.status = this.session ? 'ready' : this.status; return; }
    const session = this.start();
    if (!session) return;
    this.current = this.turns.shift();
    this.status = 'busy';
    const ms = this.o.turnTimeoutMs || 180000;
    this.current.timer = setTimeout(() => this.stop('timeout'), ms);
    session.inbox.push({
      type: 'user',
      message: { role: 'user', content: this.current.content },
      parent_tool_use_id: null,
    });
  }

  /**
   * One sentence from the teacher. Resolves when Claude has finished acting and answering.
   * @param {string} text the sentence with its context (see core/claude-persona userTurn)
   * @param {{image?: {data: string, mime: string}}} [opts]
   */
  ask(text, opts = {}) {
    // A long silence: a fresh conversation (old context costs tokens and confuses).
    const idle = this.o.idleResetMs ?? 45 * 60000;
    if (this.lastUse && this.now() - this.lastUse > idle && !this.current) this.reset();
    this.lastUse = this.now();
    const content = opts.image
      ? [{ type: 'image', source: { type: 'base64', media_type: opts.image.mime, data: opts.image.data } }, { type: 'text', text }]
      : text;
    return new Promise((resolve) => {
      this.turns.push({ content, resolve, started: this.now() });
      this.next();
    });
  }

  get busy() { return Boolean(this.current) || this.turns.length > 0; }

  /** «وقف»: stops what Claude is doing now. */
  async stop(reason = 'stopped') {
    const s = this.session;
    if (!this.current) return;
    try { await s?.q.interrupt?.(); } catch { /* already stopped */ }
    if (this.current) this.finish({ ok: false, error: reason === 'timeout' ? 'timeout' : 'stopped' });
  }

  /** «انسى»: a new conversation. */
  reset() {
    this.sessionId = null;
    this.restart();
  }

  restart() {
    const s = this.session;
    this.session = null;
    if (s) { s.inbox.close(); try { s.q.close?.(); } catch { /* gone */ } }
    if (this.current) this.turns.unshift({ ...this.current, timer: null });
    this.current = null;
    if (this.turns.length) this.next(); else this.status = 'off';
  }

  close() {
    const s = this.session;
    this.session = null;
    this.failAll('stopped');
    if (s) { s.inbox.close(); try { s.q.close?.(); } catch { /* gone */ } }
    this.status = 'off';
  }
}
