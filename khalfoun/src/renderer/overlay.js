// The overlay page: puts the brain, the character, movement, voice and the
// panels together. Runs inside a transparent always-on-top window that lets
// clicks pass through everywhere except Khalfoun and his panels.

import { Brain } from '../core/brain.js';
import { createCharacter } from './character.js';
import { Animator, EMOTION_ANIMATION } from './animations.js';
import { Motion } from './motion.js';
import { visiblePlatforms } from './platforms.js';
import { Recorder } from './recorder.js';
import { WakeListener, setMicChoice } from './wake-listener.js';
import { findWakeWord } from '../core/wake.js';
import { recognize } from '../core/intents.js';
import { toArabicDigits } from '../core/arabic.js';
import { DesktopWatcher } from '../core/desktop.js';
import { VoiceOut } from './voice-out.js';
import { getBridge } from './bridge.js';
import { SoundPlayer, ANIMATION_SOUND } from './sounds.js';
import { Effects } from './effects.js';
import { NameWheel, RaceBoard, NoiseGauge, CameraPanel, VoiceTestPanel } from './classroom-ui.js';
import { EarTrainerPanel } from './ear-ui.js';
import { EarStream, EarTrigger } from './ear-model.js';
import { ScreenFx } from './screen-fx.js';
import { CameraPick } from './camera-pick.js';
import { StepsDeck, stepWord } from './steps.js';
import { DocView } from './doc-view.js';
import { GraphPanel } from './graph-panel.js';
import { SafetyUi } from './safety-ui.js';
import { fastPlan, isFast } from '../core/fast-layer.js';
import { mathCommand } from '../core/spoken-math.js';
import { mathDeck } from '../core/math-deck.js';
import { cleanSketch, mathText } from '../core/math-sketch.js';
import { GUIDE } from '../core/guide.js';
import { STAR_MILESTONES as STAR_STEPS } from '../core/classfun.js';
import { InkLayer } from './ink.js';
import { COLORS } from '../core/office-plan.js';
import { normalize } from '../core/arabic.js';
import { MindClient } from './mind-ui.js';
import { remoteKeyFrom, REMOTE_REFUSAL } from '../core/remote-keys.js';
import { VOICE_CHOICES, VOICE_IDS, stripTashkeel } from '../core/speech-text.js';

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
let cloudInfo = { claude: false, azure: false, use: {} }; // the person's own cloud keys (status only)
// With the Claude mind on, Claude is the only mind: no Gemini, no other cloud, no local model.
const claudeOnly = () => brain?.memory.data.mind === 'claude';
const agentOn = () => !claudeOnly() && Boolean((cloudInfo.brain || cloudInfo.claude) && cloudInfo.use?.brain !== false && typeof bridge.agent === 'function');
let followUntil = 0; // after he answers, a follow-up needs no «يا خلفون» for a few seconds
const character = createCharacter(els.stage);
const animator = new Animator();
const motion = new Motion(workArea(), { width: CHAR_W, height: CHAR_H });
const recorder = new Recorder();
const sounds = new SoundPlayer({ enabled: false });
// Classroom joy: screen effects, the name wheel, the camel race and the noise meter.
const effects = new Effects(document.body);
const wheel = new NameWheel(document.body);
const raceBoard = new RaceBoard(document.body);
const noise = new NoiseGauge(document.body);
const CLASS_SCALE = 1.9; // «وضع الصف»: big enough for the back row on a projector
let classMode = false;
// Writing and drawing on the screen (voice, or the teacher's own pen).
const ink = new InkLayer({ onChange: (on) => { if (!on) setInteractive(false); } });
// The voice session: after «يا خلفون», every sentence is a command until «خلاص» or a quiet spell.
let sessionUntil = 0;
let waitingQueue = false; // a queued command waits for the step before it (a file, an answer) to finish

// ------------------------------------------------------------------ bubble

let bubbleTimer = null;
let typeTimer = null;
let bubbleUntil = 0;
let bubbleShownAt = -1e9; // his little chatter sounds follow a new bubble for a moment

let framesThisSecond = 0; // drawing health, reported in the diagnostics log

function showBubble(text, mood, long = false) {
  // «خبّي الفقاعة» from his phone: Khalfoun still acts and talks, without the box of words.
  if (bubbleHidden) { els.bubble.hidden = true; return; }
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
  bubbleShownAt = performance.now();
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

let mind = null; // the Claude mind (MindClient), when the teacher linked his Claude subscription
let lastReply = null; // for automated checks
const recentSituations = []; // for automated checks

function handle(reply) {
  if (!reply) return;
  // The wheel spins first; the name is said when it stops.
  if (reply.wheel) {
    const spinning = reply.wheel;
    animator.play('spin');
    sounds.effect('giggle');
    wheel.spin(spinning, { reduced: effects.reduced }).then(() => handle({ ...reply, wheel: null, effect: reply.effect || 'confetti' }));
    lastReply = reply;
    return;
  }
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
    case 'voice_test': openVoiceTest(); break;
    case 'walk_windows': walkTour(); break;
    case 'guide': openGuide(); break;
    default:
      if (String(reply.behavior || '').startsWith('timer:')) startTimer(Number(reply.behavior.slice(6)));
      break;
  }
  if (reply.effect) playEffect(reply.effect);
  // He picks up his marker when he writes or draws (on the screen or into a document).
  const writing = (reply.ink && !reply.ink.clear) || /^office_(put|equation|draw|circle)$/.test(reply.action?.type || '');
  if (writing) {
    character.setPenColor(reply.ink?.marks || reply.ink?.shape ? `#${COLORS[reply.ink.color]?.hex || COLORS.red.hex}` : '#1D70B8');
    animator.play('write');
  }
  if (reply.penStyle?.color) character.setPenColor(`#${COLORS[reply.penStyle.color]?.hex || '1D70B8'}`);
  if (reply.ink) {
    if (reply.ink.clear) ink.clear();
    else if (reply.ink.marks) ink.mark(reply.ink.marks, reply.ink);
    else if (reply.ink.text) ink.write(reply.ink.text);
    else if (reply.ink.shape) ink.draw(reply.ink);
  }
  if (reply.pen !== undefined) {
    if (reply.pen && !ink.pen) ink.setPen(true); else if (!reply.pen) ink.setPen(false);
    if (reply.penStyle) ink.setStyle(reply.penStyle);
    if (reply.pen) { closeCommand(); setInteractive(true); }
  }
  if (reply.compose) runCompose(reply.compose);
  if (reply.race !== undefined) raceBoard.show(reply.race, () => { brain.race = null; });
  if (reply.noise === true) startNoise();
  else if (reply.noise === false) noise.stop();
  if (reply.classMode !== undefined) setClassMode(reply.classMode);
  if (reply.camera) { closeSettings(); closeCommand(); hideGuide(); voiceTest.close(); cameraPanel.show(reply.camera.mode); }
  if (reply.action) runAction(reply.action);
  if (reply.ask) runTask(reply.ask);
  if (reply.look) runLook(reply.look);
  // «افتح الحاسبة وبعدين المفكرة»: the next command follows after a short pause.
  // The next queued command waits for this one's action or writing to finish.
  if (reply.more) {
    if (reply.action || reply.compose) waitingQueue = true;
    else setTimeout(() => handle(brain.continueQueue()), 1600);
  }
}

// ------------------------------------------------------- speaking voice

const voiceOut = new VoiceOut();
// Playful effects on any piece of the screen (a question crumpled into a ball…).
const screenFx = new ScreenFx(document.body, { celebrate: (kind) => { if (kind === 'pop') sounds.now('pop'); }, enabled: () => brain?.memory?.data?.fxEnabled !== false });
// While he speaks, the always-on listener pauses so he does not hear himself.
// While he speaks, his own voice must not come back as a command (also through the phone).
voiceOut.onStart = () => { if (wake.active || wake.external) wake.pause(); };
voiceOut.onEnd = () => { if (wake.active || wake.external) wake.resume(); };

// -------------------------------------------------------- classroom joy

function playEffect(name) {
  if (!effects.play(name)) return;
  if (name === 'none') return;
  if (name === 'fireworks' || name === 'national') { sounds.effect('gasp'); setTimeout(() => sounds.effect('sparkle'), 900); }
  else if (name === 'confetti' || name === 'balloons') sounds.effect('yay');
  else sounds.effect('sparkle');
}

async function startNoise() {
  const ok = await noise.start({
    onEvent: (e) => {
      if (e === 'quiet') handle(brain.event('noise_quiet', {}));
      else handle(brain.event('noise_loud', { level: e }));
    },
    // His own voice and his little sounds must not count as the class.
    paused: () => voiceOut.speaking || recorder.active || (sounds.enabled && performance.now() - bubbleShownAt < 2500),
    onClose: () => { brain.noiseOn = false; },
  });
  if (!ok) { brain.noiseOn = false; handle(brain.event('mic_error')); }
}

/** «وضع الصف»: Khalfoun grows and stands in the middle where the whole class sees him. */
function setClassMode(on) {
  classMode = Boolean(on);
  document.documentElement.classList.toggle('classmode', classMode);
  clearTimeout(setClassMode.timer);
  if (classMode) {
    motion.come();
    setClassMode.timer = setTimeout(() => { if (classMode) motion.stay(); }, 2600);
  } else {
    motion.free();
  }
}

/** «تمشى»: a little tour on top of the open windows, then back to the floor. */
function walkTour() {
  clearInterval(walkTour.timer);
  motion.free();
  let steps = 0;
  const go = () => {
    steps += 1;
    if (steps > 8 || motion.mode === 'drag') { clearInterval(walkTour.timer); if (motion.support) motion.climbDown(); return; }
    if (steps % 3 === 0 && motion.support) motion.climbDown();
    else if (!motion.climbUp()) motion.step((Math.random() < 0.5 ? -1 : 1) * (180 + Math.random() * 220));
  };
  go();
  walkTour.timer = setInterval(go, 4200);
}

const cameraPanel = new CameraPanel({
  solve: (image, mode) => (typeof bridge.camera === 'function' ? bridge.camera({ image, mode }) : Promise.resolve({ ok: false, error: 'no_cloud' })),
  onResult: (res) => handle(brain.event('camera_result', res)),
  onOpen: () => setInteractive(true),
  onClose: () => {},
});

