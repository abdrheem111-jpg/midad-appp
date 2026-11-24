// Khalfoun's fast cloud services, used only when the person adds their own keys:
// - Azure Speech: hearing (speech to text, Omani Arabic «ar-OM») and a speaking voice
// - Claude (Anthropic): the brain for anything his own rules do not understand
// Whisper and the local model stay as the fallback when there is no key or no internet.
// Keys never reach the page: main keeps them encrypted (see secrets.js).

const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
export const CLAUDE_MODEL = 'claude-haiku-5-5';
export const AZURE_VOICES = ['ar-OM-AbdullahNeural', 'ar-AE-HamdanNeural', 'ar-SA-HamedNeural'];
export const AZURE_REGION_RE = /^[a-z]{2,20}[a-z0-9]{0,6}$/;

async function withTimeout(fetchFn, url, init, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetchFn(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function errorName(err) {
  if (err?.name === 'AbortError') return 'timeout';
  const m = String(err?.message || err);
  return /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|fetch failed|network/i.test(m) ? 'offline' : m.slice(0, 200);
}

/**
 * Azure short-audio speech to text (one sentence, up to 60 s).
 * @param {{key: string, region: string}} cfg
 * @param {Uint8Array} wav 16 kHz mono 16-bit WAV
 * @returns {Promise<{ok: true, text: string, ms: number} | {ok: false, error: string}>}
 */
export async function transcribeAzure(cfg, wav, { fetchFn = fetch, timeoutMs = 8000, language = 'ar-OM', now = () => Date.now() } = {}) {
  if (!cfg?.key || !AZURE_REGION_RE.test(cfg.region || '')) return { ok: false, error: 'not_configured' };
  const t0 = now();
  const url = `https://${cfg.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(language)}&format=simple&profanity=raw`;
  try {
    const res = await withTimeout(fetchFn, url, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': cfg.key, 'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000', Accept: 'application/json' },
      body: wav,
    }, timeoutMs);
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'bad_key' };
    if (res.status === 429) return { ok: false, error: 'quota' };
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const data = await res.json();
    const status = data?.RecognitionStatus;
    if (status === 'Success') return { ok: true, text: String(data.DisplayText || '').replace(/[.。]+$/u, '').trim(), ms: now() - t0 };
    if (status === 'NoMatch' || status === 'InitialSilenceTimeout' || status === 'BabbleTimeout') return { ok: true, text: '', ms: now() - t0 };
    return { ok: false, error: `azure_${status || 'unknown'}` };
  } catch (err) {
    return { ok: false, error: errorName(err) };
  }
}

const escapeXml = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

/**
 * Azure text to speech: an Omani voice, a little lively. Returns MP3 bytes.
 * @returns {Promise<{ok: true, audio: Uint8Array, voice: string} | {ok: false, error: string}>}
 */
export async function speakAzure(cfg, text, { fetchFn = fetch, timeoutMs = 8000, voices = AZURE_VOICES } = {}) {
  if (!cfg?.key || !AZURE_REGION_RE.test(cfg.region || '')) return { ok: false, error: 'not_configured' };
  const line = String(text || '').slice(0, 600).trim();
  if (!line) return { ok: false, error: 'empty' };
  let last = 'no_voice';
  for (const voice of voices) {
    const lang = voice.slice(0, 5);
    const ssml = `<speak version="1.0" xml:lang="${lang}"><voice name="${voice}"><prosody rate="+6%" pitch="+12%">${escapeXml(line)}</prosody></voice></speak>`;
    try {
      const res = await withTimeout(fetchFn, `https://${cfg.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': cfg.key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'Khalfoun' },
        body: ssml,
      }, timeoutMs);
      if (res.status === 401 || res.status === 403) return { ok: false, error: 'bad_key' };
      if (res.ok) return { ok: true, audio: new Uint8Array(await res.arrayBuffer()), voice };
      last = `http_${res.status}`; // that voice is not offered in this region: try the next
    } catch (err) {
      return { ok: false, error: errorName(err) };
    }
  }
  return { ok: false, error: last };
}

/**
 * One training clip for Khalfoun's own ear: an Azure voice says a short phrase, as 16 kHz WAV.
 * @param {{voice: string, text: string, rate?: string, pitch?: string}} clip
 * @returns {Promise<{ok: true, wav: Uint8Array} | {ok: false, error: string}>}
 */
export async function sampleAzure(cfg, clip, { fetchFn = fetch, timeoutMs = 10000 } = {}) {
  if (!cfg?.key || !AZURE_REGION_RE.test(cfg.region || '')) return { ok: false, error: 'not_configured' };
  if (!/^ar-[A-Z]{2}-[A-Za-z]+Neural$/.test(clip?.voice || '')) return { ok: false, error: 'bad_voice' };
  const pct = (v) => (/^[+-]\d{1,2}%$/.test(v || '') ? v : '+0%');
  const ssml = `<speak version="1.0" xml:lang="${clip.voice.slice(0, 5)}"><voice name="${clip.voice}"><prosody rate="${pct(clip.rate)}" pitch="${pct(clip.pitch)}">${escapeXml(String(clip.text || '').slice(0, 80))}</prosody></voice></speak>`;
  try {
    const res = await withTimeout(fetchFn, `https://${cfg.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': cfg.key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'riff-16khz-16bit-mono-pcm', 'User-Agent': 'Khalfoun' },
      body: ssml,
    }, timeoutMs);
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'bad_key' };
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    return { ok: true, wav: new Uint8Array(await res.arrayBuffer()) };
  } catch (err) {
    return { ok: false, error: errorName(err) };
  }
}

