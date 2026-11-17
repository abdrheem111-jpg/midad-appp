// Audio worklet: forwards raw microphone samples to the page.
class KhalfounRecorder extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('khalfoun-recorder', KhalfounRecorder);
