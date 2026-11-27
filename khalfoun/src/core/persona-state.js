// Khalfoun's states, one at a time, each with how he looks: يسمع، يفكر، ينفذ، يتكلم، يحتفل،
// محتار، نايم (and «موقوف» for the emergency stop). The page asks for a state; this decides the
// animation and whether the change is allowed (the emergency stop wins over everything).

export const STATES = Object.freeze({
  idle: { name: 'جاهز', anim: null },
  listening: { name: 'يسمع', anim: 'listen' },
  thinking: { name: 'يفكر', anim: 'think' },
  acting: { name: 'ينفذ', anim: 'point' },
  speaking: { name: 'يتكلم', anim: null },
  celebrating: { name: 'يحتفل', anim: 'celebrate' },
  confused: { name: 'محتار', anim: 'confused' },
  sleeping: { name: 'نايم', anim: 'sleep' },
  halted: { name: 'موقوف', anim: 'freeze' },
});

export class PersonaState {
  constructor(now = () => Date.now()) { this.state = 'idle'; this.since = now(); this.now = now; }

  /**
   * @param {keyof typeof STATES} next
   * @returns {{changed: boolean, anim: string|null, name: string}}
   */
  set(next) {
    if (!(next in STATES)) return { changed: false, anim: null, name: STATES[this.state].name };
    // nothing but «idle» (let go of the stop) leaves the emergency stop
    if (this.state === 'halted' && next !== 'idle') return { changed: false, anim: null, name: STATES.halted.name };
    if (next === this.state) return { changed: false, anim: null, name: STATES[next].name };
    this.state = next; this.since = this.now();
    return { changed: true, anim: STATES[next].anim, name: STATES[next].name };
  }

  /** After a long quiet he dozes off (never while halted or busy). */
  tick(idleMs = 20 * 60000) {
    if (this.state === 'idle' && this.now() - this.since > idleMs) return this.set('sleeping');
    return { changed: false, anim: null, name: STATES[this.state].name };
  }
}