const voiceTest = new VoiceTestPanel({
  record: () => recorder.record((level) => els.micLevel.style.setProperty('--level', String(1 + level * 0.6)), { maxMs: 12000 }),
  transcribe: (wav) => bridge.transcribe(wav, 'command'),
  recognize: (text) => recognize(text),
  onDone: (score) => handle(brain.event('voice_test_done', { score })),
  onOpen: () => setInteractive(true),
  onClose: () => {},
  note: (t) => bridge.note?.(t),
});

// ---------------------------------------------------------------- the phone's control buttons
let bubbleHidden = false;
let phoneMuted = false;
let voiceBeforeMute = null;
const stepsDeck = new StepsDeck({
  ink,
  say: (t) => { showBubble(stripTashkeel(t), 'focused'); if (voiceOut.enabled) voiceOut.speak(t); },
  onChange: (st) => { pushPhoneState(); bridge.steps?.keys(st.active); },
});
const docView = new DocView(document.body);

// ---------------------------------------------------------------- Khalfoun 3: safety, speed, recovery
const safety = new SafetyUi(document.body, {
  answer: (id, ok) => bridge.safety?.answer?.(id, ok),
  onInteractive: (on) => { if (on) setInteractive(true); else if (!panelsOpen()) setInteractive(false); },
  note: (t) => bridge.note?.(t),
});
let haltedUi = false;
function setHalted(on) {
  haltedUi = on;
  safety.halt(on);
  setStatus(on ? 'halted' : 'idle');
  if (on) {
    voiceOut.stop(); safety.cancel(); cameraPick.close();
    if (recorder.active) recorder.stop();
    if (wake.active) wake.stop();
    endSession?.('emergency');
  } else updateWake();
  pushPhoneState();
}
function setFx(on) {
  brain.memory.set({ fxEnabled: on });
  if (!on) screenFx.clear();
  showBubble(on ? 'رجعت المؤثرات ✨' : 'وقّفت المؤثرات لين تقول لي «رجّع المؤثرات».', 'calm');
  pushPhoneState();
}
/** «تراجع»: Khalfoun's last action (typing, closing a window, tidying files), else the last drawing. */
async function smartUndo() {
  const r = await bridge.safety?.undo?.();
  if (r?.ok) { showBubble('رجّعتها مثل ما كانت ↶', 'calm'); return; }
  if (graphPanel.open) { graphPanel.close(); return; }
  if (ink.hasInk) { ink.undo(); return; }
  showBubble('ما فيه شي أتراجع عنه الحين.', 'calm');
}
/** A maths command solved here: the verified steps go on the screen, the teacher moves through them. */
async function localMath(mc, said, opts = {}) {
  bridge.note?.(`heard «${said}» → maths engine (${mc.task}: ${mc.expr})`);
  setStatus('thinking');
  const r = await bridge.math.solve(mc.task, mc.expr);
  setStatus('idle');
  if (!r?.ok) {
    // the engine could not read it: Claude (if on) gets the sentence as it was said
    if (mind?.on) hear(said, { ...opts, viaAgent: false, local: false, typed: true, noMath: true });
    else showBubble(`ما قدرت أحلها: ${r?.error || ''}`, 'sorry', true);
    return;
  }
  const digits = brain.memory.data.digits === 'latin' ? 'latin' : 'arabic';
  const deck = mathDeck(r, { show: 'steps', explain: mc.explain, size: { width: innerWidth, height: innerHeight } });
  const steps = deck.map((st) => ({
    shapes: cleanSketch(st.items, { pt: (x, y) => ({ x: Math.round(x), y: Math.round(y) }), len: (v) => Math.round(v), digits }),
    say: st.say ? mathText(st.say, { digits }).replace(/[\uE000-\uE003]/g, '') : '',
  }));
  stepsDeck.start({ title: '', color: 'blue', steps });
  noteLatency('local', opts);
}
/** The times the teacher's PC really takes (settings → القياسات). */
function noteMetric(kind, ms) { if (Number.isFinite(ms) && ms >= 0) bridge.metrics?.note?.(kind, ms); }
function noteLatency(kind, opts) { if (opts?.t0) noteMetric(kind, Date.now() - opts.t0); }
/** Khalfoun's state, shown as a small dot on him (يسمع، يفكر، ينفذ، يتكلم، يحتفل، محتار، نايم). */
let statusNow = 'idle';
function setStatus(st) {
  statusNow = st;
  const dot = document.querySelector('.status-dot');
  if (dot) dot.dataset.s = st;
}
// The lesson's state is saved every few seconds; after a crash (or a restart) it comes back.
function lessonSnapshot() {
  const own = stepsDeck.ownItems();
  return {
    ink: ink.items.filter((it) => !own.has(it)).slice(-300),
    steps: stepsDeck.snapshot(),
    graph: graphPanel.spec || null,
    muted: phoneMuted, bubbleHidden,
  };
}
let lessonSaved = '';
setInterval(() => {
  try {
    const st = lessonSnapshot();
    const j = JSON.stringify(st);
    if (j !== lessonSaved) { lessonSaved = j; bridge.lesson?.save?.(st); }
  } catch { /* never in the way */ }
}, 3000);
async function restoreLesson() {
  const saved = await bridge.lesson?.load?.();
  const st = saved?.state;
  if (!st) return false;
  let any = false;
  if (Array.isArray(st.ink) && st.ink.length) { ink.items.push(...st.ink); ink.redraw(); any = true; }
  if (st.steps && stepsDeck.restore(st.steps)) any = true;
  if (st.graph && graphPanel.show(st.graph).ok) any = true;
  if (st.muted) setMuted(true);
  if (st.bubbleHidden) setBubbleHidden(true);
  if (any) { bridge.note?.('lesson state restored'); showBubble('رجعت لوين كنا في الحصة 👍', 'calm'); }
  return any;
}
const graphPanel = new GraphPanel(document.body);
function pushPhoneState() {
  const st = stepsDeck?.state?.() || { step: 0, steps: 0 };
  bridge.phone?.state?.({ muted: phoneMuted, bubbleHidden, step: st.step, steps: st.steps, fxOff: brain?.memory?.data?.fxEnabled === false });
}
function setMuted(on) {
  if (on === phoneMuted) return;
  phoneMuted = on;
  if (on) { voiceBeforeMute = voiceOut.enabled; voiceOut.stop(); voiceOut.setEnabled(false); }
  else voiceOut.setEnabled(voiceBeforeMute ?? Boolean(brain.memory.data.speak));
  els.stage?.classList.toggle('muted', on);
  pushPhoneState();
}
function setBubbleHidden(on) {
  bubbleHidden = on;
  if (on) els.bubble.hidden = true;
  pushPhoneState();
}
function onPhoneCommand(name) {
  bridge.note?.(`phone button: ${name}`);
  switch (name) {
    case 'undo': smartUndo(); break;
    case 'fx': setFx(brain.memory.data.fxEnabled === false); break;
    case 'hide': handle(brain.hear('اختفي')); break;
    case 'cancel': safety.cancel(); break;
    case 'step_next': if (!stepsDeck.next()) showBubble('ما فيه خطوات الحين. قول لخلفون «حل المسألة خطوة خطوة».', 'calm'); break;
    case 'step_back': stepsDeck.back(); break;
    case 'mute': setMuted(!phoneMuted); break;
    case 'bubble': setBubbleHidden(!bubbleHidden); break;
    case 'random_student': handle(brain.hear('اختار طالب عشوائي')); break;
    case 'timer_1': handle(brain.hear('مؤقت دقيقة')); break;
    case 'timer_3': handle(brain.hear('مؤقت ٣ دقايق')); break;
    case 'timer_5': handle(brain.hear('مؤقت ٥ دقايق')); break;
    case 'celebrate': effects.play('confetti'); animator.play('celebrate'); break;
    case 'fireworks': effects.play('fireworks'); animator.play('celebrate'); break;
    case 'clear': ink.clear(); screenFx.clear(); docView.close(); graphPanel.close(); stepsDeck.end(); break;
    case 'stop': safety.cancel(); mind?.busy && bridge.mind?.stop?.(); voiceOut.stop(); cameraPick.close(); break;
    default: break;
  }
  pushPhoneState();
}
const blobToBase64 = (blob) => new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = () => resolve(''); r.readAsDataURL(blob); });
async function onPhonePhoto(purpose, bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const mime = b[0] === 0x89 ? 'image/png' : 'image/jpeg';
  const blob = new Blob([b], { type: mime });
  if (purpose === 'pick') { pickWithCamera({ blob }); return; }
  if (purpose === 'doc') { docView.show(blob); showBubble('هذا دفتر الطالب 📖 تقدر تكتب فوقه بالقلم، أو قول لي «علّق على الحل».', 'happy'); return; }
  if (!mind?.on) { showBubble('التصحيح بالصور يحتاج مخ Claude شغال من الإعدادات.', 'sorry', true); return; }
  const image = { data: await blobToBase64(blob), mime };
  if (purpose === 'problem') {
    showBubble('شفت المسألة 🧮 لحظة أحلها…', 'focused');
    mind.ask('[صورة مسألة من كتاب أو دفتر، من جوال المعلم] اقرأ المسألة بدقة، وحلها بأداة math مع show:"steps" عشان تنعرض خطوة خطوة قدام الصف. إذا فيها أكثر من مسألة خذ الأولى وقل كم باقي.', { via: 'typed', image });
    return;
  }
  if (purpose === 'key') {
    mind.ask('[صورة نموذج الإجابة من جوال المعلم] احفظ الإجابات الصحيحة اللي في هالصورة عشان تصحّح عليها أوراق الطلاب الجاية. رد بجملة قصيرة: كم سؤال حفظت.', { via: 'typed', silent: true, image });
  } else {
    mind.ask('[صورة ورقة طالب من جوال المعلم] صحّحها: إذا حفظت نموذج إجابة صحّح عليه، وإلا حل الأسئلة بنفسك بدقة. اكتب في ردك: اسم الطالب إذا مكتوب، والدرجة من المجموع، وكل خطأ في سطر قصير مع الجواب الصحيح. هذا للمعلم بس.', { via: 'typed', silent: true, image });
  }
}

