// The overlay page: puts the brain, the character, movement, voice and the
// panels together. Runs inside a transparent always-on-top window that lets
// clicks pass through everywhere except Khalfoun and his panels.

import { Brain } from '../core/brain.js';
import { createCharacter } from './character.js';
import { Animator, EMOTION_ANIMATION } from './animations.js';
import { Motion } from './motion.js';
import { visiblePlatforms } from './platforms.js';
import { Recorder } from './recorder.js';
import { WakeListener } from './wake-listener.js';
import { findWakeWord } from '../core/wake.js';
import { recognize } from '../core/intents.js';
import { toArabicDigits } from '../core/arabic.js';
import { getBridge } from './bridge.js';
import { SoundPlayer, ANIMATION_SOUND } from './sounds.js';

const CHAR_W = 170;
const CHAR_H = 209;
const PREVIEW_TASKBAR = 44;
const IDLE_ANIMS = ['look_around', 'whistle', 'stretch', 'adjust', 'peek', 'sneeze', 'flex', 'yawn', 'scratch', 'spin', 'coffee', 'cheeky', 'think', 'read', 'sway', 'tiptoe', 'bounce', 'fan', 'shrug', 'idea'];

const $ = (id) => document.getElementById(id);
const bridge = getBridge();
const isPreview = bridge.platform === 'preview';
if (isPreview) document.documentElement.classList.add('preview');

const els = {
  stage: $('stage'), bubble: $('bubble'), bubbleText: $('bubble-text'), command: $('command'), input: $('command-input'),
  mic: $('mic'), micLevel: $('mic-level'), onboarding: $('onboarding'), settings: $('settings'), ear: $('ear'),
};

const workArea = () => ({ width: window.innerWidth, height: window.innerHeight - (isPreview ? PREVIEW_TASKBAR : 0) });

let brain;
let voiceAvailable = false;
let chatInfo = { available: false, model: null };
const character = createCharacter(els.stage);
const animator = new Animator();
const motion = new Motion(workArea(), { width: CHAR_W, height: CHAR_H });
const recorder = new Recorder();
const sounds = new SoundPlayer({ enabled: false });

// ------------------------------------------------------------------ bubble

let bubbleTimer = null;
let typeTimer = null;
let bubbleUntil = 0;

function showBubble(text, mood) {
  clearTimeout(bubbleTimer);
  clearInterval(typeTimer);
  els.bubble.hidden = false;
  els.bubble.className = `bubble mood-${mood || 'calm'}`;
  // restart the pop animation
  void els.bubble.offsetWidth;
  const chars = Array.from(text);
  let shown = 0;
  els.bubbleText.textContent = '';
  els.bubble.setAttribute('aria-label', text);
  typeTimer = setInterval(() => {
    shown = Math.min(chars.length, shown + 2);
    els.bubbleText.textContent = chars.slice(0, shown).join('');
    if (shown >= chars.length) clearInterval(typeTimer);
  }, 30);
  sounds.babble(text, mood);
  const ms = Math.min(10000, 2200 + chars.length * 65);
  bubbleUntil = performance.now() + ms;
  bubbleTimer = setTimeout(hideBubble, ms);
}

function hideBubble() {
  clearInterval(typeTimer);
  els.bubble.hidden = true;
  bubbleUntil = 0;
}

// ----------------------------------------------------------------- replies

let lastReply = null; // for automated checks
const recentSituations = []; // for automated checks

