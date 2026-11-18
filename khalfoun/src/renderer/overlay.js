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
import { DesktopWatcher } from '../core/desktop.js';
import { VoiceOut } from './voice-out.js';
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
  mic: $('mic'), micLevel: $('mic-level'), onboarding: $('onboarding'), settings: $('settings'), ear: $('ear'), dictation: $('dictation'), timer: $('timer'),
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

let framesThisSecond = 0; // drawing health, reported in the diagnostics log

function showBubble(text, mood, long = false) {
  clearTimeout(bubbleTimer);
  clearInterval(typeTimer);
  els.bubble.hidden = false;
  els.bubble.className = `bubble mood-${mood || 'calm'}${long ? ' long' : ''}`;
  // restart the pop animation
  void els.bubble.offsetWidth;
  const chars = Array.from(String(text || ''));
  const full = chars.join('');
  els.bubble.setAttribute('aria-label', full);
  // Typewriter driven by the clock, not by counting timer ticks, so a slowed-down
  // timer can never leave the bubble empty; when the page cannot animate, the
  // whole sentence appears at once.
  const started = performance.now();
  const reveal = () => {
    const shown = document.hidden ? chars.length : Math.min(chars.length, Math.ceil((performance.now() - started) / 15) + 1);
    els.bubbleText.textContent = shown >= chars.length ? full : chars.slice(0, shown).join('');
    if (shown >= chars.length) clearInterval(typeTimer);
  };
  reveal();
  typeTimer = setInterval(reveal, 30);
  setTimeout(() => { if (els.bubbleText.textContent !== full && !els.bubble.hidden && els.bubble.getAttribute('aria-label') === full) { clearInterval(typeTimer); els.bubbleText.textContent = full; } }, chars.length * 15 + 400);
  if (!voiceOut.enabled) sounds.babble(full, mood);
  // Long answers (summaries, questions) stay up longer; a click on the bubble closes it.
  const ms = Math.min(long ? 60000 : 10000, 2200 + chars.length * 65);
  bubbleUntil = performance.now() + ms;
  bubbleTimer = setTimeout(hideBubble, ms);
  // One health check per bubble for the diagnostics log.
  setTimeout(() => {
    const r = els.bubble.getBoundingClientRect();
    const cs = getComputedStyle(els.bubbleText);
    bridge.note?.(`bubble «${full.slice(0, 60)}» shows ${Array.from(els.bubbleText.textContent).length}/${chars.length} chars, visible=${!els.bubble.hidden}, page=${document.visibilityState}, frames/s=${framesThisSecond}, box=${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}, color=${cs.color}, font=${cs.fontFamily.split(',')[0]} ${cs.fontSize}`);
  }, 1500);
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
  if (reply.say) {
    showBubble(reply.say, reply.emotion?.emotion, reply.long);
    if (voiceOut.enabled && !recorder.active) voiceOut.speak(reply.say);
  }
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
    case 'move:right': motion.free(); motion.step(260); break;
    case 'move:left': motion.free(); motion.step(-260); break;
    case 'move:edge_right': motion.free(); motion.toEdge(1); break;
    case 'move:edge_left': motion.free(); motion.toEdge(-1); break;
    case 'move:center': motion.free(); motion.goToX(window.innerWidth / 2); break;
    case 'move:run': motion.free(); motion.toEdge(motion.center < window.innerWidth / 2 ? 1 : -1); break;
    case 'move:mouse': motion.free(); motion.goToX(lastMouseX ?? window.innerWidth / 2); break;
    case 'move:up': if (!motion.climbUp()) handle(brain.reply('move_up_none')); break;
    case 'move:down': if (!motion.climbDown()) handle(brain.reply('move_down_none')); break;
    case 'move:stay': motion.stay(); break;
    case 'move:free': motion.free(); break;
    case 'move:turn': motion.turn(); character.setFacing(motion.facing); break;
    case 'look_window': lookAtWindow(reply.windowRect || lastNoticed?.rect); break;
    case 'game:chase': startChase(); break;
    case 'game:hide': startHide(); break;
    case 'speak:on':
      voiceOut.setEnabled(true);
      if (!voiceOut.available) { voiceOut.setEnabled(false); brain.memory.set({ speak: false }); setTimeout(() => handle(brain.reply('speak_missing')), 1800); }
      else voiceOut.speak(reply.say);
      break;
    case 'speak:off': voiceOut.setEnabled(false); break;
    case 'drumroll': sounds.effect('giggle'); setTimeout(() => sounds.effect('yay'), 500); break;
    case 'star': sounds.effect('sparkle'); break;
    case 'timer:stop': stopTimer(); break;
    case 'dictation_on': els.dictation.hidden = false; updateWake(); break;
    case 'dictation_off': els.dictation.hidden = true; updateWake(); break;
    case 'open_settings': openSettings(String(reply.situation || '').startsWith('setup_hint') ? 'setup' : null); break;
    default:
      if (String(reply.behavior || '').startsWith('timer:')) startTimer(Number(reply.behavior.slice(6)));
      break;
  }
  if (reply.action) runAction(reply.action);
  if (reply.ask) runTask(reply.ask);
  if (reply.look) runLook(reply.look);
  // «افتح الحاسبة وبعدين المفكرة»: the next command follows after a short pause.
  if (reply.more) setTimeout(() => handle(brain.continueQueue()), 1600);
}

