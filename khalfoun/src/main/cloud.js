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
