// What Khalfoun remembers about the person: settings, preferences learned from
// their reactions, habits, and an action log. Serializable to plain JSON; the
// caller decides where it is stored (a file in the main process, localStorage
// in the browser preview).

const DAY = 24 * 60 * 60 * 1000;
export const MEMORY_VERSION = 1;
const LOG_LIMIT = 200;

export function defaultMemory(now = Date.now()) {
  return {
    version: MEMORY_VERSION,
    onboarded: false,
    name: '',
    level: 0,
    kidsMode: false,
    humor: 1, // 0 هادئ, 1 عادي, 2 مجنون
    alwaysListen: false,
    firstSeen: now,
    lastSeen: now,
    interactions: 0,
    emotion: { mood: 20, energy: 80, affinity: 0 },
    // learned preferences: category -> score (positive = liked)
    likes: {},
    // template id -> times shown (for long-term variety)
    seen: {},
    commands: {},
    aliases: {}, // phrases the person taught: normalized phrase -> command
    classroom: { students: [], points: {}, picked: [] }, // class list, points, who already had a turn
    attendance: { days: {} }, // absent/late per school day
    classStars: 0, // stars the whole class earned; unlock outfits and dances
    riddlesSeen: [],
    schedule: [], // timetable: {id, days, hour, minute, subject, command, notified}
    log: [],
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class Memory {
  /**
   * @param {object} [data] previously saved JSON
   * @param {(data: object) => void} [onChange] called after every change
   */
  constructor(data, onChange) {
    this.data = migrate(data);
    this.onChange = onChange || (() => {});
  }

  get(key) { return this.data[key]; }

  set(patch) {
    Object.assign(this.data, patch);
    this.onChange(this.data);
  }

  /** Records that the person interacted; returns days since last visit. */
  touch(now = Date.now()) {
    const away = Math.max(0, now - (this.data.lastSeen ?? now));
    this.data.lastSeen = now;
    this.data.interactions += 1;
    this.onChange(this.data);
    return Math.floor(away / DAY);
  }

  recordCommand(intent) {
    this.data.commands[intent] = (this.data.commands[intent] || 0) + 1;
    this.onChange(this.data);
  }

  recordSeen(templateId) {
    this.data.seen[templateId] = (this.data.seen[templateId] || 0) + 1;
  }

  /** Learns from a reaction to a category of reply (e.g. "joke:pun"). */
  feedback(category, positive) {
    if (!category) return;
    const cur = this.data.likes[category] || 0;
    this.data.likes[category] = clamp(cur + (positive ? 1 : -1.5), -6, 6);
    this.onChange(this.data);
  }

  /** Weight multiplier in [0.25, 3] for a category based on past reactions. */
  preference(category) {
    const score = this.data.likes[category] || 0;
    return clamp(1 + score * 0.33, 0.25, 3);
  }

  /** Appends to the action log the person can review. */
  log(entry, now = Date.now()) {
    this.data.log.push({ at: now, ...entry });
    if (this.data.log.length > LOG_LIMIT) this.data.log.splice(0, this.data.log.length - LOG_LIMIT);
    this.onChange(this.data);
  }

  /** "انسَ كل شي": wipes learning and history but keeps the chosen settings. */
  forget(now = Date.now()) {
    const keep = { onboarded: this.data.onboarded, level: this.data.level, kidsMode: this.data.kidsMode };
    this.data = { ...defaultMemory(now), ...keep };
    this.onChange(this.data);
  }

  toJSON() { return this.data; }
}

function migrate(data) {
  const base = defaultMemory();
  if (!data || typeof data !== 'object') return base;
  const merged = { ...base, ...data };
  merged.emotion = { ...base.emotion, ...(data.emotion || {}) };
  for (const k of ['likes', 'seen', 'commands', 'aliases']) if (!merged[k] || typeof merged[k] !== 'object') merged[k] = {};
  if (!Array.isArray(merged.log)) merged.log = [];
  merged.level = clamp(Number(merged.level) || 0, 0, 3);
  merged.humor = clamp(Number.isFinite(Number(merged.humor)) ? Number(merged.humor) : 1, 0, 2);
  merged.version = MEMORY_VERSION;
  return merged;
}
