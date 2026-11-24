"""Trains Khalfoun's own ear on the teacher's recordings.

    python3 tools/ear/train.py <wake-data folder> <out folder> [--threshold-fph 0.5]

<wake-data> is what «علّم خلفون صوتك» saved (%APPDATA%/Khalfoun/wake-data): call/ (his «يا خلفون»),
other/ (other sentences), room/ (class sound), tts-call/ and tts-other/ (Azure voices).
Writes <out>/khalfoun-ear.onnx and <out>/ear.json (threshold and the measured results), which go to
%APPDATA%/Khalfoun/ear/ on his computer. The steps match the app exactly (features.py).
"""
import argparse, glob, json, os, sys, wave
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from features import Features, CHUNK  # noqa: E402
from onnx_mlp import export_mlp  # noqa: E402

RATE = 16000
STEP_S = CHUNK / RATE  # 0.08 s per window step


def read_wav(path):
    with wave.open(path, 'rb') as w:
        if w.getsampwidth() != 2 or w.getnchannels() != 1:
            raise ValueError(f'{path}: 16-bit mono only')
        rate = w.getframerate()
        a = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32)
    if rate != RATE:  # simple resample (Azure clips are already 16 kHz)
        t = np.linspace(0, len(a) / rate, int(len(a) * RATE / rate), endpoint=False)
        a = np.interp(t, np.arange(len(a)) / rate, a).astype(np.float32)
    return a


def trim(a, floor=0.01 * 32767):
    """The spoken part of a clip (Azure clips have silence around the words)."""
    env = np.convolve(np.abs(a), np.ones(320) / 320, 'same')
    idx = np.where(env > floor)[0]
    if not len(idx):
        return a
    return a[max(0, idx[0] - 1600): idx[-1] + 1600]


def augment(a, rng, room):
    """A clip as it may sound in class: louder or softer, a little faster or slower, with noise."""
    out = a * rng.uniform(0.35, 1.6)
    speed = rng.uniform(0.9, 1.1)
    if abs(speed - 1) > 0.01:
        n = int(len(out) / speed)
        out = np.interp(np.linspace(0, len(out) - 1, n), np.arange(len(out)), out).astype(np.float32)
    if room is not None and len(room) > len(out) and rng.random() < 0.7:
        s = rng.integers(0, len(room) - len(out))
        noise = room[s:s + len(out)]
        out = out + noise * rng.uniform(0.2, 1.0) * (np.std(out) / (np.std(noise) + 1e-6)) * 0.3
    elif rng.random() < 0.5:
        out = out + rng.normal(0, rng.uniform(20, 300), len(out)).astype(np.float32)
    return np.clip(out, -32767, 32767).astype(np.float32)


def call_windows(feat, a, has_command):
    """Windows that should fire: just after the name ends."""
    lead = 0.5
    w = feat.clip(a, lead=lead, tail=0.6)
    # window i ends at (i + 16) * 0.08 s in the padded clip
    end_t = (np.arange(len(w)) + 16) * STEP_S
    speech_end = lead + (min(len(a) / RATE, 1.1) if has_command else len(a) / RATE)
    keep = [x for x, t in zip(w, end_t) if speech_end - 0.1 <= t <= speech_end + 0.45]
    return keep


