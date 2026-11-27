// Khalfoun's maths engine for the main process: one worker thread running SymPy, started in the
// background, restarted if it ever stops or takes too long. Claude (and the fast local layer)
// call solve(); the steps come back with their reasons in Arabic.

import { Worker } from 'node:worker_threads';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toEngine, MATH_TASKS } from '../../core/math-input.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Files packed inside app.asar are run from app.asar.unpacked (a worker and WebAssembly need real files). */
export function unpacked(p) {
  const u = p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  return u !== p && existsSync(u) ? u : p;
}

export function enginePaths(root = join(HERE, '..', '..', '..')) {
  const pyDir = unpacked(join(root, 'node_modules', 'pyodide'));
  const wheelsDir = unpacked(join(root, 'assets', 'math'));
  const wheels = existsSync(wheelsDir) ? readdirSync(wheelsDir).filter((f) => f.endsWith('.whl')).sort().map((f) => join(wheelsDir, f)) : [];
  return {
    worker: unpacked(join(HERE, 'worker.mjs')),
    solver: unpacked(join(HERE, 'solver.py')),
    pyodideMjs: join(pyDir, 'pyodide.mjs'),
    indexURL: `${pyDir}/`,
    wheels,
  };
}

/**
 * @param {{paths?: ReturnType<typeof enginePaths>, log?: Function, loadMs?: number, callMs?: number}} [o]
 */
export function createMathEngine(o = {}) {
  const paths = o.paths || enginePaths();
  const log = o.log || (() => {});
  let worker = null; let ready = null; let seq = 0;
  const waiting = new Map();

  function start() {
    if (ready) return ready;
    const t0 = Date.now();
    ready = new Promise((resolve, reject) => {
      if (!existsSync(paths.pyodideMjs) || paths.wheels.length < 2) { reject(new Error('math engine files missing')); return; }
      worker = new Worker(paths.worker, { workerData: paths, resourceLimits: { maxOldGenerationSizeMb: 1024 } });
      const timer = setTimeout(() => { reject(new Error('math engine took too long to start')); stop(); }, o.loadMs || 90000);
      worker.on('message', (m) => {
        if (m?.ready) { clearTimeout(timer); log('math engine ready', `${Date.now() - t0} ms`); resolve(true); return; }
        const w = waiting.get(m?.id);
        if (w) { waiting.delete(m.id); clearTimeout(w.timer); w.resolve(m.out); }
      });
      worker.on('error', (err) => { clearTimeout(timer); log('math engine error', String(err?.message || err)); reject(err); stop(); });
      worker.on('exit', () => { for (const w of waiting.values()) { clearTimeout(w.timer); w.resolve(JSON.stringify({ ok: false, error: 'محرك الرياضيات توقف، جرب مرة ثانية' })); } waiting.clear(); worker = null; ready = null; });
    });
    ready.catch(() => { ready = null; });
    return ready;
  }

  function stop() {
    const w = worker; worker = null; ready = null;
    w?.terminate().catch(() => {});
  }

  /**
   * @param {string} task one of MATH_TASKS
   * @param {string} text the maths as the teacher or Claude wrote it (Arabic or Latin)
   */
  async function solve(task, text) {
    if (!MATH_TASKS.includes(task)) return { ok: false, error: 'مهمة غير معروفة' };
    let expr;
    if (task === 'check') {
      // «x=4 | 2x+3=11»: both parts cleaned
      const [a, b] = String(text || '').split('|');
      const ca = toEngine(a); const cb = toEngine(b);
      if (!ca.ok || !cb.ok) return { ok: false, error: (ca.ok ? cb : ca).error };
      expr = `${ca.expr}|${cb.expr}`;
    } else {
      const c = toEngine(text);
      if (!c.ok) return c;
      expr = c.expr;
    }
    try { await start(); } catch (err) { return { ok: false, error: 'محرك الرياضيات مو جاهز', detail: String(err?.message || err) }; }
    const t0 = Date.now();
    seq += 1;
    const id = seq;
    const out = await new Promise((resolve) => {
      const timer = setTimeout(() => { waiting.delete(id); resolve(JSON.stringify({ ok: false, error: 'المسألة أخذت وقت طويل' })); stop(); }, o.callMs || 15000);
      waiting.set(id, { resolve, timer });
      worker.postMessage({ id, req: { task, expr } });
    });
    let r;
    try { r = JSON.parse(out); } catch { r = { ok: false, error: 'ما قدرت أحلها' }; }
    log('math', task, `«${expr.slice(0, 80)}»`, '→', r.ok ? `«${String(r.answer).slice(0, 60)}»` : `failed: ${r.error}${r.detail ? ` (${r.detail})` : ''}`, `${Date.now() - t0} ms`);
    return { ...r, input: expr };
  }

  return { solve, warm: () => start().then(() => true).catch(() => false), close: stop, get ready() { return Boolean(worker) && Boolean(ready); } };
}
