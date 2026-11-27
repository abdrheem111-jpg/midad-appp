// Hearing while the teacher talks: the sound of a command is sent to Azure as he speaks
// (streaming), the words appear live, and the final text is ready the moment he stops — instead
// of sending the whole sentence afterwards and waiting for it to come back. Only the sound of a
// sentence goes (from just before he starts to when he stops), never the silence in between.
// The key stays in the main process. When anything goes wrong the sentence is read the old way.

/**
 * @param {{key: string, region: string, language?: string, sdk?: any, onPartial?: (text: string) => void, log?: Function}} o
 */
export function createStreamSession(o) {
  const sdk = o.sdk;
  const t0 = Date.now();
  let finalText = ''; let done = false; let failed = null;
  let resolveEnd = null;
  const ended = new Promise((r) => { resolveEnd = r; });
  const format = sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
  const push = sdk.AudioInputStream.createPushStream(format);
  const speech = sdk.SpeechConfig.fromSubscription(o.key, o.region);
  speech.speechRecognitionLanguage = o.language || 'ar-OM';
  // a short end-of-speech wait: our own VAD already decided he stopped
  try { speech.setProperty(sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, '400'); } catch { /* older SDK */ }
  const rec = new sdk.SpeechRecognizer(speech, sdk.AudioConfig.fromStreamInput(push));
  rec.recognizing = (_s, e) => { const t = e?.result?.text; if (t) o.onPartial?.(t); };
  rec.recognized = (_s, e) => {
    if (e?.result?.reason === sdk.ResultReason.RecognizedSpeech && e.result.text) finalText = `${finalText} ${e.result.text}`.trim();
  };
  rec.canceled = (_s, e) => { failed = String(e?.errorDetails || e?.reason || 'canceled'); finish(); };
  rec.sessionStopped = () => finish();
  function finish() {
    if (done) return;
    done = true;
    resolveEnd();
    try { rec.close(); } catch { /* closed */ }
  }
  rec.startContinuousRecognitionAsync(() => {}, (err) => { failed = String(err); finish(); });

  return {
    /** @param {Float32Array} samples 16 kHz, -1..1 */
    push(samples) {
      if (done) return;
      const pcm = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i += 1) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
      push.write(pcm.buffer);
    },
    /** He stopped talking: the final text (or null, and the sentence is read the old way). */
    async end(waitMs = 1500) {
      if (!done) {
        push.close();
        rec.stopContinuousRecognitionAsync(() => {}, () => {});
        await Promise.race([ended, new Promise((r) => setTimeout(r, waitMs))]);
        finish();
      }
      const ms = Date.now() - t0;
      if (failed && !finalText) { o.log?.('stream stt failed', failed); return { ok: false, error: failed, ms }; }
      return finalText ? { ok: true, text: finalText, ms, service: 'azure-stream' } : { ok: false, error: 'empty', ms };
    },
    cancel() { try { push.close(); } catch { /* closed */ } finish(); },
  };
}
