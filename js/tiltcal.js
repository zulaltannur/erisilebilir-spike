// Hub tilt directions, for one standard way of holding the Hub that everyone uses:
//   the Hub's button faces up and its USB charging port faces you.
// Then "öne" = away from you, "sola" = the left edge goes down.
// Measured on a real Essential Hub held this way (tenths of a degree from the Hub):
//   forward  -> pitch about +90°, left -> roll about +91°, right -> roll about -92°.

export const HOLD_TEXT =
  'Yönler şu tutuşa göredir: Hub\'ın düğmesi yukarıda, USB şarj girişi size bakıyor. ' +
  'Öne eğmek: sizden uzağa. Sola eğmek: Hub\'ın sol kenarı aşağıda.';

export const TILT_DEG = 25; // tilted beyond this many degrees

// How far the Hub leans forward (+) / back (-) and left (+) / right (-), in degrees.
export function tiltParts(pitch, roll) {
  return {
    forward: pitch,
    left: roll,
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
