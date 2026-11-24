# Khalfoun's ear: shared feature models

- `melspectrogram.onnx` and `embedding_model.onnx` come from openWakeWord v0.5.1
  (https://github.com/dscripka/openWakeWord). The code of openWakeWord is Apache-2.0; the
  embedding model is a re-implementation of Google's speech_embedding (Apache-2.0). The project
  states its included pre-trained models are CC BY-NC-SA 4.0: Khalfoun uses them for
  non-commercial teaching, with this attribution.
- The small classifier that knows only «يا خلفون» (`khalfoun-ear.onnx`) is trained for the
  teacher from his own recordings and Azure voices (tools/ear/train.py), and kept in
  `%APPDATA%\Khalfoun\ear\` on his computer.
