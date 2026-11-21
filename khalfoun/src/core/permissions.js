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