def other_windows(feat, a, every=1):
    w = feat.clip(a, lead=0.3, tail=0.3)
    return w[::every]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('data')
    ap.add_argument('out')
    ap.add_argument('--models', default=os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'ear'))
    ap.add_argument('--augment', type=int, default=4)
    ap.add_argument('--threshold-fph', type=float, default=0.5, help='false wakes per hour allowed on class sound')
    ap.add_argument('--seed', type=int, default=1)
    args = ap.parse_args()
    rng = np.random.default_rng(args.seed)
    feat = Features(args.models)
    files = {k: sorted(glob.glob(os.path.join(args.data, k, '*.wav'))) for k in ['call', 'other', 'room', 'tts-call', 'tts-other']}
    print({k: len(v) for k, v in files.items()})
    if len(files['call']) + len(files['tts-call']) < 10:
        sys.exit('not enough calls to train on')
    room = np.concatenate([read_wav(f) for f in files['room']]) if files['room'] else None

    # Hold out a part of his own calls and of the class sound to measure honestly.
    calls = files['call'][:]
    rng.shuffle(calls)
    n_test = max(2, len(calls) // 5) if len(calls) >= 10 else 0
    test_calls, train_calls = calls[:n_test], calls[n_test:]
    room_train, room_test = (room[: int(len(room) * 0.75)], room[int(len(room) * 0.75):]) if room is not None else (None, None)

    X, y = [], []
    def add(ws, label):
        X.extend(ws); y.extend([label] * len(ws))

    for f in train_calls + files['tts-call']:
        a = trim(read_wav(f))
        cmd = len(a) / RATE > 1.6
        for k in range(args.augment + 1):
            add(call_windows(feat, a if k == 0 else augment(a, rng, room_train), cmd), 1)
    for f in files['other'] + files['tts-other']:
        a = trim(read_wav(f))
        for k in range(max(1, args.augment // 2) + 1):
            add(other_windows(feat, a if k == 0 else augment(a, rng, room_train)), 0)
    if room_train is not None:
        add(other_windows(feat, room_train, every=2), 0)
    # silence and plain noise must never wake him
    add(other_windows(feat, rng.normal(0, 30, RATE * 20).astype(np.float32), every=3), 0)

    X = np.stack(X).reshape(len(X), -1).astype(np.float32)
    y = np.array(y)
    print(f'windows: {len(y)} ({y.sum()} call, {len(y) - y.sum()} other)')
    from sklearn.neural_network import MLPClassifier
    clf = MLPClassifier(hidden_layer_sizes=(64,), alpha=1e-3, batch_size=256, learning_rate_init=1e-3, max_iter=60,
                        early_stopping=True, validation_fraction=0.1, random_state=args.seed)
    w = np.where(y == 1, (len(y) - y.sum()) / max(1, y.sum()), 1.0)
    try:
        clf.fit(X, y, sample_weight=w)
    except TypeError:  # older scikit-learn: no sample weights, repeat the calls instead
        rep = int(max(1, round(w.max())))
        clf.fit(np.concatenate([X] + [X[y == 1]] * (rep - 1)), np.concatenate([y] + [y[y == 1]] * (rep - 1)))

    def score_windows(ws):
        if not len(ws):
            return np.zeros(0)
        return clf.predict_proba(np.stack(ws).reshape(len(ws), -1))[:, 1]

    # Threshold: the lowest one that keeps false wakes on held-out class sound under the limit
    # (two windows in a row above it = one wake, as in the app).
    def wakes(scores, thr):
        n, prev, last = 0, 0.0, -99
        for i, s in enumerate(scores):
            if s >= thr and prev >= thr and i - last > 25:
                n += 1; last = i
            prev = s
        return n
    room_scores = score_windows(other_windows(feat, room_test)) if room_test is not None else np.zeros(0)
    hours = len(room_test) / RATE / 3600 if room_test is not None else 0
    thr = 0.5
    for t in np.arange(0.3, 0.96, 0.025):
        thr = float(t)
        if hours == 0 or wakes(room_scores, thr) / hours <= args.threshold_fph:
            break
    recall = None
    if test_calls:
        hit = 0
        for f in test_calls:
            a = trim(read_wav(f))
            s = score_windows(feat.clip(a, lead=0.5, tail=0.6))
            hit += int(any(s[i] >= thr and s[i - 1] >= thr for i in range(1, len(s))) or (s >= 0.85).any())
        recall = hit / len(test_calls)
    os.makedirs(args.out, exist_ok=True)
    layers = [(clf.coefs_[0], clf.intercepts_[0]), (clf.coefs_[1], clf.intercepts_[1])]
    export_mlp(layers, os.path.join(args.out, 'khalfoun-ear.onnx'))
    report = {
        'mode': 'shadow', 'threshold': round(thr, 3), 'high': round(max(0.85, thr + 0.2), 3),
        'version': f'ear-{len(train_calls)}calls-{len(files["tts-call"])}tts',
        'measured': {'recall_held_out_calls': recall, 'held_out_calls': len(test_calls), 'false_wakes_per_hour': (wakes(room_scores, thr) / hours) if hours else None, 'class_sound_minutes': round(hours * 60, 1)},
        'counts': {k: len(v) for k, v in files.items()},
    }
    json.dump(report, open(os.path.join(args.out, 'ear.json'), 'w'), ensure_ascii=False, indent=1)
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