function handle(reply) {
  if (!reply) return;
  lastReply = reply;
  recentSituations.push(reply.situation);
  if (recentSituations.length > 20) recentSituations.shift();
  if (reply.emotion) character.setEmotion(reply.emotion);
  if (reply.costume !== undefined) character.setCostume(reply.costume);
  if (reply.say) showBubble(reply.say, reply.emotion?.emotion);
  const anim = reply.animation || EMOTION_ANIMATION[reply.emotion?.emotion];
  if (anim && anim !== 'sleep') animator.play(anim);
  if (reply.situation === 'sounds_on' || reply.situation === 'sounds_off') sounds.setEnabled(brain.memory.data.sounds !== false);
  if (anim && ANIMATION_SOUND[anim]) setTimeout(() => sounds.effect(ANIMATION_SOUND[anim], reply.emotion?.emotion), 120);
  switch (reply.behavior) {
    case 'come': motion.come(); break;
    case 'away': motion.goAway(); break;
    case 'sleep': motion.sleep(); break;
    case 'wake': motion.wake(); break;
    case 'dance': if (!reply.animation || reply.animation === 'dance') animator.play(Math.random() < 0.5 ? 'cane_dance' : 'dance', 4.8); else animator.play(reply.animation, 4.8); break;
    case 'jump': animator.play('jump'); break;
    case 'stop': motion.stop(); animator.stop(); break;
    case 'open_settings': openSettings(String(reply.situation || '').startsWith('setup_hint') ? 'setup' : null); break;
    default: break;
  }
  if (reply.action) runAction(reply.action);
}

async function runAction(action) {
  let result;
  try {
    result = await bridge.runAction(action);
  } catch (err) {
    result = { ok: false, error: String(err?.message || err) };
  }
  handle(brain.actionResult(action.id, result));
}

let chatting = false;
const chatOn = () => chatInfo.available && brain.memory.data.chatEnabled !== false && typeof bridge.chat === 'function';

function hear(text) {
  const t = String(text || '').trim();
  if (!t) return;
  const reply = brain.hear(t);
  if (reply?.situation === 'not_understood' && reply.unknownText && chatOn() && !chatting) {
    askModel(t, reply);
    return;
  }
  handle(reply);
}

/** Lets the local model answer what his built-in rules do not understand. */
async function askModel(text, fallback) {
  chatting = true;
  handle(brain.reply('thinking'));
  try {
    const d = brain.memory.data;
    const res = await bridge.chat({ text, history: brain.chatHistory, name: d.name, humor: d.humor });
    handle(res?.ok && res.text ? brain.chatReply(text, res.text) : fallback);
  } catch {
    handle(fallback);
  } finally {
    chatting = false;
  }
}

// ---------------------------------------------------------------- command box

let commandTimer = null;

function openCommand() {
  els.command.hidden = false;
  setInteractive(true);
  layout();
  els.input.focus();
  armCommandTimeout();
}

function closeCommand() {
  els.command.hidden = true;
  clearTimeout(commandTimer);
}

function armCommandTimeout() {
  clearTimeout(commandTimer);
  commandTimer = setTimeout(() => {
    if (document.activeElement !== els.input || !els.input.value) closeCommand();
  }, 20000);
}

els.command.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = els.input.value;
  els.input.value = '';
  hear(text);
  armCommandTimeout();
});

els.input.addEventListener('input', armCommandTimeout);

// ------------------------------------------------------------------- voice

async function listen() {
  if (recorder.active) { recorder.stop(); return; }
  if (!voiceAvailable) {
    handle(brain.event('stt_unavailable'));
    openCommand();
    return;
  }
  if (els.command.hidden) openCommand();
  handle(brain.event('listening'));
  els.mic.classList.add('recording');
  try {
    const { wav, spoke } = await recorder.record((level) => els.micLevel.style.setProperty('--level', String(1 + level * 0.6)));
    els.mic.classList.remove('recording');
    if (!spoke) { handle(brain.event('stt_empty')); return; }
    showBubble('…', 'focused');
    const res = await bridge.transcribe(wav, 'command');
    if (!res?.ok) { handle(brain.event(res?.error === 'stt_unavailable' ? 'stt_unavailable' : 'stt_empty')); return; }
    if (!res.text) { handle(brain.event('stt_empty')); return; }
    els.input.value = res.text;
    setTimeout(() => { if (els.input.value === res.text) els.input.value = ''; }, 2500);
    hear(res.text);
  } catch (err) {
    els.mic.classList.remove('recording');
    console.warn('microphone error', err);
    handle(brain.event('mic_error'));
  }
}

