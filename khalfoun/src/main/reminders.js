// Reminders that survive a restart: each one is saved with the time it is due;
// on start they are scheduled again (overdue ones fire right away), and
// repeating reminders reschedule themselves after firing.

const MAX_TIMER = 2 ** 31 - 1; // setTimeout limit (~24.8 days)

export class ReminderScheduler {
  /**
   * @param {{store: {read: () => Promise<any>, write: (d: any) => Promise<any>}, onFire: (r: object) => void,
   *   now?: () => number, setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout}} opts
   */
  constructor(opts) {
    this.store = opts.store;
    this.onFire = opts.onFire;
    this.now = opts.now || (() => Date.now());
    this.setTimer = opts.setTimer || setTimeout;
    this.clearTimer = opts.clearTimer || clearTimeout;
    this.items = [];
    this.timers = new Map();
    this.nextId = 1;
  }

  async restore() {
    const data = await this.store.read();
    const list = Array.isArray(data?.items) ? data.items : [];
    this.items = list.filter((r) => r && Number.isFinite(r.at) && Number.isFinite(r.minutes) && r.minutes > 0);
    this.nextId = this.items.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
    for (const r of this.items) this.arm(r);
    return this.items.length;
  }

  /** @returns {object} the saved reminder */
  add({ minutes, note = '', repeat = false }) {
    const r = { id: this.nextId, at: this.now() + minutes * 60000, minutes, note: String(note).slice(0, 200), repeat: Boolean(repeat) };
    this.nextId += 1;
    this.items.push(r);
    this.arm(r);
    this.save();
    return r;
  }

  cancelAll() {
    const n = this.items.length;
    for (const t of this.timers.values()) this.clearTimer(t);
    this.timers.clear();
    this.items = [];
    this.save();
    return n;
  }

  get pending() { return this.items.map((r) => ({ ...r })); }

  arm(r) {
    const delay = Math.max(0, r.at - this.now());
    const t = this.setTimer(() => {
      if (r.at - this.now() > 1000) { this.arm(r); return; } // long waits are split into shorter timers
      this.fire(r);
    }, Math.min(delay, MAX_TIMER));
    this.timers.set(r.id, t);
  }

  fire(r) {
    this.timers.delete(r.id);
    this.onFire({ ...r });
    if (r.repeat) {
      r.at = Math.max(r.at, this.now() - r.minutes * 60000) + r.minutes * 60000;
      if (r.at <= this.now()) r.at = this.now() + r.minutes * 60000; // skip missed repeats after a long sleep
      this.arm(r);
    } else {
      this.items = this.items.filter((x) => x.id !== r.id);
    }
    this.save();
  }

  save() {
    return this.store.write({ items: this.items });
  }

  stop() {
    for (const t of this.timers.values()) this.clearTimer(t);
    this.timers.clear();
  }
}
