// Runs actions requested by the page, after checking them again here: the
// action must be well formed, its values must come from the allowed lists,
// and the permission level stored in the main process must allow it.

import { decide } from '../../core/permissions.js';
import { APPS } from '../../core/intents.js';
import { organizeFolder, undoMoves } from './organize.js';

const APP_IDS = new Set(APPS.filter((a) => a.kind === 'app').map((a) => a.id));
const URLS = new Set(APPS.filter((a) => a.kind === 'url').map((a) => a.url));
const FOLDERS = new Set(['downloads', 'documents', 'pictures']);
const MAX_REMINDER_MIN = 24 * 60;

/**
 * Checks shape and values. Returns an error code or null.
 * @param {any} action
 */
export function validateAction(action) {
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') return 'bad_action';
  const p = action.params && typeof action.params === 'object' ? action.params : {};
  const str = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  switch (action.type) {
    case 'open_app': return APP_IDS.has(p.app) ? null : 'bad_app';
    case 'open_url': return URLS.has(p.url) ? null : 'bad_url';
    case 'open_folder': return FOLDERS.has(p.folder) ? null : 'bad_folder';
    case 'search': return str(p.query, 300) && ['google', 'youtube'].includes(p.engine) ? null : 'bad_search';
    case 'volume': return ['up', 'down', 'mute'].includes(p.direction) ? null : 'bad_volume';
    case 'screenshot': return null;
    case 'type_text': return str(p.text, 2000) ? null : 'bad_text';
    case 'reminder':
      return Number.isFinite(p.minutes) && p.minutes >= 1 && p.minutes <= MAX_REMINDER_MIN && (p.note === undefined || (typeof p.note === 'string' && p.note.length <= 200)) ? null : 'bad_reminder';
    case 'organize_downloads': case 'undo_organize': return null;
    default: return 'unknown_action';
  }
}

/**
 * @param {{platform: ReturnType<import('./platform.js').createPlatform>, getSettings: () => {level: number, kidsMode: boolean},
 *   downloadsDir: string, journal: import('../storage.js').JsonStore, scheduleReminder: (minutes: number, note: string) => void}} deps
 */
export function createExecutor(deps) {
  const { platform } = deps;

  async function run(action) {
    const invalid = validateAction(action);
    if (invalid) return { ok: false, error: invalid };
    const verdict = decide(action, deps.getSettings());
    if (!verdict.allowed) return { ok: false, error: verdict.reason };
    const p = action.params || {};
    try {
      switch (action.type) {
        case 'open_app': return await platform.openApp(p.app);
        case 'open_url': return await platform.openUrl(p.url);
        case 'open_folder': return await platform.openFolder(p.folder);
        case 'search': return await platform.search(p.query.trim(), p.engine);
        case 'volume': return await platform.volume(p.direction);
        case 'screenshot': return await platform.screenshot();
        case 'type_text': return await platform.typeText(p.text);
        case 'reminder':
          deps.scheduleReminder(Math.round(p.minutes), p.note || '');
          return { ok: true };
        case 'organize_downloads': {
          const { moves } = await organizeFolder(deps.downloadsDir);
          if (moves.length) await deps.journal.write({ at: Date.now(), moves });
          return { ok: true, data: { moved: moves.length } };
        }
        case 'undo_organize': {
          const last = await deps.journal.read();
          if (!last?.moves?.length) return { ok: true, data: { restored: 0 } };
          const { restored } = await undoMoves(last.moves);
          await deps.journal.write({ at: Date.now(), moves: [] });
          return { ok: true, data: { restored } };
        }
        default: return { ok: false, error: 'unknown_action' };
      }
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }

  return { run };
}