els.mic.addEventListener('click', listen);

// ------------------------------------------------------- «يا خلفون» wake word

let wakeBusy = false;
const wake = new WakeListener({
  onSentence: (wav) => { onWakeSentence(wav); },
  onError: (err) => {
    console.warn('wake listener stopped', err);
    brain.updateSettings({ alwaysListen: false });
    handle(brain.event('mic_error'));
    updateWake();
  },
});

/** Starts or stops always-on listening to match the setting. */
function updateWake() {
  const want = Boolean(brain?.memory.data.alwaysListen && voiceAvailable);
  if (want && !wake.active) wake.start().then(() => { els.ear.hidden = !wake.active; });
  if (!want && wake.active) wake.stop();
  els.ear.hidden = !want;
}

async function onWakeSentence(wav) {
  if (wakeBusy || recorder.active || panelsOpen()) return;
  wakeBusy = true;
  try {
    const res = await bridge.transcribe(wav, 'wake');
    if (!res?.ok || !res.text) return;
    const hit = findWakeWord(res.text);
    if (!hit.found) return;
    els.ear.classList.add('heard');
    setTimeout(() => els.ear.classList.remove('heard'), 900);
    if (hit.rest && !['call', 'empty'].includes(recognize(hit.rest).intent)) {
      // «يا خلفون افتح الحاسبة» in one breath: do it right away.
      hear(hit.rest);
      return;
    }
    const wasAsleep = brain.emotions.asleep;
    handle(brain.event('wake_call'));
    if (wasAsleep) await new Promise((r) => setTimeout(r, 900));
    wake.pause();
    try { await listen(); } finally { wake.resume(); }
  } finally {
    wakeBusy = false;
  }
}

// ---------------------------------------------------------- open windows

let lastWindows = [];
const climbAllowed = () => brain?.memory.data.walkOnWindows !== false;

function applyWindows() {
  motion.setPlatforms(climbAllowed() ? visiblePlatforms(lastWindows, workArea(), { width: CHAR_W, height: CHAR_H }) : []);
}

/** Turns walking on windows on or off to match the setting. */
function updateWindowWatch() {
  const on = climbAllowed();
  motion.climb = on;
  if (bridge.watchWindows) bridge.watchWindows(on);
  if (preview) preview.setEnabled(on);
  applyWindows();
}

let preview = null;

// ---------------------------------------------------------- pointer & mouse

let interactive = false;
function setInteractive(on) {
  if (on === interactive) return;
  interactive = on;
  bridge.setInteractive(on);
}

const panelsOpen = () => !els.onboarding.hidden || !els.settings.hidden;

document.addEventListener('mousemove', (e) => {
  const over = e.target instanceof Element && e.target.closest('.stage, .bubble, .command, .panel');
  setInteractive(Boolean(over) || panelsOpen() || !els.command.hidden && document.activeElement === els.input);
  if (motion.mode !== 'drag') {
    const hx = motion.x + CHAR_W / 2;
    const hy = motion.y + CHAR_H * 0.33;
    character.lookAt((e.clientX - hx) / 350 * motion.facing, (e.clientY - hy) / 300, 1.5);
  }
});

let press = null;
let clicks = [];
let clickTimer = null;

els.stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  els.stage.setPointerCapture(e.pointerId);
  press = { x: e.clientX, y: e.clientY, offX: e.clientX - motion.x, offY: e.clientY - motion.y, dragging: false };
});

els.stage.addEventListener('pointermove', (e) => {
  if (!press) return;
  if (!press.dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) {
    press.dragging = true;
    motion.startDrag();
    els.stage.classList.add('dragging');
    handle(brain.event('drag'));
  }
  if (press.dragging) motion.dragTo(e.clientX - press.offX, e.clientY - press.offY);
});

