// Joy in the classroom: riddles, class stars that unlock outfits and dances, the camel
// race between teams, and the name wheel. Pure logic; the page draws it.

import { normalize } from './arabic.js';
import { levenshtein } from './wake.js';

/**
 * Folk riddles (old, shared by everyone) with the answers we accept.
 * `a`: accepted answers, written normalized.
 */
export const RIDDLES = [
  { q: 'شي له أسنان وما يعض؟', a: ['المشط', 'مشط'], show: 'المشط' },
  { q: 'شي كل ما أخذت منه يكبر؟', a: ['الحفره', 'حفره'], show: 'الحفرة' },
  { q: 'شي يمشي بلا رجول ويبكي بلا عيون؟', a: ['السحاب', 'سحاب', 'الغيم', 'غيم', 'الغيوم'], show: 'السحاب' },
  { q: 'بيت ما له باب ولا شباك؟', a: ['البيضه', 'بيضه', 'البيض'], show: 'البيضة' },
  { q: 'شي له عين وحده وما يشوف؟', a: ['الابره', 'ابره', 'الإبرة'], show: 'الإبرة' },
  { q: 'شي ينكسر إذا قلت اسمه؟', a: ['الصمت', 'صمت', 'السكوت', 'سكوت', 'الهدوء'], show: 'الصمت' },
  { q: 'شي كل ما زاد نقص؟', a: ['العمر', 'عمر'], show: 'العمر' },
  { q: 'شي تقدر تمسكه بيدك اليمين وما تقدر تمسكه بيدك اليسار؟', a: ['اليد اليسار', 'يدك اليسار', 'اليسار', 'اليد اليسرى', 'يدي اليسار', 'كوع اليد اليسار', 'الكوع'], show: 'يدك اليسار' },
  { q: 'شي يكتب وما يقرا؟', a: ['القلم', 'قلم'], show: 'القلم' },
  { q: 'شي له رقبه وما له راس؟', a: ['الزجاجه', 'زجاجه', 'القاروره', 'قاروره', 'البطل', 'الدله', 'دله'], show: 'الزجاجة' },
  { q: 'شي فيه مدن بلا بيوت، وبحور بلا ماي؟', a: ['الخريطه', 'خريطه'], show: 'الخريطة' },
  { q: 'شي يطلع ويطيح وما يتحرك من مكانه؟', a: ['الدرج', 'درج', 'السلم', 'سلم'], show: 'الدرج' },
  { q: 'شي كلما غسلته زاد وساخه؟', a: ['الماي', 'ماي', 'الماء', 'ماء'], show: 'الماي' },
  { q: 'شي له أوراق وما هو شجره؟', a: ['الكتاب', 'كتاب', 'الدفتر', 'دفتر'], show: 'الكتاب' },
  { q: 'شي يسمع بلا أذن ويتكلم بلا لسان؟', a: ['الصدى', 'صدى', 'التلفون', 'الهاتف'], show: 'الصدى' },
  { q: 'شي نشوفه بالليل ثلاث مرات وبالنهار مره؟', a: ['حرف اللام', 'اللام', 'لام'], show: 'حرف اللام' },
  { q: 'شي يكون أخضر في السوق، وأحمر في البيت، وأسود في الصحن؟ (يتغير لونه مع الطبخ)', a: ['الشاي', 'شاي'], show: 'الشاي' },
  { q: 'أنا أخت خالك ولست خالتك، منو أنا؟', a: ['امي', 'الام', 'امك', 'ام', 'الوالده', 'والدتك'], show: 'أمك' },
  { q: 'رقم إذا ضربته في نفسه أو جمعته مع نفسه يطلع نفس الجواب؟', a: ['اثنين', '2', '٢', 'الاثنين', 'رقم اثنين'], show: '٢ (٢+٢ = ٢×٢ = ٤)' },
  { q: 'كم شهر في السنة فيه ٢٨ يوم؟', a: ['كلها', 'كل الشهور', 'كل الاشهر', '12', '١٢', 'اثنعش', 'اثنا عشر'], show: 'كلها! كل الشهور فيها ٢٨ يوم' },
  { q: 'شي في السما، وإذا أضفت له حرف صار في الأرض؟ (نجم ← نجمة البحر)', a: ['النجم', 'نجم', 'نجمه'], show: 'النجم' },
  { q: 'شي يمشي وهو واقف؟', a: ['الساعه', 'ساعه'], show: 'الساعة' },
];

const GIVE_UP = new Set(['الجواب', 'شو الجواب', 'ايش الجواب', 'استسلم', 'استسلمنا', 'ما عرفت', 'ما عرفنا', 'قول الجواب', 'عطنا الجواب', 'ما ادري', 'ما نعرف'].map(normalize));

