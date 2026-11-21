// Khalfoun's body: an original vector character drawn in SVG with rigged parts
// (legs, robe, two arms, head, eyes with real eyelids, mouth with teeth and
// tongue, kumma, cane, tassel) so any body animation can be mixed with any
// facial expression. Secondary motion (tassel swing, kumma lag) uses springs.

const svgNS = 'http://www.w3.org/2000/svg';
let instances = 0;

// Palette
const C = {
  skin: '#EFB78E', skinLine: '#A86A45', skinShade: '#D99266', cheek: '#F27D6C',
  clothShade: '#E7E2D8', clothLine: '#BDB5A6', clothFold: '#E4DED2',
  ink: '#2C1A10', brow: '#3A2215', lash: '#2C1A10', mouth: '#4A1611', mouthLine: '#5B2216',
  tongue: '#E86F6F', teeth: '#FFFDF8', iris1: '#9A6236', iris2: '#3A1E0C',
  red: '#B5352A', green: '#2D7A4D', gold: '#C8971C', navy: '#2D4A7A',
  wood: '#8C5A2B', woodHi: '#B98149', sandal: '#6A4024', sandalDark: '#43281A',
};

// Face layout
const EYE = { L: -19, R: 19, y: -160, rx: 13, ry: 15.5 };

/**
 * Mouth shapes. filled: drawn as an open mouth (dark inside, teeth, tongue).
 * teeth: height of the upper teeth in px; tongue: show the tongue.
 */
const MOUTHS = {
  smile: { d: 'M-11 -136 Q0 -127 11 -136', filled: false },
  small: { d: 'M-5.5 -134 Q0 -130.5 5.5 -134', filled: false },
  flat: { d: 'M-8 -133 L8 -133', filled: false },
  frown: { d: 'M-10 -129 Q0 -137 10 -129', filled: false },
  wavy: { d: 'M-12 -133 q3 -3 6 0 t6 0 t6 0 t6 0', filled: false },
  smirk: { d: 'M-9 -133.5 Q3 -130.5 12.5 -139', filled: false },
  smirkDown: { d: 'M-10 -132 Q2 -134.5 11 -131', filled: false },
  pout: { d: 'M-5 -131 Q0 -136.5 5 -131', filled: false },
  cat: { d: 'M-10 -135.5 Q-5 -129.5 0 -134 Q5 -129.5 10 -135.5', filled: false },
  grin: { d: 'M-14.5 -138.5 Q0 -136 14.5 -138.5 Q12 -121 0 -120 Q-12 -121 -14.5 -138.5 Z', filled: true, teeth: 4, tongue: true },
  laugh: { d: 'M-16.5 -140 Q0 -137.5 16.5 -140 Q14 -114 0 -113 Q-14 -114 -16.5 -140 Z', filled: true, teeth: 4.5, tongue: true },
  o: { d: 'M0 -139.5 a5.5 6.5 0 1 0 0.01 0 Z', filled: true, teeth: 0, tongue: false },
  bigO: { d: 'M0 -143 a9 11.5 0 1 0 0.01 0 Z', filled: true, teeth: 0, tongue: true },
  teeth: { d: 'M-14 -138.5 Q0 -141.5 14 -138.5 Q15 -126 0 -125 Q-15 -126 -14 -138.5 Z', filled: true, teeth: 14, tongue: false, gritted: true },
  cheeky: { d: 'M-11 -136 Q0 -127 11 -136', filled: false, tongueOut: 'center' },
  concentrate: { d: 'M-8 -133 Q-1 -131.5 6 -133.5', filled: false, tongueOut: 'side' },
};

/**
 * Face settings per emotion.
 * brow [leftRot, rightRot, lift] · lid: upper lid closed 0..1 · tiltLid: degrees, + = inner corners down (angry)
 * low: lower lid raise 0..1 (smiling eyes) · pupil: iris scale · eyes: special eye mode (at intensity eyesAt)
 */
export const FACES = {
  calm: { brow: [0, 0, 0], lid: 0.12, low: 0.12, mouth: 'smile', blush: 0.3 },
  happy: { brow: [-5, 5, -3], lid: 0.04, low: 0.4, mouth: 'grin', blush: 0.55, eyes: 'arc', eyesAt: 3 },
  proud: { brow: [-12, 12, -3], lid: 0.45, low: 0.3, tiltLid: -3, mouth: 'smirk', blush: 0.35, tilt: -5 },
  excited: { brow: [-9, 9, -6], lid: 0, low: 0.2, pupil: 1.12, mouth: 'laugh', blush: 0.75, fx: 'sparkles', eyes: 'stars', eyesAt: 3 },
  amazed: { brow: [-10, 10, -10], lid: 0, low: 0, pupil: 0.68, mouth: 'bigO', blush: 0.2, fx: 'exclaim' },
  curious: { brow: [-16, 1, -4], lid: 0.08, low: 0.1, mouth: 'small', blush: 0.3, tilt: 9, look: [0.55, -0.35] },
  focused: { brow: [14, -14, 3], lid: 0.38, low: 0.15, tiltLid: 9, mouth: 'concentrate', blush: 0.15 },
  confused: { brow: [-17, 12, -2], lid: 0.15, low: 0.05, mouth: 'wavy', blush: 0.25, tilt: -10, fx: 'question', look: [-0.4, -0.55] },
  shy: { brow: [-9, 9, -3], lid: 0.35, low: 0.3, mouth: 'cat', blush: 1, look: [0.85, 0.6], tilt: 8, hatch: true },
  grateful: { brow: [-8, 8, -3], lid: 0.05, low: 0.3, mouth: 'smile', blush: 0.6, eyes: 'arc', eyesAt: 1, fx: 'hearts' },
  longing: { brow: [-19, 19, -5], lid: 0, low: 0.1, pupil: 1.28, mouth: 'small', blush: 0.55, fx: 'hearts', eyes: 'hearts', eyesAt: 3, shine: true },
  sad: { brow: [-21, 21, -2], lid: 0.28, low: 0.05, tiltLid: -12, mouth: 'frown', blush: 0.1, look: [0, 0.7], tearAt: 2, streamAt: 3 },
  sulky: { brow: [18, -18, 4], lid: 0.42, low: 0.1, tiltLid: 12, mouth: 'pout', blush: 0.65, look: [-0.9, 0], tilt: -6, fx: 'puff' },
  jealous: { brow: [14, -14, 3], lid: 0.55, low: 0.1, tiltLid: 6, mouth: 'smirkDown', blush: 0.3, look: [1, 0] },
  scared: { brow: [-18, 18, -9], lid: 0, low: 0, pupil: 0.55, mouth: 'teeth', blush: 0, fx: 'sweat', pale: 1 },
  bored: { brow: [6, -6, 3], lid: 0.6, low: 0.05, mouth: 'flat', blush: 0.1, look: [-0.5, 0.2] },
  sleepy: { brow: [4, -4, 3], lid: 1, low: 0.15, mouth: 'o', blush: 0.25, fx: 'zzz' },
};

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const f2 = (n) => (Math.round(n * 100) / 100).toString();

