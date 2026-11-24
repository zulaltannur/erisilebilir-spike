// Short alert sounds (earcons). They supplement the screen reader and never speak.

let ctx = null;
let enabled = true;

export function setSoundsEnabled(value) {
  enabled = value;
}

function tone(freq, start, duration, type = 'sine', volume = 0.15) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, ctx.currentTime + start);
  gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + start + 0.01);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration + 0.02);
}

const PATTERNS = {
  connected: () => { tone(523, 0, 0.12); tone(784, 0.13, 0.18); },
  disconnected: () => { tone(784, 0, 0.12); tone(523, 0.13, 0.18); },
  programStart: () => { tone(660, 0, 0.1); },
  programEnd: () => { tone(660, 0, 0.1); tone(880, 0.11, 0.1); tone(1047, 0.22, 0.16); },
  error: () => { tone(220, 0, 0.25, 'square', 0.08); },
  attach: () => { tone(988, 0, 0.08); },
  detach: () => { tone(392, 0, 0.08); },
};

export function play(name) {
  if (!enabled || !PATTERNS[name]) return;
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    PATTERNS[name]();
  } catch {
    // Sound is optional; ignore failures.
  }
}