function endPress() {
  if (!press) return;
  const wasDrag = press.dragging;
  press = null;
  els.stage.classList.remove('dragging');
  if (wasDrag) { motion.endDrag(); return; }
  const now = performance.now();
  clicks = clicks.filter((t) => now - t < 700);
  clicks.push(now);
  clearTimeout(clickTimer);
  if (clicks.length >= 3) { clicks = []; handle(brain.event('tickle')); return; }
  clickTimer = setTimeout(() => {
    const n = clicks.length;
    clicks = [];
    if (n === 2) openCommand();
    else if (brain.emotions.asleep) handle(brain.event('wake_call'));
    else handle(brain.event('poke'));
  }, 300);
}

els.stage.addEventListener('pointerup', endPress);
els.stage.addEventListener('pointercancel', endPress);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!els.settings.hidden) closeSettings();
    else closeCommand();
  }
});

// -------------------------------------------------------------- onboarding

function startOnboarding() {
  els.onboarding.hidden = false;
  setInteractive(true);
  motion.paused = true;
  const box = els.onboarding.getBoundingClientRect();
  motion.x = Math.max(0, box.left - CHAR_W - 12);
  motion.targetX = motion.x;
  animator.play('knock', 600);
  handle(brain.reply('onboard_knock'));
  $('ob-name').focus();
}

$('ob-go').addEventListener('click', async () => {
  const name = $('ob-name').value;
  const level = Number(document.querySelector('input[name="ob-level"]:checked')?.value || 1);
  const humor = Number(document.querySelector('input[name="ob-humor"]:checked')?.value ?? 1);
  const kidsMode = $('ob-kids').checked;
  const res = await bridge.updateSettings({ onboarded: true, level, kidsMode });
  if (!res?.ok) return;
  els.onboarding.hidden = true;
  animator.stop();
  motion.paused = false;
  handle(brain.completeOnboarding({ name, level: res.settings.level, kidsMode: res.settings.kidsMode, humor }));
  // A first tip, only if the person has not started talking to him yet.
  const before = brain.memory.data.interactions;
  setTimeout(() => {
    if (brain.memory.data.interactions === before && performance.now() > bubbleUntil) handle(brain.reply('help'));
  }, 6000);
});

// ---------------------------------------------------------------- settings

function radio(name, value) {
  const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (el) el.checked = true;
}

function openSettings(focus = null) {
  const d = brain.memory.data;
  $('st-name').value = d.name || '';
  radio('st-level', d.level || 1);
  radio('st-humor', d.humor);
  $('st-kids').checked = !!d.kidsMode;
  $('st-listen').checked = !!d.alwaysListen;
  $('st-chat').checked = d.chatEnabled !== false;
  $('st-chat').disabled = !chatInfo.available;
  $('st-windows').checked = d.walkOnWindows !== false;
  $('st-sounds').checked = d.sounds !== false;
  $('st-listen').disabled = !voiceAvailable;
  refreshSetup().then(() => { if (focus === 'setup') $('su-title').scrollIntoView({ block: 'start', behavior: 'smooth' }); });
  renderLog();
  closeCommand();
  els.settings.hidden = false;
  setInteractive(true);
  stepAsideFrom(els.settings);
}

/** The «آخر ما سويته» list in the settings panel. */
function renderLog() {
  const d = brain.memory.data;
  const log = $('st-log');
  log.textContent = '';
  const fmt = new Intl.DateTimeFormat('ar-OM', { hour: 'numeric', minute: '2-digit' });
  const entries = d.log.slice(-8).reverse();
  if (!entries.length) {
    const li = document.createElement('li');
    li.textContent = 'ما سويت شي للحين.';
    log.appendChild(li);
  }
  for (const entry of entries) {
    const li = document.createElement('li');
    li.textContent = `${fmt.format(new Date(entry.at))} — ${entry.summary || entry.action}${entry.ok ? '' : ' (ما زبطت)'}`;
    if (!entry.ok) li.className = 'bad';
    log.appendChild(li);
  }
}