// «اختار طالب بالكاميرا»: faces found on this computer, a light lands on one student.
let facesSession = null;
let ortMod = null;
const cameraPick = new CameraPick({
  session: async () => {
    ortMod = await loadOrt();
    facesSession ??= await ortMod.InferenceSession.create(new Uint8Array(await (await fetch(new URL('../../assets/faces/yunet-2023mar.onnx', import.meta.url))).arrayBuffer()), { executionProviders: ['wasm'] });
    return facesSession;
  },
  Tensor: () => ortMod.Tensor,
  level: () => brain.memory.data.pickLevel || 'high',
  cue: (n) => sounds.now(n === 'tick' ? 'tick' : 'yay'),
  celebrate: () => effects.play('confetti'),
  say: (t) => { if (voiceOut.enabled) voiceOut.speak(t); },
  onOpen: () => { closeCommand(); setInteractive(true); },
  onClose: () => { if (!panelsOpen()) setInteractive(false); },
  note: (t) => bridge.note?.(t),
});
/** A photo from the computer's own camera (for the pick when there is no phone photo). */
async function webcamPhoto() {
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } } });
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.srcObject = stream;
    await v.play();
    await new Promise((r) => setTimeout(r, 900)); // let the camera settle its light
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    return c.toDataURL('image/jpeg', 0.9);
  } catch { return null; } finally { stream?.getTracks().forEach((t) => t.stop()); }
}
async function pickWithCamera(src) {
  if (src?.blob) return cameraPick.pick(src);
  const shot = await webcamPhoto();
  if (shot) return cameraPick.pick({ image: shot });
  showBubble('ما فيه كاميرا في الجهاز. صوّر الصف من الجوال بزر 🎯 في صفحة المايك.', 'sorry', true);
  return null;
}

// «علّم خلفون صوتك»: recordings for Khalfoun's own ear (stay on this computer).
const earTrainer = new EarTrainerPanel({
  record: (o) => recorder.record((level) => els.micLevel.style.setProperty('--level', String(1 + level * 0.6)), { ...o, trim: !o.silenceMs && o.silenceMs !== null }),
  stop: () => recorder.stop(),
  save: (kind, wav) => (bridge.ear ? bridge.ear.save(kind, wav) : Promise.resolve({ ok: false })),
  stats: () => (bridge.ear ? bridge.ear.stats() : Promise.resolve({})),
  voices: () => (bridge.ear ? bridge.ear.voices() : Promise.resolve({ ok: false })),
  onOpen: () => { wake.stop?.(); setInteractive(true); },
  onClose: () => updateWake(),
  note: (t) => bridge.note?.(t),
});
function openEarTrainer() {
  closeSettings();
  closeCommand();
  hideGuide();
  voiceOut.stop();
  earTrainer.show();
}

function openVoiceTest() {
  closeSettings();
  closeCommand();
  hideGuide();
  cameraPanel.close();
  voiceOut.stop();
  if (!voiceAvailable) { handle(brain.event('stt_unavailable')); return; }
  voiceTest.show();
}

/** «الدليل»: every command, grouped; a click puts it in the command box to try or edit. */
function openGuide() {
  const box = $('guide-list');
  if (!box.childElementCount) {
    for (const group of GUIDE) {
      const sec = document.createElement('section');
      sec.className = 'guide-group';
      const h = document.createElement('h3');
      h.textContent = `${group.icon} ${group.title}`;
      sec.append(h);
      const ul = document.createElement('ul');
      for (const [cmd, what] of group.items) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'guide-cmd';
        b.textContent = `«${cmd}»`;
        b.addEventListener('click', () => { hideGuide(); openCommand(); els.input.value = cmd; els.input.focus(); });
        const sm = document.createElement('small');
        sm.textContent = what;
        li.append(b, sm);
        ul.append(li);
      }
      sec.append(ul);
      box.append(sec);
    }
  }
  closeSettings();
  cameraPanel.close();
  voiceTest.close();
  $('guide').hidden = false;
  setInteractive(true);
  stepAsideFrom($('guide'));
}
function hideGuide() { $('guide').hidden = true; }

/** A small «سمعتك: ...» note under Khalfoun, so the person sees what was heard. */
function showHeard(text, secs) {
  const chip = $('heard');
  chip.textContent = `سمعتك: «${text}»${secs ? ` · ${toArabicDigits(secs.toFixed(1))} ث` : ''}`;
  chip.hidden = false;
  clearTimeout(showHeard.timer);
  showHeard.timer = setTimeout(() => { chip.hidden = true; }, 4500);
}

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
  nextInQueue();
}

function nextInQueue() {
  if (!waitingQueue) return;
  waitingQueue = false;
  setTimeout(() => handle(brain.continueQueue()), 500);
}

/** The cloud brain writes the document; then the brain turns it into an action. */
async function runCompose(req) {
  const slow = setTimeout(() => { if (brain.composing) handle(brain.event('thinking_long')); }, 9000);
  let res;
  try {
    res = typeof bridge.compose === 'function' ? await bridge.compose(req) : { ok: false, error: 'no_cloud' };
  } catch (err) {
    res = { ok: false, error: String(err?.message || err) };
  }
  clearTimeout(slow);
  const next = brain.composed(req, res);
  handle(next);
  if (!next?.action) nextInQueue();
}

let chatting = false;
const chatOn = () => !claudeOnly() && chatInfo.available && brain.memory.data.chatEnabled !== false && typeof bridge.chat === 'function';

// Every sentence the person says counts: an answer that comes back for an older one
// (a slow cloud or model) is dropped instead of interrupting the newer command.
let heardSeq = 0;

// With the Claude mind on, these stay instant and local (no need to think about them).
// the fast local layer (core/fast-layer.js): known commands are done here at once, never sent to Claude
// Not classroom features: Claude does these with its own tools.
const GENERIC_INTENTS = new Set(['open_app', 'open_installed', 'close_app', 'open_url', 'open_folder', 'search', 'key', 'type_text', 'open_download', 'office_write', 'office_format', 'office_draw', 'office_equation', 'office_pdf', 'screen_write', 'screen_draw']);
const GENERIC_ACTIONS = new Set(['open_app', 'open_installed', 'close_app', 'open_url', 'open_folder', 'search', 'press_key', 'type_text', 'open_download', 'office_put', 'office_format', 'office_draw', 'office_equation', 'office_pdf', 'open_web', 'key_combo']);

function hear(text, opts = {}) {
  const t = String(text || '').trim();
  if (!t) return;
  if (haltedUi && !opts.typed) return; // the emergency stop: he hears nothing until it is let go
  const nt = normalize(t);
  // the yellow countdown: «لا / الغ / وقف / لا تسوي» cancels it
  if (safety.counting && /^(لا|الغ|الغيه|الغي|كنسل|وقف|لا تسوي|لا تسويها|خلها|اتركها|لا لا)( يا خلفون)?$/.test(nt)) { safety.cancel(); return; }
  // «حل ٢س + ٣ = ١١» / «حلل س تربيع ناقص تسعة»: SymPy on this PC solves it step by step, no Claude needed
  const mc = !opts.viaAgent && !opts.noMath ? mathCommand(t) : null;
  if (mc && bridge.math) { localMath(mc, t, opts); return; }
  // «تراجع»: the last thing Khalfoun did is taken back (else the drawing, else Ctrl+Z as before)
  if (/^(يا خلفون )?(تراجع|تراجع عن اخر شي|رجع اللي سويته|الغ اخر شي|كنسل اخر شي)$/.test(nt)) { smartUndo(); return; }
  if (!opts.viaAgent) heardSeq += 1;
  // «كمل» / «ارجع» while the steps of a solution are showing: at once, no thinking needed.
  const sw = stepsDeck.active ? stepWord(normalize(t)) : null;
  if (sw) { bridge.note?.(`heard «${t}» → step ${sw}`); if (sw === 'next') stepsDeck.next(); else stepsDeck.back(); return; }
  if (mind?.on && !opts.viaAgent && !opts.local) {
    const quick = recognize(t);
    // «شغل مؤقت ٥ دقايق واختار طالب»: every part known → done here, one after the other
    const plan = !mind.question && !isFast(quick) ? fastPlan(t, recognize) : null;
    if (plan) {
      bridge.note?.(`heard «${t}» → local plan: ${plan.join(' | ')}`);
      plan.forEach((part, i) => setTimeout(() => { const r = brain.hear(part); handle(r); }, i * 500));
      noteLatency('local', opts);
      return;
    }
    if (isFast(quick) && !mind.question) noteLatency('local', opts);
    if (!isFast(quick) || mind.question) {
      followUntil = Date.now() + 9000;
      bridge.note?.(`heard «${t}» → claude`);
      // Claude will click and type on the screen: Khalfoun's window must let the mouse through,
      // and the keyboard goes back to the program the teacher was in (Word, a PDF…).
      if (!els.command.hidden) closeCommand({ forceGiveBack: true });
      if (!ink.pen && !panelsOpen()) setInteractive(false);
      mind.ask(t, { via: opts.typed ? 'typed' : 'voice', session: Boolean(opts.session), silent: Boolean(opts.silent) }).then((took) => { if (!took) hear(t, { ...opts, local: true }); });
      return;
    }
  }
  const reply = brain.hear(t);
  bridge.note?.(`heard «${t}» → ${reply?.situation || 'nothing'}${reply?.action ? ` (action ${reply.action.type})` : ''}${reply?.awaitingConfirm ? ' (asks to confirm)' : ''}`);
  followUntil = Date.now() + 9000;
  // A joke told to him: the cloud brain gets the joke and answers it; without it, he laughs.
  if (reply?.situation === 'user_joke' && agentOn() && !opts.viaAgent && !chatting) { askAgent(t, reply, opts); return; }
  if (reply?.situation === 'not_understood' && reply.unknownText && !opts.viaAgent && !chatting) {
    // Claude first (fast and clever, with the person's key), then the local model.
    if (agentOn()) { askAgent(t, reply, opts); return; }
    if (chatOn()) { askModel(t, reply); return; }
  }
  if (opts.quietIfUnknown && reply?.situation === 'not_understood') return;
  handle(reply);
}

/**
 * Claude understands anything his rules do not: it answers in his voice, turns the request
 * into his own commands (checked like everything else), or stays quiet when the words were
 * not meant for him.
 */