/** Checks an Azure key quickly (issues a short-lived token; nothing is billed). */
export async function verifyAzure(cfg, { fetchFn = fetch } = {}) {
  if (!cfg?.key || !AZURE_REGION_RE.test(cfg.region || '')) return { ok: false, error: 'not_configured' };
  try {
    const res = await withTimeout(fetchFn, `https://${cfg.region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
      method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': cfg.key, 'Content-Length': '0' },
    }, 8000);
    if (res.ok) return { ok: true };
    return { ok: false, error: res.status === 401 || res.status === 403 ? 'bad_key' : `http_${res.status}` };
  } catch (err) {
    return { ok: false, error: errorName(err) };
  }
}

// ------------------------------------------------------------------ Claude

/**
 * Example commands his rules understand. Claude turns free speech into these, and they then
 * go through the same checks (permissions, fixed program lists) as anything the person says.
 */
export const COMMAND_EXAMPLES = [
  'افتح الحاسبة', 'افتح الوورد', 'افتح المتصفح', 'افتح يوتيوب', 'افتح التنزيلات', 'افتح سطح المكتب', 'افتح السبورة', 'افتح الدفتر',
  'سكر الحاسبة', 'سكرها', 'دور عن <كلمات>', 'دور في يوتيوب عن <كلمات>', 'اكتب <نص>', 'ذكرني بعد ١٠ دقايق <بشي>', 'ذكرني الساعة ٧ الصبح <بشي>',
  'شغل مؤقت ٥ دقايق', 'ارفع الصوت', 'وطي الصوت', 'اكتم الصوت', 'صور الشاشة', 'كم الساعة', 'شو التاريخ', 'كم ١٢ ضرب ١٢', 'اختبرني',
  'قول نكتة', 'رتب التنزيلات', 'اختار طالب', 'قسمهم ٤ مجموعات', 'اعط احمد نجمة', 'شو حصتي الجاية', 'شو عندي اليوم', 'ابدأ العرض',
  'الشريحة الجاية', 'وقف العرض', 'انسخ', 'الصق', 'احفظ', 'تراجع', 'ملف جديد', 'اشرح اللي في الشاشة', 'لخص اللي في الشاشة', 'ابدأ الإملاء',
  'نام', 'تعال هنا', 'روح بعيد', 'ارقص',
  'غايب <اسم> و<اسم>', '<اسم> متأخر', 'حضر <اسم>', 'منو غايب اليوم', 'صدر كشف الغياب', 'صدر النقاط', 'عطني لغز', 'لف العجلة',
  'ابدأ سباق الهجن', 'نقطة للفريق الأول', 'نجمة للصف', 'كم نجمة عند الصف', 'احتفل', 'العاب نارية', 'سو مطر', 'زينة العيد الوطني',
  'شيل الزينة', 'مقياس الهدوء', 'وقف مقياس الهدوء', 'وضع الصف', 'الوضع العادي', 'حل من الكاميرا', 'افتح اختبار القراءة', 'اختبر السمع',
  'اكتب فقرة عن <موضوع> في الوورد', 'سو عرض تقديمي عن <موضوع> من ٥ شرائح', 'جهز ورقة عمل عن <موضوع>', 'سو اختبار عن <موضوع>', 'سو جدول <موضوع> في الاكسل',
  'اكتب قصة عن <موضوع> في PDF', 'ارسم دورة <موضوع>', 'ارسم دائرة حمرا', 'ارسم ٣ نجوم صفرا', 'اكتب في الوورد: <نص كما قاله>', 'اكتب معادلة س زائد ٢ يساوي ٥',
  'خلي الخط عريض', 'كبر الخط', 'لون الخط احمر', 'وسط الكلام', 'انزل سطر', 'شريحة جديدة', 'دور عليه', 'حوله PDF',
  'اكتب على الشاشة <نص>', 'ارسم دائرة على الشاشة', 'قلم', 'وقف القلم', 'امسح الشاشة',
];

const RESPOND_TOOL = {
  name: 'respond',
  description: 'How Khalfoun answers: what he says out loud, and the commands he carries out.',
  input_schema: {
    type: 'object',
    properties: {
      addressed: { type: 'boolean', description: 'false when the words were not said to Khalfoun (people talking to each other, TV, noise, half a sentence). Then say nothing and do nothing.' },
      say: { type: 'string', description: 'Short Omani Arabic reply, at most two short sentences. Empty when commands speak for themselves or when not addressed.' },
      commands: { type: 'array', maxItems: 4, items: { type: 'string' }, description: 'Commands to run, in order, each written exactly like the examples. Empty when nothing should happen.' },
    },
    required: ['addressed', 'say', 'commands'],
  },
};

/** The system prompt: who he is, how short to be, and when to stay quiet. */
export function agentSystem({ name = '', context = '', kidsMode = false, level = 3 } = {}) {
  return [
    'أنت «خلفون»: شخصية كرتونية عُمانية تعيش على سطح مكتب ويندوز، مساعد ذكي ومرح لمعلم عُماني.',
    'تتكلم باللهجة العُمانية الخفيفة، بجمل قصيرة جداً (جملة أو جملتين)، دافئ ومرح بدون مبالغة. لا تستعمل الإنجليزية.',
    'تقدر تنفذ أوامر على الجهاز. إذا طلب الشخص شي ينعمل بأمر، ضعه في commands بنفس صيغة هذه الأمثلة بالضبط (غيّر الكلمات بين < > فقط):',
    COMMAND_EXAMPLES.join(' | '),
    'لا تخترع أوامر خارج هذه الصيغ. إذا ما يقدر ينعمل، قل ذلك بلطف واقترح البديل.',
    'إذا الكلام مب موجّه لك (ناس يتكلمون مع بعض، تلفزيون، نص جملة، كلام ما له معنى): addressed=false و say فارغ و commands فارغة. السكوت أحسن من الرد الغلط.',
    'إذا الطلب واضح نفّذ مباشرة بدون أسئلة. اسأل سؤال واحد قصير فقط إذا الطلب ناقص فعلاً.',
    'إذا الشخص قال نكتة أو مزحة أو تريقة، افهم وين الضحكة وردّ بضحكة وتعليق ذكي قصير على نفس النكتة (بدون أوامر). وإذا طلب نكتة قلها أنت مباشرة في say.',
    'في الصف: شجّع الطلاب، ولا تحرج أحد، ولا تسخر من اسم أو شكل.',
    'لا تذكر أنك نموذج أو ذكاء اصطناعي من شركة. أنت خلفون.',
    kidsMode ? 'وضع الأطفال مفعّل: كلام بسيط ولطيف، لا مواقع غير مناسبة، لا شي مخيف.' : '',
    level < 2 ? 'مستوى الإذن «التعارف»: لا تقترح أوامر تفتح أو تغيّر برامج؛ تكلم فقط.' : '',
    name ? `اسم الشخص: ${name}.` : '',
    context ? `معلومات عن الوقت والشخص:\n${context}` : '',
  ].filter(Boolean).join('\n');
}

export class ClaudeAgent {
  /** @param {{key: string, model?: string, fetchFn?: typeof fetch, timeoutMs?: number, now?: () => number}} opts */
  constructor(opts) {
    this.key = opts.key;
    this.model = opts.model || CLAUDE_MODEL;
    this.fetchFn = opts.fetchFn || fetch;
    this.timeoutMs = opts.timeoutMs || 12000;
    this.now = opts.now || (() => Date.now());
  }

  /**
   * @param {{text: string, history?: Array<{user: string, khalfoun: string}>, name?: string, context?: string, kidsMode?: boolean, level?: number}} p
   * @returns {Promise<{ok: true, addressed: boolean, say: string, commands: string[], ms: number} | {ok: false, error: string}>}
   */
  async respond(p) {
    const t0 = this.now();
    const messages = [];
    for (const h of (p.history || []).slice(-6)) {
      if (h.user) messages.push({ role: 'user', content: String(h.user).slice(0, 400) });
      if (h.khalfoun) messages.push({ role: 'assistant', content: String(h.khalfoun).slice(0, 400) });
    }
    messages.push({ role: 'user', content: String(p.text || '').slice(0, 800) });
    // The API wants turns to alternate, starting with the person.
    const merged = [];
    for (const m of messages) {
      if (merged.length && merged[merged.length - 1].role === m.role) merged[merged.length - 1].content += `\n${m.content}`;
      else merged.push({ ...m });
    }
    while (merged.length && merged[0].role !== 'user') merged.shift();
    try {
      const res = await withTimeout(this.fetchFn, CLAUDE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 300,
          system: agentSystem(p),
          messages: merged,
          tools: [RESPOND_TOOL],
          tool_choice: { type: 'tool', name: 'respond' },
        }),
      }, this.timeoutMs);
      if (res.status === 401 || res.status === 403) return { ok: false, error: 'bad_key' };
      if (res.status === 402 || res.status === 400) {
        const body = await res.json().catch(() => ({}));
        const msg = String(body?.error?.message || '');
        if (/credit|balance|billing/i.test(msg)) return { ok: false, error: 'no_credit' };
        return { ok: false, error: `http_${res.status}` };
      }
      if (res.status === 429 || res.status === 529) return { ok: false, error: 'busy' };
      if (!res.ok) return { ok: false, error: `http_${res.status}` };
      const data = await res.json();
      const use = (data?.content || []).find((c) => c.type === 'tool_use' && c.name === 'respond');
      if (!use) return { ok: false, error: 'no_answer' };
      return { ok: true, ...cleanAgentAnswer(use.input), ms: this.now() - t0 };
    } catch (err) {
      return { ok: false, error: errorName(err) };
    }
  }

  /** A one-word call to check the key and the credit. */
  async verify() {
    const r = await this.respond({ text: 'هلا' });
    return r.ok ? { ok: true, ms: r.ms } : r;
  }
}

/** Never trust the shape of a model's answer. */
export function cleanAgentAnswer(input) {
  const i = input && typeof input === 'object' ? input : {};
  const addressed = i.addressed !== false;
  const say = addressed ? String(i.say || '').replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  const commands = addressed && Array.isArray(i.commands)
    ? i.commands.map((c) => String(c || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()).filter((c) => c && c.length <= 200).slice(0, 4)
    : [];
  return { addressed, say, commands };
}

// ------------------------------------------------------------------ Gemini (free tier)

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
/** Google keeps renaming its models; this alias follows the newest Flash. */
export const GEMINI_ALIAS = 'gemini-flash-latest';
export const GEMINI_LITE_ALIAS = 'gemini-flash-lite-latest';

const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    addressed: { type: 'BOOLEAN' },
    say: { type: 'STRING' },
    commands: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['addressed', 'say', 'commands'],
};

/** Google's reason for refusing a key, named so the person knows what to do. */
async function geminiAuthError(res) {
  const body = await res.json().catch(() => ({}));
  const msg = String(body?.error?.message || '');
  const reason = JSON.stringify(body?.error?.details || '');
  if (/ACCESS_TOKEN_TYPE_UNSUPPORTED/.test(msg + reason)) return { ok: false, error: 'key_type', detail: msg.slice(0, 160) };
  if (/SERVICE_DISABLED|has not been used|is disabled/i.test(msg + reason)) return { ok: false, error: 'api_disabled', detail: msg.slice(0, 160) };
  if (/location is not supported|User location/i.test(msg)) return { ok: false, error: 'region_blocked', detail: msg.slice(0, 160) };
  return { ok: false, error: 'bad_key', detail: msg.slice(0, 160) };
}

/** Picks the newest plain «Flash» model from Google's list (not lite, preview, image or audio). */
export function pickGeminiModel(models) {
  const ok = (models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''))
    .filter((n) => /^gemini-\d+(\.\d+)?-flash$/.test(n));
  const ver = (n) => Number(/^gemini-(\d+(?:\.\d+)?)/.exec(n)[1]);
  return ok.sort((a, b) => ver(b) - ver(a))[0] || null;
}

/**
 * The models to fall back on, lightest last: the Flash and Flash-Lite aliases, then the two
 * newest Flash and Flash-Lite versions the key lists (no previews, voices or images).
 */
export function geminiPool(names = []) {
  const plain = names.filter((n) => /^gemini-\d+(\.\d+)?-flash(-lite)?$/.test(n));
  const ver = (n) => Number(/^gemini-(\d+(?:\.\d+)?)/.exec(n)[1]);
  const byNew = (a, b) => ver(b) - ver(a);
  const flash = plain.filter((n) => !n.endsWith('-lite')).sort(byNew).slice(0, 2);
  const lite = plain.filter((n) => n.endsWith('-lite')).sort(byNew).slice(0, 2);
  return [...new Set([GEMINI_ALIAS, GEMINI_LITE_ALIAS, ...flash, ...lite])];
}

export class GeminiAgent {
  /** @param {{key: string, model?: string, fetchFn?: typeof fetch, timeoutMs?: number, now?: () => number}} opts */
  constructor(opts) {
    this.key = opts.key;
    this.model = opts.model || null;
    this.fetchFn = opts.fetchFn || fetch;
    this.timeoutMs = opts.timeoutMs || 12000;
    this.now = opts.now || (() => Date.now());
    // How to ask for little thinking: newer models take «thinkingLevel», older «thinkingBudget»;
    // if a model refuses both, ask without.
    this.thinking = 'level';
  }

  thinkingConfig() {
    if (this.thinking === 'level') return { thinkingLevel: 'MINIMAL' };
    if (this.thinking === 'budget') return { thinkingBudget: 0 };
    return null;
  }

  /** Steps down the thinking setting after a model refused it; false when nothing is left to try. */
  refuseThinking() {
    if (this.thinking === 'level') { this.thinking = 'budget'; return true; }
    if (this.thinking === 'budget') { this.thinking = 'none'; return true; }
    return false;
  }

  /** The model to call: the alias first; if Google rejects it, the newest Flash in the key's list. */
  async resolveModel() {
    // After a switch to a lighter model, the usual one is tried again a while later.
    if (this.model && this.switchedAt && this.now() - this.switchedAt > 20 * 60000 && this.preferred && !this.isResting(this.preferred)) {
      this.model = this.preferred; this.switchedAt = 0;
    }
    if (this.model) { this.preferred = this.preferred || this.model; return this.model; }
    this.model = GEMINI_ALIAS;
    this.preferred = GEMINI_ALIAS;
    return this.model;
  }

  /**
   * One generateContent call that moves to another model when this one is busy, out of
   * quota or too slow (Google's free models are often overloaded): the newest Flash, the
   * Flash-Lite alias, then the versions this key lists. A model that worked is kept; a
   * failing one rests for a few minutes. Returns the last answer when every model failed.
   */
  async generate(model, init, timeoutMs) {
    const tried = new Set();
    let current = model;
    let last = null;
    let lastErr = null;
    for (let i = 0; i < 3; i += 1) {
      tried.add(current);
      const ms = i === 0 ? timeoutMs : Math.max(6000, Math.round(timeoutMs * 0.7));
      try {
        const res = await withTimeout(this.fetchFn, `${GEMINI_BASE}/models/${encodeURIComponent(current)}:generateContent`, init, ms);
        if (res.status !== 429 && res.status < 500) {
          if (res.ok && current !== this.model) { this.model = current; this.switchedAt = this.now(); }
          return { res, model: current };
        }
        last = res; lastErr = null;
        this.rest(current, res.status === 429 ? 30 * 60000 : 3 * 60000);
      } catch (err) {
        if (errorName(err) !== 'timeout') throw err;
        lastErr = err; last = null;
        this.rest(current, 3 * 60000);
      }
      const next = await this.nextModel(tried);
      if (!next) break;
      current = next;
    }
    if (last) return { res: last, model: current };
    throw lastErr;
  }

  rest(model, ms) {
    this.resting = this.resting || new Map();
    this.resting.set(model, this.now() + ms);
  }

  isResting(model) {
    const until = this.resting?.get(model);
    return Boolean(until && until > this.now());
  }

  /** The next model to try after a failure, or null. */
  async nextModel(tried) {
    if (!this.pool) {
      const listed = await this.listModels();
      this.pool = geminiPool(listed);
    }
    return this.pool.find((m) => !tried.has(m) && !this.isResting(m)) || null;
  }

  async listModels() {
    try {
      const res = await withTimeout(this.fetchFn, `${GEMINI_BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': this.key } }, 6000);
      if (!res.ok) return [];
      return ((await res.json())?.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => String(m.name || '').replace(/^models\//, ''));
    } catch { return []; }
  }

  async discoverModel() {
    try {
      const res = await withTimeout(this.fetchFn, `${GEMINI_BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': this.key } }, 8000);
      if (!res.ok) return null;
      return pickGeminiModel((await res.json())?.models);
    } catch { return null; }
  }

  body(p) {
    const contents = [];
    for (const h of (p.history || []).slice(-6)) {
      if (h.user) contents.push({ role: 'user', parts: [{ text: String(h.user).slice(0, 400) }] });
      if (h.khalfoun) contents.push({ role: 'model', parts: [{ text: String(h.khalfoun).slice(0, 400) }] });
    }
    contents.push({ role: 'user', parts: [{ text: String(p.text || '').slice(0, 800) }] });
    const merged = [];
    for (const c of contents) {
      const last = merged[merged.length - 1];
      if (last && last.role === c.role) last.parts[0].text += `\n${c.parts[0].text}`;
      else merged.push({ role: c.role, parts: [{ text: c.parts[0].text }] });
    }
    while (merged.length && merged[0].role !== 'user') merged.shift();
    const generationConfig = { responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA, maxOutputTokens: 300, temperature: 0.6 };
    // Thinking makes the answer slower; a short reply does not need it.
    const thinking = this.thinkingConfig();
    if (thinking) generationConfig.thinkingConfig = thinking;
    return {
      systemInstruction: { parts: [{ text: `${agentSystem(p)}\nأجب بكائن JSON فقط فيه addressed و say و commands.` }] },
      contents: merged,
      generationConfig,
    };
  }

  async respond(p) {
    const t0 = this.now();
    let model = await this.resolveModel();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let res;
      try {
        ({ res, model } = await this.generate(model, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': this.key },
          body: JSON.stringify(this.body(p)),
        }, this.timeoutMs));
      } catch (err) {
        return { ok: false, error: errorName(err) };
      }
      if (res.status === 400 || res.status === 404) {
        const msg = String((await res.json().catch(() => ({})))?.error?.message || '');
        if (/API key not valid|API_KEY_INVALID/i.test(msg)) return { ok: false, error: 'bad_key', detail: msg.slice(0, 160) };
        if (/thinking/i.test(msg) && this.refuseThinking()) continue;
        // The alias or a retired model: ask Google which Flash this key can use.
        const found = await this.discoverModel();
        if (found && found !== model) { model = found; this.model = found; continue; }
        return { ok: false, error: `http_${res.status}` };
      }
      if (res.status === 401 || res.status === 403) return geminiAuthError(res);
      if (res.status === 429) return { ok: false, error: 'quota' };
      if (res.status >= 500) return { ok: false, error: 'busy' };
      if (!res.ok) return { ok: false, error: `http_${res.status}` };
      const data = await res.json();
      const text = (data?.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('').trim();
      let parsed;
      try { parsed = JSON.parse(text.replace(/^```(?:json)?|```$/g, '').trim()); } catch { return { ok: false, error: 'no_answer' }; }
      return { ok: true, ...cleanAgentAnswer(parsed), ms: this.now() - t0, model };
    }
    return { ok: false, error: 'no_answer' };
  }

  /** Checks the key with Google's model list (fast), then one real short answer. */
  async verify() {
    const t0 = this.now();
    try {
      const res = await withTimeout(this.fetchFn, `${GEMINI_BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': this.key } }, 10000);
      if (res.status === 400 || res.status === 401 || res.status === 403) return geminiAuthError(res);
      if (res.ok) {
        const best = pickGeminiModel((await res.json())?.models);
        if (best && !this.model) this.model = best;
      }
    } catch (err) {
      return { ok: false, error: errorName(err), detail: 'model list' };
    }
    const keep = this.timeoutMs;
    this.timeoutMs = 25000; // the first answer may be slow while Google warms up
    try {
      const r = await this.respond({ text: 'هلا' });
      return r.ok ? { ok: true, ms: this.now() - t0, model: r.model } : r;
    } finally {
      this.timeoutMs = keep;
    }
  }

  /**
   * Hearing with the same free key: Gemini writes down what was said in the recording.
   * @param {Uint8Array} wav 16 kHz mono WAV
   * @returns {Promise<{ok: true, text: string, ms: number} | {ok: false, error: string}>}
   */
  async transcribe(wav, { timeoutMs = 12000, reading = false } = {}) {
    const t0 = this.now();
    let model = await this.resolveModel();
    const data = Buffer.from(wav).toString('base64');
    const ask = reading
      ? 'هذا تسجيل طالب يقرأ نصاً عربياً بصوت عالٍ. اكتب الكلمات التي نطقها حرفياً كما قرأها، حتى لو أخطأ أو كرر أو تلعثم، بدون تصحيح ولا تشكيل ولا شرح. إذا ما فيه كلام واضح اكتب: -'
      : 'اكتب الكلام العربي المنطوق في هذا التسجيل حرفياً كما قيل باللهجة العُمانية، بدون ترجمة ولا شرح ولا علامات. إذا ما فيه كلام واضح اكتب: -';
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const generationConfig = { temperature: 0, maxOutputTokens: reading ? 1500 : 200 };
      const thinking = this.thinkingConfig();
      if (thinking) generationConfig.thinkingConfig = thinking;
      let res;
      try {
        ({ res, model } = await this.generate(model, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': this.key },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [
              { inline_data: { mime_type: 'audio/wav', data } },
              { text: ask },
            ] }],
            generationConfig,
          }),
        }, timeoutMs));
      } catch (err) {
        return { ok: false, error: errorName(err) };
      }
      if (res.status === 400 || res.status === 404) {
        const msg = String((await res.json().catch(() => ({})))?.error?.message || '');
        if (/API key not valid|API_KEY_INVALID/i.test(msg)) return { ok: false, error: 'bad_key', detail: msg.slice(0, 160) };
        if (/thinking/i.test(msg) && this.refuseThinking()) continue;
        const found = await this.discoverModel();
        if (found && found !== model) { model = found; this.model = found; continue; }
        return { ok: false, error: `http_${res.status}` };
      }
      if (res.status === 401 || res.status === 403) return geminiAuthError(res);
      if (res.status === 429) return { ok: false, error: 'quota' };
      if (!res.ok) return { ok: false, error: `http_${res.status}` };
      const out = await res.json();
      const text = (out?.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join(' ')
        .replace(/[«»"“”]/g, '').replace(/\s+/g, ' ').trim();
      return { ok: true, text: /^[-–—.\s]*$/.test(text) ? '' : text.replace(/[.。]+$/u, ''), ms: this.now() - t0 };
    }
    return { ok: false, error: 'no_answer' };
  }
}

/** What Khalfoun asks when he looks at a photo from the camera. */
export function visionPrompt(mode = 'solve') {
  if (mode === 'look') return 'أنت خلفون، مساعد معلم عُماني. صف باختصار ما في الصورة بالعربية (٣ جمل كحد أقصى). إذا فيها سؤال أو مسألة اذكرها.';
  return [
    'أنت خلفون، مساعد معلم عُماني. في الصورة سؤال أو مسألة من دفتر أو ورقة أو سبورة.',
    'اكتب أولاً سطراً يبدأ بـ «السؤال:» فيه نص السؤال كما تقرؤه.',
    'ثم «الحل:» بخطوات مرقمة قصيرة واضحة لطالب، بالعربية، والأرقام بالأرقام العربية المشرقية أو العادية كما في السؤال.',
    'ثم سطر أخير يبدأ بـ «الجواب:».',
    'إذا الصورة غير واضحة أو ما فيها سؤال، اكتب فقط: غير واضح.',
    'لا تكتب أكثر من ١٢ سطراً.',
  ].join('\n');
}

/**
 * Looking at the whole screen at full resolution: what to do, the screen's size, and the
 * words Windows read with where they are (so numbers and Arabic words are read exactly).
 */
export function screenPrompt(task, { width = 0, height = 0, layout = '', kidsMode = false } = {}) {
  return [
    'أنت خلفون، مساعد معلم عُماني ذكي. هذه لقطة كاملة لشاشة المعلم الآن' + (width ? ` بدقة ${width}×${height} بكسل.` : '.'),
    task,
    layout ? `للدقة: هذا النص كما قرأه قارئ ويندوز مع موقع كل سطر (س,ص العرض×الارتفاع بالبكسل). اعتمد على الصورة، واستعمله للتأكد من الكلمات والأرقام:\n${layout.slice(0, 3500)}` : '',
    'أجب بالعربية الواضحة، بدون رموز تنسيق ولا نجوم. لا تذكر الإحداثيات إلا إذا طُلبت.',
    kidsMode ? 'القارئ طفل: كلمات بسيطة جداً.' : '',
  ].filter(Boolean).join('\n');
}

/** Cleans a vision answer; null when the model could not read the photo. */
export function cleanVision(text) {
  const t = String(text || '').replace(/\*\*/g, '').replace(/^#+\s*/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!t || /^غير واضح[.!]?$/.test(t)) return null;
  return t.slice(0, 2500);
}

/** Gemini looks at a photo (base64 JPEG/PNG) and answers in Arabic. */
GeminiAgent.prototype.vision = async function vision(image, { mime = 'image/jpeg', mode = 'solve', timeoutMs = 30000, prompt = '' } = {}) {
  const t0 = this.now();
  let model = await this.resolveModel();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const generationConfig = { temperature: 0.2, maxOutputTokens: 1500 };
    const thinking = this.thinkingConfig();
    if (thinking) generationConfig.thinkingConfig = thinking;
    let res;
    try {
      ({ res, model } = await this.generate(model, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data: image } }, { text: prompt || visionPrompt(mode) }] }], generationConfig }),
      }, timeoutMs));
    } catch (err) {
      return { ok: false, error: errorName(err) };
    }
    if (res.status === 400 || res.status === 404) {
      const msg = String((await res.json().catch(() => ({})))?.error?.message || '');
      if (/API key not valid|API_KEY_INVALID/i.test(msg)) return { ok: false, error: 'bad_key' };
      if (/thinking/i.test(msg) && this.refuseThinking()) continue;
      const found = await this.discoverModel();
      if (found && found !== model) { model = found; this.model = found; continue; }
      return { ok: false, error: `http_${res.status}` };
    }
    if (res.status === 401 || res.status === 403) return geminiAuthError(res);
    if (res.status === 429) return { ok: false, error: 'quota' };
    if (res.status >= 500) return { ok: false, error: 'busy' };
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const out = await res.json();
    const text = cleanVision((out?.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join(''));
    return text ? { ok: true, text, ms: this.now() - t0, service: 'gemini' } : { ok: false, error: 'unclear' };
  }
  return { ok: false, error: 'no_answer' };
};

