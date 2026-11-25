// Color recognition from the sensor's hue / saturation / brightness.
// Real LEGO bricks and room light differ, so the user can teach the app each color
// (Ayarlar > Renk sensörü ayarı). Taught colors are stored in the browser and the
// nearest one wins. Without teaching, built-in ranges are used.

const STORAGE_KEY = 'erisilebilir-spike-renk-ayari';

let samples = load(); // { [colorIndex]: { h, s, v } }

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

export function getCalibration() {
  return { ...samples };
}

export function setCalibrationSample(color, hsv) {
  samples[color] = { h: hsv.h, s: hsv.s, v: hsv.v };
  save();
}

export function clearCalibration() {
  samples = {};
  save();
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(samples));
  } catch {
    /* storage unavailable: calibration lasts until the page closes */
  }
}

// Nothing in front of the sensor: brightness about 1 on a real Essential sensor.
const NOTHING = 15;

function distance(a, b) {
  const dhRaw = Math.abs(a.h - b.h);
  const dh = Math.min(dhRaw, 360 - dhRaw) / 180; // 0..1
  // Hue means little for grey-ish colors (black, white), so weigh it by saturation.
  const hueWeight = 3 * Math.min(1, Math.min(a.s, b.s) / 400);
  const ds = Math.abs(a.s - b.s) / 1000;
  const dv = Math.abs(a.v - b.v) / 1000;
  return hueWeight * dh + ds + 0.7 * dv;
}

// SPIKE color numbers: 0 black, 1 pink, 2 purple, 3 blue, 4 light blue, 5 turquoise,
// 6 green, 7 yellow, 8 orange, 9 red, 10 white, -1 nothing in front of the sensor.
export function colorFromHsv(h, s, v) {
  if (v < NOTHING) return -1;
  const taught = Object.entries(samples);
  if (taught.length >= 2) {
    let best = -1;
    let bestD = Infinity;
    for (const [color, ref] of taught) {
      const d = distance({ h, s, v }, ref);
      if (d < bestD) {
        bestD = d;
        best = Number(color);
      }
    }
    return best;
  }
  // Built-in ranges (before the user has taught any colors). Shifted after first tests
  // on a real Essential sensor: its yellow read as about 30, orange below 15,
  // dark blue near 210. Teaching the colors is still more reliable.
  if (s < 250) return v > 300 ? 10 : 0;
  if (v < 40) return 0;
  if (h >= 345 || h < 8) return 9;
  if (h < 22) return 8;
  if (h < 75) return 7;
  if (h < 170) return 6;
  if (h < 195) return 5;
  if (h < 210) return 4;
  if (h < 260) return 3;
  if (h < 300) return 2;
  return 1;
}