async function askAgent(text, fallback, opts = {}) {
  chatting = true;
  // Only show «thinking» if the answer is not almost instant.
  const thinking = setTimeout(() => { if (chatting) handle(brain.reply('thinking')); }, 700);
  const seq = heardSeq;
  try {
    const d = brain.memory.data;
    const res = await bridge.agent({ text, history: brain.chatHistory, name: d.name, context: brain.chatContext() });
    if (seq !== heardSeq) { clearTimeout(thinking); bridge.note?.(`late answer for «${text}» dropped (a newer command came)`); return; }
    if (!res?.ok) {
      bridge.note?.(`claude for «${text}» → failed: ${res?.error}`);
      clearTimeout(thinking);
      if (chatOn()) { chatting = false; askModel(text, fallback); return; }
      handle(res?.error === 'no_credit' || res?.error === 'bad_key' ? brain.event('cloud_problem', { error: res.error }) : (opts.quietIfUnknown ? null : fallback));
      return;
    }
    clearTimeout(thinking);
    if (!res.addressed) { bridge.note?.(`claude: «${text}» was not for me`); return; }
    if (res.commands.length) {
      brain.chatHistory.push({ user: text, khalfoun: res.say || res.commands.join('، ') });
      if (brain.chatHistory.length > 6) brain.chatHistory.shift();
      chatting = false;
      if (res.say && res.commands.every((c) => !/^(اكتب|دور)/.test(c))) showBubble(res.say, brain.emotions.current?.emotion);
      hear(res.commands.join(' وبعدين '), { viaAgent: true });
      return;
    }
    if (res.say) {
      handle(brain.chatReply(text, res.say));
      if (fallback?.situation === 'user_joke') { animator.play('laugh'); sounds.effect('giggle'); }
    }
  } catch {
    clearTimeout(thinking);
    handle(opts.quietIfUnknown ? null : fallback);
  } finally {
    clearTimeout(thinking);
    chatting = false;
  }
}

/** Lets the local model answer what his built-in rules do not understand. */
async function askModel(text, fallback) {
  chatting = true;
  handle(brain.reply('thinking'));
  // A model loading from disk can take a while: say so instead of going quiet.
  const slow = setTimeout(() => { if (chatting) handle(brain.reply('thinking_long')); }, 9000);
  const seq = heardSeq;
  try {
    const d = brain.memory.data;
    const res = await bridge.chat({ text, history: brain.chatHistory, name: d.name, humor: d.humor, context: brain.chatContext() });
    if (seq !== heardSeq) { bridge.note?.(`late model answer for «${text}» dropped (a newer command came)`); return; }
    const asCommand = res?.ok && res.command ? brain.modelCommand(text, res.command) : null;
    bridge.note?.(`model for «${text}» → ${res?.command ? `command «${res.command}»` : res?.text ? 'chat' : `failed: ${res?.error}`}`);
    handle(asCommand || (res?.ok && res.text ? brain.chatReply(text, res.text) : fallback));
  } catch {
    handle(fallback);
  } finally {
    clearTimeout(slow);
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

function closeCommand(opts = {}) {
  const hadFocus = !els.command.hidden && document.activeElement === els.input;
  els.command.hidden = true;
  clearTimeout(commandTimer);
  // While the Claude mind works, it decides where the focus is (it clicks the right window).
  const mindActing = mind && (mind.busy || Date.now() - (mind.lastAct || 0) < 20000);
  if (hadFocus && els.settings.hidden && !opts.keepFocus && (!mindActing || opts.forceGiveBack)) bridge.giveBack?.();
  // Clicks pass through again at once (not only after the next mouse move).
  if (!ink.pen && !panelsOpen()) setInteractive(false);
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
  hear(text, { typed: true });
  armCommandTimeout();
});

els.input.addEventListener('input', armCommandTimeout);

// ------------------------------------------------------------------- voice

async function listen() {
  if (recorder.active) { recorder.stop(); return; }
  voiceOut.stop(); // he stops talking when you start
  if (!voiceAvailable) {
    handle(brain.event('stt_unavailable'));
    openCommand();
    return;
  }
  if (els.command.hidden) openCommand();
  handle(brain.event('listening'));
  els.mic.classList.add('recording');
  sounds.cue('start');
  // The phone is the microphone: its next sentence is the command (no second microphone).
  if (phoneLive()) {
    phoneCommandUntil = Date.now() + 9000;
    setTimeout(() => { if (phoneCommandUntil && Date.now() >= phoneCommandUntil) { phoneCommandUntil = 0; els.mic.classList.remove('recording'); } }, 9200);
    return;
  }
  try {
    const { wav, spoke } = await recorder.record((level) => els.micLevel.style.setProperty('--level', String(1 + level * 0.6)));
    els.mic.classList.remove('recording');
    sounds.cue('stop');
    if (!spoke) { bridge.note?.(`mic: no speech detected (${wav?.length || 0} bytes recorded)`); handle(brain.event('stt_empty')); return; }
    await useCommandWav(wav);
  } catch (err) {
    els.mic.classList.remove('recording');
    console.warn('microphone error', err);
    bridge.note?.(`mic error: ${err?.name || ''} ${err?.message || err}`);
    handle(brain.event('mic_error'));
  }
}

/** A spoken command (from the button, the remote or the phone) → words → Khalfoun. */
async function useCommandWav(wav) {
  showBubble('…', 'focused');
  // The screenshot is taken now, while the words are being recognised (seconds saved).
  if (mind?.on) bridge.mind?.prefetch?.();
  const t0 = performance.now();
  const res = await bridge.transcribe(wav, 'command');
  if (res?.ok && res.text) showHeard(res.text, (performance.now() - t0) / 1000);
  if (!res?.ok) { handle(brain.event(res?.error === 'stt_unavailable' ? 'stt_unavailable' : /^stt_failed/.test(res?.error || '') ? 'stt_failed' : 'stt_empty')); return; }
  if (!res.text) { bridge.note?.('mic: speech recorded but whisper heard no words'); handle(brain.event('stt_empty')); return; }
  els.input.value = res.text;
  setTimeout(() => { if (els.input.value === res.text) els.input.value = ''; }, 2500);
  hear(res.text);
}

// ---------------------------------------------------------------- the phone as the microphone
let phoneState = { connected: false, streaming: false };
let phoneCommandUntil = 0;
const phoneLive = () => phoneState.streaming && !preferredMicPresent;
let preferredMicPresent = false; // a wireless microphone he chose is plugged in: it comes first
function onPhoneStatus(st) {
  const was = phoneLive();
  phoneState = { connected: Boolean(st.connected), streaming: Boolean(st.streaming) };
  const now = phoneLive();
  if (now !== was) {
    wake.useExternal(now);
    bridge.note?.(now ? 'phone mic: listening through the phone' : 'phone mic: back to the computer microphone');
  }
  els.ear.classList.toggle('phone', now);
  els.ear.hidden = !(wake.active || now);
  renderPhone();
}
function onPhoneAudio(pcm) {
  if (!phoneLive()) return;
  const b = pcm instanceof Uint8Array ? pcm : new Uint8Array(pcm || []);
  const i16 = new Int16Array(b.buffer, b.byteOffset, Math.floor(b.length / 2));
  const f = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i += 1) f[i] = i16[i] / 32768;
  wake.feed(f);
}
function onPhoneSay(wav) {
  if (panelsOpen()) return;
  voiceOut.stop();
  const b = wav instanceof Uint8Array ? wav : new Uint8Array(wav || []);
  useCommandWav(b);
}

els.mic.addEventListener('click', listen);
els.bubble.addEventListener('click', (e) => { if (!e.target.closest('.bubble-choices')) hideBubble(); });

/** Buttons under his question (the Claude mind asks before anything risky). */
function showChoices(labels, onPick) {
  const box = $('bubble-choices');
  box.replaceChildren(...labels.map((label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', (e) => { e.stopPropagation(); hideChoices(); onPick(label); });
    return b;
  }));
  box.hidden = false;
  els.bubble.hidden = false;
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(hideBubble, 60000);
}

function hideChoices() {
  const box = $('bubble-choices');
  box.hidden = true;
  box.replaceChildren();
}

// ------------------------------------------------------- the Claude mind in settings

const MIND_TEXT = {
  install: 'ينزّل برنامج Claude الرسمي (حوالي ١٧٨ ميجا، مرة وحدة) ويتأكد من بصمته.',
  signin: 'انفتح المتصفح على موقع Claude: سجّل دخول بحسابك (اللي فيه الاشتراك) واضغط «Authorize». خلفون ينتظر.',
};

function renderMind(e) {
  const info = mind?.info || {};
  const st = $('md-state');
  if (!st) return;
  if (!bridge.mind || info.supported === false) {
    $('md-steps').hidden = true;
    $('md-on').disabled = true;
    st.textContent = 'ويندوز فقط';
    return;
  }
  st.textContent = info.loggedIn ? `مربوط${info.plan ? ` · ${info.plan}` : ''}` : info.installed ? 'منزّل، مو مربوط' : 'مو منزّل';
  st.classList.toggle('on', Boolean(info.loggedIn));
  $('md-install').hidden = Boolean(info.installed);
  $('md-signin').hidden = !info.installed || Boolean(info.loggedIn);
  $('md-signout').hidden = !info.loggedIn;
  $('md-on').checked = brain?.memory.data.mind === 'claude';
  $('md-on').disabled = !info.loggedIn;
  radio('md-model', info.model || brain?.memory.data.mindModel || 'smart');
  if (e?.type === 'install') {
    const bar = $('md-progress');
    bar.hidden = false;
    const pct = e.total ? Math.round((e.done / e.total) * 100) : 0;
    bar.firstElementChild.style.width = `${pct}%`;
    $('md-result').textContent = e.phase === 'unpack' ? 'يفك البرنامج…' : `ينزّل… ${toArabicDigits(pct)}٪`;
  }
  if (e?.type === 'login') {
    if (e.step === 'browser') $('md-result').textContent = MIND_TEXT.signin;
    if (e.step === 'code') { $('md-code-row').hidden = false; $('md-code').focus(); }
    if (e.step === 'done') { $('md-code-row').hidden = true; $('md-result').textContent = 'تم الربط! خلفون الحين يفكر بـ Claude.'; }
    if (e.step === 'failed') { $('md-code-row').hidden = true; $('md-result').textContent = 'ما تم الربط. جرب مرة ثانية.'; }
  }
}

