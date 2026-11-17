// Picks what Khalfoun says: filters the reply bank by situation, humor level and
// available variables, weights by emotion fit and learned preferences, avoids
// recent repeats, then fills in the variables.

import { NAME_FALLBACKS } from './templates/ar-om.js';

const VAR_RE = /\{(\w+)\}/g;
const RECENT_LIMIT = 100;

export class ResponseEngine {
  /**
   * @param {{templates: Array<object>, rng?: () => number, memory?: import('./memory.js').Memory}} opts
   */
  constructor({ templates, rng = Math.random, memory = null }) {
    this.rng = rng;
    this.memory = memory;
    this.recent = [];
    this.bySituation = new Map();
    const ids = new Set();
    for (const t of templates) {
      if (ids.has(t.id)) throw new Error(`Duplicate template id: ${t.id}`);
      ids.add(t.id);
      const vars = [...t.t.matchAll(VAR_RE)].map((m) => m[1]);
      const entry = { ...t, vars, w: t.w ?? 1, h: t.h ?? 0 };
      if (!this.bySituation.has(t.s)) this.bySituation.set(t.s, []);
      this.bySituation.get(t.s).push(entry);
    }
  }

  has(situation) { return this.bySituation.has(situation); }

  /** Number of distinct sentences the bank can produce for a situation. */
  count(situation) { return (this.bySituation.get(situation) || []).length; }

  /**
   * @param {string} situation
   * @param {{emotion?: string, humor?: number, vars?: Record<string, any>, name?: string}} [ctx]
   * @returns {{id: string, text: string, animation: string|null, cat: string|null}|null}
   */
  say(situation, ctx = {}) {
    const list = this.bySituation.get(situation);
    if (!list) return null;
    const humor = ctx.humor ?? 1;
    const vars = ctx.vars || {};
    const usable = list.filter((t) => t.h <= humor && t.vars.every((v) => v === 'name' || (vars[v] !== undefined && vars[v] !== null)));
    if (!usable.length) return null;

    const fresh = usable.filter((t) => !this.recent.includes(t.id));
    const pool = fresh.length ? fresh : usable;
    const weights = pool.map((t) => {
      let w = t.w;
      if (t.e && t.e !== '*') w *= t.e === ctx.emotion ? 2.5 : 0.2;
      if (this.memory && t.cat) w *= this.memory.preference(t.cat);
      if (this.memory) w /= 1 + 0.05 * (this.memory.data.seen[t.id] || 0);
      return Math.max(w, 0.0001);
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.rng() * total;
    let chosen = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i += 1) {
      r -= weights[i];
      if (r < 0) { chosen = pool[i]; break; }
    }

    this.recent.push(chosen.id);
    if (this.recent.length > RECENT_LIMIT) this.recent.shift();
    if (this.memory) this.memory.recordSeen(chosen.id);

    return { id: chosen.id, text: this.fill(chosen.t, vars, ctx.name), animation: chosen.a || null, cat: chosen.cat || null };
  }

  fill(text, vars, name) {
    const fallback = NAME_FALLBACKS[Math.floor(this.rng() * NAME_FALLBACKS.length) % NAME_FALLBACKS.length];
    let out = text;
    if (name) {
      out = out.replace(/\{name\}/g, name);
    } else {
      out = out.replace(/يا \{name\}/g, fallback).replace(/\{name\}/g, fallback);
    }
    return out.replace(VAR_RE, (_, key) => String(vars[key] ?? '')).replace(/\s+([؟،.!])/g, '$1').replace(/\s{2,}/g, ' ').trim();
  }
}
