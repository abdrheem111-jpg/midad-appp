import { isEditingKey } from './keys.js';

// Permission levels chosen by the user at first run, and the rule that decides
// whether an action may run, needs a spoken "yes", or is refused.
// The same rule runs in the renderer (to talk about it) and again in the main
// process (to enforce it), so a compromised page cannot skip it.

export const LEVELS = {
  NONE: 0, // onboarding not finished: he may move and chat, nothing else
  ACQUAINT: 1, // التعارف
  ASSISTANT: 2, // المساعد
  TRUSTED: 3, // الثقة الكاملة
};

export const LEVEL_INFO = [
  { level: 0, name: 'لم يُحدد', can: 'لم تكتمل التهيئة بعد' },
  { level: 1, name: 'التعارف', can: 'يتجول ويتفاعل ويسمع، دون لمس أي برنامج' },
  { level: 2, name: 'المساعد', can: 'يفتح البرامج والمواقع ويضبط الصوت، ويستأذن قبل أي تعديل' },
  { level: 3, name: 'الثقة الكاملة', can: 'ينفذ مباشرة، ويستأذن فقط قبل الحذف والإرسال والشراء' },
];

/** Risk class for each action type the executor knows. */
export const ACTION_RISK = {
  open_tool: 'none', // his own whiteboard and notebook windows
  close_tool: 'none',
  office_put: 'modify', // writes into the open Word/PowerPoint/Excel document, or a new file
  office_draw: 'modify',
  office_format: 'modify',
  office_slide: 'modify',
  office_equation: 'modify',
  office_circle: 'modify',
  office_pdf: 'system', // saves a PDF copy of the open document in Documents\\خلفون
  save_sheet: 'system', // a new spreadsheet in Documents\\خلفون (attendance, points); never overwrites another file
  open_app: 'open',
  open_url: 'open',
  open_folder: 'open',
  open_installed: 'open', // only programs already on the Start menu
  open_download: 'open', // a file that just arrived in the Downloads folder
  read_selection: 'system', // copies the selected text; the clipboard is put back
  read_screen: 'system', // a screenshot read on this computer, never sent anywhere
  find_on_screen: 'system', // the same reading, to mark a word where it is
  active_window: 'none',
  close_app: 'modify', // an app may hold unsaved work; it still gets to ask to save
  search: 'open',
  volume: 'system',
  screenshot: 'system',
  reminder: 'none',
  cancel_reminders: 'none',
  type_text: 'modify',
  // Claude's hands (the Claude mind): the mouse and keyboard as a person uses them.
  mouse_click: 'modify',
  mouse_move: 'none',
  mouse_drag: 'modify',
  mouse_scroll: 'none',
  key_combo: 'modify', // closing/deleting combos are asked for first (core/claude-persona keysNeedConsent)
  open_web: 'open', // an https page in the browser
  find_files: 'none', // look for the teacher's files by name (Desktop, Documents, Downloads)
  open_file: 'open', // open one of them (documents, pictures, videos only)
  window_list: 'none', // the windows on the taskbar
  window_op: 'modify', // bring forward / minimize / maximize / restore / close one of them
  pdf_write: 'modify',
  organize_downloads: 'modify',
  undo_organize: 'modify',
  delete_files: 'destructive',
};

/** Sites a child may open in kids mode. */
export const KIDS_SAFE_HOSTS = ['www.google.com', 'www.youtube.com', 'youtube.com', 'google.com', 'kids.youtube.com', 'www.youtubekids.com'];

/**
 * @param {{type: string, params?: any}} action
 * @param {{level: number, kidsMode?: boolean}} settings
 * @returns {{allowed: boolean, confirm: boolean, reason: string}}
 */
export function decide(action, settings) {
  // Keys that change content (paste, delete, enter...) are edits; the rest are like volume.
  const risk = action?.type === 'press_key' ? (isEditingKey(action.params?.key) ? 'modify' : 'system') : ACTION_RISK[action?.type];
  const level = Number(settings?.level) || 0;
  if (!risk) return { allowed: false, confirm: false, reason: 'unknown_action' };
  if (risk === 'none') return { allowed: true, confirm: false, reason: 'ok' };

  if (settings?.kidsMode) {
    if (risk === 'modify' || risk === 'destructive') return { allowed: false, confirm: false, reason: 'kids_mode' };
    if (action.type === 'open_url' || action.type === 'search') {
      const url = action.type === 'open_url' ? action.params?.url : null;
      if (url && !isKidsSafeUrl(url)) return { allowed: false, confirm: false, reason: 'kids_mode' };
    }
  }

  if (level <= LEVELS.ACQUAINT) return { allowed: false, confirm: false, reason: 'level_too_low' };
  if (risk === 'destructive') return { allowed: true, confirm: true, reason: 'destructive' };
  // Khalfoun 3.1: the teacher wants his commands done at once — no «تبي أسوي؟» unless he turns on «اسأل قبل»
  if (settings?.askFirst !== true) return { allowed: true, confirm: false, reason: 'ok' };
  if (level === LEVELS.ASSISTANT) {
    if (risk === 'modify') return { allowed: true, confirm: true, reason: 'modify_needs_yes' };
    return { allowed: true, confirm: false, reason: 'ok' };
  }
  return { allowed: true, confirm: false, reason: 'ok' };
}

export function isKidsSafeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && KIDS_SAFE_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

/**
 * The three colours the teacher sees:
 *   green  — done at once;
 *   yellow — shown for 3 seconds first, and he can cancel it (closing a window, saving a copy, tidying files);
 *   red    — needs a clear «نعم» by voice or phone (deleting, and whatever decide() asks about).
 */
export const YELLOW = new Set(['close_app', 'office_pdf', 'save_sheet', 'organize_downloads', 'undo_organize', 'pdf_write']);
export function colorOf(action, settings) {
  const v = decide(action, settings);
  // direct mode: nothing waits (the yellow countdown only when the teacher turned it on)
  if (ACTION_RISK[action?.type] === 'destructive' || v.confirm) return 'red';
  if (YELLOW.has(action?.type) || (action?.type === 'window_op' && action.params?.op === 'close')) return 'yellow';
  return 'green';
}

/** What «تراجع» can take back for an action that went through, or null. */
export function undoFor(action) {
  const p = action?.params || {};
  if (['type_text', 'office_put', 'office_draw', 'office_format', 'office_equation', 'office_circle', 'office_slide'].includes(action?.type)) return { type: 'key_combo', params: { keys: 'ctrl+z' } };
  if (action?.type === 'window_op' && ['minimize', 'maximize'].includes(p.op)) return { type: 'window_op', params: { hwnd: p.hwnd, op: 'restore' } };
  if (action?.type === 'organize_downloads') return { type: 'undo_organize', params: {} };
  return null;
}

/** The action in a few Arabic words, for the yellow countdown («بسكّر وورد…»). */
export function describeAction(action) {
  const p = action?.params || {};
  switch (action?.type) {
    case 'close_app': return `بسكّر ${p.app || p.name || 'البرنامج'}`;
    case 'window_op': return 'بسكّر النافذة';
    case 'office_pdf': return 'بحفظ نسخة PDF من الملف';
    case 'save_sheet': return 'بحفظ جدول جديد';
    case 'organize_downloads': return 'برتّب مجلد التنزيلات';
    case 'undo_organize': return 'برجّع ترتيب التنزيلات مثل قبل';
    case 'pdf_write': return 'بكتب في ملف الـ PDF';
    default: return 'بنفّذ الأمر';
  }
}
