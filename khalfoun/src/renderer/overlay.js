// The overlay page: puts the brain, the character, movement, voice and the
// panels together. Runs inside a transparent always-on-top window that lets
// clicks pass through everywhere except Khalfoun and his panels.

import { Brain } from '../core/brain.js';
import { createCharacter } from './character.js';
import { Animator, EMOTION_ANIMATION } from './animations.js';
import { Motion } from './motion.js';
import { Recorder } from './recorder.js';
import { getBridge } from './bridge.js';

const CHAR_W = 170;
const CHAR_H = 209;
const PREVIEW_TASKBAR = 44;
const IDLE_ANIMS = ['look_around', 'whistle', 'stretch', 'adjust', 'peek', 'sneeze', 'flex', 'yawn', 'scratch', 'spin', 'coffee'];

const $ = (id) => document.getElementById(id);
const bridge = getBridge();
const isPreview = bridge.platform === 'preview';
if (isPreview) document.documentElement.classList.add('preview');

const els = {
  stage: $('stage'), bubble: $('bubble'), bubbleText: $('bubble-text'), command: $('command'), input: $('command-input'),
  mic: $('mic'), micLevel: $('mic-level'), onboarding: $('onboarding'), settings: $('settings'),
};

const workArea = () => ({ width: window.innerWidth, height: window.innerHeight - (isPreview ? PREVIEW_TASKBAR : 0) });

let brain;
let voiceAvailable = false;
const character = createCharacter(els.stage);
const animator = new Animator();
const motion = new Motion(workArea(), { width: CHAR_W, height: CHAR_H });
const recorder = new Recorder();

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

function handle(reply) {
  if (!reply) return;
  if (reply.emotion) character.setEmotion(reply.emotion);
  if (reply.say) showBubble(reply.say, reply.emotion?.emotion);
  const anim = reply.animation || EMOTION_ANIMATION[reply.emotion?.emotion];
  if (anim && anim !== 'sleep') animator.play(anim);
  switch (reply.behavior) {
    case 'come': motion.come(); break;
    case 'away': motion.goAway(); break;
    case 'sleep': motion.sleep(); break;
    case 'wake': motion.wake(); break;
    case 'dance': animator.play('dance', 4.8); break;
    case 'jump': animator.play('jump'); break;
    case 'stop': motion.stop(); animator.stop(); break;
    case 'open_settings': openSettings(); break;
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

function hear(text) {
  const t = String(text || '').trim();
  if (!t) return;
  handle(brain.hear(t));
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
    const res = await bridge.transcribe(wav);
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

function openSettings() {
  const d = brain.memory.data;
  $('st-name').value = d.name || '';
  radio('st-level', d.level || 1);
  radio('st-humor', d.humor);
  $('st-kids').checked = !!d.kidsMode;
  $('st-voice').textContent = voiceAvailable
    ? 'الاستماع الصوتي جاهز: اضغط زر الميكروفون أو Ctrl+Shift+Space وتكلم.'
    : 'الاستماع الصوتي غير مركّب بعد. شوف ملف README لتركيب نموذج الاستماع، ولين ذاك اكتب أوامرك.';
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
  closeCommand();
  els.settings.hidden = false;
  setInteractive(true);
  stepAsideFrom(els.settings);
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

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const talking = performance.now() < bubbleUntil;
  motion.paused = talking || !els.command.hidden || panelsOpen() || recorder.active;

  const asleep = brain?.emotions.asleep;
  if (asleep && (motion.mode === 'idle' || motion.mode === 'focus')) motion.sleep();
  if (!asleep && motion.mode === 'sleep') motion.wake();

  for (const ev of motion.update(dt)) {
    if (ev.type === 'landed' && brain) handle(brain.event('dropped'));
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

  animator.setBase(motion.baseAnimation);
  if (motion.mode === 'walk' || motion.mode === 'run') character.setFacing(motion.facing);
  character.render(dt, animator.update(dt));
  layout();
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => motion.setArea(workArea()));

// ------------------------------------------------------------------- start

async function start() {
  const loaded = await bridge.loadState();
  voiceAvailable = !!loaded?.voice?.available;
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
      case 'reminder': handle(brain.event('reminder_fire', { note: ev.note })); motion.come(); break;
      case 'open-command': openCommand(); break;
      case 'ptt': listen(); break;
      case 'open-settings': openSettings(); break;
      case 'come': handle(brain.hear('تعال')); break;
      default: break;
    }
  });

  setInterval(() => handle(brain.tick()), 4000);
  requestAnimationFrame(frame);

  if (!brain.memory.data.onboarded) startOnboarding();
  else handle(brain.start());

  // Hooks for automated UI tests and debugging.
  window.__khalfoun = { brain, motion, animator, character, hear, handle, bridge, showBubble };
  document.documentElement.dataset.ready = '1';
}

start().catch((err) => {
  console.error('Khalfoun failed to start', err);
  document.documentElement.dataset.ready = 'error';
});
