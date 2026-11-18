// Talks to a language model running on this same computer through the common
// OpenAI-style API that Ollama, llama.cpp's server and LM Studio all offer.
// Nothing is sent to the internet: only local addresses are accepted.

import { buildMessages, cleanReply, isSafe, isLocalEndpoint, extractCommand, buildTaskMessages, cleanTaskReply, buildVisionMessages } from '../core/chat-prompt.js';

export const DEFAULT_ENDPOINTS = [
  'http://127.0.0.1:11434/v1', // Ollama
  'http://127.0.0.1:8080/v1', // llama.cpp server
  'http://127.0.0.1:1234/v1', // LM Studio
];

async function getJSON(fetchFn, url, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Looks for a local model server. Returns {endpoint, model} or null.
 * @param {{endpoints?: string[], fetchFn?: typeof fetch, timeoutMs?: number, preferred?: string}} [opts]
 */
export async function findLocalModel(opts = {}) {
  const fetchFn = opts.fetchFn || fetch;
  for (const endpoint of opts.endpoints || DEFAULT_ENDPOINTS) {
    if (!isLocalEndpoint(endpoint)) continue;
    try {
      const data = await getJSON(fetchFn, `${endpoint}/models`, { method: 'GET' }, opts.timeoutMs || 800);
      const models = (data?.data || []).map((m) => m?.id).filter((id) => typeof id === 'string' && id);
      if (!models.length) continue;
      const model = opts.preferred && models.includes(opts.preferred) ? opts.preferred : models.find((m) => !/embed/i.test(m)) || models[0];
      return { endpoint, model, models };
    } catch {
      // nothing listening there
    }
  }
  return null;
}

/** Models that can look at images (Ollama names). */
export const VISION_RE = /(llava|bakllava|qwen2\.5vl|qwen2\.5-vl|qwen2-vl|qwen-vl|gemma3|minicpm-v|llama3\.2-vision|moondream|granite3\.2-vision|mistral-small3\.[12])/i;

/** The first model in the list that understands images, or null. */
export function pickVisionModel(models) {
  return (models || []).find((m) => VISION_RE.test(m)) || null;
}

export class ChatClient {
  /**
   * @param {{endpoint: string, model: string, fetchFn?: typeof fetch, timeoutMs?: number}} opts
   */
  constructor(opts) {
    if (!isLocalEndpoint(opts.endpoint)) throw new Error('endpoint_not_local');
    this.endpoint = opts.endpoint.replace(/\/+$/, '');
    this.model = opts.model;
    this.fetchFn = opts.fetchFn || fetch;
    this.timeoutMs = opts.timeoutMs || 25000;
    this.busy = false;
  }

  /**
   * @param {{text: string, name?: string, kidsMode?: boolean, humor?: number, history?: Array<{user: string, khalfoun: string}>}} ctx
   * @returns {Promise<{ok: true, text: string} | {ok: false, error: string}>}
   */
  /**
   * Works on a piece of text: summarize, explain, questions or solve.
   * @param {{mode: string, text: string, kidsMode?: boolean}} ctx
   */
  async task(ctx) {
    if (this.busy) return { ok: false, error: 'busy' };
    if (!ctx?.text || typeof ctx.text !== 'string') return { ok: false, error: 'bad_text' };
    this.busy = true;
    try {
      const data = await getJSON(this.fetchFn, `${this.endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, messages: buildTaskMessages(ctx), temperature: 0.4, max_tokens: 700, stream: false }),
      }, Math.max(this.timeoutMs, 90000));
      const text = cleanTaskReply(data?.choices?.[0]?.message?.content);
      if (!isSafe(text, !!ctx.kidsMode)) return { ok: false, error: 'unsafe_or_empty' };
      return { ok: true, text };
    } catch (err) {
      return { ok: false, error: err?.name === 'AbortError' ? 'timeout' : String(err?.message || err) };
    } finally {
      this.busy = false;
    }
  }

  /**
   * Looks at a screenshot with a vision model: describe, explain, solve, questions or summarize.
   * @param {{mode: string, image: string, model: string, kidsMode?: boolean}} ctx image = base64 JPEG/PNG
   */
  async vision(ctx) {
    if (this.busy) return { ok: false, error: 'busy' };
    if (!ctx?.image || !ctx.model) return { ok: false, error: 'bad_image' };
    this.busy = true;
    try {
      const data = await getJSON(this.fetchFn, `${this.endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: ctx.model, messages: buildVisionMessages(ctx), temperature: 0.3, max_tokens: 700, stream: false }),
      }, 150000);
      const text = cleanTaskReply(data?.choices?.[0]?.message?.content);
      if (!isSafe(text, !!ctx.kidsMode)) return { ok: false, error: 'unsafe_or_empty' };
      return { ok: true, text };
    } catch (err) {
      return { ok: false, error: err?.name === 'AbortError' ? 'timeout' : String(err?.message || err) };
    } finally {
      this.busy = false;
    }
  }

  async reply(ctx) {
    if (this.busy) return { ok: false, error: 'busy' };
    if (!ctx?.text || typeof ctx.text !== 'string') return { ok: false, error: 'bad_text' };
    this.busy = true;
    try {
      const data = await getJSON(this.fetchFn, `${this.endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, messages: buildMessages(ctx), temperature: 0.8, max_tokens: 160, stream: false }),
      }, this.timeoutMs);
      const rawText = String(data?.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, ' ').trim();
      // The model may answer with a command for the brain instead of a chat line.
      const command = extractCommand(rawText);
      if (command) return { ok: true, command };
      const text = cleanReply(rawText);
      if (!isSafe(text, !!ctx.kidsMode)) return { ok: false, error: 'unsafe_or_empty' };
      return { ok: true, text };
    } catch (err) {
      return { ok: false, error: err?.name === 'AbortError' ? 'timeout' : String(err?.message || err) };
    } finally {
      this.busy = false;
    }
  }
}
