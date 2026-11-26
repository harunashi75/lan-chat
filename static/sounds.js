// Short, soft notification sounds synthesised with Web Audio (no audio files to ship).
let context = null;

function audio() {
  context ??= new (window.AudioContext || window.webkitAudioContext)();
  if (context.state === "suspended") context.resume();
  return context;
}

// [frequency Hz, start s, duration s]
const SOUNDS = {
  message: [[880, 0, 0.09], [1175, 0.09, 0.16]],
  voiceJoin: [[523, 0, 0.09], [784, 0.09, 0.18]],
  voiceLeave: [[784, 0, 0.09], [523, 0.09, 0.18]]
};
const MAX_GAIN = 0.22; // keeps the loudest setting discreet

// volume: 0..1
export function playSound(name, volume) {
  if (volume <= 0 || !SOUNDS[name]) return;
  try {
    const ctx = audio();
    const now = ctx.currentTime;
    for (const [frequency, start, duration] of SOUNDS[name]) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(MAX_GAIN * volume, now + start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(now + start);
      oscillator.stop(now + start + duration + 0.02);
    }
  } catch {
    // Audio can be blocked until the user interacts with the page: stay silent.
  }
}
