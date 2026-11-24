// All sounds are synthesized with the Web Audio API: no sound files are needed.
// Two groups:
//  - alert sounds (earcons) that support the screen reader; can be turned off
//  - program sounds that a child's program plays on purpose; always on

let ctx = null;
let enabled = true;
export let lastSound = null; // for tests

export function setSoundsEnabled(value) {
  enabled = value;
}

// Browsers only allow audio after a user action. Call this on every key press
// and click so the audio engine is ready when a program later plays a sound.
export function unlockAudio() {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    /* no audio available */
  }
}

function tone(freq, start, duration, { type = 'sine', volume = 0.25, endFreq = null } = {}) {
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + duration);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
  gain.gain.setValueAtTime(volume, t0 + Math.max(0.01, duration - 0.05));
  gain.gain.linearRampToValueAtTime(0, t0 + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

function noise(start, duration, volume = 0.35, filterFreq = 1500) {
  const t0 = ctx.currentTime + start;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = filterFreq;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(t0);
}

// ---------- Alert sounds (short, quiet) ----------

const ALERTS = {
  connected: () => { tone(523, 0, 0.12, { volume: 0.15 }); tone(784, 0.13, 0.18, { volume: 0.15 }); },
  disconnected: () => { tone(784, 0, 0.12, { volume: 0.15 }); tone(523, 0.13, 0.18, { volume: 0.15 }); },
  programStart: () => { tone(660, 0, 0.1, { volume: 0.15 }); },
  programEnd: () => { tone(660, 0, 0.1, { volume: 0.15 }); tone(880, 0.11, 0.1, { volume: 0.15 }); tone(1047, 0.22, 0.16, { volume: 0.15 }); },
  error: () => { tone(220, 0, 0.25, { type: 'square', volume: 0.08 }); },
  attach: () => { tone(988, 0, 0.08, { volume: 0.12 }); },
  detach: () => { tone(392, 0, 0.08, { volume: 0.12 }); },
  // Guided pairing: ticks while Chrome scans, then a bell = "press Down, then Enter".
  tick: () => { tone(1400, 0, 0.03, { type: 'square', volume: 0.06 }); },
  ready: () => { tone(784, 0, 0.12); tone(988, 0.13, 0.12); tone(1175, 0.26, 0.12); tone(1568, 0.39, 0.3); },
};

// essential = true plays even when alert sounds are turned off (pairing guidance).
export function play(name, { essential = false } = {}) {
  if ((!enabled && !essential) || !ALERTS[name]) return;
  try {
    unlockAudio();
    ALERTS[name]();
  } catch {
    /* sound is optional */
  }
}

// ---------- Program sounds (clear and distinct) ----------
// Each returns its length in seconds, so a program can wait until it has finished.

export const PROGRAM_SOUNDS = {
  beep: { name: 'bip', play: () => (tone(880, 0, 0.35, { type: 'square', volume: 0.18 }), 0.4) },
  bell: { name: 'zil', play: () => (tone(1318, 0, 0.6), tone(1975, 0, 0.6, { volume: 0.12 }), tone(1318, 0.3, 0.5, { volume: 0.15 }), 0.8) },
  drum: { name: 'davul', play: () => (tone(150, 0, 0.3, { volume: 0.6, endFreq: 50 }), noise(0, 0.08, 0.2, 800), 0.4) },
  clap: { name: 'alkış', play: () => { for (let i = 0; i < 6; i++) noise(i * 0.12, 0.08, 0.5, 1800); return 0.8; } },
  up: { name: 'yükselen ses', play: () => (tone(300, 0, 0.6, { type: 'triangle', endFreq: 1200 }), 0.65) },
  down: { name: 'alçalan ses', play: () => (tone(1200, 0, 0.6, { type: 'triangle', endFreq: 300 }), 0.65) },
  siren: { name: 'siren', play: () => { for (let i = 0; i < 2; i++) { tone(700, i * 0.6, 0.3, { type: 'sawtooth', volume: 0.12 }); tone(950, i * 0.6 + 0.3, 0.3, { type: 'sawtooth', volume: 0.12 }); } return 1.2; } },
  success: { name: 'başarı', play: () => (tone(523, 0, 0.15), tone(659, 0.15, 0.15), tone(784, 0.3, 0.15), tone(1047, 0.45, 0.4), 0.9) },
  laser: { name: 'lazer', play: () => (tone(1800, 0, 0.3, { type: 'sawtooth', volume: 0.12, endFreq: 200 }), 0.35) },
  drop: { name: 'su damlası', play: () => (tone(1500, 0, 0.12, { endFreq: 500 }), 0.2) },
  boing: { name: 'yay', play: () => (tone(200, 0, 0.5, { type: 'triangle', endFreq: 600 }), tone(600, 0.25, 0.3, { type: 'triangle', endFreq: 250 }), 0.6) },
};

export const NOTES = {
  C: { name: 'Do', freq: 261.63 },
  D: { name: 'Re', freq: 293.66 },
  E: { name: 'Mi', freq: 329.63 },
  F: { name: 'Fa', freq: 349.23 },
  G: { name: 'Sol', freq: 392.0 },
  A: { name: 'La', freq: 440.0 },
  B: { name: 'Si', freq: 493.88 },
  C2: { name: 'ince Do', freq: 523.25 },
};

function remember(value) {
  lastSound = value;
  if (typeof window !== 'undefined') window.__lastSound = value; // read by the tests
}

export function playProgramSound(key) {
  remember(key);
  try {
    unlockAudio();
    return PROGRAM_SOUNDS[key] ? PROGRAM_SOUNDS[key].play() : 0;
  } catch {
    return 0;
  }
}

export function playNote(key, seconds) {
  remember(`note:${key}`);
  try {
    unlockAudio();
    tone(NOTES[key].freq, 0, seconds, { type: 'triangle', volume: 0.3 });
  } catch {
    /* ignore */
  }
  return seconds;
}

// Speak with the computer's own voice (in Turkish when available).
export function speak(text) {
  remember(`speak:${text}`);
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'tr-TR';
    const voice = speechSynthesis.getVoices().find((v) => v.lang && v.lang.startsWith('tr'));
    if (voice) u.voice = voice;
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    // Safety net: never block the program for long if the voice never reports "end".
    const timer = setTimeout(done, 1000 + text.length * 150);
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