/** @returns {'right'|'give_up'|'wrong'} */
export function checkRiddle(riddle, text) {
  const t = normalize(text).replace(/^(هو|هي|الجواب|جوابي|اظن|يمكن|اعتقد)\s+/, '').trim();
  if (GIVE_UP.has(t) || GIVE_UP.has(normalize(text))) return 'give_up';
  for (const a of riddle.a) {
    const ans = normalize(a);
    if (t === ans || ` ${t} `.includes(` ${ans} `)) return 'right';
    if (ans.length >= 4 && t.length >= 3 && levenshtein(t, ans) <= 1) return 'right';
  }
  return 'wrong';
}

/** Picks a riddle the class has not had lately. */
export function nextRiddle(seen = [], rng = Math.random) {
  const fresh = RIDDLES.map((_, i) => i).filter((i) => !seen.includes(i));
  const pool = fresh.length ? fresh : RIDDLES.map((_, i) => i);
  return pool[Math.floor(rng() * pool.length)];
}

// ------------------------------------------------------------------ class stars

/** Every few stars the class unlocks something new for Khalfoun. */
export const STAR_MILESTONES = [
  { at: 5, kind: 'dance', id: 'cane_dance', label: 'رقصة العصا' },
  { at: 10, kind: 'costume', id: 'flag', label: 'العلم العُماني' },
  { at: 20, kind: 'costume', id: 'bisht', label: 'البشت' },
  { at: 30, kind: 'effect', id: 'fireworks', label: 'الألعاب النارية' },
  { at: 40, kind: 'costume', id: 'lantern', label: 'الفانوس' },
  { at: 60, kind: 'dance', id: 'celebrate', label: 'رقصة الأبطال' },
];

/** Milestones crossed when the class goes from `before` to `after` stars. */
export function crossedMilestones(before, after) {
  return STAR_MILESTONES.filter((m) => before < m.at && after >= m.at);
}

export function unlockedAt(stars) {
  return STAR_MILESTONES.filter((m) => stars >= m.at);
}

export function nextMilestone(stars) {
  return STAR_MILESTONES.find((m) => m.at > stars) || null;
}

// ------------------------------------------------------------------ camel race

export const RACE_GOAL = 10;
export const TEAM_NAMES = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس'];

export class CamelRace {
  /** @param {{teams?: number, goal?: number, positions?: number[]}} [data] */
  constructor(data = {}) {
    const teams = Math.min(6, Math.max(2, Number(data.teams) || 2));
    this.goal = Math.min(30, Math.max(3, Number(data.goal) || RACE_GOAL));
    this.positions = Array.isArray(data.positions) && data.positions.length === teams ? data.positions.map((p) => Math.max(0, Number(p) || 0)) : Array(teams).fill(0);
    this.winner = null;
  }

  get teams() { return this.positions.length; }

  /** Moves a team (1-based) forward; returns what happened. */
  advance(team, steps = 1) {
    const i = team - 1;
    if (this.winner !== null || i < 0 || i >= this.teams) return null;
    this.positions[i] = Math.max(0, Math.min(this.goal, this.positions[i] + steps));
    if (this.positions[i] >= this.goal) this.winner = team;
    return { team, position: this.positions[i], winner: this.winner };
  }

  leader() {
    const max = Math.max(...this.positions);
    const leaders = this.positions.map((p, i) => (p === max ? i + 1 : null)).filter(Boolean);
    return leaders.length === 1 ? leaders[0] : null;
  }

  toJSON() { return { teams: this.teams, goal: this.goal, positions: this.positions }; }
}

// ------------------------------------------------------------------ name wheel

/**
 * The wheel stops on a name chosen fairly (the classroom picker decides who); this only
 * works out how far to spin so it lands there.
 */
export function wheelSpin(names, chosen, rng = Math.random) {
  const index = Math.max(0, names.indexOf(chosen));
  const slice = 360 / Math.max(1, names.length);
  const turns = 4 + Math.floor(rng() * 3);
  // The pointer is at the top: rotate so the middle of the chosen slice ends there.
  const angle = turns * 360 + (360 - (index * slice + slice / 2));
  return { index, angle, slice };
}

/** «فريق ٢», «الفريق الثاني», «المجموعه الثالثه», «الفريق 3» → 2 / 2 / 3 / 3. */
export function teamNumber(text) {
  const t = normalize(text);
  const ord = { الاول: 1, الثاني: 2, الثالث: 3, الرابع: 4, الخامس: 5, السادس: 6, الاولي: 1, الثانيه: 2, الثالثه: 3, الرابعه: 4, الخامسه: 5, السادسه: 6, واحد: 1, اثنين: 2, ثلاثه: 3, اربعه: 4, خمسه: 5, سته: 6 };
  const words = t.split(/\s+/);
  for (let i = 0; i < words.length - 1; i += 1) {
    if (!/(?:فريق|مجموعه|^جمل$|^الجمل$)$/.test(words[i])) continue;
    const w = (words[i + 1] === 'رقم' ? words[i + 2] || '' : words[i + 1]).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
    if (/^\d$/.test(w)) return Number(w);
    if (ord[w]) return ord[w];
  }
  return null;
}