// ----- Khalfoun 3 settings: the provider, privacy, the yellow countdown, barge-in, effects, suggestions
function renderK3() {
  const d = brain.memory.data;
  $('k3-provider').value = d.provider === 'apikey' ? 'apikey' : 'subscription';
  $('k3-privacy').checked = d.privacyMask !== false;
  $('k3-photos').checked = !!d.maskPhotos;
  $('k3-yellow').checked = d.yellowCountdown !== false;
  $('k3-barge').checked = d.bargeIn !== false;
  $('k3-fx').checked = d.fxEnabled !== false;
  $('k3-suggest').checked = d.suggestions !== false;
  $('k3-every').value = String(d.suggestEvery || 10);
  bridge.metrics?.report?.().then((r) => {
    const ul = $('k3-metrics'); ul.textContent = '';
    for (const line of r?.lines || []) { const li = document.createElement('li'); li.textContent = line; ul.append(li); }
  }).catch(() => {});
}
async function setK3(patch) {
  const res = await bridge.updateSettings(patch);
  brain.memory.set(res?.settings ? Object.fromEntries(Object.keys(patch).map((k) => [k, res.settings[k]])) : patch);
  if ('provider' in patch) { await mind?.refresh(); renderMind(); }
  pushPhoneState();
}
for (const [id, key] of [['k3-privacy', 'privacyMask'], ['k3-photos', 'maskPhotos'], ['k3-yellow', 'yellowCountdown'], ['k3-barge', 'bargeIn'], ['k3-fx', 'fxEnabled'], ['k3-suggest', 'suggestions']]) {
  $(id)?.addEventListener('change', () => setK3({ [key]: $(id).checked }));
}
$('k3-provider')?.addEventListener('change', () => setK3({ provider: $('k3-provider').value }));
$('k3-every')?.addEventListener('change', () => setK3({ suggestEvery: Number($('k3-every').value) || 10 }));

async function setMindSetting(patch) {
  const res = await bridge.updateSettings(patch);
  if (res?.settings) brain.memory.set({ mind: res.settings.mind, mindModel: res.settings.mindModel });
  await mind.refresh();
  renderMind();
  brain.setChatAvailable(chatOn() || agentOn());
  brain.setVisionAvailable((Boolean(chatInfo.vision) && chatOn()) || agentOn());
}

$('md-install')?.addEventListener('click', async () => {
  $('md-install').disabled = true;
  $('md-result').textContent = MIND_TEXT.install;
  const r = await bridge.mind.install();
  $('md-install').disabled = false;
  $('md-progress').hidden = true;
  $('md-result').textContent = r?.ok ? 'نزل! الحين اضغط «اربط اشتراكي».' : `ما نزل (${r?.error || 'خطأ'}). تأكد من الإنترنت وجرب مرة ثانية.`;
  await mind.refresh();
  renderMind();
});

$('md-signin')?.addEventListener('click', async () => {
  $('md-signin').disabled = true;
  $('md-result').textContent = MIND_TEXT.signin;
  const r = await bridge.mind.signIn();
  $('md-signin').disabled = false;
  await mind.refresh();
  if (r?.ok) await setMindSetting({ mind: 'claude' });
  else renderMind({ type: 'login', step: 'failed' });
  if (r?.ok) { handle({ say: 'هلا! الحين أفكر بمخ Claude. جرّبني: قول لي أي شي.', emotion: { emotion: 'excited', intensity: 3 }, animation: 'celebrate' }); }
});

$('md-code')?.addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const r = await bridge.mind.code($('md-code').value);
  $('md-code').value = '';
  $('md-result').textContent = r?.ok ? 'وصل الرمز، لحظة…' : 'الرمز ما انقبل.';
});

$('md-signout')?.addEventListener('click', async () => {
  await bridge.mind.signOut();
  await setMindSetting({ mind: 'classic' });
  $('md-result').textContent = 'انفصل الاشتراك. خلفون رجع لمخه العادي.';
});

$('md-on')?.addEventListener('change', () => setMindSetting({ mind: $('md-on').checked ? 'claude' : 'classic' }));
document.querySelectorAll('input[name="md-model"]').forEach((r) => r.addEventListener('change', () => {
  if (!r.checked) return;
  bridge.mind?.model(r.value);
  setMindSetting({ mindModel: r.value });
}));

// ------------------------------------------------------- «يا خلفون» wake word

let wakeBusy = false;
const wake = new WakeListener({
  onSentence: (wav, ms, head) => { onWakeSentence(wav, head, ms); },
  onAudio: (samples) => onEarAudio(samples),
  onError: (err) => {
    // The microphone can be busy for a moment (a call, another app): try again instead of
    // switching listening off for good. After a few failures in a row, tell him once.
    console.warn('wake listener stopped', err);
    bridge.note?.(`wake listener stopped: ${err?.message || err}`);
    wakeFailures += 1;
    if (wakeFailures === 3) { handle(brain.event('mic_error')); setTimeout(() => showBubble(`${fallbackHint()}.`, 'sorry', true), 4000); }
    setTimeout(() => updateWake(), Math.min(60000, 5000 * wakeFailures));
  },
});
let wakeFailures = 0;
let wakeCloudFails = 0;
let fallbackToldAt = 0;
/** The other way to make him listen: the remote's button if one was learned, else the shortcut. */
const fallbackHint = () => (remoteKey ? 'اضغط زر الريموت وأنا أسمعك' : 'اضغط زر المايك أو Ctrl+Shift+Space وأنا أسمعك');

// ---------------------------------------------------------------- Khalfoun's own ear
// A small model trained on the teacher's voice, listening on this computer for «يا خلفون».
// 'shadow': it only writes what it thinks beside the cloud's answer (to check it before
// trusting it); 'on': only sentences it heard his name in are checked in the cloud.
let ear = null;
let earError = null;
const cloudHearsNow = () => Boolean((cloudInfo?.azure || cloudInfo?.gemini) && cloudInfo.use?.hear !== false);
// The ONNX runtime (WebAssembly, one thread), shared by his ear and the faces finder.
let ortP = null;
function loadOrt() {
  ortP ??= import('../../node_modules/onnxruntime-web/dist/ort.wasm.min.mjs').then((ort) => {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = new URL('../../node_modules/onnxruntime-web/dist/', import.meta.url).href;
    return ort;
  });
  return ortP;
}
async function loadEar() {
  const m = await bridge.ear?.models?.().catch(() => null);
  if (!m?.cls) return;
  try {
    const ort = await loadOrt();
    const stream = await EarStream.create(ort, m);
    ear = { stream, trigger: new EarTrigger(m.config), mode: m.config.mode, hitAt: 0, steps: 0, ms: 0, version: m.config.version };
    bridge.note?.(`ear ready: ${ear.mode}, threshold ${m.config.threshold}, ${m.config.version || 'no version'}`);
  } catch (err) {
    ear = null;
    earError = String(err?.message || err).slice(0, 300);
    bridge.note?.(`ear failed to load: ${earError}`);
  }
}
function onEarAudio(samples) {
  if (!ear || inSession() || brain.dictation) return;
  const t0 = performance.now();
  ear.stream.push(samples).then((score) => {
    if (!ear || score === null) return;
    ear.ms += performance.now() - t0;
    ear.steps += 1;
    if (ear.trigger.feed(score)) {
      ear.hitAt = Date.now();
      bridge.note?.(`ear: heard his name (${score.toFixed(2)})`);
      if (ear.mode === 'on') { els.ear.classList.add('heard'); setTimeout(() => els.ear.classList.remove('heard'), 900); }
    }
    if (ear.steps % 3750 === 0) bridge.note?.(`ear: ${(ear.ms / ear.steps).toFixed(1)} ms per batch over ${ear.steps} batches`); // every ~5 min
  }).catch(() => {});
}

/** Starts or stops always-on listening to match the setting. */
function updateWake() {
  // While dictating, listen all the time (no «يا خلفون» needed) if voice is installed.
  const want = Boolean((brain?.memory.data.alwaysListen || brain?.dictation) && voiceAvailable);
  if (want && !wake.active) wake.start().then(() => { els.ear.hidden = !wake.active; if (wake.active) wakeFailures = 0; });
  if (!want && wake.active) wake.stop();
  els.ear.hidden = !want;
}

/** «خلاص», «شكراً»...: the end of a voice session. */
const SESSION_END = new Set(['خلاص', 'خلاص يا خلفون', 'خلاص خلفون', 'شكرا', 'شكرا خلفون', 'شكرا يا خلفون', 'مشكور', 'تسلم', 'تسلم يا خلفون', 'مع السلامه', 'بس', 'بس خلاص', 'وقف السماع', 'لا تسمع', 'كفايه', 'خلصت', 'خلاص خلصت', 'خلاص شكرا', 'باي'].map(normalize));
// After «يا خلفون», commands need no name and no button until «خلاص» or this long without one.
const SESSION_MS = () => Math.max(1, Math.min(30, Number(brain?.memory.data.sessionMinutes) || 5)) * 60000;
const inSession = () => Date.now() < sessionUntil;

function startSession() {
  if (brain?.memory.data.voiceSession === false) return;
  const was = inSession();
  sessionUntil = Date.now() + SESSION_MS();
  els.stage.classList.add('session');
  els.ear.classList.add('session');
  showSessionChip();
  if (!was) bridge.note?.('voice session started');
}

function endSession(why) {
  if (!sessionUntil) return;
  sessionUntil = 0;
  if (why === 'words') followUntil = 0; // «خلاص» means done: no follow-up listening either
  els.stage.classList.remove('session');
  els.ear.classList.remove('session');
  $('session-chip').hidden = true;
  bridge.note?.(`voice session ended (${why})`);
  if (why === 'timeout') handle(brain.event('session_timeout'));
  else if (why === 'words') handle(brain.event('session_end'));
}

function showSessionChip() {
  const chip = $('session-chip');
  chip.textContent = 'أسمعك بدون زر… قول أوامرك، و«خلاص» لما تخلص';
  chip.hidden = false;
}

setInterval(() => { if (sessionUntil && !inSession()) endSession('timeout'); }, 1000);

// Sentences heard while the previous one is still being read wait their turn (two at most).
const wakeQueue = [];
async function onWakeSentence(wav, head = wav, ms = 0) {
  // He pressed the mic button or the remote while the phone is the microphone: this is it.
  if (phoneCommandUntil && Date.now() < phoneCommandUntil) {
    phoneCommandUntil = 0;
    els.mic.classList.remove('recording');
    sounds.cue('stop');
    useCommandWav(wav);
    return;
  }
  if (recorder.active || panelsOpen() || haltedUi) return;
  // Did the ear hear his name during this sentence (or just before it)?
  const meta = { earHit: Boolean(ear && ear.hitAt && ear.hitAt >= Date.now() - (ms || 3000) - 1500), t0: Date.now() };
  if (voiceOut.speaking) {
    // His own voice coming back through the speakers is not a command — but the teacher
    // interrupting him is: his name heard by the ear, or any sentence from the phone's microphone
    // (close to the teacher's mouth, far from the speakers) stops him at once to listen.
    if (brain.memory.data.bargeIn !== false && (meta.earHit || phoneLive())) { voiceOut.stop(); bridge.note?.('barge-in: stopped talking to listen'); } else return;
  }
  if (wakeBusy) { if (wakeQueue.length < 2 && (inSession() || brain.dictation || meta.earHit)) wakeQueue.push([wav, head, meta]); return; }
  wakeBusy = true;
  try {
    await readWakeSentence(wav, head, meta);
    while (wakeQueue.length) await readWakeSentence(...wakeQueue.shift());
  } finally {
    wakeBusy = false;
  }
}