/** Walks out from under a panel so he stays visible beside it. */
function stepAsideFrom(panel) {
  const r = panel.getBoundingClientRect();
  if (motion.x + CHAR_W < r.left || motion.x > r.right) return;
  const leftSpot = r.left - CHAR_W - 12;
  const rightSpot = r.right + 12;
  if (leftSpot >= 0) motion.walkTo(leftSpot, true);
  else if (rightSpot + CHAR_W <= window.innerWidth) motion.walkTo(rightSpot, true);
}

function closeSettings() { els.settings.hidden = true; }

// ------------------------------------------------- one-click setup (settings)

let setupStatus = null;
const fmtMB = (mb) => (mb >= 1000 ? `${toArabicDigits((mb / 1000).toFixed(1))} جيجا` : `${toArabicDigits(Math.max(1, Math.round(mb)))} ميجا`);

function fillSelect(sel, options, keep) {
  const prev = keep ? sel.value : null;
  sel.textContent = '';
  for (const [value, label] of options) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    sel.appendChild(opt);
  }
  if (prev && options.some(([v]) => v === prev)) sel.value = prev;
}

/** Fills the two setup cards from the main process's view of what is installed. */
async function refreshSetup() {
  if (!bridge.setup) { $('su-voice').closest('.setup').hidden = true; return; }
  try { setupStatus = await bridge.setup.status(); } catch { setupStatus = null; }
  if (!setupStatus) return;
  const busy = setupStatus.busy;
  const v = setupStatus.voice;
  const vState = $('su-voice-state');
  vState.textContent = v.available ? 'جاهز' : 'غير مركّب';
  vState.classList.toggle('ok', !!v.available);
  fillSelect($('su-voice-pack'), Object.entries(v.packs).map(([id, p]) => [id, `${p.label}${id === 'balanced' ? ' (ينصح به)' : ''}${p.mb ? ` · ${fmtMB(p.mb)}` : ' · موجود'}`]), true);
  if (!$('su-voice-pack').dataset.touched) $('su-voice-pack').value = 'balanced';
  $('su-voice-text').textContent = !v.supported
    ? 'التجهيز التلقائي للاستماع متوفر على ويندوز. على هذا الجهاز ركّب whisper.cpp يدوياً (انظر README).'
    : v.available
      ? 'اضغط الميكروفون أو Ctrl+Shift+Space وتكلم. تقدر تنزّل حجم أدق من هنا متى ما بغيت.'
      : 'ينزّل برنامج الاستماع ونموذجه مرة وحدة، وبعدها يشتغل دون إنترنت. «متوازن» يناسب أغلب الأجهزة، و«دقيق» أفهم للهجة لكنه أبطأ.';
  $('su-voice-go').textContent = v.available ? 'نزّل هذا الحجم' : 'جهّز الاستماع';
  $('su-voice-controls').hidden = !v.supported;

  const b = setupStatus.brain;
  const bState = $('su-brain-state');
  bState.textContent = b.chatAvailable ? 'جاهز' : b.ollamaRunning ? 'ينقصه نموذج' : 'يحتاج Ollama';
  bState.classList.toggle('ok', !!b.chatAvailable);
  fillSelect($('su-brain-choice'), Object.entries(b.choices).map(([id, c]) => [id, `${c.label} · ${c.model} · ${fmtMB(c.approxMB)}`]), true);
  $('su-brain-choice').hidden = !b.ollamaRunning;
  $('su-brain-text').textContent = b.chatAvailable
    ? `يسولف عبر ${b.model} على جهازك فقط، وما يطلع منه شي للإنترنت.`
    : b.ollamaRunning
      ? 'Ollama شغّال. اختار حجم النموذج واضغط «نزّل العقل». «عادي» يناسب أغلب الأجهزة.'
      : 'العقل يحتاج برنامج Ollama المجاني. نزّله وثبّته من صفحته، وبعدين ارجع هنا واضغط «نزّل العقل».';
  $('su-brain-go').textContent = b.ollamaRunning ? 'نزّل العقل' : 'افتح صفحة Ollama';
  for (const id of ['su-voice-go', 'su-voice-pack', 'su-brain-go', 'su-brain-choice']) $(id).disabled = Boolean(busy);
}