// ------------------------------------------------------- speaking voice

const voiceOut = new VoiceOut();
// While he speaks, the always-on listener pauses so he does not hear himself.
voiceOut.onStart = () => { if (wake.active) wake.pause(); };
voiceOut.onEnd = () => { if (wake.active) wake.resume(); };

// ------------------------------------------------- living Khalfoun: desktop

const desktop = new DesktopWatcher();
let lastNoticed = null;

/** New and closed windows become remarks (with cool-downs, never while busy). */
function noticeWindows(list) {
  const events = desktop.update(list, Date.now());
  for (const ev of events) {
    if (panelsOpen() || recorder.active || game) continue;
    if (ev.type === 'opened' && Date.now() - ownOpenAt < 8000) continue;
    lastNoticed = ev;
    handle(brain.event(ev.type === 'opened' ? 'window_opened' : 'window_closed', { kind: ev.kind, title: ev.title }));
  }
}

/** Walks toward a window that just opened, looks at it, and sometimes hops onto it. */
function lookAtWindow(rect) {
  if (!rect || motion.focus) return;
  const cx = rect.x + rect.w / 2;
  motion.goToX(Math.min(Math.max(cx, CHAR_W), window.innerWidth - CHAR_W));
  setTimeout(() => {
    character.lookAt((cx - (motion.x + CHAR_W / 2)) / 350, (rect.y - motion.y) / 300, 2);
    if (Math.random() < 0.4) motion.climbUp();
  }, 1600);
}

// ----------------------------------------------------------- desktop games

let game = null;

/** «طاردني»: he runs after the mouse for 25 seconds; touching the cursor is a catch. */
function startChase() {
  stopGame();
  game = { name: 'chase', score: 0, lastCatch: 0, until: performance.now() + 25000 };
  motion.free();
  game.timer = setInterval(() => {
    if (!game || game.name !== 'chase') return;
    if (performance.now() > game.until) { const score = game.score; stopGame(); handle(brain.event('game_over', { game: 'chase', score })); return; }
    if (lastMouseX !== null && motion.mode !== 'hop' && motion.mode !== 'fall') motion.walkTo(lastMouseX - CHAR_W / 2, true);
  }, 250);
}

/** «غميضة»: he hides faded somewhere on the floor; a click on him finds him. */
function startHide() {
  stopGame();
  const x = Math.random() * Math.max(1, window.innerWidth - CHAR_W);
  game = { name: 'hide', started: performance.now(), hiding: false };
  setTimeout(() => {
    if (!game || game.name !== 'hide') return;
    motion.goToX(x + CHAR_W / 2);
    setTimeout(() => {
      if (!game || game.name !== 'hide') return;
      motion.stay();
      game.hiding = true;
      game.started = performance.now();
      els.stage.classList.add('hiding');
      hideBubble();
      game.timer = setTimeout(() => { stopGame(); handle(brain.event('game_over', { game: 'hide', found: false })); }, 30000);
    }, 2200);
  }, 1500);
}

