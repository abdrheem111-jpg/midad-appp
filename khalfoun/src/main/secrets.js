// The person's cloud keys (Claude, Azure Speech), kept encrypted with Windows' own
// protection for this user (Electron safeStorage, DPAPI on Windows). The page never
// gets a key back: it only learns whether one is set.

import { AZURE_REGION_RE } from './cloud.js';

export const DEFAULT_CLOUD = {
  claude: '', // encrypted, base64
  azureKey: '', // encrypted, base64
  azureRegion: '',
  use: { hear: true, brain: true, voice: true },
  usage: { day: '', wakeSeconds: 0, seconds: 0 },
};

/** Free Azure hours are shared by everything: always-on listening may use this much a day. */
export const WAKE_SECONDS_PER_DAY = 10 * 60;

export class CloudSecrets {
  /**
   * @param {{read: () => Promise<object>, write: (d: object) => Promise<void>}} store
   * @param {{isEncryptionAvailable: () => boolean, encryptString: (s: string) => Buffer, decryptString: (b: Buffer) => string}} safe
   */
  constructor(store, safe, today = () => new Date().toISOString().slice(0, 10)) {
    this.store = store;
    this.safe = safe;
    this.today = today;
    this.data = structuredClone(DEFAULT_CLOUD);
  }

  async load() {
    const d = await this.store.read();
    this.data = { ...structuredClone(DEFAULT_CLOUD), ...(d && typeof d === 'object' ? d : {}) };
    this.data.use = { ...DEFAULT_CLOUD.use, ...(this.data.use || {}) };
    this.data.usage = { ...DEFAULT_CLOUD.usage, ...(this.data.usage || {}) };
    return this;
  }

  save() { return this.store.write(this.data); }

  encrypt(value) {
    if (!value) return '';
    if (!this.safe.isEncryptionAvailable()) throw new Error('encryption_unavailable');
    return this.safe.encryptString(value).toString('base64');
  }

  decrypt(value) {
    if (!value) return '';
    try { return this.safe.decryptString(Buffer.from(value, 'base64')); } catch { return ''; }
  }

  get claudeKey() { return this.decrypt(this.data.claude); }

  get azure() {
    const key = this.decrypt(this.data.azureKey);
    return key && this.data.azureRegion ? { key, region: this.data.azureRegion } : null;
  }

  /** What the page may know. */
  status() {
    return {
      claude: Boolean(this.data.claude),
      azure: Boolean(this.data.azureKey && this.data.azureRegion),
      azureRegion: this.data.azureRegion,
      use: { ...this.data.use },
      encryption: this.safe.isEncryptionAvailable(),
    };
  }

  /**
   * Applies a change from the settings panel. An empty string removes a key; undefined leaves it.
   * @returns {string|null} an error code, or null
   */
  async update(patch) {
    const p = patch && typeof patch === 'object' ? patch : {};
    if (p.claudeKey !== undefined) {
      const k = String(p.claudeKey).trim();
      if (k && !/^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(k)) return 'bad_claude_key';
      this.data.claude = this.encrypt(k);
    }
    if (p.azureKey !== undefined) {
      const k = String(p.azureKey).trim();
      if (k && !/^[A-Za-z0-9]{20,100}$/.test(k)) return 'bad_azure_key';
      this.data.azureKey = this.encrypt(k);
    }
    if (p.azureRegion !== undefined) {
      const r = String(p.azureRegion).trim().toLowerCase().replace(/\s+/g, '');
      if (r && !AZURE_REGION_RE.test(r)) return 'bad_region';
      this.data.azureRegion = r;
    }
    if (p.use && typeof p.use === 'object') {
      for (const k of ['hear', 'brain', 'voice']) if (k in p.use) this.data.use[k] = Boolean(p.use[k]);
    }
    await this.save();
    return null;
  }

  /** Counts seconds of audio sent; always-on listening stops using the cloud past its daily share. */
  allowWake() {
    this.rollDay();
    return this.data.usage.wakeSeconds < WAKE_SECONDS_PER_DAY;
  }

  count(seconds, wake) {
    this.rollDay();
    this.data.usage.seconds += seconds;
    if (wake) this.data.usage.wakeSeconds += seconds;
  }

  rollDay() {
    const day = this.today();
    if (this.data.usage.day !== day) this.data.usage = { day, wakeSeconds: 0, seconds: 0 };
  }
}