async function readWakeSentence(wav, head = wav, meta = {}) {
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
  // In a session every sentence is read as a command (accurate), not just checked for his name.
  const session = inSession();
  // A sentence starts the screenshot now, while it is being turned into words (seconds saved).
  if (session && mind?.on) bridge.mind?.prefetch?.();
  // Khalfoun's own ear decides first whether his name was in it: when it is trusted ('on'), a
  // sentence it did not hear his name in is not sent anywhere (no cost, no limit).
  let peak = null;
  if (ear && !session) {
    peak = ear.trigger.takePeak();
    if (ear.mode === 'on' && !meta.earHit && Date.now() >= followUntil) return;
    if (ear.mode === 'on' && meta.earHit && !cloudHearsNow()) {
      // No cloud to read it: the ear alone opens the session, the next sentence is the command.
      bridge.note?.(`ear: opened the session (peak ${peak.toFixed(2)})`);
      if (meta.t0) noteMetric('wake', Date.now() - meta.t0);
      handle(brain.event('session_start'));
      startSession();
      return;
    }
  }
  // Outside a session only the first seconds are checked for «يا خلفون» (a fraction of the cost).
  let res = await bridge.transcribe(session ? wav : head, session ? 'command' : 'wake');
  if (res?.ok && meta.t0) noteMetric(session ? 'stt' : 'wake', Date.now() - meta.t0);
  // The call is the first way; when hearing keeps failing (no internet, the service slow), he
  // is reminded of the fallback: the remote's button (or the keyboard shortcut), once an hour.
  if (!res?.ok) {
    wakeCloudFails += 1;
    if (wakeCloudFails >= 3 && Date.now() - fallbackToldAt > 3600000) {
      fallbackToldAt = Date.now();
      showBubble(`ما أقدر أسمع ندائي زين الحين (يمكن الإنترنت). ${fallbackHint()}.`, 'sorry', true);
    }
  } else wakeCloudFails = 0;
  if (ear && !session) bridge.note?.(`ear check: peak ${peak === null ? '-' : peak.toFixed(2)} ${meta.earHit ? 'HIT' : 'no'} → «${res?.text || ''}» ${findWakeWord(res?.text || '').found ? 'NAME' : 'other'}`);
  if (ear?.mode === 'on' && meta.earHit && !session && res?.ok && !res.text) {
    // The cloud gave nothing back (its daily time is up): the ear heard him, so trust it.
    handle(brain.event('session_start'));
    startSession();
    return;
  }
  if (!res?.ok || !res.text) return;
  let hit = findWakeWord(res.text);
  if (!session && hit.found && head !== wav) {
    // His name was there and he kept talking: read the whole sentence properly.
    if (mind?.on) bridge.mind?.prefetch?.();
    const full = await bridge.transcribe(wav, 'command');
    if (full?.ok && full.text) { res = full; const again = findWakeWord(full.text); hit = again.found ? again : { found: true, rest: full.text }; }
  }
  if (session) {
    const said = (hit.found ? hit.rest : res.text).trim();
    if (!said) { startSession(); return; }
    showHeard(said);
    if (SESSION_END.has(normalize(said))) { endSession('words'); return; }
    sessionUntil = Date.now() + SESSION_MS(); // each command keeps the session open
    // He may be talking to the class, not to Khalfoun: Claude is told so, and stays quiet then.
    hear(said, { quietIfUnknown: true, session: !hit.found, t0: meta.t0 });
    return;
  }
  if (!hit.found) {
    // A follow-up right after he answered needs no name; Claude (or the rules) decide
    // whether it was meant for him, and he stays quiet if not.
    if (Date.now() < followUntil && !chatting) hear(res.text, { quietIfUnknown: true });
    return;
  }
  els.ear.classList.add('heard');
  setTimeout(() => els.ear.classList.remove('heard'), 900);
  const wasAsleep = brain.emotions.asleep;
  if (hit.rest && !['call', 'empty'].includes(recognize(hit.rest).intent)) {
    // «يا خلفون افتح الحاسبة» in one breath: do it, and keep listening for the next one.
    startSession();
    showHeard(hit.rest);
    hear(hit.rest);
    return;
  }
  if (brain.memory.data.voiceSession !== false) {
    // «يا خلفون» alone opens the session: no button, no repeating his name.
    handle(brain.event('session_start'));
    startSession();
    return;
  }
  handle(brain.event('wake_call'));
  if (wasAsleep) await new Promise((r) => setTimeout(r, 900));
  wake.pause();
  try { await listen(); } finally { wake.resume(); }
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

const panelsOpen = () => !els.onboarding.hidden || !els.settings.hidden || !$('guide').hidden || cameraPanel.open || voiceTest.open || earTrainer.open || cameraPick.open;

let lastMouseX = null;
document.addEventListener('mousemove', (e) => {
  lastMouseX = e.clientX;
  ink.setPointer(e.clientX, e.clientY);
  const over = e.target instanceof Element && e.target.closest('.stage, .bubble, .command, .panel, .fx-ui');
  setInteractive(Boolean(over) || ink.pen || panelsOpen() || !els.command.hidden && document.activeElement === els.input);
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
    if (ink.pen) handle(brain.hear('وقف القلم'));
    else if (cameraPanel.open) cameraPanel.close();
    else if (voiceTest.open) voiceTest.close();
    else if (earTrainer.open) earTrainer.close();
    else if (cameraPick.open) cameraPick.close();
    else if (!$('guide').hidden) hideGuide();
    else if (!els.settings.hidden) closeSettings();
    else closeCommand();
  }
});
$('gd-close').addEventListener('click', hideGuide);

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

/** Uses the cloud voice when the person set up Azure (falls back to Windows' voice). */
function applyCloud() {
  voiceOut.remote = cloudInfo.azure && cloudInfo.use?.voice !== false && typeof bridge.speak === 'function' ? (line) => bridge.speak(line) : null;
  if ((cloudInfo.azure || cloudInfo.gemini) && cloudInfo.use?.hear !== false) voiceAvailable = true;
}

function renderCloud() {
  const s = cloudInfo;
  $('cl-claude-state').textContent = s.claude ? 'مضبوط ✓' : 'ما فيه مفتاح';
  $('cl-gemini-state').textContent = s.gemini ? (s.claude ? 'محفوظ (Claude أولاً)' : 'مضبوط ✓') : 'ما فيه مفتاح';
  $('cl-gemini').value = '';
  $('cl-azure-state').textContent = s.azure ? `مضبوط ✓ (${s.azureRegion})` : 'ما فيه مفتاح';
  $('cl-region').value = s.azureRegion || '';
  $('cl-use-hear').checked = s.use?.hear !== false;
  $('cl-use-brain').checked = s.use?.brain !== false;
  $('cl-use-voice').checked = s.use?.voice !== false;
  $('cl-claude').value = '';
  $('cl-azure').value = '';
}

const CLOUD_ERRORS = {
  bad_claude_key: 'مفتاح Claude شكله غلط. لازم يبدأ بـ sk-ant-', bad_gemini_key: 'مفتاح Gemini شكله غلط. لازم يبدأ بـ AQ. أو AIza', bad_azure_key: 'مفتاح Azure شكله غلط (حروف وأرقام بس).',
  bad_region: 'اسم المنطقة غلط. مثال: uaenorth', encryption_unavailable: 'ويندوز ما سمح بتشفير المفاتيح على هالجهاز.',
};

async function saveCloud(patch) {
  if (!bridge.cloud) return;
  const r = await bridge.cloud.set(patch);
  if (r?.status) cloudInfo = r.status;
  applyCloud();
  brain.setChatAvailable(chatOn() || agentOn());
  brain.setVisionAvailable((Boolean(chatInfo.vision) && chatOn()) || agentOn());
  renderCloud();
  $('cl-result').textContent = r?.ok ? 'انحفظ.' : (CLOUD_ERRORS[r?.error] || `ما انحفظ: ${r?.error}`);
  // Fast hearing is ready: «يا خلفون» without a button, once (the person can still turn it off).
  if (r?.ok && (cloudInfo?.azure || cloudInfo?.gemini) && cloudInfo.use?.hear !== false && !brain.memory.data.listenAutoDone) {
    brain.memory.set({ listenAutoDone: true });
    brain.updateSettings({ alwaysListen: true });
    updateWake();
    $('st-listen').checked = true;
  }
  return r?.ok;
}

