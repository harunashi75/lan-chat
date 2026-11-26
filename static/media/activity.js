// Voice activity detection: an analyser per microphone stream (ours and the others') decides
// who is speaking, and publishes it to speaking.js.
import { audioContext } from '../sounds.js';
import { setSpeaking } from '../speaking.js';

const POLL_MS = 80;
const ON_LEVEL = 0.03;   // RMS above this: speaking
const OFF_LEVEL = 0.018; // RMS must fall below this to stop (hysteresis avoids flicker)
const HOLD_MS = 300;     // keep the ring a little after the last loud sample

const watchers = new Map(); // client id -> { source, analyser, samples, lastLoud }
let timer = null;

function level(watcher) {
  watcher.analyser.getByteTimeDomainData(watcher.samples);
  let sum = 0;
  for (const value of watcher.samples) {
    const centred = (value - 128) / 128;
    sum += centred * centred;
  }
  return Math.sqrt(sum / watcher.samples.length);
}

function poll() {
  const now = performance.now();
  for (const [id, watcher] of watchers) {
    const rms = level(watcher);
    if (rms > ON_LEVEL || (watcher.speaking && rms > OFF_LEVEL)) watcher.lastLoud = now;
    watcher.speaking = now - watcher.lastLoud < HOLD_MS;
    setSpeaking(id, watcher.speaking);
  }
}

// Start analysing the audio of a MediaStream (never routed to the speakers: only measured).
export function watchStream(id, stream) {
  unwatch(id);
  try {
    const ctx = audioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    watchers.set(id, { source, analyser, samples: new Uint8Array(analyser.fftSize), lastLoud: 0, speaking: false });
    timer ??= setInterval(poll, POLL_MS);
  } catch (error) {
    console.warn('Voice activity unavailable', error);
  }
}

export function unwatch(id) {
  const watcher = watchers.get(id);
  if (!watcher) return;
  watcher.source.disconnect();
  watchers.delete(id);
  setSpeaking(id, false);
  if (!watchers.size && timer) { clearInterval(timer); timer = null; }
}
