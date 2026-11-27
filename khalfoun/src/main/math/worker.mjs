// Runs SymPy (inside Pyodide, Python compiled to WebAssembly) in its own thread, so a long sum
// never freezes Khalfoun. Everything is local: Pyodide and the SymPy wheels ship with the app.

import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const { loadPyodide } = await import(pathToFileURL(workerData.pyodideMjs).href);
const py = await loadPyodide({ indexURL: workerData.indexURL, stdout: () => {}, stderr: () => {} });
for (const w of workerData.wheels) { const b = readFileSync(w); py.unpackArchive(new Uint8Array(b.buffer, b.byteOffset, b.byteLength), 'wheel'); }
// The solver needs nothing from JavaScript: that bridge is closed before any input is read.
py.runPython("import sys\nsys.modules['js'] = None\nsys.modules['pyodide_js'] = None");
py.runPython(readFileSync(workerData.solver, 'utf8'));
py.runPython('import sympy');
const handle = py.globals.get('handle');
parentPort.postMessage({ ready: true });
parentPort.on('message', ({ id, req }) => {
  let out;
  try { out = handle(JSON.stringify(req)); } catch (err) { out = JSON.stringify({ ok: false, error: 'ما قدرت أحلها', detail: String(err?.message || err).slice(0, 200) }); }
  parentPort.postMessage({ id, out });
});