/** Motifs placed on curved bands around the kumma so the pattern wraps the dome. */
function kummaEmbroidery() {
  let out = '';
  const band = (y0, half, n, draw) => {
    for (let i = 0; i < n; i += 1) {
      const t = -1 + (2 * i) / (n - 1);
      const x = half * Math.sin((t * Math.PI) / 2); // foreshortened toward the sides
      const y = y0 - 7 * (1 - (x / half) ** 2); // follows the curve of the brim
      const s = 0.55 + 0.45 * Math.cos((t * Math.PI) / 2); // smaller near the edges
      out += draw(x, y, s);
    }
  };
  // zigzag band just above the brim
  band(-201, 46, 15, (x, y, s) => `<path d="M${f2(x - 3.2 * s)} ${f2(y + 2 * s)}l${f2(3.2 * s)} ${f2(-4.4 * s)}l${f2(3.2 * s)} ${f2(4.4 * s)}" fill="none" stroke="${C.red}" stroke-width="${f2(1.5 * s)}" stroke-linejoin="round"/>`);
  // diamonds
  band(-211, 43, 12, (x, y, s) => `<path d="M${f2(x)} ${f2(y - 3.6 * s)}l${f2(3 * s)} ${f2(3.6 * s)}l${f2(-3 * s)} ${f2(3.6 * s)}l${f2(-3 * s)} ${f2(-3.6 * s)}z" fill="${C.green}"/><circle cx="${f2(x)}" cy="${f2(y)}" r="${f2(0.9 * s)}" fill="${C.gold}"/>`);
  // dotted line
  band(-219, 38, 19, (x, y, s) => `<circle cx="${f2(x)}" cy="${f2(y)}" r="${f2(1.1 * s)}" fill="${C.gold}"/>`);
  // small flowers
  band(-227, 30, 8, (x, y, s) => {
    let p = '';
    for (let k = 0; k < 4; k += 1) {
      const a = (k * Math.PI) / 2;
      p += `<circle cx="${f2(x + Math.cos(a) * 2.2 * s)}" cy="${f2(y + Math.sin(a) * 2.2 * s)}" r="${f2(1.3 * s)}" fill="${C.red}"/>`;
    }
    return `${p}<circle cx="${f2(x)}" cy="${f2(y)}" r="${f2(1 * s)}" fill="${C.gold}"/>`;
  });
  // rosette on top
  let rosette = '';
  for (let k = 0; k < 8; k += 1) {
    const a = (k * Math.PI) / 4;
    const x = Math.cos(a) * 5;
    const y = -240 + Math.sin(a) * 1.9;
    rosette += `<ellipse cx="${f2(x)}" cy="${f2(y)}" rx="2.4" ry="1.2" transform="rotate(${f2((a * 180) / Math.PI)} ${f2(x)} ${f2(y)})" fill="${k % 2 ? C.green : C.navy}"/>`;
  }
  return `${out}${rosette}<circle cx="0" cy="-240" r="2.1" fill="${C.red}"/>`;
}

function star(cx, cy, r) {
  let d = '';
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    d += `${i ? 'L' : 'M'}${f2(cx + Math.cos(a) * rr)} ${f2(cy + Math.sin(a) * rr)}`;
  }
  return `${d}Z`;
}

function heart(cx, cy, s) {
  return `M${f2(cx)} ${f2(cy + 4 * s)} C${f2(cx - 7 * s)} ${f2(cy - 1 * s)} ${f2(cx - 4.5 * s)} ${f2(cy - 7 * s)} ${f2(cx)} ${f2(cy - 3.5 * s)} C${f2(cx + 4.5 * s)} ${f2(cy - 7 * s)} ${f2(cx + 7 * s)} ${f2(cy - 1 * s)} ${f2(cx)} ${f2(cy + 4 * s)} Z`;
}

function spiral(cx, cy) {
  let d = `M${cx} ${cy}`;
  for (let a = 0; a < Math.PI * 5; a += 0.35) {
    const r = 1 + a * 0.75;
    d += ` L${f2(cx + Math.cos(a) * r)} ${f2(cy + Math.sin(a) * r)}`;
  }
  return d;
}

function eyeMarkup(uid, side) {
  const cx = EYE[side];
  const { y: cy, rx, ry } = EYE;
  return `
    <g data-part="eye${side}">
      <clipPath id="${uid}-clip${side}"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/></clipPath>
      <g clip-path="url(#${uid}-clip${side})">
        <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${uid}-eyewhite)"/>
        <g data-part="iris${side}">
          <circle cx="${cx}" cy="${cy + 1}" r="9.6" fill="url(#${uid}-iris)"/>
          <circle cx="${cx}" cy="${cy + 1}" r="9.6" fill="none" stroke="#24120A" stroke-width="1"/>
          <circle cx="${cx}" cy="${cy + 1}" r="4.9" fill="#140904"/>
          <circle data-part="shine${side}" cx="${cx + 3.6}" cy="${cy - 3.2}" r="3.5" fill="#FFFFFF"/>
          <circle cx="${cx - 3.2}" cy="${cy + 4.6}" r="1.6" fill="#FFFFFF" opacity="0.85"/>
        </g>
        <g data-part="stars${side}" opacity="0"><path d="${star(cx, cy, 10)}" fill="#FFC93C" stroke="#C88A00" stroke-width="1.2"/><circle cx="${cx + 3}" cy="${cy - 3}" r="1.8" fill="#fff"/></g>
        <g data-part="hearts${side}" opacity="0"><path d="${heart(cx, cy, 1.45)}" fill="#E8476A" stroke="#A82245" stroke-width="1"/><circle cx="${cx - 3}" cy="${cy - 3}" r="1.6" fill="#fff"/></g>
        <path data-part="spiral${side}" d="${spiral(cx, cy)}" fill="none" stroke="${C.ink}" stroke-width="1.8" opacity="0"/>
        <path d="M${cx - rx} ${cy} A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}" fill="none" stroke="${C.lash}" stroke-width="5"/>
        <g data-part="lids${side}">
          <path data-part="lowLid${side}" fill="url(#${uid}-skin)"/>
          <path data-part="lowEdge${side}" fill="none" stroke="${C.skinShade}" stroke-width="1.6"/>
          <path data-part="upLid${side}" fill="url(#${uid}-skin)"/>
          <path data-part="upEdge${side}" fill="none" stroke="${C.lash}" stroke-width="3.4" stroke-linecap="round"/>
        </g>
      </g>
      <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#4A2A18" stroke-width="1.5"/>
      <path d="M${side === 'L' ? cx - rx + 1 : cx + rx - 1} ${cy - 7} l${side === 'L' ? -4 : 4} -3.5" stroke="${C.lash}" stroke-width="2.4" stroke-linecap="round"/>
    </g>`;
}

/**
 * Builds the character inside a container element.
 * @param {HTMLElement} container
 */