/** Claude looks at a photo and answers in Arabic. */
ClaudeAgent.prototype.vision = async function vision(image, { mime = 'image/jpeg', mode = 'solve', timeoutMs = 30000, prompt = '' } = {}) {
  const t0 = this.now();
  try {
    const res = await withTimeout(this.fetchFn, CLAUDE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1200,
        messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mime, data: image } }, { type: 'text', text: prompt || visionPrompt(mode) }] }],
      }),
    }, timeoutMs);
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'bad_key' };
    if (res.status === 402 || res.status === 400) {
      const msg = String((await res.json().catch(() => ({})))?.error?.message || '');
      return { ok: false, error: /credit|balance|billing/i.test(msg) ? 'no_credit' : `http_${res.status}` };
    }
    if (res.status === 429 || res.status === 529) return { ok: false, error: 'busy' };
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const data = await res.json();
    const text = cleanVision((data?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n'));
    return text ? { ok: true, text, ms: this.now() - t0, service: 'claude' } : { ok: false, error: 'unclear' };
  } catch (err) {
    return { ok: false, error: errorName(err) };
  }
};

/** Claude writes longer content (documents, decks) from a system and a user prompt. */
ClaudeAgent.prototype.write = async function write({ system, user, maxTokens = 3000, timeoutMs = 60000 }) {
  const t0 = this.now();
  try {
    const res = await withTimeout(this.fetchFn, CLAUDE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: this.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    }, timeoutMs);
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'bad_key' };
    if (res.status === 402 || res.status === 400) {
      const msg = String((await res.json().catch(() => ({})))?.error?.message || '');
      return { ok: false, error: /credit|balance|billing/i.test(msg) ? 'no_credit' : `http_${res.status}` };
    }
    if (res.status === 429 || res.status === 529) return { ok: false, error: 'busy' };
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const data = await res.json();
    const text = (data?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    return text ? { ok: true, text, ms: this.now() - t0, service: 'claude' } : { ok: false, error: 'empty' };
  } catch (err) {
    return { ok: false, error: errorName(err) };
  }
};

