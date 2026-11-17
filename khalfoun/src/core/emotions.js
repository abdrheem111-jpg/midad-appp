// Emotion engine: three slow internal gauges (mood, energy, affinity) plus a
// fast "current emotion" chosen by events. 16 emotions x 3 intensities, and an
// optional secondary emotion for blends ("happy but shy").

export const EMOTIONS = [
  'calm', 'happy', 'proud', 'excited', 'amazed', 'curious', 'focused', 'confused', 'shy',
  'grateful', 'longing', 'sad', 'sulky', 'jealous', 'scared', 'bored', 'sleepy',
];

export const EMOTION_LABELS = {
  calm: 'هادئ', happy: 'فرحان', proud: 'فخور', excited: 'متحمس', amazed: 'مندهش',
  curious: 'فضولي', focused: 'مركّز', confused: 'محتار', shy: 'مستحي', grateful: 'ممتن',
  longing: 'مشتاق', sad: 'حزين بلطف', sulky: 'زعلان مصطنع', jealous: 'غيران', scared: 'خايف',
  bored: 'ملول', sleepy: 'نعسان',
};

/**
 * event -> [emotion, base intensity 1..3, mood delta, energy delta, affinity delta, secondary?]
 */
const EVENT_TABLE = {
  greet: ['happy', 2, 4, 3, 0.2],
  wake: ['happy', 1, 0, 25, 0],
  success: ['happy', 2, 5, -1, 0.3],
  fast_success: ['amazed', 2, 6, -1, 0.3],
  streak: ['proud', 3, 8, 0, 0.5],
  praise: ['shy', 2, 10, 2, 1, 'happy'],
  thanks: ['grateful', 2, 6, 1, 0.8],
  joke: ['excited', 2, 3, -1, 0.2],
  error: ['sad', 1, -6, -2, 0],
  scold: ['sulky', 2, -10, -2, -0.5],
  not_understood: ['confused', 1, -2, -1, 0],
  working: ['focused', 2, 0, -1, 0],
  listening: ['curious', 1, 0, 0, 0],
  danger: ['scared', 2, -2, 0, 0],
  other_assistant: ['jealous', 2, -3, 0, 0],
  return_after_days: ['longing', 3, 6, 10, 0.5, 'happy'],
  poke: ['amazed', 1, 1, 2, 0.1],
  tickle: ['happy', 3, 6, 2, 0.3],
  dropped: ['scared', 1, -1, 0, 0],
  dance: ['excited', 3, 4, -4, 0.2],
  curious: ['curious', 2, 1, 0, 0],
  focus_mode: ['calm', 1, 0, 0, 0],
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const BORED_AFTER_MS = 3 * 60 * 1000;
const SLEEP_AFTER_MS = 10 * 60 * 1000;

export class EmotionEngine {
  /**
   * @param {{mood?: number, energy?: number, affinity?: number, now?: number}} [init]
   */
  constructor(init = {}) {
    const now = init.now ?? Date.now();
    this.mood = clamp(init.mood ?? 20, -100, 100);
    this.energy = clamp(init.energy ?? 80, 0, 100);
    this.affinity = clamp(init.affinity ?? 0, 0, 100);
    this.current = { emotion: 'calm', intensity: 1, secondary: null, since: now, holdMs: 0 };
    this.lastInteraction = now;
    this.asleep = false;
  }

  /** Current mood band used to scale intensity and choose wording. */
  get moodBand() {
    if (this.mood > 40) return 'high';
    if (this.mood < -30) return 'low';
    return 'mid';
  }

  /**
   * Applies an event and returns the resulting emotion snapshot.
   * @param {string} event
   * @param {number} [now]
   */
  feel(event, now = Date.now()) {
    const row = EVENT_TABLE[event];
    if (!row) return this.snapshot(now);
    const [emotion, base, dMood, dEnergy, dAff, secondary] = row;
    this.mood = clamp(this.mood + dMood, -100, 100);
    this.energy = clamp(this.energy + dEnergy, 0, 100);
    this.affinity = clamp(this.affinity + dAff, 0, 100);
    if (event !== 'dropped' && event !== 'focus_mode') this.lastInteraction = now;
    if (event !== 'focus_mode') this.asleep = false;

    let intensity = base;
    const positive = dMood > 0;
    if (positive && this.mood > 60) intensity += 1;
    if (!positive && dMood < 0 && this.mood < -40) intensity += 1;
    if (this.energy < 20 && emotion !== 'sleepy') intensity -= 1;
    intensity = clamp(intensity, 1, 3);

    this.current = { emotion, intensity, secondary: secondary || null, since: now, holdMs: 2500 + intensity * 1500 };
    return this.snapshot(now);
  }

  /**
   * Advances time: emotions fade back to calm, energy drains slowly, long idle
   * leads to boredom then sleep.
   * @param {number} [now]
   */
  tick(now = Date.now()) {
    const idle = now - this.lastInteraction;
    const age = now - this.current.since;
    if (idle >= SLEEP_AFTER_MS) {
      if (!this.asleep) {
        this.asleep = true;
        this.current = { emotion: 'sleepy', intensity: 3, secondary: null, since: now, holdMs: Infinity };
      }
    } else if (idle >= BORED_AFTER_MS && this.current.emotion !== 'bored' && age > this.current.holdMs) {
      this.current = { emotion: 'bored', intensity: idle > BORED_AFTER_MS * 2 ? 2 : 1, secondary: null, since: now, holdMs: 60000 };
    } else if (age > this.current.holdMs && this.current.emotion !== 'calm' && idle < BORED_AFTER_MS) {
      const fadeTo = this.mood > 50 ? 'happy' : 'calm';
      this.current = { emotion: fadeTo, intensity: 1, secondary: null, since: now, holdMs: fadeTo === 'calm' ? 0 : 8000 };
    }
    // Mood drifts slowly toward a small positive baseline.
    this.mood += (15 - this.mood) * 0.002;
    return this.snapshot(now);
  }

  /** Puts him to sleep right away (user asked). */
  sleep(now = Date.now()) {
    this.asleep = true;
    this.current = { emotion: 'sleepy', intensity: 3, secondary: null, since: now, holdMs: Infinity };
    return this.snapshot(now);
  }

  snapshot(now = Date.now()) {
    return {
      emotion: this.current.emotion,
      intensity: this.current.intensity,
      secondary: this.current.secondary,
      label: EMOTION_LABELS[this.current.emotion],
      mood: Math.round(this.mood),
      energy: Math.round(this.energy),
      affinity: Math.round(this.affinity * 10) / 10,
      asleep: this.asleep,
      idleMs: now - this.lastInteraction,
    };
  }

  toJSON() {
    return { mood: this.mood, energy: this.energy, affinity: this.affinity };
  }
}