function openSettings(focus = null) {
  const d = brain.memory.data;
  renderCloud();
  renderMind();
  mind?.refresh().then(() => renderMind());
  $('st-name').value = d.name || '';
  radio('st-level', d.level || 1);
  radio('st-humor', d.humor);
  $('st-kids').checked = !!d.kidsMode;
  $('st-listen').checked = !!d.alwaysListen;
  $('st-session').checked = d.voiceSession !== false;
  $('st-chat').checked = d.chatEnabled !== false;
  $('st-chat').disabled = !chatInfo.available;
  $('st-windows').checked = d.walkOnWindows !== false;
  $('st-sounds').checked = d.sounds !== false;
  $('st-speak').checked = !!d.speak;
  renderVoiceChoice();
  $('st-listen').disabled = !voiceAvailable;
  renderRemote();
  refreshMics();
  renderPhone();
  renderK3();
  refreshSetup().then(() => { if (focus === 'setup') $('su-title').scrollIntoView({ block: 'start', behavior: 'smooth' }); });
  renderLog();
  renderAliases();
  renderClassTools();
  closeCommand();
  hideGuide();
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
$('cl-save').addEventListener('click', async () => {
  const patch = {};
  if ($('cl-claude').value.trim()) patch.claudeKey = $('cl-claude').value.trim();
  if ($('cl-gemini').value.trim()) patch.geminiKey = $('cl-gemini').value.trim();
  if ($('cl-azure').value.trim()) patch.azureKey = $('cl-azure').value.trim();
  if ($('cl-region').value.trim() !== (cloudInfo.azureRegion || '')) patch.azureRegion = $('cl-region').value.trim();
  if (!Object.keys(patch).length) { $('cl-result').textContent = 'ما فيه شي جديد.'; return; }
  if (await saveCloud(patch)) $('cl-test').click();
});
$('cl-test').addEventListener('click', async () => {
  if (!bridge.cloud) return;
  $('cl-result').textContent = 'أجرب المفاتيح...';
  const r = await bridge.cloud.test();
  const say = (x, name) => (!x ? '' : x.ok ? `${name}: يشتغل ✓${x.ms ? ` (${(x.ms / 1000).toFixed(1)} ث)` : ''}` : `${name}: ${{ bad_key: 'المفتاح غلط', no_credit: 'ما فيه رصيد', offline: 'ما فيه نت', timeout: 'تأخر', quota: 'خلص الحد المجاني لليوم', key_type: 'جوجل رفضت نوع المفتاح (مشكلة من جوجل)', api_disabled: 'خدمة Gemini مب مفعّلة في المشروع', region_blocked: 'جوجل ما تسمح بالخدمة من منطقتك' }[x.error] || x.error}`);
  $('cl-result').textContent = [say(r?.claude, 'Claude'), say(r?.gemini, 'Gemini'), say(r?.azure, 'Azure')].filter(Boolean).join(' · ') || 'حط مفتاح أول.';
});
$('cl-forget').addEventListener('click', () => saveCloud({ claudeKey: '', geminiKey: '', azureKey: '', azureRegion: '' }));
for (const [id, key] of [['cl-use-hear', 'hear'], ['cl-use-brain', 'brain'], ['cl-use-voice', 'voice']]) {
  $(id).addEventListener('change', () => saveCloud({ use: { [key]: $(id).checked } }));
}

// ---------------------------------------------------------------- what Khalfoun has learned about him
const LEARNED_KIND = { word: 'كلمة', like: 'يحب', fix: 'تصحيح', fact: 'معلومة' };
async function renderLearned() {
  const list = $('learned-list');
  const r = await bridge.mind?.learned?.().catch(() => null);
  if (!r) { list.replaceChildren(); return; }
  const item = (label, text, id) => {
    const li = document.createElement('li');
    const tag = document.createElement('b'); tag.textContent = label;
    const span = document.createElement('span'); span.textContent = text;
    const del = document.createElement('button'); del.type = 'button'; del.className = 'icon-btn'; del.textContent = '✕'; del.setAttribute('aria-label', 'احذف');
    del.addEventListener('click', async () => { await bridge.mind.forget(id); renderLearned(); });
    li.append(tag, span, del);
    return li;
  };
  const rows = [
    ...r.habits.map((h) => item('أمر', `«${h.phrase}» (${h.count} مرات)`, h.id)),
    ...r.notes.map((n) => item(LEARNED_KIND[n.kind] || 'معلومة', n.text, n.id)),
  ];
  if (!rows.length) { const li = document.createElement('li'); li.className = 'fine'; li.textContent = 'لسا ما تعلم شي. استخدمه وهو يتعلمك.'; rows.push(li); }
  list.replaceChildren(...rows);
}
$('learned-box').addEventListener('toggle', () => { if ($('learned-box').open) renderLearned(); });

// ---------------------------------------------------------------- choosing his voice
function renderVoiceChoice() {
  const sel = $('voice-choice');
  if (!sel.options.length) sel.replaceChildren(...VOICE_CHOICES.map((v) => new Option(v.label, v.id)));
  sel.value = VOICE_IDS.includes(sysVoice) ? sysVoice : VOICE_IDS[0];
  $('voice-row').hidden = !(cloudInfo?.azure && cloudInfo.use?.voice !== false);
}
let sysVoice = null;
$('voice-choice').addEventListener('change', async () => {
  sysVoice = $('voice-choice').value;
  await bridge.updateSettings?.({ voiceName: sysVoice });
  tryVoice();
});
async function tryVoice() {
  voiceOut.stop();
  const r = await bridge.previewVoice?.($('voice-choice').value).catch(() => null);
  if (!r?.ok || !r.audio) { showBubble('ما قدرت أجرب الصوت الحين.', 'sorry'); return; }
  const url = URL.createObjectURL(new Blob([r.audio], { type: 'audio/mpeg' }));
  const a = new Audio(url);
  a.onended = () => URL.revokeObjectURL(url);
  a.play().catch(() => URL.revokeObjectURL(url));
}
$('voice-try').addEventListener('click', tryVoice);

$('st-speak').addEventListener('change', () => {
  handle(brain.hear($('st-speak').checked ? 'تكلم' : 'لا تتكلم'));
  $('st-speak').checked = !!brain.memory.data.speak;
});
$('st-windows').addEventListener('change', () => {
  brain.memory.set({ walkOnWindows: $('st-windows').checked });
  updateWindowWatch();
});
// ---------------------------------------------------------------- the presenter remote
let remoteKey = null;
let remoteLearning = null; // { stop() } while he presses the remote
function renderRemote(note) {
  const label = remoteKey ? remoteKeyLabel(remoteKey) : null;
  $('rm-state').textContent = remoteKey ? 'جاهز' : 'ما فيه';
  $('rm-forget').hidden = !remoteKey;
  $('rm-learn').textContent = remoteLearning ? '⏳ اضغط زر الريموت الحين…' : remoteKey ? '🎛️ غيّر زر الريموت' : '🎛️ علّم خلفون زر الريموت';
  if (note !== undefined) $('rm-result').textContent = note;
  else if (!remoteLearning) $('rm-result').textContent = label ? `الزر: ${label}. اضغطه في أي وقت وخلفون يسمعك.` : '';
}
const remoteKeyLabel = (accel) => accel.replace(/Ctrl/g, 'Ctrl').replace('PageDown', 'الصفحة التالية').replace('PageUp', 'الصفحة السابقة').replace('MediaPlayPause', 'زر التشغيل');
function learnRemote() {
  if (remoteLearning) { remoteLearning.stop('ألغيت.'); return; }
  bridge.remote?.pause(true);
  const onKey = async (e) => {
    e.preventDefault(); e.stopPropagation();
    const k = remoteKeyFrom(e);
    if (!k.ok) { if (k.why !== 'modifier') renderRemote(REMOTE_REFUSAL[k.why]); return; }
    window.removeEventListener('keydown', onKey, true);
    const r = await bridge.remote?.set(k.accel);
    if (r?.ok) {
      remoteKey = k.accel;
      done(`تمام! الزر «${k.label}» صار زر خلفون: اضغطه وخلفون يسمعك.${k.warn ? ` ملاحظة: ${k.warn}` : ''}`);
    } else done(r?.error === 'taken' ? 'هذا الزر ماخذه برنامج ثاني في جهازك. جرّب زر ثاني.' : 'ما قدرت آخذ هذا الزر. جرّب زر ثاني.');
  };
  const timer = setTimeout(() => done('ما وصلني شي من الريموت. تأكد إنه شغال وموصول، وجرّب مرة ثانية.'), 20000);
  function done(note) {
    clearTimeout(timer);
    window.removeEventListener('keydown', onKey, true);
    remoteLearning = null;
    bridge.remote?.pause(false);
    renderRemote(note);
  }
  remoteLearning = { stop: done };
  window.addEventListener('keydown', onKey, true);
  window.focus();
  renderRemote('اضغط الحين في الريموت الزر اللي تبغاه لخلفون (مثل زر بدء العرض). عندك ٢٠ ثانية.');
}
$('rm-learn').addEventListener('click', learnRemote);
$('ear-open').addEventListener('click', () => openEarTrainer());
$('rm-forget').addEventListener('click', async () => {
  const r = await bridge.remote?.set(null);
  if (r?.ok) { remoteKey = null; renderRemote('نسيت الزر.'); }
});

// ---------------------------------------------------------------- choosing the microphone
async function refreshMics() {
  const sel = $('mic-choice');
  let mics = [];
  try { mics = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications'); } catch { /* no devices */ }
  const want = brain.memory.data.micId || '';
  sel.replaceChildren(new Option('مايك الجهاز (الافتراضي)', ''), ...mics.map((d, i) => new Option(d.label || `مايك ${i + 1}`, d.deviceId)));
  sel.value = mics.some((d) => d.deviceId === want) ? want : '';
  preferredMicPresent = Boolean(want && mics.some((d) => d.deviceId === want));
  setMicChoice(preferredMicPresent ? want : '');
  if (preferredMicPresent && phoneState.streaming) onPhoneStatus(phoneState); // the wireless mic comes first
}
$('mic-choice').addEventListener('change', async () => {
  brain.updateSettings({ micId: $('mic-choice').value });
  await refreshMics();
  // listen again through the chosen microphone
  if (wake.active) { wake.stop(); updateWake(); }
  onPhoneStatus(phoneState);
});
navigator.mediaDevices?.addEventListener?.('devicechange', () => { refreshMics().then(() => { if (wake.active) { wake.stop(); updateWake(); } onPhoneStatus(phoneState); }); });

// ---------------------------------------------------------------- the phone page (QR code)
async function renderPhone(info) {
  if (info === undefined && !els.settings.hidden) info = await bridge.phone?.info?.().catch(() => null);
  if (info === undefined) return;
  const on = Boolean(info?.ok);
  $('phone-on').hidden = on;
  $('phone-off').hidden = !on;
  $('phone-box').hidden = !on;
  if (!on) return;
  if (info.qr) $('phone-qr').src = info.qr;
  $('phone-url').textContent = (info.urls || [info.url]).join('  ·  ');
  $('phone-state').textContent = phoneLive() ? '✓ التلفون هو المايك الحين' : phoneState.connected ? '✓ التلفون متصل (فعّل «استماع دائم» في التلفون، أو اضغط الزر فيه وتكلم)' : preferredMicPresent && phoneState.streaming ? 'المايك اللاسلكي هو الأول، والتلفون احتياط' : 'امسح الرمز بالتلفون…';
}
$('phone-on').addEventListener('click', async () => {
  $('phone-on').disabled = true;
  const r = await bridge.phone?.start?.().catch(() => null);
  $('phone-on').disabled = false;
  if (!r?.ok) { $('phone-state').textContent = r?.error === 'no_network' ? 'الجهاز مو متصل بشبكة. وصّله بنقطة اتصال التلفون وجرب.' : 'ما قدرت أشغّل مايك التلفون.'; $('phone-box').hidden = false; return; }
  await renderPhone(r);
  $('phone-box').scrollIntoView({ block: 'center', behavior: 'smooth' });
});
$('phone-off').addEventListener('click', async () => {
  await bridge.phone?.stop?.();
  onPhoneStatus({ connected: false, streaming: false });
  renderPhone({ ok: false });
});

$('st-listen').addEventListener('change', () => {
  brain.updateSettings({ alwaysListen: $('st-listen').checked });
  updateWake();
});
$('st-session').addEventListener('change', () => {
  brain.memory.set({ voiceSession: $('st-session').checked });
  if (!$('st-session').checked) endSession('off');
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
$('ct-voicetest').addEventListener('click', () => openVoiceTest());
$('ct-guide').addEventListener('click', () => openGuide());
$('ct-reading').addEventListener('click', () => { closeSettings(); handle(brain.hear('افتح اختبار القراءة')); });
$('ct-stars-reset').addEventListener('click', () => {
  // eslint-disable-next-line no-alert
  if (window.confirm('أصفّر نجوم الصف؟')) { brain.memory.set({ classStars: 0 }); renderClassTools(); }
});

function renderClassTools() {
  const stars = Number(brain.memory.data.classStars) || 0;
  $('ct-stars').textContent = toArabicDigits(stars);
  const next = STAR_STEPS.find((m) => m.at > stars);
  $('ct-next').textContent = next ? `(باقي ${toArabicDigits(next.at - stars)} على ${next.label})` : '(كل الجوايز مفتوحة)';
}

// ------------------------------------------------------------------ layout

function layout() {
  const x = motion.x;
  const y = motion.y;
  els.stage.style.transform = classMode
    ? `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${CLASS_SCALE})`
    : `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  const headY = classMode ? y - CHAR_H * (CLASS_SCALE - 1) : y;
  const heard = $('heard');
  if (!heard.hidden) {
    const w = heard.offsetWidth;
    heard.style.transform = `translate(${Math.min(Math.max(4, x + CHAR_W / 2 - w / 2), window.innerWidth - w - 4).toFixed(1)}px, ${Math.min(window.innerHeight - 30, y + CHAR_H + 2).toFixed(1)}px)`;
  }
  const cx = x + CHAR_W / 2;
  if (!els.ear.hidden) els.ear.style.transform = `translate(${(x + 6).toFixed(1)}px, ${(y + 100).toFixed(1)}px)`;
  if (!els.dictation.hidden) {
    const w = els.dictation.offsetWidth;
    els.dictation.style.transform = `translate(${Math.min(Math.max(4, x + CHAR_W / 2 - w / 2), window.innerWidth - w - 4).toFixed(1)}px, ${(y + CHAR_H - 28).toFixed(1)}px)`;
  }
  let top = headY + 4;
  if (!els.command.hidden) {
    const w = els.command.offsetWidth;
    const left = Math.min(Math.max(8, cx - w / 2), window.innerWidth - w - 8);
    top = Math.max(8, headY - els.command.offsetHeight + 6);
    els.command.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
  }
  if (!els.bubble.hidden) {
    const w = els.bubble.offsetWidth;
    const h = els.bubble.offsetHeight;
    // Keep clear of an open panel: the bubble stays on Khalfoun's side of it.
    const panel = !els.onboarding.hidden ? els.onboarding : !els.settings.hidden ? els.settings : !$('guide').hidden ? $('guide') : null;
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
  cloudInfo = loaded?.cloud || cloudInfo;
  applyCloud();
  renderCloud();
  remoteKey = loaded?.settings?.remoteKey || null;
  sysVoice = loaded?.settings?.voiceName || null;
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
  mind = new MindClient({
    bridge, brain, ink, character, animator, sounds, voiceOut, showBubble, screenFx, effects, pickWithCamera, stepsDeck, docView, graphPanel, setStatus: (st) => setStatus(st), metric: (k, ms) => noteMetric(k, ms),
    recorderActive: () => recorder.active,
    localHear: (cmd, o = {}) => {
      // Claude's «classroom» tool is for the games and class tools only: opening a program or a
      // file, typing or searching are Claude's own tools (seen: «افتح الـ PDF مع الصف العاشر»
      // went to «open an installed program» and Claude said it was done).
      if (o.onlyClassroom) {
        const intent = recognize(cmd)?.intent;
        if (GENERIC_INTENTS.has(intent)) return { situation: 'not_classroom' };
      }
      const r = brain.hear(cmd);
      if (o.onlyClassroom && r?.action && GENERIC_ACTIONS.has(r.action.type)) return { situation: 'not_classroom' };
      if (r && r.situation !== 'not_understood') handle(r);
      return r;
    },
    note: (t) => bridge.note?.(t),
    colorHex: (c) => (COLORS[c] ? `#${COLORS[c].hex}` : null),
    showChoices, hideChoices,
    onSetup: (e) => renderMind(e),
    onTool: (name) => {
      mind.lastAct = Date.now();
      if (['click', 'drag', 'scroll', 'move_mouse'].includes(name) && !ink.pen) setInteractive(false);
    },
  });
  if (bridge.mind) mind.refresh().then(() => renderMind());
  brain.setChatAvailable(chatOn() || agentOn());
  brain.setVisionAvailable((Boolean(chatInfo.vision) && chatOn()) || agentOn());
  bridge.onEvent((ev) => {
    switch (ev?.type) {
      case 'reminder': sounds.effect('chime'); handle(brain.event('reminder_fire', { note: ev.note })); motion.come(); break;
      case 'open-command': openCommand(); break;
      case 'ptt': listen(); break;
      case 'open-settings': openSettings(); break;
      case 'come': handle(brain.hear('تعال')); break;
      case 'mind': mind?.onEvent(ev.data); break;
      case 'mind_ui': mind?.onUi(ev.data); break;
      case 'windows': lastWindows = Array.isArray(ev.list) ? ev.list : []; applyWindows(); noticeWindows(lastWindows); break;
      case 'download': if (!panelsOpen()) handle(brain.event('download_new', { name: ev.name, kind: ev.kind })); break;
      case 'resume': handle(brain.event('resume')); motion.come(); break;
      case 'tool-closed': handle(brain.event('tool_closed', { tool: ev.tool })); break;
      case 'tool-busy': handle(brain.event('tool_busy', { tool: ev.tool, mode: ev.mode })); break;
      case 'tool-done': handle(brain.event('tool_done', { tool: ev.tool, mode: ev.mode, ok: !!ev.ok })); break;
      case 'tool-event': handle(brain.event('tool_event', { tool: ev.tool, what: ev.what, count: ev.count })); break;
      case 'setup-progress': showSetupProgress(ev); break;
      case 'voice-ready':
        voiceAvailable = !!ev.available;
        $('st-listen').disabled = !voiceAvailable;
        updateWake();
        break;
      case 'ear-progress': earTrainer.progress(ev); break;
      case 'phone-status': onPhoneStatus(ev); break;
      case 'phone-audio': onPhoneAudio(ev.pcm); break;
      case 'phone-say': onPhoneSay(ev.wav); break;
      case 'phone-cmd': onPhoneCommand(ev.name); break;
      case 'phone-whisper': hear(String(ev.text || ''), { typed: true, silent: true }); break;
      case 'phone-photo': onPhonePhoto(ev.purpose, ev.photo); break;
      case 'steps-key': if (ev.dir === 'back') stepsDeck.back(); else stepsDeck.next(); break;
      case 'soft-confirm': safety.soft(ev); break;
      case 'click-marker': safety.marker(ev.x, ev.y); break;
      case 'emergency': setHalted(Boolean(ev.on)); break;
      case 'wake-limit':
        showBubble(`خلص وقت سماع «يا خلفون» لليوم. ${fallbackHint()}، وبكرة يرجع السماع.`, 'sorry', true);
        break;
      case 'chat-ready':
        chatInfo = { available: !!ev.available, model: ev.model || null, vision: ev.vision || null };
        $('st-chat').disabled = !chatInfo.available;
        brain.setChatAvailable(chatOn());
        brain.setVisionAvailable((Boolean(ev.vision) && chatOn()) || agentOn());
        break;
      default: break;
    }
  });

  setInterval(() => {
    // No idle chatter while the Claude mind works, or just after it answered.
    if (mind && (mind.busy || Date.now() - (mind.lastAct || 0) < 60000)) return;
    if (inSession()) return; // he is teaching with Khalfoun listening: no chatter
    handle(brain.tick());
  }, 4000);
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
  loadEar(); // Khalfoun's own ear, if one has been trained for this teacher
  refreshMics(); // a wireless microphone he chose comes first
  updateWindowWatch();
  if (!brain.memory.data.onboarded) startOnboarding();
  else handle(brain.start());
  // Khalfoun 3: the status dot on him, and the lesson brought back after a crash or a restart
  if (els.stage && !els.stage.querySelector('.status-dot')) { const dot = document.createElement('i'); dot.className = 'status-dot'; dot.dataset.s = 'idle'; els.stage.append(dot); }
  restoreLesson().catch(() => {});

  // Hooks for automated UI tests and debugging.
  window.__khalfoun = { brain, motion, animator, character, hear, handle, bridge, showBubble, sounds, wake, updateWake, updateWindowWatch, effects, ink, startSession, endSession, onWakeSentence, get inSession() { return inSession(); }, wheel, raceBoard, noise, cameraPanel, voiceTest, get classMode() { return classMode; }, get preview() { return preview; }, get lastReply() { return lastReply; }, recentSituations, get game() { return game; }, noticeWindows, desktop, voiceOut, get mind() { return mind; }, renderMind, screenFx, cameraPick, pickWithCamera, stepsDeck, docView, graphPanel, showBubble, voiceOut, onPhoneCommand, onPhonePhoto, get phoneMuted() { return phoneMuted; }, get bubbleHidden() { return bubbleHidden; }, get ear() { return ear; }, get earError() { return earError; }, onPhoneStatus, onPhoneAudio, onPhoneSay, get phoneLive() { return phoneLive(); }, loadEar, onEarAudio, earTrainer, endFollow: () => { followUntil = 0; }, safety, setHalted, get haltedUi() { return haltedUi; }, setFx, smartUndo, lessonSnapshot, restoreLesson, setStatus, get statusNow() { return statusNow; } };
  document.documentElement.dataset.ready = '1';
}

start().catch((err) => {
  console.error('Khalfoun failed to start', err);
  document.documentElement.dataset.ready = 'error';
});