function stopGame() {
  if (!game) return;
  clearInterval(game.timer);
  clearTimeout(game.timer);
  els.stage.classList.remove('hiding');
  if (game.name === 'hide') motion.free();
  game = null;
}

// Cursor touching him during the chase is a catch; a click while hiding finds him.
els.stage.addEventListener('pointerenter', () => {
  if (game?.name === 'chase' && performance.now() - game.lastCatch > 1200) {
    game.lastCatch = performance.now();
    game.score += 1;
    sounds.effect('giggle');
    animator.play('laugh');
    if (game.score % 2 === 1) handle(brain.event('game_catch'));
  }
});
els.stage.addEventListener('pointerdown', () => {
  if (game?.name === 'hide' && game.hiding) {
    const seconds = (performance.now() - game.started) / 1000;
    stopGame();
    sounds.effect('yay');
    handle(brain.event('game_over', { game: 'hide', found: true, seconds }));
  }
}, true);

// Spinning the mouse round and round near him makes him dizzy.
const spin = { turns: 0, lastAngle: null, since: 0, lastDizzy: 0 };
document.addEventListener('mousemove', (e) => {
  const cx = motion.x + CHAR_W / 2;
  const cy = motion.y + CHAR_H / 2;
  const dx = e.clientX - cx;
  const dy = e.clientY - cy;
  if (Math.hypot(dx, dy) > 260 || game) { spin.turns = 0; spin.lastAngle = null; return; }
  const a = Math.atan2(dy, dx);
  const now = performance.now();
  if (spin.lastAngle !== null) {
    let d = a - spin.lastAngle;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    if (now - spin.since > 2500) { spin.turns = 0; spin.since = now; }
    spin.turns += d / (2 * Math.PI);
    if (Math.abs(spin.turns) >= 3 && now - spin.lastDizzy > 20000) {
      spin.lastDizzy = now;
      spin.turns = 0;
      handle(brain.event('dizzy'));
    }
  } else {
    spin.since = now;
  }
  spin.lastAngle = a;
});

// ------------------------------------------------------------- class timer

let timerEnd = 0;
let timerTick = null;
const fmtClock = (sec) => toArabicDigits(`${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`);

/** A big countdown at the top of the screen; Khalfoun celebrates when it ends. */
function startTimer(seconds) {
  if (!(seconds > 0)) return;
  stopTimer();
  timerEnd = Date.now() + seconds * 1000;
  els.timer.hidden = false;
  const tick = () => {
    const left = Math.max(0, Math.round((timerEnd - Date.now()) / 1000));
    els.timer.textContent = `⏱ ${fmtClock(left)}`;
    els.timer.classList.toggle('ending', left <= 10);
    if (left <= 0) {
      stopTimer();
      sounds.effect('chime');
      setTimeout(() => sounds.effect('chime'), 600);
      motion.come();
      handle(brain.event('timer_done'));
    }
  };
  tick();
  timerTick = setInterval(tick, 250);
}

function stopTimer() {
  clearInterval(timerTick);
  timerTick = null;
  timerEnd = 0;
  els.timer.hidden = true;
  els.timer.classList.remove('ending');
}

/** Summaries, explanations, questions and solutions from the local model. */
async function runTask(ask) {
  let res;
  try {
    res = typeof bridge.chatTask === 'function' ? await bridge.chatTask(ask) : { ok: false, error: 'chat_unavailable' };
  } catch (err) {
    res = { ok: false, error: String(err?.message || err) };
  }
  bridge.note?.(`model task ${ask.mode} → ${res?.ok ? 'ok' : `failed: ${res?.error}`}`);
  handle(brain.taskReply(ask.mode, res));
}

/** AI eyes: the vision model looks at the screen (Khalfoun hides for the picture). */
async function runLook(look) {
  let res;
  try {
    res = typeof bridge.visionLook === 'function' ? await bridge.visionLook(look) : { ok: false, error: 'vision_unavailable' };
  } catch (err) {
    res = { ok: false, error: String(err?.message || err) };
  }
  bridge.note?.(`vision ${look.mode} → ${res?.ok ? 'ok' : `failed: ${res?.error}`}`);
  handle(brain.taskReply(look.mode, res));
}

let ownOpenAt = 0; // when Khalfoun himself last opened something (no remark about that window)