export function createCharacter(container) {
  instances += 1;
  const uid = `kf${instances}`;
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '-110 -258 220 270');
  svg.setAttribute('class', 'khalfoun-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'خلفون');
  svg.innerHTML = `
  <defs>
    <radialGradient id="${uid}-skin" gradientUnits="userSpaceOnUse" cx="-12" cy="-172" r="72">
      <stop offset="0" stop-color="#F8CDA8"/><stop offset="0.62" stop-color="${C.skin}"/><stop offset="1" stop-color="${C.skinShade}"/>
    </radialGradient>
    <linearGradient id="${uid}-hand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#F6C7A0"/><stop offset="1" stop-color="${C.skinShade}"/>
    </linearGradient>
    <linearGradient id="${uid}-cloth" gradientUnits="userSpaceOnUse" x1="-50" y1="0" x2="50" y2="0">
      <stop offset="0" stop-color="#EEEAE2"/><stop offset="0.22" stop-color="#FFFFFF"/><stop offset="0.6" stop-color="#FBFAF6"/><stop offset="1" stop-color="${C.clothShade}"/>
    </linearGradient>
    <linearGradient id="${uid}-sleeve" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#ECE7DE"/>
    </linearGradient>
    <radialGradient id="${uid}-kumma" gradientUnits="userSpaceOnUse" cx="-14" cy="-236" r="64">
      <stop offset="0" stop-color="#FFFFFF"/><stop offset="0.7" stop-color="#FAF6EA"/><stop offset="1" stop-color="#E5DCC6"/>
    </radialGradient>
    <radialGradient id="${uid}-iris" cx="0.45" cy="0.4" r="0.6">
      <stop offset="0" stop-color="${C.iris1}"/><stop offset="1" stop-color="${C.iris2}"/>
    </radialGradient>
    <linearGradient id="${uid}-eyewhite" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#E3DCD6"/><stop offset="0.35" stop-color="#FFFFFF"/>
    </linearGradient>
    <radialGradient id="${uid}-blush">
      <stop offset="0" stop-color="${C.cheek}" stop-opacity="0.85"/><stop offset="1" stop-color="${C.cheek}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${uid}-shadow">
      <stop offset="0" stop-color="#000" stop-opacity="0.28"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${uid}-pale" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7FA6D9" stop-opacity="0.55"/><stop offset="1" stop-color="#7FA6D9" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="${uid}-face"><path d="M-50 -192 C-56 -164 -52 -136 -36 -124 C-24 -115 24 -115 36 -124 C52 -136 56 -164 50 -192 C40 -214 -40 -214 -50 -192 Z"/></clipPath>
    <clipPath id="${uid}-dome"><path d="M-52 -194 C-54 -236 -30 -249 0 -249 C30 -249 54 -236 52 -194 Q0 -210 -52 -194 Z"/></clipPath>
    <clipPath id="${uid}-mouthclip"><path data-part="mouthClip" d="${MOUTHS.grin.d}"/></clipPath>
  </defs>

  <ellipse data-part="shadow" cx="0" cy="2" rx="48" ry="8.5" fill="url(#${uid}-shadow)"/>
  <g data-part="root">
    <g data-part="legL">
      <path d="M-21 -36 L-8 -36 L-8 -9 L-21 -9 Z" fill="url(#${uid}-hand)" stroke="${C.skinLine}" stroke-width="1.3"/>
      <path d="M-31 -3.5 Q-31 -12 -14 -12 Q3 -12 3 -3.5 Q3 1.5 -14 1.5 Q-31 1.5 -31 -3.5 Z" fill="${C.sandal}" stroke="${C.sandalDark}" stroke-width="1.5"/>
      <path d="M-29 -2 Q-14 1 1 -2" stroke="${C.sandalDark}" stroke-width="1.2" fill="none" opacity="0.6"/>
      <path d="M-23 -9.5 Q-14 -15.5 -5 -9.5" stroke="${C.sandalDark}" stroke-width="3.2" fill="none" stroke-linecap="round"/>
      <path d="M-15 -12.5 L-15 -9" stroke="${C.gold}" stroke-width="1.6"/>
    </g>
    <g data-part="legR">
      <path d="M8 -36 L21 -36 L21 -9 L8 -9 Z" fill="url(#${uid}-hand)" stroke="${C.skinLine}" stroke-width="1.3"/>
      <path d="M31 -3.5 Q31 -12 14 -12 Q-3 -12 -3 -3.5 Q-3 1.5 14 1.5 Q31 1.5 31 -3.5 Z" fill="${C.sandal}" stroke="${C.sandalDark}" stroke-width="1.5"/>
      <path d="M29 -2 Q14 1 -1 -2" stroke="${C.sandalDark}" stroke-width="1.2" fill="none" opacity="0.6"/>
      <path d="M23 -9.5 Q14 -15.5 5 -9.5" stroke="${C.sandalDark}" stroke-width="3.2" fill="none" stroke-linecap="round"/>
      <path d="M15 -12.5 L15 -9" stroke="${C.gold}" stroke-width="1.6"/>
    </g>
    <g data-part="body">
      <path data-part="robe" d="M-28 -121 C-38 -114 -44 -80 -49 -34 Q-50 -19 -37 -17 L37 -17 Q50 -19 49 -34 C44 -80 38 -114 28 -121 Q0 -128 -28 -121 Z" fill="url(#${uid}-cloth)" stroke="${C.clothLine}" stroke-width="2"/>
      <g data-part="folds" fill="none" stroke="${C.clothFold}" stroke-width="2" stroke-linecap="round">
        <path d="M-22 -78 Q-26 -50 -31 -20"/><path d="M-9 -62 Q-10 -42 -12 -19"/>
        <path d="M10 -84 Q14 -52 16 -19"/><path d="M27 -66 Q32 -42 38 -19"/>
      </g>
      <path d="M-48 -30 Q0 -23 48 -30 L47 -21 Q0 -15 -47 -21 Z" fill="#EFEBE3" opacity="0.9"/>
      <g data-part="bisht" opacity="0">
        <path d="M-29 -121 C-41 -112 -47 -75 -51 -30 Q-52 -19 -40 -17 L-23 -17 C-21 -60 -19 -95 -12 -120 Z" fill="#4B2E1E" stroke="#2E1B11" stroke-width="1.5"/>
        <path d="M29 -121 C41 -112 47 -75 51 -30 Q52 -19 40 -17 L23 -17 C21 -60 19 -95 12 -120 Z" fill="#4B2E1E" stroke="#2E1B11" stroke-width="1.5"/>
        <path d="M-12 -120 C-19 -95 -21 -60 -23 -17 M12 -120 C19 -95 21 -60 23 -17" fill="none" stroke="#D9A82B" stroke-width="3"/>
        <path d="M-15 -118 Q-22 -116 -26 -108 M15 -118 Q22 -116 26 -108" fill="none" stroke="#D9A82B" stroke-width="2" stroke-dasharray="2 1.6"/>
      </g>
      <path d="M-47 -24 Q0 -18 47 -24" fill="none" stroke="${C.gold}" stroke-width="1" stroke-dasharray="2 2.5" opacity="0.7"/>
      <ellipse cx="0" cy="-117" rx="19" ry="6" fill="#A08060" opacity="0.18"/>
      <path d="M-12 -122 Q0 -110 12 -122" fill="none" stroke="#CDBF9A" stroke-width="1.8"/>
      <path d="M-10 -119 Q0 -108.5 10 -119" fill="none" stroke="${C.gold}" stroke-width="1" stroke-dasharray="1.6 2"/>
      <path d="M0 -111 L0 -92" stroke="${C.gold}" stroke-width="1.1" stroke-dasharray="1.6 2.2"/>
      <g data-part="tassel">
        <path d="M6 -115 Q11 -104 9 -92" fill="none" stroke="#D8CCAE" stroke-width="1.8"/>
        <ellipse cx="9" cy="-90" rx="2.6" ry="2" fill="${C.gold}"/>
        <path d="M5.6 -88.5 Q4 -79 6 -73 Q9 -71 12 -73 Q14 -79 12.4 -88.5 Z" fill="#F1E8D2" stroke="#BFAF88" stroke-width="1"/>
        <path d="M7.5 -86 L7 -74 M9 -86 L9 -73 M10.5 -86 L11 -74" stroke="#CDBE98" stroke-width="0.7"/>
      </g>
    </g>
    <g data-part="head">
      <path d="M-10 -134 L10 -134 L10 -116 Q0 -112 -10 -116 Z" fill="url(#${uid}-hand)" stroke="${C.skinLine}" stroke-width="1.3"/>
      <g data-part="ears">
        <ellipse cx="-52" cy="-160" rx="9" ry="12" fill="url(#${uid}-skin)" stroke="${C.skinLine}" stroke-width="1.8"/>
        <path d="M-54 -166 Q-49 -161 -53 -154" stroke="${C.skinLine}" stroke-width="1.5" fill="none"/>
        <ellipse cx="52" cy="-160" rx="9" ry="12" fill="url(#${uid}-skin)" stroke="${C.skinLine}" stroke-width="1.8"/>
        <path d="M54 -166 Q49 -161 53 -154" stroke="${C.skinLine}" stroke-width="1.5" fill="none"/>
      </g>
      <path d="M-50 -192 C-56 -164 -52 -136 -36 -124 C-24 -115 24 -115 36 -124 C52 -136 56 -164 50 -192 C40 -214 -40 -214 -50 -192 Z" fill="url(#${uid}-skin)" stroke="${C.skinLine}" stroke-width="2"/>
      <g clip-path="url(#${uid}-face)">
        <path d="M-58 -150 C-54 -128 -36 -114 0 -114 C36 -114 54 -128 58 -150 C52 -126 36 -118 0 -118 C-36 -118 -52 -126 -58 -150 Z" fill="${C.skinShade}" opacity="0.45"/>
        <rect data-part="pale" x="-60" y="-200" width="120" height="50" fill="url(#${uid}-pale)" opacity="0"/>
      </g>
      <path d="M-50 -193 Q-52 -183 -48 -172 Q-46 -181 -44 -190 Z M50 -193 Q52 -183 48 -172 Q46 -181 44 -190 Z" fill="#2E1B10"/>
      <g data-part="blush">
        <ellipse cx="-34" cy="-141" rx="11" ry="6.5" fill="url(#${uid}-blush)"/>
        <ellipse cx="34" cy="-141" rx="11" ry="6.5" fill="url(#${uid}-blush)"/>
      </g>
      <g data-part="hatch" stroke="#D9534A" stroke-width="1.3" stroke-linecap="round" opacity="0">
        <path d="M-40 -139 l3 -5 M-35 -139 l3 -5 M-30 -139 l3 -5 M28 -139 l3 -5 M33 -139 l3 -5 M38 -139 l3 -5"/>
      </g>
      ${eyeMarkup(uid, 'L')}
      ${eyeMarkup(uid, 'R')}
      <g data-part="arcEyes" opacity="0" fill="none" stroke="${C.lash}" stroke-width="4.2" stroke-linecap="round">
        <path d="M-30 -158 Q-19 -172 -8 -158"/><path d="M8 -158 Q19 -172 30 -158"/>
      </g>
      <g data-part="xEyes" opacity="0" fill="none" stroke="${C.lash}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M-28 -168 L-12 -160 L-28 -152"/><path d="M28 -168 L12 -160 L28 -152"/>
      </g>
      <path data-part="browL" d="M-6 -177 C-13 -185 -25 -187 -33 -180 C-25 -182.5 -14 -181.5 -6 -174.5 Z" fill="${C.brow}"/>
      <path data-part="browR" d="M6 -177 C13 -185 25 -187 33 -180 C25 -182.5 14 -181.5 6 -174.5 Z" fill="${C.brow}"/>
      <ellipse cx="0" cy="-146.5" rx="4.6" ry="3.4" fill="#E09A70"/>
      <ellipse cx="-1.4" cy="-147.8" rx="1.6" ry="1" fill="#FFFFFF" opacity="0.6"/>
      <g data-part="mouth">
        <path data-part="mouthFill" fill="${C.mouth}"/>
        <g clip-path="url(#${uid}-mouthclip)">
          <rect data-part="teeth" x="-20" y="-145" width="40" height="0" fill="${C.teeth}"/>
          <path data-part="grit" d="M-7 -139 V-125 M0 -140 V-125 M7 -139 V-125 M-15 -132 H15" stroke="#C9C0B4" stroke-width="1" opacity="0"/>
          <ellipse data-part="tongue" cx="0" cy="-119" rx="9" ry="6" fill="${C.tongue}"/>
        </g>
        <path data-part="mouthLine" fill="none" stroke="${C.mouthLine}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
        <path data-part="tongueOut" d="M-4.5 -133 Q-5 -124 0 -123.5 Q5 -124 4.5 -133 Z" fill="${C.tongue}" stroke="${C.mouthLine}" stroke-width="1.4" opacity="0"/>
      </g>
      <g data-part="tears" opacity="0">
        <path d="M-27 -147 q-4.5 7.5 0 11 q4.5 -3.5 0 -11 Z" fill="#8FD0F5" stroke="#4F9ACB" stroke-width="0.9"/>
        <path d="M27 -147 q-4.5 7.5 0 11 q4.5 -3.5 0 -11 Z" fill="#8FD0F5" stroke="#4F9ACB" stroke-width="0.9"/>
      </g>
      <g data-part="streams" opacity="0" fill="none" stroke="#8FD0F5" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="6 5">
        <path d="M-24 -146 Q-27 -132 -24 -118"/><path d="M24 -146 Q27 -132 24 -118"/>
      </g>
      <path data-part="sweat" d="M41 -183 q-6.5 10 0 15 q6.5 -5 0 -15 Z" fill="#A6DCF7" stroke="#5FA8D3" stroke-width="1" opacity="0"/>
      <g data-part="glasses" opacity="0" fill="none" stroke="${C.gold}" stroke-width="2">
        <circle cx="-19" cy="-160" r="15.5" fill="#FFFFFF" fill-opacity="0.12"/>
        <circle cx="19" cy="-160" r="15.5" fill="#FFFFFF" fill-opacity="0.12"/>
        <path d="M-3.5 -162 Q0 -166 3.5 -162 M-34.5 -162 L-50 -166 M34.5 -162 L50 -166"/>
        <path d="M-27 -170 l6 -3 M11 -170 l6 -3" stroke="#FFFFFF" stroke-width="1.6" opacity="0.8"/>
      </g>
      <g data-part="kumma">
        <path d="M-52 -194 C-54 -236 -30 -249 0 -249 C30 -249 54 -236 52 -194 Q0 -210 -52 -194 Z" fill="url(#${uid}-kumma)" stroke="${C.clothLine}" stroke-width="2"/>
        <g clip-path="url(#${uid}-dome)">${kummaEmbroidery()}
          <ellipse cx="-20" cy="-236" rx="16" ry="6" fill="#FFFFFF" opacity="0.55"/>
        </g>
        <path d="M-53.5 -194 Q0 -210.5 53.5 -194 L52 -183.5 Q0 -198.5 -52 -183.5 Z" fill="#F3EEE1" stroke="${C.clothLine}" stroke-width="1.8"/>
        <path d="M-50 -189 Q0 -204 50 -189" stroke="${C.red}" stroke-width="1.3" fill="none" stroke-dasharray="3 2.4"/>
        <path d="M-52 -185 Q0 -200 52 -185" stroke="#D9CFB6" stroke-width="1" fill="none"/>
      </g>
    </g>
    <g data-part="arms">
      <g data-part="armL">
        <path data-part="sleeveL" d="M-24 -119 C-40 -114 -48 -98 -50 -76 L-52 -68 Q-44 -63.5 -35 -66.5 L-34 -76 C-33 -96 -27 -106 -20 -110 Z" fill="url(#${uid}-sleeve)" stroke="${C.clothLine}" stroke-width="2"/>
        <path d="M-51.5 -71 Q-44 -66.5 -35.5 -69.5" fill="none" stroke="${C.clothLine}" stroke-width="1.3"/>
        <g data-part="pen" opacity="0">
          <rect x="-48.5" y="-72" width="9.5" height="9" rx="2.6" fill="#0E2F4F"/>
          <rect data-part="penBody" x="-48.5" y="-64" width="9.5" height="30" rx="3" fill="#1D70B8" stroke="#0E2F4F" stroke-width="1.2"/>
          <rect x="-46.6" y="-60" width="2.2" height="20" rx="1.1" fill="#FFFFFF" opacity="0.45"/>
          <path d="M-47.5 -34.5 L-40 -34.5 L-43.75 -26 Z" fill="#F3EEE1" stroke="#0E2F4F" stroke-width="1.1" stroke-linejoin="round"/>
          <path data-part="penTip" d="M-45.2 -29.2 L-42.3 -29.2 L-43.75 -25.5 Z" fill="#1D70B8"/>
        </g>
        <path d="M-50.5 -66 C-54 -59 -51 -51 -43.5 -50.5 C-36 -50.5 -33 -57 -35.5 -65 Z" fill="url(#${uid}-hand)" stroke="${C.skinLine}" stroke-width="1.5"/>
        <path d="M-36.5 -63 Q-31 -62 -32 -56.5 Q-34 -55 -36 -57" fill="url(#${uid}-hand)" stroke="${C.skinLine}" stroke-width="1.3"/>
        <g data-part="flag" opacity="0">
          <path d="M-44 -54 L-44 -132" stroke="${C.wood}" stroke-width="2.6" stroke-linecap="round"/>
          <circle cx="-44" cy="-133" r="2.4" fill="${C.gold}"/>
          <g data-part="flagCloth">
            <rect x="-55" y="-130" width="11" height="27" fill="#C8102E"/>
            <rect x="-86" y="-130" width="31" height="9" fill="#FFFFFF"/>
            <rect x="-86" y="-121" width="31" height="9" fill="#C8102E"/>
            <rect x="-86" y="-112" width="31" height="9" fill="#008000"/>
            <path d="M-52.5 -126 l3 3 M-46.5 -126 l-3 3 M-49.5 -127.5 v5" stroke="#FFFFFF" stroke-width="1.1" stroke-linecap="round"/>
            <rect x="-86" y="-130" width="42" height="27" fill="none" stroke="#7A1020" stroke-width="0.8" opacity="0.5"/>
          </g>
        </g>
        <g data-part="cup" opacity="0">
          <path d="M-53 -72 L-34 -72 L-36.5 -61 Q-43.5 -56.5 -50.5 -61 Z" fill="#FFFFFF" stroke="${C.gold}" stroke-width="1.5"/>
          <path d="M-52.4 -69.5 L-34.6 -69.5" stroke="${C.green}" stroke-width="1.6"/>
          <ellipse cx="-43.5" cy="-72" rx="9.5" ry="1.8" fill="#C98A2E"/>
          <g data-part="steam" fill="none" stroke="#C9C2B6" stroke-width="1.5" stroke-linecap="round">
            <path d="M-47 -77 q-3 -4 0 -8 t0 -8"/><path d="M-41 -78 q3 -4 0 -8 t0 -8"/>
          </g>
        </g>
      </g>
      <g data-part="armR">
        <g data-part="cane">
          <path d="M44 -58 L55.5 -1" stroke="${C.wood}" stroke-width="4.6" stroke-linecap="round"/>
          <path d="M43.4 -56 L54.6 -1" stroke="${C.woodHi}" stroke-width="1.2" stroke-linecap="round" opacity="0.8"/>
          <path d="M44 -58 Q40.5 -81 28.5 -77 Q24 -75 26 -70.5" stroke="${C.wood}" stroke-width="4.6" stroke-linecap="round" fill="none"/>
          <path d="M47.5 -40 l3.2 -0.6 M50.6 -24 l3.2 -0.6 M53.2 -11 l3.2 -0.6" stroke="#5E3A1A" stroke-width="1.6"/>
          <g data-part="lantern" opacity="0">
            <path d="M27 -71 L27 -63" stroke="#7A5A20" stroke-width="1.2"/>
            <circle cx="27" cy="-50" r="11" fill="#FFD866" opacity="0.35"/>
            <path d="M21 -62 L33 -62 L35 -55 L33 -42 L21 -42 L19 -55 Z" fill="#FFE9A8" stroke="${C.gold}" stroke-width="1.6"/>
            <path d="M27 -62 L27 -42 M19 -55 L35 -55" stroke="${C.gold}" stroke-width="1"/>
            <path d="M23 -64 L31 -64 L29 -62 L25 -62 Z M23 -42 L31 -42 L29 -39 L25 -39 Z" fill="${C.gold}"/>
            <ellipse data-part="flame" cx="27" cy="-51" rx="2.2" ry="3.4" fill="#FF9F1C"/>
          </g>
        </g>
        <path data-part="sleeveR" d="M24 -119 C40 -114 48 -98 50 -76 L52 -68 Q44 -63.5 35 -66.5 L34 -76 C33 -96 27 -106 20 -110 Z" fill="url(#${uid}-sleeve)" stroke="${C.clothLine}" stroke-width="2"/>
        <path d="M51.5 -71 Q44 -66.5 35.5 -69.5" fill="none" stroke="${C.clothLine}" stroke-width="1.3"/>
        <path d="M50.5 -66 C54 -59 51 -51 43.5 -50.5 C36 -50.5 33 -57 35.5 -65 Z" fill="url(#${uid}-hand)" stroke="${C.skinLine}" stroke-width="1.5"/>
        <path d="M36.5 -63 Q31 -62 32 -56.5 Q34 -55 36 -57" fill="url(#${uid}-hand)" stroke="${C.skinLine}" stroke-width="1.3"/>
      </g>
    </g>
    <g data-part="fx">
      <g data-part="fx-zzz" opacity="0" font-family="Tajawal, sans-serif" font-weight="700" fill="#5B6B8C" stroke="#fff" stroke-width="0.8" paint-order="stroke">
        <text x="42" y="-214" font-size="16">z</text><text x="56" y="-231" font-size="21">z</text><text x="72" y="-250" font-size="26">Z</text>
      </g>
      <g data-part="fx-question" opacity="0">
        <path d="M58 -236 q0 -12 12 -12 q12 0 12 11 q0 7 -8 10 q-4 1.6 -4 6 v3" fill="none" stroke="#E08A00" stroke-width="5.5" stroke-linecap="round"/>
        <circle cx="70" cy="-208" r="3.4" fill="#E08A00"/>
      </g>
      <g data-part="fx-exclaim" opacity="0">
        <path d="M64 -250 L70 -250 L68.5 -222 L65.5 -222 Z" fill="#D64541" stroke="#9E2622" stroke-width="1"/>
        <circle cx="67" cy="-213" r="3.6" fill="#D64541"/>
        <path d="M52 -244 l-6 -5 M82 -244 l6 -5 M50 -230 l-7 0 M84 -230 l7 0" stroke="#D64541" stroke-width="2" stroke-linecap="round"/>
      </g>
      <g data-part="fx-sparkles" opacity="0">
        <path data-part="sp1" d="M0 -9 Q1.2 -1.2 9 0 Q1.2 1.2 0 9 Q-1.2 1.2 -9 0 Q-1.2 -1.2 0 -9 Z" fill="#FFC93C" stroke="#D69A00" stroke-width="0.8"/>
        <path data-part="sp2" d="M0 -9 Q1.2 -1.2 9 0 Q1.2 1.2 0 9 Q-1.2 1.2 -9 0 Q-1.2 -1.2 0 -9 Z" fill="#FFC93C" stroke="#D69A00" stroke-width="0.8"/>
        <path data-part="sp3" d="M0 -9 Q1.2 -1.2 9 0 Q1.2 1.2 0 9 Q-1.2 1.2 -9 0 Q-1.2 -1.2 0 -9 Z" fill="#FFF0B8" stroke="#D69A00" stroke-width="0.8"/>
      </g>
      <g data-part="fx-hearts" opacity="0">
        <path d="${heart(64, -214, 1.6)}" fill="#E8476A" stroke="#A82245" stroke-width="1"/>
        <path d="${heart(-66, -200, 1.15)}" fill="#F07A93" stroke="#A82245" stroke-width="1"/>
        <path d="${heart(76, -240, 1)}" fill="#F07A93" stroke="#A82245" stroke-width="1"/>
      </g>
      <g data-part="fx-notes" opacity="0" fill="#3B5BA9" stroke="#fff" stroke-width="0.8" paint-order="stroke" font-size="24" font-family="sans-serif">
        <text x="48" y="-206">♪</text><text x="68" y="-230">♫</text>
      </g>
      <g data-part="fx-dust" opacity="0" fill="#D9D2C2" stroke="#BFB7A5" stroke-width="1">
        <circle cx="-46" cy="-5" r="8"/><circle cx="-60" cy="-12" r="5.5"/><circle cx="46" cy="-5" r="8"/><circle cx="60" cy="-12" r="5.5"/>
      </g>
      <g data-part="fx-cast" opacity="0" fill="#FFC93C">
        <circle cx="34" cy="-92" r="3"/><circle cx="20" cy="-106" r="2.2"/><circle cx="46" cy="-110" r="2.6"/>
        <path d="M28 -126 Q29 -120 35 -119 Q29 -118 28 -112 Q27 -118 21 -119 Q27 -120 28 -126 Z"/>
      </g>
      <g data-part="fx-puff" opacity="0" fill="#E6E2DA" stroke="#B9B2A4" stroke-width="1.2">
        <circle cx="-62" cy="-182" r="7"/><circle cx="-70" cy="-190" r="5"/><circle cx="-56" cy="-192" r="4.5"/>
      </g>
      <g data-part="fx-dizzy" opacity="0">
        <path data-part="dz1" d="${star(0, 0, 6)}" fill="#FFC93C" stroke="#C88A00" stroke-width="1"/>
        <path data-part="dz2" d="${star(0, 0, 5)}" fill="#FFC93C" stroke="#C88A00" stroke-width="1"/>
        <path data-part="dz3" d="${star(0, 0, 4.5)}" fill="#FFC93C" stroke="#C88A00" stroke-width="1"/>
      </g>
    </g>
  </g>`;
  container.appendChild(svg);

  const P = {};
  for (const el of svg.querySelectorAll('[data-part]')) P[el.getAttribute('data-part')] = el;

  const face = { browL: 0, browR: 0, lift: 0, lid: 0.12, low: 0.12, tiltLid: 0, pupil: 1, blush: 0.3, tilt: 0, lookX: 0, lookY: 0, pale: 0 };
  let target = { ...face };
  let mouthName = 'smile';
  let currentMouth = null;
  let emotion = { emotion: 'calm', intensity: 1, secondary: null };
  let look = { x: 0, y: 0, until: 0 };
  let dart = { x: 0, y: 0, next: 2 };
  let blinkAt = 1.5;
  let blinkT = -1;
  let facing = 1;
  let clock = 0;
  let velocity = 0;
  let costume = null;
  const spring = { tassel: 0, tasselV: 0, kumma: 0, kummaV: 0, prevHead: 0 };

  function setEmotion(snap) {
    if (!snap || !FACES[snap.emotion]) return;
    emotion = snap;
    const f = FACES[snap.emotion];
    const k = 0.7 + 0.15 * (snap.intensity || 1);
    target = {
      browL: f.brow[0] * k, browR: f.brow[1] * k, lift: f.brow[2] * k, lid: f.lid ?? 0.1, low: f.low ?? 0.1,
      tiltLid: (f.tiltLid || 0) * k, pupil: f.pupil || 1, blush: f.blush, tilt: (f.tilt || 0) * k,
      lookX: f.look ? f.look[0] : 0, lookY: f.look ? f.look[1] : 0, pale: f.pale || 0,
    };
    mouthName = f.mouth;
    if (snap.secondary === 'happy' && !MOUTHS[f.mouth].filled) mouthName = snap.intensity >= 2 ? 'grin' : 'smile';
  }

  /** Eyes follow a point given in [-1,1] coordinates relative to the head. */
  function lookAt(x, y, holdSec = 1.2) {
    look = { x: clamp(x, -1, 1), y: clamp(y, -1, 1), until: clock + holdSec };
  }

  function setFacing(dir) { facing = dir < 0 ? -1 : 1; }

  /** Outfit for occasions: 'flag' (National Day), 'bisht' (Eid), 'lantern' (Ramadan) or null. */
  function setCostume(name) {
    costume = ['flag', 'bisht', 'lantern'].includes(name) ? name : null;
    P.flag.setAttribute('opacity', costume === 'flag' ? 1 : 0);
    P.bisht.setAttribute('opacity', costume === 'bisht' ? 1 : 0);
    P.lantern.setAttribute('opacity', costume === 'lantern' ? 1 : 0);
    const sleeve = costume === 'bisht' ? '#4B2E1E' : `url(#${uid}-sleeve)`;
    P.sleeveL.setAttribute('fill', sleeve);
    P.sleeveR.setAttribute('fill', sleeve);
  }

  /** The marker he holds takes the colour of the screen pen. */
  function setPenColor(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(String(hex))) return;
    P.penBody.setAttribute('fill', hex);
    P.penTip.setAttribute('fill', hex);
  }

  /** Horizontal speed in px/s, drives the tassel swing. */
  function setVelocity(vx) { velocity = Number.isFinite(vx) ? vx : 0; }

  function setMouth(name) {
    if (name === currentMouth) return;
    currentMouth = name;
    const m = MOUTHS[name] || MOUTHS.smile;
    if (m.filled) {
      P.mouthFill.setAttribute('d', m.d);
      P.mouthClip.setAttribute('d', m.d);
      P.mouthFill.setAttribute('opacity', 1);
      P.teeth.setAttribute('height', m.teeth || 0);
      P.teeth.setAttribute('y', m.gritted ? -142 : -141);
      P.grit.setAttribute('opacity', m.gritted ? 1 : 0);
      P.tongue.setAttribute('opacity', m.tongue ? 1 : 0);
      P.tongue.setAttribute('cy', name === 'laugh' ? -116 : name === 'bigO' ? -126 : -120);
    } else {
      P.mouthFill.setAttribute('opacity', 0);
      P.tongue.setAttribute('opacity', 0);
      P.teeth.setAttribute('height', 0);
      P.grit.setAttribute('opacity', 0);
    }
    P.mouthLine.setAttribute('d', m.d);
    P.tongueOut.setAttribute('opacity', m.tongueOut ? 1 : 0);
    P.tongueOut.setAttribute('transform', m.tongueOut === 'side' ? 'translate(7 -1) rotate(-20 0 -133) translate(0 -133) scale(0.75) translate(0 133)' : 'translate(0 0)');
  }

  function lids(side, lid, low, tilt) {
    const cx = EYE[side];
    const { y: cy, ry } = EYE;
    const ly = lerp(cy - ry - 4, cy + ry * 0.18, clamp(lid, 0, 1));
    const lowY = lerp(cy + ry + 4, cy + ry * 0.05, clamp(low, 0, 1) * 0.65);
    P[`upLid${side}`].setAttribute('d', `M${cx - 24} ${cy - 40} H${cx + 24} V${f2(ly)} Q${cx} ${f2(ly + 7)} ${cx - 24} ${f2(ly)} Z`);
    P[`upEdge${side}`].setAttribute('d', `M${cx - 24} ${f2(ly)} Q${cx} ${f2(ly + 7)} ${cx + 24} ${f2(ly)}`);
    P[`lowLid${side}`].setAttribute('d', `M${cx - 24} ${cy + 40} H${cx + 24} V${f2(lowY)} Q${cx} ${f2(lowY - 6)} ${cx - 24} ${f2(lowY)} Z`);
    P[`lowEdge${side}`].setAttribute('d', `M${cx - 24} ${f2(lowY)} Q${cx} ${f2(lowY - 6)} ${cx + 24} ${f2(lowY)}`);
    const t = side === 'L' ? tilt : -tilt;
    P[`lids${side}`].setAttribute('transform', `rotate(${f2(t)} ${cx} ${cy})`);
  }

  /**
   * Draws one frame.
   * @param {number} dt seconds since last frame
   * @param {object} pose body pose from the animator
   */
  function render(dt, pose) {
    clock += dt;
    const a = Math.min(1, dt * 10);
    for (const key of Object.keys(face)) face[key] = lerp(face[key], target[key], a);
    const f = FACES[emotion.emotion] || FACES.calm;

    // blinking
    if (blinkT < 0 && clock >= blinkAt) blinkT = 0;
    let blink = 0;
    if (blinkT >= 0) {
      blinkT += dt;
      blink = blinkT < 0.06 ? blinkT / 0.06 : blinkT < 0.16 ? 1 - (blinkT - 0.06) / 0.1 : 0;
      if (blinkT >= 0.16) { blinkT = -1; blinkAt = clock + 1.8 + Math.random() * 4.2; }
    }

    // eye mode: pose override first, then the emotion's special eyes at enough intensity
    let mode = pose.eyeMode || (pose.eyesClosed ? 'arc' : null);
    if (!mode && f.eyes && emotion.intensity >= (f.eyesAt || 1)) mode = f.eyes;
    const replaceEyes = mode === 'arc' || mode === 'x';
    P.arcEyes.setAttribute('opacity', mode === 'arc' ? 1 : 0);
    P.xEyes.setAttribute('opacity', mode === 'x' ? 1 : 0);

    // small eye darts make him look alive when nothing holds his gaze
    if (clock >= dart.next) dart = { x: (Math.random() * 2 - 1) * 0.35, y: (Math.random() * 2 - 1) * 0.2, next: clock + 1.2 + Math.random() * 2.8 };
    const following = clock < look.until;
    const lx = (following ? look.x : face.lookX + dart.x) * 4.2;
    const ly = (following ? look.y : face.lookY + dart.y) * 3.6;
    const lidAmount = Math.max(face.lid * (pose.eyeMul ? 1 / pose.eyeMul : 1), blink);

    for (const side of ['L', 'R']) {
      const cx = EYE[side];
      const special = mode === 'stars' || mode === 'hearts' || mode === 'spiral';
      P[`eye${side}`].setAttribute('opacity', replaceEyes ? 0 : 1);
      P[`iris${side}`].setAttribute('opacity', special ? 0 : 1);
      P[`iris${side}`].setAttribute('transform', `translate(${f2(cx + lx)} ${f2(EYE.y + ly)}) scale(${f2(face.pupil)}) translate(${-cx} ${-EYE.y})`);
      P[`stars${side}`].setAttribute('opacity', mode === 'stars' ? 1 : 0);
      P[`hearts${side}`].setAttribute('opacity', mode === 'hearts' ? 1 : 0);
      P[`spiral${side}`].setAttribute('opacity', mode === 'spiral' ? 1 : 0);
      if (mode === 'spiral') P[`spiral${side}`].setAttribute('transform', `rotate(${f2(((side === 'L' ? 1 : -1) * clock * 400) % 360)} ${cx} ${EYE.y})`);
      if (mode === 'stars' || mode === 'hearts') {
        const pulse = 1 + 0.08 * Math.sin(clock * 9);
        P[`${mode}${side}`].setAttribute('transform', `translate(${cx} ${EYE.y}) scale(${f2(pulse)}) translate(${-cx} ${-EYE.y})`);
      }
      P[`shine${side}`].setAttribute('r', f.shine ? 4.6 : 3.5);
      lids(side, special ? Math.min(0.1, lidAmount) : lidAmount, special ? 0 : face.low, special ? 0 : face.tiltLid);
    }

    P.browL.setAttribute('transform', `translate(0 ${f2(face.lift)}) rotate(${f2(face.browL)} -19 -180)`);
    P.browR.setAttribute('transform', `translate(0 ${f2(face.lift)}) rotate(${f2(face.browR)} 19 -180)`);
    setMouth(pose.mouth || mouthName);
    P.blush.setAttribute('opacity', f2(face.blush));
    P.hatch.setAttribute('opacity', f.hatch && face.blush > 0.7 ? 0.9 : 0);
    P.pale.setAttribute('opacity', f2(face.pale));
    const streaming = Boolean(f.streamAt && emotion.intensity >= f.streamAt);
    P.tears.setAttribute('opacity', f.tearAt && emotion.intensity >= f.tearAt && !streaming ? 0.95 : 0);
    P.streams.setAttribute('opacity', streaming ? 0.85 : 0);
    if (streaming) P.streams.setAttribute('stroke-dashoffset', f2(-(clock * 30) % 11));

    const fxName = pose.fx || (mode === 'spiral' ? 'dizzy' : f.fx);
    for (const n of ['zzz', 'question', 'exclaim', 'sparkles', 'hearts', 'notes', 'dust', 'cast', 'puff', 'dizzy']) {
      const el = P[`fx-${n}`];
      const on = fxName === n || pose.fx2 === n;
      el.setAttribute('opacity', on ? f2(0.8 + 0.2 * Math.sin(clock * 6)) : 0);
      if (!on) continue;
      if (n === 'zzz') el.setAttribute('transform', `translate(${f2(Math.sin(clock * 2) * 3)} ${f2(-((clock * 8) % 10))})`);
      else if (n === 'hearts' || n === 'notes') el.setAttribute('transform', `translate(0 ${f2(-((clock * 10) % 14))})`);
      else el.setAttribute('transform', `translate(0 ${f2(Math.sin(clock * 3) * 3)})`);
    }
    if (fxName === 'sparkles') {
      const spots = [[-70, -204], [70, -190], [60, -240]];
      ['sp1', 'sp2', 'sp3'].forEach((id, i) => {
        const s = 0.55 + 0.45 * Math.abs(Math.sin(clock * 4 + i * 2.1));
        P[id].setAttribute('transform', `translate(${spots[i][0]} ${spots[i][1]}) scale(${f2(s)}) rotate(${f2((clock * 60) % 360)})`);
      });
    }
    if (fxName === 'dizzy') {
      ['dz1', 'dz2', 'dz3'].forEach((id, i) => {
        const ang = clock * 4 + (i * Math.PI * 2) / 3;
        P[id].setAttribute('transform', `translate(${f2(Math.cos(ang) * 34)} ${f2(-238 + Math.sin(ang) * 8)})`);
      });
    }
    P.sweat.setAttribute('opacity', fxName === 'sweat' ? 0.95 : 0);
    if (fxName === 'sweat') P.sweat.setAttribute('transform', `translate(0 ${f2((clock * 6) % 5)})`);
    P.cup.setAttribute('opacity', pose.cup ? 1 : 0);
    P.pen.setAttribute('opacity', pose.pen ? 1 : 0);
    if (costume === 'flag') P.flag.setAttribute('opacity', pose.pen || pose.cup ? 0 : 1);
    if (pose.cup) P.steam.setAttribute('transform', `translate(0 ${f2(-((clock * 6) % 4))})`);
    P.glasses.setAttribute('opacity', pose.glasses ? 1 : 0);
    // the flag pole stays upright whatever the arm does
    if (costume === 'flag') P.flag.setAttribute('transform', `rotate(${f2(-(pose.armL || 0) - (pose.bodyRot || 0) - (pose.rot || 0))} -44 -57)`);
    if (costume === 'flag') P.flagCloth.setAttribute('transform', `translate(-44 -116) skewY(${f2(Math.sin(clock * 5) * 6)}) scale(${f2(1 - Math.abs(Math.sin(clock * 2.5)) * 0.06)} 1) translate(44 116)`);
    if (costume === 'lantern') P.flame.setAttribute('ry', f2(3.4 + Math.sin(clock * 13) * 0.6));

    // body
    const sx = (pose.sx ?? 1) * facing;
    const sy = pose.sy ?? 1;
    P.root.setAttribute('transform', `translate(${f2(pose.x || 0)} ${f2(pose.y || 0)}) rotate(${f2(pose.rot || 0)}) scale(${f2(sx)} ${f2(sy)})`);
    const shadowScale = Math.max(0.4, 1 + (pose.y || 0) / 160);
    P.shadow.setAttribute('transform', `translate(${f2(pose.x || 0)} 0) scale(${f2(shadowScale)} 1)`);
    P.legL.setAttribute('transform', `rotate(${f2(pose.legL || 0)} -14 -34)`);
    P.legR.setAttribute('transform', `rotate(${f2(pose.legR || 0)} 14 -34)`);
    const bodyT = `rotate(${f2(pose.bodyRot || 0)} 0 -20) translate(0 ${f2(pose.bodyY || 0)})`;
    P.body.setAttribute('transform', bodyT);
    P.arms.setAttribute('transform', bodyT);
    // Arm angles are mirror-symmetric: positive raises the arm outward and up, negative brings it across the body.
    P.armL.setAttribute('transform', `rotate(${f2(pose.armL || 0)} -26 -112)`);
    P.armR.setAttribute('transform', `rotate(${f2(-(pose.armR || 0))} 26 -112)`);
    P.cane.setAttribute('transform', `rotate(${f2(pose.cane || 0)} 43 -61)`);

    // springs: the tassel swings with movement, the kumma lags behind the head
    const step = Math.min(dt, 1 / 30);
    const tasselTarget = (pose.tassel || 0) - clamp(velocity * facing * 0.08, -25, 25) - (pose.rot || 0) * 0.6;
    spring.tasselV += ((tasselTarget - spring.tassel) * 90 - spring.tasselV * 7) * step;
    spring.tassel += spring.tasselV * step;
    P.tassel.setAttribute('transform', `rotate(${f2(clamp(spring.tassel, -40, 40))} 6 -115)`);
    const headRot = (pose.headRot || 0) + face.tilt;
    const headVel = dt > 0 ? (headRot - spring.prevHead) / dt : 0;
    spring.prevHead = headRot;
    spring.kummaV += ((clamp(-headVel * 0.03, -10, 10) - spring.kumma) * 140 - spring.kummaV * 11) * step;
    spring.kumma += spring.kummaV * step;
    P.head.setAttribute('transform', `translate(0 ${f2((pose.headY || 0) + (pose.bodyY || 0))}) rotate(${f2(headRot)} 0 -125)`);
    P.kumma.setAttribute('transform', `translate(0 ${f2(pose.kummaY || 0)}) rotate(${f2((pose.kummaRot || 0) + spring.kumma)} 0 -205)`);
  }

  return { el: svg, setEmotion, lookAt, setFacing, setVelocity, setCostume, setPenColor, render, get emotion() { return emotion; }, get costume() { return costume; } };
}

export const MOUTH_SHAPES = Object.keys(MOUTHS);