function showSetupProgress(p) {
  const box = $('su-progress');
  box.hidden = false;
  const pct = p.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0;
  $('su-bar').style.width = `${pct}%`;
  const what = p.kind === 'brain' ? 'العقل' : 'الاستماع';
  $('su-progress-text').textContent = p.step === 'done'
    ? `خلص تنزيل ${what}، جاري التركيب...`
    : p.total
      ? `ينزّل ${what}: ${toArabicDigits(pct)}٪ (${fmtMB(p.done / 1e6)} من ${fmtMB(p.total / 1e6)})`
      : `ينزّل ${what}...`;
}

async function runSetup(kind, choice) {
  handle(brain.event('setup_start', { kind }));
  for (const id of ['su-voice-go', 'su-voice-pack', 'su-brain-go', 'su-brain-choice']) $(id).disabled = true;
  showSetupProgress({ kind, step: 'start', done: 0, total: 0 });
  let res;
  try {
    res = kind === 'brain' ? await bridge.setup.brain(choice) : await bridge.setup.voice(choice);
  } catch (err) {
    res = { ok: false, text: String(err?.message || err) };
  }
  $('su-progress').hidden = true;
  if (res?.ok) {
    sounds.effect('yay');
    handle(brain.event('setup_done', { kind, model: res.model }));
    brain.memory.log({ action: `setup_${kind}`, ok: true, summary: kind === 'brain' ? 'تجهيز العقل' : 'تجهيز الاستماع' });
  } else {
    handle(brain.event('setup_failed', { kind, reason: res?.text }));
    brain.memory.log({ action: `setup_${kind}`, ok: false, error: res?.error || null, summary: kind === 'brain' ? 'تجهيز العقل' : 'تجهيز الاستماع' });
  }
  renderLog();
  refreshSetup();
}

$('su-voice-pack').addEventListener('change', () => { $('su-voice-pack').dataset.touched = '1'; });
$('su-voice-go').addEventListener('click', () => runSetup('voice', $('su-voice-pack').value));
$('su-brain-go').addEventListener('click', async () => {
  if (setupStatus?.brain?.ollamaRunning) { runSetup('brain', $('su-brain-choice').value); return; }
  await bridge.setup.getOllama();
  handle(brain.reply('setup_hint_brain'));
});
$('su-cancel').addEventListener('click', () => bridge.setup.cancel());