async function runAction(action) {
  if (/^open_|^search$|^open_download$/.test(action.type)) ownOpenAt = Date.now();
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
  bridge.note?.(`heard «${t}» → ${reply?.situation || 'nothing'}${reply?.action ? ` (action ${reply.action.type})` : ''}${reply?.awaitingConfirm ? ' (asks to confirm)' : ''}`);
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
    const asCommand = res?.ok && res.command ? brain.modelCommand(text, res.command) : null;
    bridge.note?.(`model for «${text}» → ${res?.command ? `command «${res.command}»` : res?.text ? 'chat' : `failed: ${res?.error}`}`);
    handle(asCommand || (res?.ok && res.text ? brain.chatReply(text, res.text) : fallback));
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
  bridge.focus?.(); // the window may have just handed the focus to another program
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
    if (!spoke) { bridge.note?.(`mic: no speech detected (${wav?.length || 0} bytes recorded)`); handle(brain.event('stt_empty')); return; }
    showBubble('…', 'focused');
    const res = await bridge.transcribe(wav, 'command');
    if (!res?.ok) { handle(brain.event(res?.error === 'stt_unavailable' ? 'stt_unavailable' : 'stt_empty')); return; }
    if (!res.text) { bridge.note?.('mic: speech recorded but whisper heard no words'); handle(brain.event('stt_empty')); return; }
    els.input.value = res.text;
    setTimeout(() => { if (els.input.value === res.text) els.input.value = ''; }, 2500);
    hear(res.text);
  } catch (err) {
    els.mic.classList.remove('recording');
    console.warn('microphone error', err);
    bridge.note?.(`mic error: ${err?.name || ''} ${err?.message || err}`);
    handle(brain.event('mic_error'));
  }
}

els.mic.addEventListener('click', listen);
els.bubble.addEventListener('click', () => hideBubble());

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
  // While dictating, listen all the time (no «يا خلفون» needed) if voice is installed.
  const want = Boolean((brain?.memory.data.alwaysListen || brain?.dictation) && voiceAvailable);
  if (want && !wake.active) wake.start().then(() => { els.ear.hidden = !wake.active; });
  if (!want && wake.active) wake.stop();
  els.ear.hidden = !want;
}

