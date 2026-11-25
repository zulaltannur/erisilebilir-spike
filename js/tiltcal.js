// Which way is "front" and "left" on the Hub.
// The Hub reports two tilt angles (pitch and roll). Which one means "forward" depends
// on how the Hub sits in a model, and measurements with a real Hub showed that people
// hold it in different ways. So the user can teach it (Ayarlar > Eğim ayarı): hold the
// Hub flat, tilted forward, tilted left. Without teaching, a measured default is used.

const STORAGE_KEY = 'erisilebilir-spike-egim-ayari';

// Default from a real Essential Hub held with the USB port towards the person:
// forward made roll negative, left made pitch positive.
const DEFAULT = { flat: { pitch: 0, roll: 0 }, forward: { pitch: 0, roll: -1 }, left: { pitch: 1, roll: 0 } };

let axes = load();

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return data && data.forward && data.left ? data : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

const unit = (v) => {
  const len = Math.hypot(v.pitch, v.roll) || 1;
  return { pitch: v.pitch / len, roll: v.roll / len };
};

export function isTiltTaught() {
  return axes !== DEFAULT;
}

// flat, forward, left: { pitch, roll } readings taken while the Hub was held that way.
export function teachTilt(flat, forward, left) {
  axes = {
    flat,
    forward: unit({ pitch: forward.pitch - flat.pitch, roll: forward.roll - flat.roll }),
    left: unit({ pitch: left.pitch - flat.pitch, roll: left.roll - flat.roll }),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(axes));
  } catch {
    /* storage unavailable */
  }
}

export function clearTilt() {
  axes = DEFAULT;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export const TILT_DEG = 25; // tilted beyond this many degrees

// Returns how far the Hub leans forward (+) / back (-) and left (+) / right (-), in degrees.
export function tiltParts(pitch, roll) {
  const p = pitch - axes.flat.pitch;
  const r = roll - axes.flat.roll;
  return {
    forward: p * axes.forward.pitch + r * axes.forward.roll,
    left: p * axes.left.pitch + r * axes.left.roll,
    upsideDown: Math.abs(roll) > 135 || Math.abs(pitch) > 135,
  };
}

export function tiltWords(pitch, roll) {
  const t = tiltParts(pitch, roll);
  if (t.upsideDown) return 'Hub ters duruyor';
  const words = [];
  if (t.forward > TILT_DEG) words.push('öne');
  if (t.forward < -TILT_DEG) words.push('arkaya');
  if (t.left > TILT_DEG) words.push('sola');
  if (t.left < -TILT_DEG) words.push('sağa');
  return words.length ? `Hub ${words.join(' ve ')} eğik` : 'Hub düz duruyor';
}
