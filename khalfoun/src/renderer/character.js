// Khalfoun's body: an original vector character drawn in SVG with separate,
// rigged parts (legs, body, two arms, head, face, kumma, cane) so any body
// animation can be mixed with any facial expression.

const SKIN = '#E8B088';
const SKIN_LINE = '#B47B55';
const CLOTH = '#FBFAF6';
const CLOTH_LINE = '#C7C2B6';
const INK = '#2A1A10';
const CANE = '#8A5A2E';
const RED = '#B83A2E';
const GREEN = '#2F7D4F';
const GOLD = '#C99A1E';

const svgNS = 'http://www.w3.org/2000/svg';

function kummaEmbroidery() {
  // Rows of small stitched motifs across the dome, like a hand-embroidered kumma.
  let out = '';
  const rows = [
    { y: -205, half: 40, step: 9, color: RED, shape: 'dot' },
    { y: -213, half: 38, step: 10, color: GREEN, shape: 'diamond' },
    { y: -221, half: 33, step: 9, color: GOLD, shape: 'dot' },
    { y: -228, half: 25, step: 10, color: RED, shape: 'diamond' },
  ];
  for (const r of rows) {
    for (let x = -r.half; x <= r.half + 0.1; x += r.step) {
      if (r.shape === 'dot') out += `<circle cx="${x.toFixed(1)}" cy="${r.y}" r="1.7" fill="${r.color}"/>`;
      else out += `<path d="M${x.toFixed(1)} ${r.y - 3}l3 3l-3 3l-3 -3z" fill="${r.color}"/>`;
    }
  }
  // Rosette on top
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    out += `<circle cx="${(Math.cos(a) * 5).toFixed(2)}" cy="${(-235 + Math.sin(a) * 2.2).toFixed(2)}" r="1.4" fill="${GREEN}"/>`;
  }
  out += `<circle cx="0" cy="-235" r="1.8" fill="${RED}"/>`;
  return out;
}

const MOUTHS = {
  smile: 'M-12 -146 Q0 -137 12 -146',
  grin: 'M-15 -148 Q0 -147 15 -148 Q12 -131 0 -130 Q-12 -131 -15 -148 Z',
  flat: 'M-9 -144 L9 -144',
  small: 'M-6 -145 Q0 -141 6 -145',
  frown: 'M-11 -139 Q0 -147 11 -139',
  o: 'M0 -150 a6 7 0 1 0 0.01 0 Z',
  bigO: 'M0 -153 a9 11 0 1 0 0.01 0 Z',
  wavy: 'M-13 -143 q3.25 -4 6.5 0 t6.5 0 t6.5 0 t6.5 0',
  smirk: 'M-10 -144 Q2 -141 13 -149',
  pout: 'M-6 -142 Q0 -147 6 -142',
};

const FILLED_MOUTHS = new Set(['grin', 'o', 'bigO']);