async function onWakeSentence(wav) {
  if (wakeBusy || recorder.active || panelsOpen()) return;
  wakeBusy = true;
  try {
    if (brain.dictation) {
      // Dictation: every sentence counts, read with the accurate model.
      const res = await bridge.transcribe(wav, 'command');
      if (res?.ok && res.text) {
        const hit = findWakeWord(res.text);
        const said = hit.found ? hit.rest : res.text;
        if (said) hear(said);
      }
      return;
    }
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

let lastMouseX = null;
document.addEventListener('mousemove', (e) => {
  lastMouseX = e.clientX;
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
  $('st-speak').checked = !!d.speak;
  $('st-listen').disabled = !voiceAvailable;
  refreshSetup().then(() => { if (focus === 'setup') $('su-title').scrollIntoView({ block: 'start', behavior: 'smooth' }); });
  renderLog();
  renderAliases();
  closeCommand();
  els.settings.hidden = false;
  setInteractive(true);
  stepAsideFrom(els.settings);
}

/** Phrases the person taught («لما أقول ... يعني ...»), each with a ✕ to forget it. */
function renderAliases() {
  const list = $('st-aliases');
  list.textContent = '';
  const items = brain.taughtPhrases();
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'للحين ما علمتني شي. قول مثلاً: لما أقول صباحو يعني افتح المتصفح.';
    list.appendChild(li);
    return;
  }
  for (const { key, command } of items) {
    const li = document.createElement('li');
    const text = document.createElement('span');
    const k = document.createElement('b');
    k.textContent = `«${key}»`;
    text.append(k, ` ← ${command}`);
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'x';
    x.setAttribute('aria-label', `انسَ ${key}`);
    x.textContent = '✕';
    x.addEventListener('click', () => { brain.forgetPhrase(key); renderAliases(); });
    li.append(text, x);
    list.appendChild(li);
  }
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
    ? `يسولف عبر ${b.model} على جهازك فقط، وما يطلع منه شي للإنترنت. ${b.vision ? `العيون الذكية جاهزة (${b.vision}): قول «اشرح اللي في الشاشة».` : 'للعيون الذكية (يفهم الصور) اختار «عقل + عيون ذكية» ونزّله.'}`
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
  brain.setChatAvailable(chatOn());
});
$('st-sounds').addEventListener('change', () => {
  brain.memory.set({ sounds: $('st-sounds').checked });
  sounds.setEnabled($('st-sounds').checked);
  if ($('st-sounds').checked) sounds.effect('ding');
});
$('st-speak').addEventListener('change', () => {
  handle(brain.hear($('st-speak').checked ? 'تكلم' : 'لا تتكلم'));
  $('st-speak').checked = !!brain.memory.data.speak;
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
  if (!els.dictation.hidden) {
    const w = els.dictation.offsetWidth;
    els.dictation.style.transform = `translate(${Math.min(Math.max(4, x + CHAR_W / 2 - w / 2), window.innerWidth - w - 4).toFixed(1)}px, ${(y + CHAR_H - 28).toFixed(1)}px)`;
  }
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
  frameCount += 1;
  requestAnimationFrame(frame);
}

let frameCount = 0;
setInterval(() => { framesThisSecond = frameCount; frameCount = 0; }, 1000);

window.addEventListener('resize', () => { motion.setArea(workArea()); applyWindows(); });

// ------------------------------------------------------------------- start

async function start() {
  const loaded = await bridge.loadState();
  voiceAvailable = !!loaded?.voice?.available;
  chatInfo = { available: !!loaded?.chat?.available, model: loaded?.chat?.model || null, vision: loaded?.chat?.vision || null };
  const memoryData = { ...(loaded?.memory || {}), ...(loaded?.settings || {}) };
  let saveTimer = null;
  brain = new Brain({
    memoryData,
    onMemoryChange: (data) => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => bridge.saveMemory(data), 700);
    },
  });

  voiceOut.setEnabled(!!brain.memory.data.speak);
  brain.setChatAvailable(chatOn());
  brain.setVisionAvailable(Boolean(chatInfo.vision) && chatOn());
  bridge.onEvent((ev) => {
    switch (ev?.type) {
      case 'reminder': sounds.effect('chime'); handle(brain.event('reminder_fire', { note: ev.note })); motion.come(); break;
      case 'open-command': openCommand(); break;
      case 'ptt': listen(); break;
      case 'open-settings': openSettings(); break;
      case 'come': handle(brain.hear('تعال')); break;
      case 'windows': lastWindows = Array.isArray(ev.list) ? ev.list : []; applyWindows(); noticeWindows(lastWindows); break;
      case 'download': if (!panelsOpen()) handle(brain.event('download_new', { name: ev.name, kind: ev.kind })); break;
      case 'resume': handle(brain.event('resume')); motion.come(); break;
      case 'setup-progress': showSetupProgress(ev); break;
      case 'voice-ready':
        voiceAvailable = !!ev.available;
        $('st-listen').disabled = !voiceAvailable;
        updateWake();
        break;
      case 'chat-ready':
        chatInfo = { available: !!ev.available, model: ev.model || null, vision: ev.vision || null };
        $('st-chat').disabled = !chatInfo.available;
        brain.setChatAvailable(chatOn());
        brain.setVisionAvailable(Boolean(ev.vision) && chatOn());
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
    preview = createPreviewDesktop(document.body, (list) => { lastWindows = list; applyWindows(); noticeWindows(list); });
  }
  sounds.setEnabled(brain.memory.data.sounds !== false);
  updateWake();
  updateWindowWatch();
  if (!brain.memory.data.onboarded) startOnboarding();
  else handle(brain.start());

  // Hooks for automated UI tests and debugging.
  window.__khalfoun = { brain, motion, animator, character, hear, handle, bridge, showBubble, sounds, wake, updateWake, updateWindowWatch, get preview() { return preview; }, get lastReply() { return lastReply; }, recentSituations, get game() { return game; }, noticeWindows, desktop, voiceOut };
  document.documentElement.dataset.ready = '1';
}

start().catch((err) => {
  console.error('Khalfoun failed to start', err);
  document.documentElement.dataset.ready = 'error';
});
