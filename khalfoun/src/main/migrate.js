// Khalfoun 3 lives beside Khalfoun 2: its own folder (%APPDATA%\Khalfoun3), so Khalfoun 2 stays
// installed and untouched. On the first run Khalfoun 3 copies what the teacher built up in
// Khalfoun 2 (his name, timetable, students, memory, the trained ear, the phone pairing, the
// encrypted keys with the key that opens them) — copies only, Khalfoun 2's files are never
// changed. The big downloads (whisper, Claude's program) are used from Khalfoun 2's folder
// instead of copied.

import { existsSync, mkdirSync, copyFileSync, cpSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const V2_FOLDER = 'Khalfoun';
export const V3_FOLDER = 'Khalfoun3';
const FILES = ['memory.json', 'settings.json', 'organize-journal.json', 'notebook.json', 'cloud.json', 'reminders.json', 'teacher-notes.json', 'phone-cert.json', 'Local State'];
const FOLDERS = ['ear', 'wake-data'];
const MARK = 'migrated-from-khalfoun2.json';

/** Khalfoun 2's folder next to this one (…\AppData\Roaming\Khalfoun). */
export function v2Dir(userData) {
  return join(dirname(userData), V2_FOLDER);
}

function size(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? size(join(dir, e.name)) : statSync(join(dir, e.name)).size;
  return n;
}

/**
 * Copies Khalfoun 2's data once. Must run before the app is ready (the "Local State" file holds
 * the key that opens the encrypted Azure/Claude keys, and Chromium reads it at start).
 * @returns {{done: boolean, copied?: string[], reason?: string}}
 */
export function migrateFromV2(userData, { fs = { existsSync, mkdirSync, copyFileSync, cpSync, writeFileSync }, now = Date.now } = {}) {
  const from = v2Dir(userData);
  if (from === userData) return { done: false, reason: 'same_folder' };
  if (fs.existsSync(join(userData, MARK))) return { done: false, reason: 'already' };
  if (fs.existsSync(join(userData, 'memory.json')) || fs.existsSync(join(userData, 'settings.json'))) {
    // Khalfoun 3 already has its own data: never overwrite it
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(join(userData, MARK), JSON.stringify({ at: now(), copied: [], reason: 'own_data' }));
    return { done: false, reason: 'own_data' };
  }
  if (!fs.existsSync(from)) return { done: false, reason: 'no_v2' };
  fs.mkdirSync(userData, { recursive: true });
  const copied = [];
  for (const f of FILES) {
    if (!fs.existsSync(join(from, f))) continue;
    try { fs.copyFileSync(join(from, f), join(userData, f)); copied.push(f); } catch { /* skip that one */ }
  }
  for (const d of FOLDERS) {
    const src = join(from, d);
    if (!fs.existsSync(src)) continue;
    try {
      if (fs.cpSync === cpSync && size(src) > 300e6) continue; // never a huge copy
      fs.cpSync(src, join(userData, d), { recursive: true });
      copied.push(`${d}/`);
    } catch { /* skip */ }
  }
  fs.writeFileSync(join(userData, MARK), JSON.stringify({ at: now(), from, copied }));
  return { done: true, copied };
}

/** Where else to look for big downloads that Khalfoun 2 already has (whisper, Claude's program). */
export function sharedDirs(userData, name) {
  return [join(userData, name), join(v2Dir(userData), name)];
}
