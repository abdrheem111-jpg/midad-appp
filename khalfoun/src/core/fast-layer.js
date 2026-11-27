// The fast local layer: ordinary code, not a mind. Commands it knows for sure are done at once
// on the PC (well under a second, no internet, nothing spent from the Claude plan); only what it
// does not understand goes to Claude.

import { normalize } from './arabic.js';

/** Intents (from intents.js) that never need Claude when recognised with high confidence. */
export const FAST_INTENTS = Object.freeze([
  // the screen
  'screen_pen', 'screen_clear', 'open_tool', 'close_tool',
  // the class
  'timer', 'timer_stop', 'pick_student', 'award', 'points_board', 'groups', 'random_number', 'students_count',
  // the day
  'time', 'date', 'schedule_today', 'schedule_next', 'schedule_show',
  // Khalfoun himself
  'volume', 'stop', 'open_settings', 'come', 'away', 'sleep', 'dance', 'jump', 'sounds', 'hear_check',
  // pages and known files
  'key', 'open_again',
]);
const FAST = new Set(FAST_INTENTS);
export const FAST_CONFIDENCE = 0.9;

/** @param {{intent: string, confidence: number}|null} r what recognize() returned */
export function isFast(r) {
  return Boolean(r && FAST.has(r.intent) && r.confidence >= FAST_CONFIDENCE);
}


/** Splits a compound sentence into its commands; one part when it is not compound. */
export function splitCompound(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  const parts = [];
  for (const piece of t.split(/\s*[،,]\s*(?:و\s*)?|\s+(?:وبعدين|وبعدها|ثم)\s+/)) {
    // a bare «و» joins two commands only when both halves are at least two words or a known command
    const sub = piece.split(/\s+و(?=[^\s]{2,})/);
    for (const s of sub) if (s.trim()) parts.push(s.trim());
  }
  return parts.length ? parts : [t];
}

/**
 * When every part of a compound sentence is a fast command, the plan to run them one after the
 * other here; otherwise null (Claude gets the whole sentence, and checks each step itself).
 * @param {string} text
 * @param {(t: string) => {intent: string, confidence: number}|null} recognize
 */
export function fastPlan(text, recognize) {
  const parts = splitCompound(text); // a wrong split (a word that starts with و) never passes: every part must be a known command
  if (parts.length < 2 || parts.length > 4) return null;
  const rec = parts.map((p) => ({ text: p, r: recognize(p) }));
  return rec.every((x) => isFast(x.r)) ? rec.map((x) => x.text) : null;
}

export { normalize };