$('st-close').addEventListener('click', closeSettings);
$('st-name').addEventListener('change', () => brain.updateSettings({ name: $('st-name').value }));
for (const el of document.querySelectorAll('input[name="st-humor"]')) {
  el.addEventListener('change', () => brain.updateSettings({ humor: Number(el.value) }));
}
for (const el of document.querySelectorAll('input[name="st-level"]')) {
  el.addEventListener('change', async () => {
    const res = await bridge.updateSettings({ level: Number(el.value) });
    if (res?.ok) handle(brain.updateSettings({ level: res.settings.level }));
    radio('st-level', brain.memory.data.level);
  });
}
$('st-kids').addEventListener('change', async () => {
  const want = $('st-kids').checked;
  const res = await bridge.updateSettings({ kidsMode: want });
  if (res?.ok) brain.updateSettings({ kidsMode: res.settings.kidsMode });
  $('st-kids').checked = !!brain.memory.data.kidsMode;
});
$('st-chat').addEventListener('change', async () => {
  const want = $('st-chat').checked;
  const res = await bridge.updateSettings({ chatEnabled: want });
  brain.memory.set({ chatEnabled: res?.ok ? res.settings.chatEnabled !== false : !want });
});
$('st-sounds').addEventListener('change', () => {
  brain.memory.set({ sounds: $('st-sounds').checked });
  sounds.setEnabled($('st-sounds').checked);
  if ($('st-sounds').checked) sounds.effect('ding');
});
$('st-windows').addEventListener('change', () => {
  brain.memory.set({ walkOnWindows: $('st-windows').checked });
  updateWindowWatch();
});
$('st-listen').addEventListener('change', () => {
  brain.updateSettings({ alwaysListen: $('st-listen').checked });
  updateWake();
});
$('st-forget').addEventListener('click', () => {
  // eslint-disable-next-line no-alert
  if (window.confirm('أنسى كل اللي تعلمته عنك؟ (الإعدادات تبقى)')) {
    brain.memory.forget();
    closeSettings();
    handle(brain.reply('cancelled'));
  }
});
$('st-quit').addEventListener('click', () => bridge.quit());

// ------------------------------------------------------------------ layout

function layout() {
  const x = motion.x;
  const y = motion.y;
  els.stage.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  const cx = x + CHAR_W / 2;
  if (!els.ear.hidden) els.ear.style.transform = `translate(${(x + 6).toFixed(1)}px, ${(y + 100).toFixed(1)}px)`;
  let top = y + 4;
  if (!els.command.hidden) {
    const w = els.command.offsetWidth;
    const left = Math.min(Math.max(8, cx - w / 2), window.innerWidth - w - 8);
    top = Math.max(8, y - els.command.offsetHeight + 6);
    els.command.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
  }
  if (!els.bubble.hidden) {
    const w = els.bubble.offsetWidth;
    const h = els.bubble.offsetHeight;
    // Keep clear of an open panel: the bubble stays on Khalfoun's side of it.
    const panel = !els.onboarding.hidden ? els.onboarding : !els.settings.hidden ? els.settings : null;
    let maxRight = window.innerWidth - 8;
    if (panel) {
      const r = panel.getBoundingClientRect();
      if (cx < r.left) maxRight = Math.min(maxRight, r.left - 8);
    }
    const left = Math.min(Math.max(8, cx - w / 2), maxRight - w);
    const btop = Math.max(8, top - h - 14);
    els.bubble.style.transform = `translate(${left.toFixed(1)}px, ${btop.toFixed(1)}px)`;
    els.bubble.style.setProperty('--tail', `${Math.min(Math.max(22, cx - left), w - 22).toFixed(1)}px`);
  }
}

// -------------------------------------------------------------------- loop

let last = performance.now();
let nextFidget = 25;
let lastX = motion.x;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const talking = performance.now() < bubbleUntil;
  motion.paused = talking || !els.command.hidden || panelsOpen() || recorder.active;

  const asleep = brain?.emotions.asleep;
  if (asleep && (motion.mode === 'idle' || motion.mode === 'focus')) motion.sleep();
  if (!asleep && motion.mode === 'sleep') motion.wake();

  for (const ev of motion.update(dt)) {
    if (!brain) continue;
    if (ev.type === 'hop') sounds.effect('boing');
    if (ev.type === 'landed' && ev.impact > 500) sounds.effect('thud');
    if (ev.type === 'slip') handle(brain.event('slip'));
    else if (ev.type === 'landed' && ev.impact > 500) handle(brain.event('dropped'));
    else if (ev.type === 'landed' && ev.onWindow && Math.random() < 0.35) handle(brain.event('hop_window'));
  }

  // occasional fidgets when nothing else is happening
  nextFidget -= dt;
  if (nextFidget <= 0) {
    const humor = brain?.memory.data.humor ?? 1;
    nextFidget = (humor === 2 ? 14 : humor === 1 ? 24 : 45) + Math.random() * 20;
    if (brain && !asleep && !motion.focus && motion.mode === 'idle' && !talking && !animator.playing && !panelsOpen()) {
      animator.play(IDLE_ANIMS[Math.floor(Math.random() * IDLE_ANIMS.length)]);
    }
  }

  character.setVelocity(dt > 0 ? (motion.x - lastX) / dt : 0);
  lastX = motion.x;
  animator.setBase(motion.baseAnimation);
  if (motion.mode === 'walk' || motion.mode === 'run') character.setFacing(motion.facing);
  character.render(dt, animator.update(dt));
  layout();
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => { motion.setArea(workArea()); applyWindows(); });

