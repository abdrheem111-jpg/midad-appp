# Khalfoun's ear: the same feature steps as the app (src/renderer/ear-model.js), for training.
# 16 kHz audio → every 80 ms (1280 samples): mel frames (openWakeWord melspectrogram.onnx, the
# last 1280+480 samples) → one 96-number embedding (embedding_model.onnx over the last 76 frames).
# The classifier looks at the last 16 embeddings (1.28 s).
import numpy as np, onnxruntime as ort
CHUNK, CTX, WIN, STEP_EMB, N_EMB = 1280, 480, 76, 8, 16

class Features:
    def __init__(self, models_dir):
        o = ort.SessionOptions(); o.intra_op_num_threads = 1; o.inter_op_num_threads = 1
        self.mel = ort.InferenceSession(f'{models_dir}/melspectrogram.onnx', o)
        self.emb = ort.InferenceSession(f'{models_dir}/embedding_model.onnx', o)
    def reset(self):
        self.raw = np.zeros(CTX, np.float32)
        self.frames = np.ones((WIN, 32), np.float32)  # what silence-free start looks like (as openWakeWord)
        self.embs = []
    def step(self, chunk):
        """chunk: 1280 samples, int16 scale (float32). Returns the newest embedding (96,)."""
        buf = np.concatenate([self.raw[-CTX:], chunk.astype(np.float32)])
        self.raw = buf
        m = self.mel.run(None, {'input': buf[None, :]})[0].squeeze()  # (frames, 32)
        m = m / 10.0 + 2.0
        self.frames = np.concatenate([self.frames, m[-8:]])[-WIN - 8:]
        win = self.frames[-WIN:]
        e = self.emb.run(None, {'input_1': win[None, :, :, None].astype(np.float32)})[0].reshape(96)
        self.embs.append(e)
        return e
    def clip(self, audio, lead=0.5, tail=0.5):
        """A whole clip (int16-scale float) with silence around it → list of (16,96) windows."""
        self.reset()
        a = np.concatenate([np.zeros(int(16000 * lead)), audio, np.zeros(int(16000 * tail))]).astype(np.float32)
        a = a[: len(a) // CHUNK * CHUNK]
        out = []
        for i in range(0, len(a), CHUNK):
            self.step(a[i:i + CHUNK])
            if len(self.embs) >= N_EMB: out.append(np.stack(self.embs[-N_EMB:]))
        return out