/** Face settings per emotion. brow: [leftRot, rightRot, lift]; eye: openness; look: [x,y]. */
export const FACES = {
  calm: { brow: [0, 0, 0], eye: 1, mouth: 'smile', blush: 0.25 },
  happy: { brow: [-4, 4, -3], eye: 1, mouth: 'grin', blush: 0.5, happyEyesAt: 3 },
  proud: { brow: [-10, 10, -2], eye: 0.7, mouth: 'smirk', blush: 0.3 },
  excited: { brow: [-6, 6, -5], eye: 1.15, pupil: 1.2, mouth: 'grin', blush: 0.6, fx: 'sparkles' },
  amazed: { brow: [-8, 8, -9], eye: 1.25, pupil: 0.75, mouth: 'bigO', blush: 0.2, fx: 'exclaim' },
  curious: { brow: [-12, 2, -3], eye: 1.05, mouth: 'small', blush: 0.25, tilt: 8 },
  focused: { brow: [14, -14, 2], eye: 0.75, mouth: 'flat', blush: 0.1 },
  confused: { brow: [-14, 10, -2], eye: 1, mouth: 'wavy', blush: 0.2, tilt: -10, fx: 'question' },
  shy: { brow: [-6, 6, -2], eye: 0.85, mouth: 'small', blush: 1, look: [0.8, 0.7], tilt: 6 },
  grateful: { brow: [-6, 6, -3], eye: 1, mouth: 'smile', blush: 0.6, happyEyesAt: 1, fx: 'hearts' },
  longing: { brow: [-16, 16, -4], eye: 1.15, pupil: 1.25, mouth: 'small', blush: 0.5, fx: 'hearts' },
  sad: { brow: [-18, 18, -1], eye: 0.85, mouth: 'frown', blush: 0.1, look: [0, 0.7], tearAt: 2 },
  sulky: { brow: [16, -16, 3], eye: 0.8, mouth: 'pout', blush: 0.7, look: [-0.9, 0], tilt: -6 },
  jealous: { brow: [12, -12, 2], eye: 0.6, mouth: 'flat', blush: 0.3, look: [1, 0] },
  scared: { brow: [-16, 16, -8], eye: 1.25, pupil: 0.6, mouth: 'wavy', blush: 0, fx: 'sweat' },
  bored: { brow: [4, -4, 2], eye: 0.5, mouth: 'flat', blush: 0.1, look: [-0.5, 0.3] },
  sleepy: { brow: [4, -4, 3], eye: 0.06, mouth: 'o', blush: 0.2, fx: 'zzz' },
};

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Builds the character inside a container element.
 * @param {HTMLElement} container
 */
