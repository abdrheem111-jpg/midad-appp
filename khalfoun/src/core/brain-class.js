// The brain's classroom-joy part: attendance, riddles, the name wheel, the camel race,
// class stars, celebrations and screen effects, the noise meter, the big class mode,
// solving from the camera and the voice test. Kept apart from brain.js so each stays
// readable; the brain calls these with itself as `b`.

import { toArabicDigits } from './arabic.js';
import { Attendance, dayKey, namesIn, toCsv } from './attendance.js';
import {
  RIDDLES, checkRiddle, nextRiddle, CamelRace, TEAM_NAMES, crossedMilestones, nextMilestone, unlockedAt, wheelSpin,
} from './classfun.js';

const RIDDLE_TTL = 4 * 60000;
const EFFECT_NAMES = new Set(['confetti', 'fireworks', 'national', 'rain', 'snow', 'lanterns', 'balloons', 'stars', 'hearts', 'bubbles']);

/** «أحمد ومريم وسالم» for a list of names. */
export function joinNames(list) {
  if (list.length <= 1) return list[0] || '';
  return `${list.slice(0, -1).join('، ')} و${list.at(-1)}`;
}

function attendance(b) { return new Attendance(b.memory.data.attendance || {}); }
function saveAttendance(b, a) { b.memory.set({ attendance: a.toJSON() }); }

