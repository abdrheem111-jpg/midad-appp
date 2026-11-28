// Khalfoun 3.1: a big library of extra moves — gestures for teaching, reactions for the class,
// celebrations and playful bits. Same rules as animations.js: pure functions of time returning a
// partial pose (arms/legs/head in degrees, offsets in SVG units, face hints, little effects).

const S = Math.sin;
const PI2 = Math.PI * 2;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);
const hop = (t) => 4 * t * (1 - t);
/** rises in the first `a` of the time, holds, falls in the last `b` */
const env = (u, a = 0.2, b = 0.2) => clamp01(u / a) * (1 - clamp01((u - (1 - b)) / b));

/** @type {Record<string, {loop: boolean, dur: number, pose: (t: number) => object, ar: string}>} */
export const MORE_ANIMATIONS = {
  // ---- teaching gestures
  point_up: { ar: 'يأشر فوق', loop: false, dur: 1.4, pose: (t) => { const e = env(t / 1.4); return { armR: 160 * e, cane: -60 * e, headRot: -10 * e, eyeMul: 1.05 }; } },
  point_down: { ar: 'يأشر تحت', loop: false, dur: 1.4, pose: (t) => { const e = env(t / 1.4); return { armR: 20 * e, cane: 30 * e, headRot: 12 * e, headY: 3 * e }; } },
  point_left: { ar: 'يأشر يسار', loop: false, dur: 1.4, pose: (t) => { const e = env(t / 1.4); return { armL: 90 * e, bodyRot: -5 * e, headRot: -8 * e }; } },
  point_right: { ar: 'يأشر يمين', loop: false, dur: 1.4, pose: (t) => { const e = env(t / 1.4); return { armR: 90 * e, cane: -40 * e, bodyRot: 5 * e, headRot: 8 * e }; } },
  present: { ar: 'يقدّم «هذا هو!»', loop: false, dur: 1.6, pose: (t) => { const u = t / 1.6; const e = ease(clamp01(u / 0.35)) * (1 - clamp01((u - 0.85) / 0.15)); return { armL: 55 * e, armR: 55 * e, bodyRot: -4 * e, headRot: -6 * e, mouth: 'grin', fx: u > 0.3 && u < 0.8 ? 'sparkles' : null }; } },
  teacher_point: { ar: 'يشرح ويأشر للسبورة', loop: false, dur: 2.2, pose: (t) => { const e = env(t / 2.2, 0.15, 0.15); return { armR: (80 + S(t * 6) * 8) * e, cane: -45 * e, headRot: (-12 + S(t * 3) * 4) * e, mouth: t % 0.6 < 0.3 ? 'o' : 'small', glasses: true }; } },
  count_fingers: { ar: 'يعد على أصابعه', loop: false, dur: 2.4, pose: (t) => { const k = Math.floor(t / 0.6); return { armL: 70 + (k % 2) * 10, armR: -40 + (k % 2) * 8, headRot: 6, mouth: 'small', bodyY: (k % 2) * -1.5 }; } },
  measure: { ar: 'يقيس بيديه «كذا طول»', loop: false, dur: 1.8, pose: (t) => { const e = env(t / 1.8); return { armL: (40 + S(t * 5) * 6) * e, armR: (40 - S(t * 5) * 6) * e, mouth: 'o', headRot: 4 * e }; } },
  typing: { ar: 'يطبع على الكيبورد', loop: true, dur: 0.5, pose: (t) => ({ armL: -40 + Math.max(0, S(t * 40)) * 10, armR: -40 + Math.max(0, -S(t * 40)) * 10, headRot: 10, headY: 2, glasses: true, mouth: 'small' }) },
  read_glasses: { ar: 'يلبس النظارة ويقرأ', loop: false, dur: 2.4, pose: (t) => { const u = t / 2.4; return { armL: u < 0.3 ? -150 * env(u / 0.3, 0.5, 0.5) : -70, armR: -70, glasses: u > 0.2, headRot: 10, headY: 3, mouth: 'small' }; } },
  write_fast: { ar: 'يكتب بسرعة', loop: false, dur: 1.8, pose: (t) => { const up = env(t / 1.8, 0.1, 0.1); return { armL: up * (72 + S(t * 34) * 7), headRot: up * -9, pen: true, mouth: 'small', bodyRot: up * S(t * 17) * 1.5 }; } },
  calculate: { ar: 'يحسب في راسه', loop: false, dur: 2.2, pose: (t) => ({ armL: -116, headRot: 8 + S(t * 9) * 3, eyeMode: t % 0.7 < 0.35 ? 'spiral' : null, mouth: 'smirkDown', fx: 'question' }) },
  lightbulb: { ar: 'جته فكرة! 💡', loop: false, dur: 1.5, pose: (t) => ({ armR: 155 * env(t / 1.5, 0.1, 0.25), cane: -55, y: -hop(clamp01(t / 0.45)) * 18, mouth: 'grin', fx: 'exclaim', eyeMode: 'stars' }) },
  explain_hands: { ar: 'يشرح بيديه', loop: true, dur: 1.6, pose: (t) => ({ armL: 35 + S(t * 4) * 18, armR: 35 + S(t * 4 + 1.6) * 18, headRot: S(t * 2) * 5, mouth: t % 0.5 < 0.25 ? 'o' : 'small' }) },
  // ---- yes, no, attention
  yes_yes: { ar: 'إي إي (يهز راسه)', loop: false, dur: 1.2, pose: (t) => ({ headY: Math.max(0, S(t * 20)) * 6, mouth: 'smile', eyeMode: 'arc' }) },
  no_no: { ar: 'لا لا (يحرك إصبعه)', loop: false, dur: 1.4, pose: (t) => ({ armR: 120, cane: -30 + S(t * 22) * 25, headRot: S(t * 11) * 6, mouth: 'pout' }) },
  attention: { ar: 'انتبهوا! ☝️', loop: false, dur: 1.6, pose: (t) => ({ armR: 165, cane: -70, y: -hop(clamp01(t / 0.35)) * 10, mouth: 'o', fx: 'exclaim', sy: 1.03 }) },
  silence: { ar: 'هدوء 🤫', loop: false, dur: 2, pose: (t) => ({ armL: -158, mouth: 'pout', headRot: 4 + S(t * 2) * 2, eyesClosed: t > 0.6 && t < 1.4 }) },
  listen_hard: { ar: 'يتسمّع بقوة', loop: true, dur: 2, pose: (t) => ({ armL: 150, headRot: -14 + S(t * 3) * 2, bodyRot: -6, eyeMul: 1.15, mouth: 'small' }) },
  wink: { ar: 'يغمز 😉', loop: false, dur: 1, pose: (t) => ({ eyeMode: t > 0.2 && t < 0.7 ? 'arc' : null, headRot: -8, mouth: 'cheeky' }) },
  // ---- praise and celebration
  thumbs_up: { ar: 'ممتاز 👍', loop: false, dur: 1.6, pose: (t) => { const e = env(t / 1.6); return { armR: 100 * e, cane: -80 * e, mouth: 'grin', eyeMode: 'arc', y: -hop(clamp01(t / 0.4)) * 6, fx: 'sparkles' }; } },
  victory: { ar: 'نصر! ✌️', loop: false, dur: 1.6, pose: (t) => ({ armL: 140, armR: 140, y: -hop(clamp01(t / 0.6)) * 40, mouth: 'laugh', fx: 'sparkles', eyeMode: 'stars' }) },
  fist_pump: { ar: 'يس! 💪', loop: false, dur: 1.2, pose: (t) => ({ armR: 120 + Math.max(0, S(t * 16)) * 30, armL: -20, mouth: 'grin', y: -Math.abs(S(t * 8)) * 8 }) },
  high_five: { ar: 'كفّك! ✋', loop: false, dur: 1.4, pose: (t) => { const u = t / 1.4; return { armR: 140 * ease(clamp01(u / 0.3)), cane: -60, mouth: 'laugh', y: u > 0.4 && u < 0.6 ? -10 : 0, fx: u > 0.4 && u < 0.7 ? 'sparkles' : null }; } },
  clap_fast: { ar: 'تصفيق حار 👏', loop: false, dur: 2, pose: (t) => { const c = Math.max(0, S(t * 36)); return { armL: -45 - c * 30, armR: -45 - c * 30, mouth: 'laugh', y: -Math.abs(S(t * 5)) * 8, fx: 'sparkles' }; } },
  standing_ovation: { ar: 'يصفق ويقفز', loop: false, dur: 2.4, pose: (t) => { const c = Math.max(0, S(t * 30)); return { armL: 60 + c * 50, armR: 60 + c * 50, y: -Math.abs(S(t * 6)) * 20, mouth: 'laugh', fx: 'sparkles', eyeMode: 'stars' }; } },
  bow_deep: { ar: 'انحناءة شكر', loop: false, dur: 2, pose: (t) => { const u = hop(clamp01(t / 2)); return { headY: 16 * u, sy: 1 - 0.12 * u, armL: -60 * u, armR: 30 * u, eyesClosed: u > 0.5, mouth: 'smile' }; } },
  salute: { ar: 'تحية', loop: false, dur: 1.6, pose: (t) => { const e = env(t / 1.6, 0.2, 0.2); return { armL: -150 * e, sy: 1 + 0.03 * e, headRot: -4 * e, mouth: 'smile' }; } },
  hip_hip: { ar: 'هيب هيب هرّي!', loop: false, dur: 2.4, pose: (t) => { const k = t % 0.8; const up = k > 0.5; return { armL: up ? 150 : 40, armR: up ? 150 : 40, y: up ? -16 : 0, mouth: up ? 'laugh' : 'o', fx: up ? 'sparkles' : null }; } },
  happy_dance: { ar: 'رقصة فرح', loop: true, dur: 1, pose: (t) => { const p = t * PI2; return { rot: S(p) * 10, armL: 110 + S(p * 2) * 30, armR: 110 - S(p * 2) * 30, y: -Math.abs(S(p * 2)) * 10, mouth: 'laugh', legL: S(p) * 16, legR: -S(p) * 16 }; } },
  robot_dance: { ar: 'رقصة روبوت 🤖', loop: true, dur: 1.6, pose: (t) => { const k = Math.floor(t / 0.2) % 8; const a = [0, 90, 90, 0, -60, -60, 90, 0][k]; return { armL: a, armR: 90 - a, headRot: [0, 10, -10, 0, 10, -10, 0, 0][k], bodyY: k % 2 ? -2 : 0, mouth: 'flat' }; } },
  twirl: { ar: 'يلف لفتين', loop: false, dur: 1.4, pose: (t) => { const u = ease(clamp01(t / 1.4)); return { sx: Math.cos(u * PI2 * 3), y: -hop(u) * 24, armL: 100, armR: 100, mouth: 'laugh' }; } },
  wiggle: { ar: 'يتهزهز', loop: false, dur: 1.4, pose: (t) => ({ rot: S(t * 30) * 7, sx: 1 + S(t * 30) * 0.03, mouth: 'cheeky', armL: 20, armR: 20 }) },
  drum: { ar: 'يدق على الطبل', loop: false, dur: 2, pose: (t) => ({ armL: -30 + Math.max(0, S(t * 24)) * 40, armR: -30 + Math.max(0, -S(t * 24)) * 40, headY: Math.max(0, S(t * 12)) * 3, mouth: 'grin' }) },
  drumroll: { ar: 'طبلة... 🥁', loop: false, dur: 2, pose: (t) => { const fast = t < 1.6; return { armL: fast ? -30 + Math.max(0, S(t * 60)) * 25 : 150, armR: fast ? -30 + Math.max(0, -S(t * 60)) * 25 : 150, mouth: fast ? 'small' : 'laugh', fx: fast ? null : 'exclaim', y: fast ? 0 : -14 }; } },
  magic: { ar: 'خدعة سحرية ✨', loop: false, dur: 2.2, pose: (t) => { const u = t / 2.2; return { armR: 110 + S(t * 14) * 25, cane: -60 + S(t * 14) * 40, sx: u > 0.55 && u < 0.75 ? Math.cos(((u - 0.55) / 0.2) * PI2) : 1, mouth: 'cheeky', fx: u > 0.5 ? 'sparkles' : null, eyeMode: u > 0.75 ? 'stars' : null }; } },
  falcon: { ar: 'الصقر العماني على يده 🦅', loop: false, dur: 2.2, pose: (t) => { const e = env(t / 2.2); return { armL: 65 * e, headRot: -10 * e, sy: 1 + 0.03 * e, mouth: 'smile', fx: e > 0.8 ? 'sparkles' : null }; } },
  camel_ride: { ar: 'راكب جمل 🐪', loop: true, dur: 1.2, pose: (t) => { const p = t * PI2 / 1.2; return { y: -Math.abs(S(p)) * 12, rot: S(p) * 6, armL: 30, armR: 30, legL: 25, legR: -25, mouth: 'grin' }; } },
  // ---- reactions
  surprised: { ar: 'تفاجأ!', loop: false, dur: 1.2, pose: (t) => ({ y: -hop(clamp01(t / 0.35)) * 22, armL: 80, armR: 80, mouth: 'bigO', eyeMul: 1.25, fx: 'exclaim', kummaY: -hop(clamp01(t / 0.35)) * 16 }) },
  scared: { ar: 'خايف 😱', loop: false, dur: 1.6, pose: (t) => ({ armL: -150, armR: -150, sy: 0.94, rot: S(t * 40) * 3, mouth: 'teeth', fx: 'sweat' }) },
  tired: { ar: 'تعبان', loop: false, dur: 2.4, pose: (t) => ({ headY: 7, headRot: 10, armL: -6, armR: -6, sy: 0.96, eyeMode: 'arc', mouth: 'o', bodyY: S(t * 2) * 1.5 }) },
  arms_crossed: { ar: 'مكتّف يديه', loop: false, dur: 2, pose: () => ({ armL: -75, armR: -75, headRot: -6, mouth: 'flat', sy: 1.01 }) },
  hands_on_hips: { ar: 'يده على خصره', loop: false, dur: 2, pose: () => ({ armL: -30, armR: -30, sx: 1.05, headRot: -5, mouth: 'smirkDown' }) },
  mock_angry: { ar: 'زعلان مزح 😤', loop: false, dur: 1.8, pose: (t) => ({ armL: -82, armR: -82, headRot: -12, legL: Math.max(0, S(t * 12)) * 16, mouth: 'pout', fx: 'puff' }) },
  sneaky: { ar: 'يتسلل', loop: false, dur: 2, pose: (t) => ({ sy: 0.92, legL: S(t * 8) * 10, legR: -S(t * 8) * 10, armL: -20, armR: 40, headRot: 10, eyeMode: null, mouth: 'cheeky', rot: -5 }) },
  look_up: { ar: 'يطالع فوق', loop: false, dur: 1.6, pose: () => ({ headRot: -16, headY: -2, look: [0, -1], mouth: 'o' }) },
  look_down: { ar: 'يطالع تحت', loop: false, dur: 1.6, pose: () => ({ headRot: 14, headY: 4, mouth: 'small' }) },
  lean_curious: { ar: 'يقرّب يشوف', loop: false, dur: 1.8, pose: (t) => { const e = env(t / 1.8); return { rot: 9 * e, headRot: -8 * e, eyeMul: 1 + 0.15 * e, mouth: 'o', glasses: true }; } },
  hiccup: { ar: 'فواق', loop: false, dur: 1.6, pose: (t) => { const hit = (t % 0.55) < 0.12; return { y: hit ? -10 : 0, eyeMul: hit ? 1.3 : 1, mouth: hit ? 'o' : 'flat' }; } },
  stargaze: { ar: 'يحلم 🌟', loop: true, dur: 3, pose: (t) => ({ headRot: -14, armL: -116, eyeMode: 'stars', mouth: 'smile', bodyY: S(t * 2) * 1.2 }) },
  meditate: { ar: 'هدوء وتركيز 🧘', loop: true, dur: 4, pose: (t) => ({ eyesClosed: true, armL: 20, armR: 20, sy: 0.98 + S(t * PI2 / 4) * 0.015, mouth: 'smile', legL: 30, legR: -30 }) },
  strong: { ar: 'يرفع أثقال 🏋️', loop: false, dur: 2, pose: (t) => { const u = hop(clamp01(t / 2)); return { armL: 60 + 90 * u, armR: 60 + 90 * u, sy: 1 - 0.04 * u, mouth: 'teeth', fx: u > 0.8 ? 'sweat' : null }; } },
  sweep: { ar: 'ينظّف (يمسح)', loop: false, dur: 1.8, pose: (t) => ({ armL: -40 + S(t * 12) * 30, armR: -40 + S(t * 12) * 30, bodyRot: S(t * 12) * 6, headRot: 10, fx: 'dust' }) },
  jog: { ar: 'يركض في مكانه', loop: true, dur: 0.5, pose: (t) => { const p = (t / 0.5) * PI2; return { legL: S(p) * 26, legR: -S(p) * 26, armL: -S(p) * 26, armR: S(p) * 22, bodyY: -Math.abs(S(p)) * 5 }; } },
  hop3: { ar: 'ثلاث قفزات', loop: false, dur: 1.5, pose: (t) => ({ y: -hop((t % 0.5) / 0.5) * 16, armL: 40, armR: 40, mouth: 'grin' }) },
};