export function createCharacter(container) {
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '-110 -258 220 270');
  svg.setAttribute('class', 'khalfoun-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'خلفون');
  svg.innerHTML = `
  <defs>
    <radialGradient id="kf-face" cx="45%" cy="40%" r="65%">
      <stop offset="0%" stop-color="#F2C29C"/><stop offset="100%" stop-color="${SKIN}"/>
    </radialGradient>
  </defs>
  <ellipse data-part="shadow" cx="0" cy="2" rx="42" ry="7" fill="rgba(0,0,0,0.20)"/>
  <g data-part="root">
    <g data-part="legL">
      <rect x="-21" y="-36" width="13" height="28" rx="5" fill="${SKIN}" stroke="${SKIN_LINE}" stroke-width="1.5"/>
      <path d="M-30 -4 Q-30 -12 -14 -12 Q2 -12 2 -4 Q2 1 -14 1 Q-30 1 -30 -4 Z" fill="#6E4325" stroke="#4A2C17" stroke-width="1.5"/>
      <path d="M-22 -10 Q-14 -16 -6 -10" stroke="#4A2C17" stroke-width="2.5" fill="none"/>
    </g>
    <g data-part="legR">
      <rect x="8" y="-36" width="13" height="28" rx="5" fill="${SKIN}" stroke="${SKIN_LINE}" stroke-width="1.5"/>
      <path d="M30 -4 Q30 -12 14 -12 Q-2 -12 -2 -4 Q-2 1 14 1 Q30 1 30 -4 Z" fill="#6E4325" stroke="#4A2C17" stroke-width="1.5"/>
      <path d="M22 -10 Q14 -16 6 -10" stroke="#4A2C17" stroke-width="2.5" fill="none"/>
    </g>
    <g data-part="body">
      <path d="M-30 -119 C-40 -110 -45 -70 -49 -32 Q-50 -18 -36 -17 L36 -17 Q50 -18 49 -32 C45 -70 40 -110 30 -119 Q0 -129 -30 -119 Z" fill="${CLOTH}" stroke="${CLOTH_LINE}" stroke-width="2"/>
      <path d="M-47 -30 Q0 -24 47 -30 L46 -22 Q0 -16 -46 -22 Z" fill="#EEEBE3"/>
      <path d="M-9 -121 L0 -108 L9 -121" fill="none" stroke="${CLOTH_LINE}" stroke-width="2"/>
      <path d="M-14 -118 Q-8 -112 -6 -104 M14 -118 Q8 -112 6 -104" fill="none" stroke="${GOLD}" stroke-width="1.2" opacity="0.8"/>
      <g data-part="tassel">
        <path d="M0 -108 L0 -86" stroke="${CLOTH_LINE}" stroke-width="2"/>
        <ellipse cx="0" cy="-80" rx="3.4" ry="7" fill="#E7DCC4" stroke="${CLOTH_LINE}" stroke-width="1.2"/>
      </g>
    </g>
    <g data-part="head">
      <rect x="-9" y="-134" width="18" height="16" rx="4" fill="${SKIN}" stroke="${SKIN_LINE}" stroke-width="1.5"/>
      <circle cx="-49" cy="-167" r="9.5" fill="${SKIN}" stroke="${SKIN_LINE}" stroke-width="1.8"/>
      <circle cx="49" cy="-167" r="9.5" fill="${SKIN}" stroke="${SKIN_LINE}" stroke-width="1.8"/>
      <path d="M-51 -171 Q-46 -167 -50 -162 M51 -171 Q46 -167 50 -162" stroke="${SKIN_LINE}" stroke-width="1.5" fill="none"/>
      <circle cx="0" cy="-169" r="50" fill="url(#kf-face)" stroke="${SKIN_LINE}" stroke-width="2"/>
      <path d="M-46 -184 Q-48 -176 -44 -168 M46 -184 Q48 -176 44 -168" stroke="#3A2416" stroke-width="3" fill="none" stroke-linecap="round"/>
      <ellipse data-part="blushL" cx="-31" cy="-150" rx="8.5" ry="5" fill="#EE7F72"/>
      <ellipse data-part="blushR" cx="31" cy="-150" rx="8.5" ry="5" fill="#EE7F72"/>
      <g data-part="eyeL">
        <ellipse cx="-18" cy="-170" rx="12" ry="14.5" fill="#FFFFFF" stroke="${SKIN_LINE}" stroke-width="1.2"/>
        <g data-part="pupilL"><circle cx="-18" cy="-169" r="7" fill="${INK}"/><circle cx="-15.5" cy="-172" r="2.5" fill="#FFFFFF"/></g>
      </g>
      <g data-part="eyeR">
        <ellipse cx="18" cy="-170" rx="12" ry="14.5" fill="#FFFFFF" stroke="${SKIN_LINE}" stroke-width="1.2"/>
        <g data-part="pupilR"><circle cx="18" cy="-169" r="7" fill="${INK}"/><circle cx="20.5" cy="-172" r="2.5" fill="#FFFFFF"/></g>
      </g>
      <g data-part="happyEyes" opacity="0">
        <path d="M-28 -168 Q-18 -181 -8 -168" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path d="M8 -168 Q18 -181 28 -168" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>
      </g>
      <path data-part="browL" d="M-29 -189 Q-19 -195 -8 -190" stroke="#3A2416" stroke-width="4.5" fill="none" stroke-linecap="round"/>
      <path data-part="browR" d="M8 -190 Q19 -195 29 -189" stroke="#3A2416" stroke-width="4.5" fill="none" stroke-linecap="round"/>
      <path d="M-1 -161 Q2 -155 5 -158" stroke="${SKIN_LINE}" stroke-width="2" fill="none" stroke-linecap="round"/>
      <path data-part="mouth" d="${MOUTHS.smile}" stroke="#7A2E1F" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path data-part="tear" d="M-24 -158 q-4 7 0 10 q4 -3 0 -10 Z" fill="#7EC8F2" opacity="0"/>
      <g data-part="kumma">
        <path d="M-47 -199 Q-45 -240 0 -242 Q45 -240 47 -199 Q0 -211 -47 -199 Z" fill="#FDFCF7" stroke="${CLOTH_LINE}" stroke-width="2"/>
        ${kummaEmbroidery()}
        <path d="M-48 -199 Q0 -212 48 -199 L46 -189 Q0 -201 -46 -189 Z" fill="#F3EFE3" stroke="${CLOTH_LINE}" stroke-width="1.8"/>
        <path d="M-44 -194 Q0 -206 44 -194" stroke="${RED}" stroke-width="1.4" fill="none" stroke-dasharray="3 3"/>
      </g>
      <path data-part="sweat" d="M38 -186 q-6 9 0 14 q6 -5 0 -14 Z" fill="#9AD6F7" stroke="#5FA8D3" stroke-width="1" opacity="0"/>
    </g>
    <g data-part="arms">
  <g data-part="armL">
    <path d="M-24 -117 Q-46 -110 -50 -76 Q-51 -64 -41 -64 Q-34 -65 -34 -76 Q-32 -100 -20 -108 Z" fill="${CLOTH}" stroke="${CLOTH_LINE}" stroke-width="2"/>
    <circle cx="-43" cy="-61" r="8.5" fill="${SKIN}" stroke="${SKIN_LINE}" stroke-width="1.5"/>
    <g data-part="cup" opacity="0">
      <path d="M-52 -74 L-34 -74 L-37 -62 Q-43 -58 -49 -62 Z" fill="#FFFFFF" stroke="${GOLD}" stroke-width="1.5"/>
      <path d="M-51 -71 L-35 -71" stroke="${GREEN}" stroke-width="1.5"/>
    </g>
  </g>
  <g data-part="armR">
    <g data-part="cane">
      <path d="M44 -60 L54 -3" stroke="${CANE}" stroke-width="4.5" stroke-linecap="round"/>
      <path d="M44 -60 Q41 -80 30 -77" stroke="${CANE}" stroke-width="4.5" stroke-linecap="round" fill="none"/>
    </g>
    <path d="M24 -117 Q46 -110 50 -76 Q51 -64 41 -64 Q34 -65 34 -76 Q32 -100 20 -108 Z" fill="${CLOTH}" stroke="${CLOTH_LINE}" stroke-width="2"/>
    <circle cx="43" cy="-61" r="8.5" fill="${SKIN}" stroke="${SKIN_LINE}" stroke-width="1.5"/>
  </g>
    </g>
    <g data-part="fx">
      <g data-part="fx-zzz" opacity="0" font-family="sans-serif" font-weight="700" fill="#5B6B8C">
        <text x="40" y="-215" font-size="16">z</text><text x="54" y="-232" font-size="20">z</text><text x="70" y="-250" font-size="24">Z</text>
      </g>
      <text data-part="fx-question" x="52" y="-215" font-size="34" font-weight="800" fill="#E08A00" opacity="0" font-family="sans-serif">?</text>
      <text data-part="fx-exclaim" x="52" y="-215" font-size="34" font-weight="800" fill="#D64541" opacity="0" font-family="sans-serif">!</text>
      <g data-part="fx-sparkles" opacity="0" fill="${GOLD}">
        <path d="M-70 -200 l3 -9 l3 9 l9 3 l-9 3 l-3 9 l-3 -9 l-9 -3 z"/>
        <path d="M66 -186 l2 -6 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 z"/>
        <path d="M58 -236 l2 -7 l2 7 l7 2 l-7 2 l-2 7 l-2 -7 l-7 -2 z"/>
      </g>
      <g data-part="fx-hearts" opacity="0" fill="#E2546B">
        <path d="M60 -212 c-4 -6 -12 -2 -9 4 l9 9 l9 -9 c3 -6 -5 -10 -9 -4 z"/>
        <path d="M-66 -196 c-3 -4 -9 -1 -7 3 l7 7 l7 -7 c2 -4 -4 -7 -7 -3 z"/>
      </g>
      <g data-part="fx-notes" opacity="0" fill="#3B5BA9" font-size="22" font-family="sans-serif">
        <text x="48" y="-205">♪</text><text x="66" y="-228">♫</text>
      </g>
      <g data-part="fx-dust" opacity="0" fill="#CFC8B8">
        <circle cx="-44" cy="-4" r="7"/><circle cx="-56" cy="-10" r="5"/><circle cx="44" cy="-4" r="7"/><circle cx="56" cy="-10" r="5"/>
      </g>
      <g data-part="fx-cast" opacity="0" fill="${GOLD}">
        <circle cx="34" cy="-92" r="3"/><circle cx="22" cy="-104" r="2.2"/><circle cx="44" cy="-108" r="2.6"/>
        <path d="M28 -120 l2 -6 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 z"/>
      </g>
    </g>
  </g>`;
  container.appendChild(svg);

  const part = (name) => svg.querySelector(`[data-part="${name}"]`);
  const P = {};
  for (const n of ['shadow', 'root', 'legL', 'legR', 'body', 'arms', 'armL', 'armR', 'cane', 'cup', 'head', 'eyeL', 'eyeR', 'pupilL', 'pupilR',
    'happyEyes', 'browL', 'browR', 'mouth', 'tear', 'sweat', 'kumma', 'blushL', 'blushR', 'tassel',
    'fx-zzz', 'fx-question', 'fx-exclaim', 'fx-sparkles', 'fx-hearts', 'fx-notes', 'fx-dust', 'fx-cast']) P[n] = part(n);

  const face = { browL: 0, browR: 0, lift: 0, eye: 1, pupil: 1, blush: 0.25, tilt: 0, lookX: 0, lookY: 0 };
  let target = { ...face };
  let mouth = 'smile';
  let emotion = { emotion: 'calm', intensity: 1, secondary: null };
  let look = { x: 0, y: 0, until: 0 };
  let blinkAt = 1.5;
  let blinkT = -1;
  let facing = 1;
  let clock = 0;

  function setEmotion(snap) {
    if (!snap || !FACES[snap.emotion]) return;
    emotion = snap;
    const f = FACES[snap.emotion];
    const k = 0.7 + 0.15 * (snap.intensity || 1);
    target = {
      browL: f.brow[0] * k, browR: f.brow[1] * k, lift: f.brow[2] * k, eye: f.eye, pupil: f.pupil || 1,
      blush: f.blush, tilt: (f.tilt || 0) * k, lookX: f.look ? f.look[0] : 0, lookY: f.look ? f.look[1] : 0,
    };
    mouth = f.mouth;
    if (snap.secondary === 'happy' && f.mouth !== 'grin') mouth = snap.intensity >= 2 ? 'grin' : 'smile';
  }

  /** Eyes follow a point given in [-1,1] coordinates relative to the head. */
  function lookAt(x, y, holdSec = 1.2) {
    look = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), until: clock + holdSec };
  }

  function setFacing(dir) { facing = dir < 0 ? -1 : 1; }

  /**
   * Draws one frame.
   * @param {number} dt seconds since last frame
   * @param {object} pose body pose from the animator
   */
  function render(dt, pose) {
    clock += dt;
    const a = Math.min(1, dt * 10);
    for (const key of Object.keys(face)) face[key] = lerp(face[key], target[key], a);

    // blinking
    if (blinkT < 0 && clock >= blinkAt) blinkT = 0;
    let blink = 1;
    if (blinkT >= 0) {
      blinkT += dt;
      blink = blinkT < 0.07 ? 1 - blinkT / 0.07 : blinkT < 0.14 ? (blinkT - 0.07) / 0.07 : 1;
      blink = Math.max(0.08, blink);
      if (blinkT >= 0.14) { blinkT = -1; blinkAt = clock + 2 + Math.random() * 4; }
    }

    const f = FACES[emotion.emotion] || FACES.calm;
    const happyEyes = (f.happyEyesAt && emotion.intensity >= f.happyEyesAt) || pose.eyesClosed;
    const open = Math.max(0.06, face.eye * blink * (pose.eyeMul ?? 1));
    P.happyEyes.setAttribute('opacity', happyEyes && !pose.eyesClosed ? 1 : 0);
    const eyeVisible = happyEyes ? 0 : 1;
    P.eyeL.setAttribute('opacity', eyeVisible);
    P.eyeR.setAttribute('opacity', eyeVisible);
    P.eyeL.setAttribute('transform', `translate(0 -170) scale(1 ${open.toFixed(3)}) translate(0 170)`);
    P.eyeR.setAttribute('transform', `translate(0 -170) scale(1 ${open.toFixed(3)}) translate(0 170)`);

    const lx = (clock < look.until ? look.x : face.lookX) * 4;
    const ly = (clock < look.until ? look.y : face.lookY) * 4;
    const ps = face.pupil;
    P.pupilL.setAttribute('transform', `translate(${(-18 + lx).toFixed(2)} ${(-169 + ly).toFixed(2)}) scale(${ps.toFixed(3)}) translate(18 169)`);
    P.pupilR.setAttribute('transform', `translate(${(18 + lx).toFixed(2)} ${(-169 + ly).toFixed(2)}) scale(${ps.toFixed(3)}) translate(-18 169)`);

    P.browL.setAttribute('transform', `translate(0 ${face.lift.toFixed(2)}) rotate(${face.browL.toFixed(2)} -18 -191)`);
    P.browR.setAttribute('transform', `translate(0 ${face.lift.toFixed(2)}) rotate(${face.browR.toFixed(2)} 18 -191)`);
    const m = pose.mouth || mouth;
    P.mouth.setAttribute('d', MOUTHS[m] || MOUTHS.smile);
    P.mouth.setAttribute('fill', FILLED_MOUTHS.has(m) ? '#7A2E1F' : 'none');
    P.blushL.setAttribute('opacity', face.blush.toFixed(2));
    P.blushR.setAttribute('opacity', face.blush.toFixed(2));

    const fxName = pose.fx || f.fx;
    for (const n of ['zzz', 'question', 'exclaim', 'sparkles', 'hearts', 'notes', 'dust', 'cast']) {
      const el = P[`fx-${n}`];
      const on = fxName === n || (pose.fx2 === n);
      el.setAttribute('opacity', on ? (0.75 + 0.25 * Math.sin(clock * 6)).toFixed(2) : 0);
      if (on && n === 'zzz') el.setAttribute('transform', `translate(0 ${(-((clock * 8) % 10)).toFixed(1)})`);
      else if (on) el.setAttribute('transform', `translate(0 ${(Math.sin(clock * 3) * 3).toFixed(1)})`);
    }
    P.tear.setAttribute('opacity', f.tearAt && emotion.intensity >= f.tearAt ? 0.9 : 0);
    P.sweat.setAttribute('opacity', fxName === 'sweat' ? 0.95 : 0);
    P.cup.setAttribute('opacity', pose.cup ? 1 : 0);

    // body
    const sx = (pose.sx ?? 1) * facing;
    const sy = pose.sy ?? 1;
    P.root.setAttribute('transform', `translate(${(pose.x || 0).toFixed(2)} ${(pose.y || 0).toFixed(2)}) rotate(${(pose.rot || 0).toFixed(2)}) scale(${sx.toFixed(3)} ${sy.toFixed(3)})`);
    const shadowScale = Math.max(0.4, 1 + (pose.y || 0) / 160);
    P.shadow.setAttribute('transform', `translate(${(pose.x || 0).toFixed(2)} 0) scale(${shadowScale.toFixed(3)} 1)`);
    P.legL.setAttribute('transform', `rotate(${(pose.legL || 0).toFixed(2)} -14 -34)`);
    P.legR.setAttribute('transform', `rotate(${(pose.legR || 0).toFixed(2)} 14 -34)`);
    const bodyT = `rotate(${(pose.bodyRot || 0).toFixed(2)} 0 -20) translate(0 ${(pose.bodyY || 0).toFixed(2)})`;
    P.body.setAttribute('transform', bodyT);
    P.arms.setAttribute('transform', bodyT);
    // Arm angles are mirror-symmetric: positive raises the arm outward and up, negative brings it across the body.
    P.armL.setAttribute('transform', `rotate(${(pose.armL || 0).toFixed(2)} -26 -112)`);
    P.armR.setAttribute('transform', `rotate(${(-(pose.armR || 0)).toFixed(2)} 26 -112)`);
    P.cane.setAttribute('transform', `rotate(${(pose.cane || 0).toFixed(2)} 43 -61)`);
    P.tassel.setAttribute('transform', `rotate(${(pose.tassel || 0).toFixed(2)} 0 -108)`);
    const headRot = (pose.headRot || 0) + face.tilt;
    P.head.setAttribute('transform', `translate(0 ${((pose.headY || 0) + (pose.bodyY || 0)).toFixed(2)}) rotate(${headRot.toFixed(2)} 0 -125)`);
    P.kumma.setAttribute('transform', `translate(0 ${(pose.kummaY || 0).toFixed(2)}) rotate(${(pose.kummaRot || 0).toFixed(2)} 0 -205)`);
  }

  return { el: svg, setEmotion, lookAt, setFacing, render, get emotion() { return emotion; } };
}