/** Gemini writes longer content, answering in JSON. */
GeminiAgent.prototype.write = async function write({ system, user, maxTokens = 4000, timeoutMs = 60000 }) {
  const t0 = this.now();
  let model = await this.resolveModel();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const generationConfig = { temperature: 0.6, maxOutputTokens: maxTokens, responseMimeType: 'application/json' };
    const thinking = this.thinkingConfig();
    if (thinking) generationConfig.thinkingConfig = thinking;
    let res;
    try {
      ({ res, model } = await this.generate(model, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.key },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig }),
      }, timeoutMs));
    } catch (err) {
      return { ok: false, error: errorName(err) };
    }
    if (res.status === 400 || res.status === 404) {
      const msg = String((await res.json().catch(() => ({})))?.error?.message || '');
      if (/API key not valid|API_KEY_INVALID/i.test(msg)) return { ok: false, error: 'bad_key' };
      if (/thinking/i.test(msg) && this.refuseThinking()) continue;
      const found = await this.discoverModel();
      if (found && found !== model) { model = found; this.model = found; continue; }
      return { ok: false, error: `http_${res.status}` };
    }
    if (res.status === 401 || res.status === 403) return geminiAuthError(res);
    if (res.status === 429) return { ok: false, error: 'quota' };
    if (res.status >= 500) return { ok: false, error: 'busy' };
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const out = await res.json();
    const text = (out?.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
    return text ? { ok: true, text, ms: this.now() - t0, service: 'gemini' } : { ok: false, error: 'empty' };
  }
  return { ok: false, error: 'no_answer' };
};

/**
 * Several cloud brains in order: the next one answers when the first has no credit, a bad
 * key or is busy (a Claude key without credit must not block a working Gemini key).
 */
export function chainAgents(agents) {
  const chain = agents.filter(Boolean);
  return {
    async respond(p) {
      let last = { ok: false, error: 'not_configured' };
      for (const a of chain) {
        last = await a.respond(p);
        if (last.ok || !['no_credit', 'bad_key', 'busy', 'key_type', 'quota'].includes(last.error)) return last;
      }
      return last;
    },
    async write(req) {
      let last = { ok: false, error: 'not_configured' };
      for (const a of chain) {
        if (!a.write) continue;
        last = await a.write(req);
        if (last.ok || !['no_credit', 'bad_key', 'busy', 'key_type', 'quota', 'timeout'].includes(last.error)) return last;
      }
      return last;
    },
    async vision(image, opts) {
      let last = { ok: false, error: 'not_configured' };
      for (const a of chain) {
        if (!a.vision) continue;
        last = await a.vision(image, opts);
        if (last.ok || !['no_credit', 'bad_key', 'busy', 'key_type', 'quota', 'timeout'].includes(last.error)) return last;
      }
      return last;
    },
  };
}