// ------------------------------------------------------------------- start

async function start() {
  const loaded = await bridge.loadState();
  voiceAvailable = !!loaded?.voice?.available;
  chatInfo = { available: !!loaded?.chat?.available, model: loaded?.chat?.model || null };
  const memoryData = { ...(loaded?.memory || {}), ...(loaded?.settings || {}) };
  let saveTimer = null;
  brain = new Brain({
    memoryData,
    onMemoryChange: (data) => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => bridge.saveMemory(data), 700);
    },
  });

  bridge.onEvent((ev) => {
    switch (ev?.type) {
      case 'reminder': sounds.effect('chime'); handle(brain.event('reminder_fire', { note: ev.note })); motion.come(); break;
      case 'open-command': openCommand(); break;
      case 'ptt': listen(); break;
      case 'open-settings': openSettings(); break;
      case 'come': handle(brain.hear('تعال')); break;
      case 'windows': lastWindows = Array.isArray(ev.list) ? ev.list : []; applyWindows(); break;
      case 'setup-progress': showSetupProgress(ev); break;
      case 'voice-ready':
        voiceAvailable = !!ev.available;
        $('st-listen').disabled = !voiceAvailable;
        updateWake();
        break;
      case 'chat-ready':
        chatInfo = { available: !!ev.available, model: ev.model || null };
        $('st-chat').disabled = !chatInfo.available;
        break;
      default: break;
    }
  });

  setInterval(() => handle(brain.tick()), 4000);
  // Habits the person agreed to («كل يوم افتح لي...»), checked now and every ten minutes.
  const runRoutines = () => { if (brain.memory.data.onboarded) for (const action of brain.dueRoutines()) runAction(action); };
  setTimeout(runRoutines, 8000);
  setInterval(runRoutines, 10 * 60 * 1000);
  // Dress for today's occasion, and check again every hour.
  let dressedFor;
  const dressForToday = () => {
    const occ = brain.currentOccasion();
    const id = occ?.id ?? null;
    if (id === dressedFor) return; // keep an outfit the person picked until the occasion changes
    dressedFor = id;
    character.setCostume(occ?.costume ?? null);
  };
  dressForToday();
  setInterval(dressForToday, 60 * 60 * 1000);
  requestAnimationFrame(frame);

  if (isPreview) {
    const { createPreviewDesktop } = await import('./preview-desktop.js');
    preview = createPreviewDesktop(document.body, (list) => { lastWindows = list; applyWindows(); });
  }
  sounds.setEnabled(brain.memory.data.sounds !== false);
  updateWake();
  updateWindowWatch();
  if (!brain.memory.data.onboarded) startOnboarding();
  else handle(brain.start());

  // Hooks for automated UI tests and debugging.
  window.__khalfoun = { brain, motion, animator, character, hear, handle, bridge, showBubble, sounds, wake, updateWake, updateWindowWatch, get preview() { return preview; }, get lastReply() { return lastReply; }, recentSituations };
  document.documentElement.dataset.ready = '1';
}

start().catch((err) => {
  console.error('Khalfoun failed to start', err);
  document.documentElement.dataset.ready = 'error';
});