function stamp(time) {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function raceState(race) {
  return race ? { teams: race.teams, goal: race.goal, positions: [...race.positions], winner: race.winner, names: TEAM_NAMES.slice(0, race.teams) } : null;
}

/** A star (or more) for the whole class; unlocks rewards at milestones. */
function addStars(b, count, now) {
  const before = Number(b.memory.data.classStars) || 0;
  const after = Math.min(999, before + count);
  b.memory.set({ classStars: after });
  const crossed = crossedMilestones(before, after);
  b.emotions.feel('celebrate', now);
  if (crossed.length) {
    const prize = crossed.at(-1);
    const extra = { effect: prize.kind === 'effect' ? prize.id : 'stars' };
    if (prize.kind === 'costume') extra.costume = prize.id;
    const rep = b.reply('star_unlock', { vars: { reward: prize.label, stars: toArabicDigits(after) }, behavior: prize.kind === 'dance' ? 'dance' : null, costume: prize.kind === 'costume' ? prize.id : undefined });
    return { ...rep, ...extra, animation: prize.kind === 'dance' ? prize.id : rep.animation, stars: after };
  }
  const next = nextMilestone(after);
  const rep = next
    ? b.reply('star_added', { vars: { stars: toArabicDigits(after), left: toArabicDigits(next.at - after), reward: next.label } })
    : b.reply('star_added_max', { vars: { stars: toArabicDigits(after) } });
  return { ...rep, effect: 'stars', stars: after };
}

/**
 * Handles the classroom intents. Returns a reply, or undefined when the intent is not one
 * of these (the brain then carries on with its own switch).
 */
export function routeClassroom(b, r, raw, now) {
  const s = r.slots || {};
  switch (r.intent) {
    case 'attendance': {
      const room = b.room();
      if (!room.students.length) {
        if (s.soft) return undefined;
        b.emotions.feel('curious', now);
        return b.reply('attendance_no_list');
      }
      const { found, unknown } = namesIn(s.names, (n) => room.find(n));
      if (!found.length) {
        if (s.soft) return undefined;
        b.emotions.feel('not_understood', now);
        return b.reply('attendance_not_found', { vars: { names: s.names.slice(0, 40) } });
      }
      const att = attendance(b);
      att.mark(dayKey(now), found, s.kind);
      saveAttendance(b, att);
      b.emotions.feel(s.kind === 'present' ? 'success' : 'care', now);
      const sit = (s.kind === 'absent' ? 'attendance_absent' : s.kind === 'late' ? 'attendance_late' : 'attendance_present') + (found.length > 1 ? '_many' : '');
      const rep = b.reply(sit, { vars: { student: found[0], names: joinNames(found), count: toArabicDigits(found.length) } });
      if (unknown.length && rep.say) return { ...rep, say: `${rep.say} (ما لقيت في القائمة: ${unknown.slice(0, 3).join('، ')})` };
      return rep;
    }
    case 'attendance_today': {
      const day = attendance(b).days[dayKey(now)];
      if (!day || (!day.absent.length && !day.late.length)) return b.reply('attendance_none_today');
      const parts = [];
      if (day.absent.length) parts.push(`الغياب (${toArabicDigits(day.absent.length)}): ${day.absent.join('، ')}`);
      if (day.late.length) parts.push(`التأخير (${toArabicDigits(day.late.length)}): ${day.late.join('، ')}`);
      const list = parts.join('\n');
      b.context.lastAnswer = { text: list, at: now };
      const head = b.reply('attendance_list');
      return { ...head, say: `${head.say}\n${list}`, long: true };
    }
    case 'attendance_clear': {
      const att = attendance(b);
      delete att.days[dayKey(now)];
      saveAttendance(b, att);
      b.emotions.feel('success', now);
      return b.reply('attendance_cleared');
    }
    case 'attendance_student': {
      const room = b.room();
      const name = room.find(s.name) || null;
      if (!name) { b.emotions.feel('not_understood', now); return b.reply('attendance_not_found', { vars: { names: s.name || '' } }); }
      const sum = attendance(b).summary()[name] || { absent: 0, late: 0 };
      return b.reply('attendance_student', { vars: { student: name, absent: toArabicDigits(sum.absent), late: toArabicDigits(sum.late) } });
    }
    case 'export_sheet': {
      const room = b.room();
      let rows;
      let label;
      if (s.what === 'points') {
        const names = [...new Set([...room.students, ...Object.keys(room.points)])];
        if (!names.length) { b.emotions.feel('curious', now); return b.reply('pick_need_names'); }
        rows = [['الطالب', 'النقاط'], ...names.map((n) => [n, String(room.points[n] || 0)]).sort((x, y) => Number(y[1]) - Number(x[1]))];
        label = 'النقاط';
      } else {
        const att = attendance(b);
        if (!Object.keys(att.days).length) { b.emotions.feel('curious', now); return b.reply('attendance_export_empty'); }
        rows = att.rows(room.students);
        label = 'الغياب';
      }
      const name = `${label} ${stamp(now)}`;
      return b.plan({ type: 'save_sheet', params: { name, csv: toCsv(rows) } },
        { situation: 'sheet_saved', sayOn: 'result', vars: { what: label }, summary: `حفظ كشف ${label}` }, now);
    }
    case 'riddle': {
      const seen = b.memory.data.riddlesSeen || [];
      const index = nextRiddle(seen, b.rng);
      b.memory.set({ riddlesSeen: [...seen, index].slice(-(RIDDLES.length - 2)) });
      b.riddle = { index, at: now, tries: 0 };
      b.emotions.feel('curious', now);
      return b.reply('riddle_ask', { vars: { riddle: RIDDLES[index].q } });
    }
    case 'wheel': {
      const room = b.room();
      if (room.students.length < 2) { b.emotions.feel('curious', now); return b.reply('pick_need_names'); }
      const pick = room.pick(b.rng);
      b.saveRoom(room);
      b.emotions.feel('celebrate', now);
      const names = room.students.slice(0, 30);
      if (!names.includes(pick.name)) names[names.length - 1] = pick.name;
      const spin = wheelSpin(names, pick.name, b.rng);
      return { ...b.reply('wheel_result', { vars: { student: pick.name } }), wheel: { names, chosen: pick.name, angle: spin.angle } };
    }
    case 'race_start': {
      b.race = new CamelRace({ teams: s.teams || 2 });
      b.emotions.feel('celebrate', now);
      return { ...b.reply('race_start', { vars: { count: toArabicDigits(b.race.teams) } }), race: raceState(b.race) };
    }
    case 'race_advance': {
      if (!b.race || b.race.winner) b.race = new CamelRace({ teams: Math.max(2, s.team) });
      if (s.team > b.race.teams) {
        // «الفريق الثالث» in a two-team race: widen the race rather than refuse.
        b.race = new CamelRace({ teams: s.team, goal: b.race.goal, positions: [...b.race.positions, ...Array(s.team - b.race.teams).fill(0)] });
      }
      const res = b.race.advance(s.team, s.steps || 1);
      if (!res) return b.reply('not_understood');
      if (res.winner) {
        b.emotions.feel('celebrate', now);
        const rep = b.reply('race_win', { vars: { team: TEAM_NAMES[res.winner - 1] }, behavior: 'dance' });
        return { ...rep, race: raceState(b.race), effect: 'fireworks' };
      }
      const leader = b.race.leader();
      const left = b.race.goal - res.position;
      const sit = left <= 2 ? 'race_close' : 'race_step';
      return { ...b.reply(sit, { vars: { team: TEAM_NAMES[s.team - 1], left: toArabicDigits(left), leader: leader ? TEAM_NAMES[leader - 1] : '' } }), race: raceState(b.race) };
    }
    case 'race_stop':
      b.race = null;
      return { ...b.reply('race_stopped'), race: null };
    case 'class_star':
      return addStars(b, Math.max(1, Math.min(10, s.count || 1)), now);
    case 'class_stars': {
      const stars = Number(b.memory.data.classStars) || 0;
      const next = nextMilestone(stars);
      const got = unlockedAt(stars).map((m) => m.label);
      const rep = b.reply(next ? 'stars_status' : 'stars_status_max', { vars: { stars: toArabicDigits(stars), left: next ? toArabicDigits(next.at - stars) : '', reward: next?.label || '' } });
      return got.length && rep.say ? { ...rep, say: `${rep.say}\nفتحنا: ${got.join('، ')}` } : rep;
    }
    case 'celebrate':
      b.emotions.feel('celebrate', now);
      return { ...b.reply('celebrate', { behavior: 'dance' }), effect: 'confetti' };
    case 'effect': {
      const effect = EFFECT_NAMES.has(s.effect) ? s.effect : 'confetti';
      b.emotions.feel('celebrate', now);
      const costume = effect === 'national' ? 'flag' : effect === 'lanterns' ? 'lantern' : undefined;
      return { ...b.reply(`effect_${effect}`, { costume }), effect };
    }
    case 'effect_stop':
      return { ...b.reply('effect_stopped'), effect: 'none' };
    case 'noise':
      b.noiseOn = !!s.on;
      b.emotions.feel(s.on ? 'focus_mode' : 'success', now);
      return { ...b.reply(s.on ? 'noise_on' : 'noise_off'), noise: !!s.on };
    case 'class_mode':
      b.emotions.feel(s.on ? 'celebrate' : 'focus_mode', now);
      return { ...b.reply(s.on ? 'class_mode_on' : 'class_mode_off'), classMode: !!s.on };
    case 'camera':
      b.emotions.feel('curious', now);
      return { ...b.reply('camera_open'), camera: { mode: s.mode || 'solve' } };
    case 'voice_test':
      b.emotions.feel('curious', now);
      return b.reply('voice_test_open', { behavior: 'voice_test' });
    case 'walk_windows':
      b.emotions.feel('curious', now);
      return b.reply('walk_windows', { behavior: 'walk_windows' });
    case 'guide':
      b.emotions.feel('curious', now);
      return b.reply('guide_open', { behavior: 'guide' });
    case 'user_joke':
      b.emotions.feel('joke', now);
      return b.reply('user_joke');
    default:
      return undefined;
  }
}

/**
 * While a riddle is waiting for its answer. Returns a reply, or null to let the sentence
 * be handled normally (a real command ends the riddle quietly).
 */
export function riddleTurn(b, r, raw, now) {
  const rid = b.riddle;
  if (!rid) return null;
  if (now - rid.at > RIDDLE_TTL) { b.riddle = null; return null; }
  const riddle = RIDDLES[rid.index];
  const verdict = checkRiddle(riddle, raw);
  if (verdict === 'right') {
    b.riddle = null;
    b.emotions.feel('celebrate', now);
    return { ...b.reply('riddle_right', { vars: { answer: riddle.show } }), effect: 'confetti' };
  }
  if (verdict === 'give_up' || r.intent === 'stop') {
    b.riddle = null;
    b.emotions.feel('joke', now);
    return b.reply('riddle_answer', { vars: { answer: riddle.show } });
  }
  // A command or a question is not a guess: leave the riddle and do it.
  if (!['unknown', 'open_unknown', 'no', 'yes', 'dont_know'].includes(r.intent)) { b.riddle = null; return null; }
  rid.tries += 1;
  rid.at = now;
  if (rid.tries >= 3) {
    b.riddle = null;
    b.emotions.feel('joke', now);
    return b.reply('riddle_answer', { vars: { answer: riddle.show } });
  }
  b.emotions.feel('quiz_wrong', now);
  return b.reply(rid.tries === 2 ? 'riddle_wrong_last' : 'riddle_wrong');
}

/** Events from the page for these features. Returns a reply, null, or undefined if not ours. */
export function classroomEvent(b, name, data, now) {
  switch (name) {
    case 'noise_loud': {
      if (now - (b.lastNoiseRemark || 0) < 25000) return null;
      b.lastNoiseRemark = now;
      b.emotions.feel('focus_mode', now);
      return b.reply(data.level === 'very' ? 'noise_very_loud' : 'noise_loud');
    }
    case 'noise_quiet': {
      // A long quiet stretch earns the class a star.
      if (now - (b.lastQuietStar || 0) < 4 * 60000) return null;
      b.lastQuietStar = now;
      const res = addStars(b, 1, now);
      return res.situation === 'star_unlock' ? res : addStarsReply(b);
    }
    case 'wheel_done':
      return null;
    case 'camera_result': {
      if (!data.ok) {
        b.emotions.feel('confused', now);
        const sit = data.reason === 'no_cloud' ? 'camera_no_cloud' : data.reason === 'no_camera' ? 'camera_none' : 'camera_failed';
        return b.reply(sit);
      }
      b.emotions.feel('success', now);
      b.context.lastAnswer = { text: String(data.text || ''), at: now };
      return b.reply(data.saved ? 'camera_solved_saved' : 'camera_solved');
    }
    case 'voice_test_done': {
      const score = Math.max(0, Math.min(100, Math.round(Number(data.score) || 0)));
      b.emotions.feel(score >= 80 ? 'celebrate' : 'care', now);
      return b.reply(score >= 80 ? 'voice_test_good' : score >= 50 ? 'voice_test_ok' : 'voice_test_bad', { vars: { score: toArabicDigits(score) } });
    }
    default:
      return undefined;
  }
}

// The quiet star is added inside addStars; this only builds its reply once.
function addStarsReply(b) {
  const stars = Number(b.memory.data.classStars) || 0;
  return { ...b.reply('noise_reward', { vars: { stars: toArabicDigits(stars) } }), effect: 'stars', stars };
}
