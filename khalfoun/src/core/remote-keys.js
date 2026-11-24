// The teacher's presenter remote (clicker): he presses one of its buttons once in settings, and
// from then on that button makes Khalfoun listen, from anywhere. A remote sends ordinary keys
// (Page Down, F5, B…), so a key that is needed for typing is refused, and a key that other
// programs use (Page Down turns PDF pages) is allowed with a warning.

const MEDIA = {
  MediaPlayPause: 'MediaPlayPause', MediaTrackNext: 'MediaNextTrack', MediaTrackPrevious: 'MediaPreviousTrack', MediaStop: 'MediaStop',
  AudioVolumeUp: 'VolumeUp', AudioVolumeDown: 'VolumeDown', AudioVolumeMute: 'VolumeMute',
};
const NAMED = { PageUp: 'PageUp', PageDown: 'PageDown', Home: 'Home', End: 'End', Insert: 'Insert', Pause: 'Pause', ScrollLock: 'Scrolllock', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
const LABEL = {
  PageUp: 'زر الصفحة السابقة (Page Up)', PageDown: 'زر الصفحة التالية (Page Down)', Home: 'Home', End: 'End', Insert: 'Insert', Pause: 'Pause', Scrolllock: 'Scroll Lock',
  Up: 'السهم فوق', Down: 'السهم تحت', Left: 'السهم يسار', Right: 'السهم يمين',
  MediaPlayPause: 'زر التشغيل', MediaNextTrack: 'زر التالي', MediaPreviousTrack: 'زر السابق', MediaStop: 'زر الإيقاف',
  VolumeUp: 'رفع الصوت', VolumeDown: 'خفض الصوت', VolumeMute: 'كتم الصوت',
};

/** Only these shapes reach the main process (it checks again before registering). */
// A letter, digit or arrow only together with Ctrl or Alt (alone they are typing).
export const REMOTE_ACCEL = /^(?:(?:(?:Ctrl|Alt|Shift)\+){0,3}(?:F(?:[1-9]|1\d|2[0-4])|PageUp|PageDown|Home|End|Insert|Pause|Scrolllock|MediaPlayPause|MediaNextTrack|MediaPreviousTrack|MediaStop|VolumeUp|VolumeDown|VolumeMute)|(?:Shift\+)?(?:Ctrl|Alt)\+(?:(?:Ctrl|Alt|Shift)\+){0,2}(?:Up|Down|Left|Right|[A-Z0-9]))$/;

/**
 * A key press from the remote → the shortcut to register.
 * @param {{key: string, code?: string, ctrlKey?: boolean, altKey?: boolean, shiftKey?: boolean, metaKey?: boolean}} e
 * @returns {{ok: true, accel: string, label: string, warn?: string} | {ok: false, why: 'typing_key'|'escape'|'unknown'|'modifier'}}
 */
export function remoteKeyFrom(e) {
  const key = String(e?.key || '');
  const code = String(e?.code || '');
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock'].includes(key)) return { ok: false, why: 'modifier' };
  if (key === 'Escape') return { ok: false, why: 'escape' }; // closes things everywhere: never taken
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
  const withMods = (name) => [...mods, name].join('+');
  const strong = e.ctrlKey || e.altKey; // with Ctrl or Alt even a letter is not typing
  let name = null;
  let label = null;
  let warn;
  const f = /^F(\d{1,2})$/.exec(key);
  if (f && Number(f[1]) >= 1 && Number(f[1]) <= 24) {
    name = key;
    if (!mods.length && key === 'F5') warn = 'زر F5 يحدّث صفحات المتصفح ويبدأ عرض البوربوينت: بيصير لخلفون بس.';
  } else if (MEDIA[code] || MEDIA[key]) {
    name = MEDIA[code] || MEDIA[key];
    if (/^Volume/.test(name)) warn = 'هذا زر الصوت في الجهاز: بيصير لخلفون بدل ما يغيّر الصوت.';
  } else if (NAMED[key]) {
    name = NAMED[key];
    if (['Up', 'Down', 'Left', 'Right'].includes(name) && !strong) return { ok: false, why: 'typing_key' };
    if (['PageUp', 'PageDown', 'Home', 'End'].includes(name) && !strong) warn = 'هذا الزر يقلّب صفحات الـ PDF والعروض: بيصير لخلفون بس، والتقليب يكون بزر ثاني.';
  } else if (/^[a-z0-9]$/i.test(key) && strong) {
    name = key.toUpperCase();
  } else if (/^Key[A-Z]$|^Digit\d$/.test(code) && strong) {
    name = code.slice(-1); // Arabic layout: the letter's place on the keyboard
  } else if (key.length === 1 || ['Enter', 'Tab', 'Backspace', 'Delete', ' ', 'Spacebar'].includes(key)) {
    return { ok: false, why: 'typing_key' };
  } else {
    return { ok: false, why: 'unknown' };
  }
  const accel = withMods(name);
  if (!REMOTE_ACCEL.test(accel)) return { ok: false, why: 'unknown' };
  label = [...mods, LABEL[name] || name].join(' + ');
  return warn ? { ok: true, accel, label, warn } : { ok: true, accel, label };
}

/** What Khalfoun says when a pressed key cannot be used. */
export const REMOTE_REFUSAL = {
  typing_key: 'هذا الزر يرسل حرف أو زر كتابة، لو أخذته خلفون بيخرب الكتابة. جرّب زر ثاني في الريموت (مثل زر بدء العرض).',
  escape: 'هذا زر Esc، يستخدمونه كل البرامج للإغلاق. جرّب زر ثاني.',
  unknown: 'ما عرفت هذا الزر. جرّب زر ثاني في الريموت.',
  modifier: 'هذا زر Ctrl أو Shift لحاله، جرّب زر ثاني.',
};
