// Protocol tests. Run: node test/protocol.test.mjs
import { crc32 as zlibCrc32 } from 'node:zlib';
import { pack, FrameDecoder } from '../js/cobs.js';
import { crc32 } from '../js/crc.js';
import { parseDeviceNotification, startFileUploadRequest } from '../js/protocol.js';
import { T } from '../js/texts.js';
import { colorFromHsv } from '../js/colorcal.js';

let fail = 0;
const check = (ok, name, extra) => {
  if (!ok) {
    fail++;
    console.log('BAŞARISIZ:', name, extra ?? '');
  }
};
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Deterministic pseudo-random bytes, biased towards the special values 0..3
let seed = 1;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const randomBytes = (n) =>
  Uint8Array.from({ length: n }, () => (rnd() < 0.5 ? Math.floor(rnd() * 4) : Math.floor(rnd() * 256)));

// 1. COBS round trip and framing rules
for (const n of [1, 2, 3, 5, 83, 84, 85, 86, 168, 170, 200, 400, 1000]) {
  for (let k = 0; k < 20; k++) {
    const data = randomBytes(n);
    const framed = pack(data);
    check(framed[framed.length - 1] === 0x02, 'son bayt 0x02', n);
    check(framed.slice(0, -1).every((b) => b !== 0x01 && b !== 0x02 && b !== 0x03), 'gövdede ayraç yok', n);
    const out = new FrameDecoder().push(framed);
    check(out.length === 1 && eq(Array.from(out[0]), Array.from(data)), 'gidiş-dönüş', n);
  }
}

// 2. Known vector from the protocol rules: [0x00] -> code word 0+1+2=3, then next block 1+2=3
//    encoded [0x03, 0x03], XOR 3 -> [0x00, 0x00], plus delimiter.
check(eq(Array.from(pack(Uint8Array.of(0x00))), [0x00, 0x00, 0x02]), 'bilinen örnek [0x00]', Array.from(pack(Uint8Array.of(0x00))));

// 3. Messages arriving in odd pieces, plus a high-priority message
{
  const a = pack(Uint8Array.of(0x3c, 1, 2, 3));
  const b = pack(Uint8Array.of(0x21, 65, 0));
  const all = Uint8Array.from([...a, 0x01, ...b]);
  const dec = new FrameDecoder();
  const got = [...dec.push(all.slice(0, 3)), ...dec.push(all.slice(3, 7)), ...dec.push(all.slice(7))];
  check(got.length === 2 && got[0][0] === 0x3c && got[1][0] === 0x21, 'parça parça gelen mesajlar');
}

// 4. CRC32 equals zlib CRC32 on zero-padded data, with and without seed
for (const n of [0, 1, 3, 4, 7, 100, 333]) {
  const data = randomBytes(n);
  const padded = new Uint8Array(Math.ceil(n / 4) * 4);
  padded.set(data);
  check(crc32(data) === zlibCrc32(padded), 'crc', n);
  check(crc32(data, 12345) === zlibCrc32(padded, 12345), 'crc tohumlu', n);
}

// 5. Device notification: battery, motor on A, color on B, 3x3 matrix
{
  const b = [0x00, 85];
  const motor = new DataView(new ArrayBuffer(12));
  motor.setUint8(0, 0x0a); motor.setUint8(1, 0); motor.setUint8(2, 0x41);
  motor.setInt16(3, -90, true); motor.setInt16(5, 0, true); motor.setInt8(7, 0); motor.setInt32(8, 1234, true);
  b.push(...new Uint8Array(motor.buffer));
  const color = new DataView(new ArrayBuffer(9));
  color.setUint8(0, 0x0c); color.setUint8(1, 1); color.setInt8(2, 9);
  b.push(...new Uint8Array(color.buffer));
  b.push(0x0e, 1, ...Array(9).fill((10 << 4) | 9));
  const msg = Uint8Array.from([0x3c, b.length & 0xff, b.length >> 8, ...b]);
  const d = parseDeviceNotification(msg);
  check(
    d.length === 4 && d[0].level === 85 && d[1].absPosition === -90 && d[1].position === 1234 &&
      d[2].color === 9 && d[2].port === 1 && d[3].pixels[0].brightness === 10 && d[3].pixels[0].color === 9,
    'cihaz bildirimi', JSON.stringify(d),
  );
}

// 6. File upload request layout: id, name, NUL, slot, crc (little-endian)
{
  const r = startFileUploadRequest('program.py', 0, 0x01020304);
  check(r[0] === 0x0c && r[11] === 0 && r[12] === 0 && r[13] === 4 && r[16] === 1 && r.length === 17, 'yükleme isteği', Array.from(r));
}

// 7. Turkish suffixes for port letters
check(T.attached('A', 'motor') === "Port A'ya motor takıldı.", 'ek A', T.attached('A', 'motor'));
check(T.attached('B', 'motor') === "Port B'ye motor takıldı.", 'ek B', T.attached('B', 'motor'));
check(T.noMotorAt('A', 'B') === "Port A'da motor yok. Motor Port B'de.", 'ek bulunma', T.noMotorAt('A', 'B'));

// 8. Color from hue/saturation/brightness (real red reading from an Essential sensor)
check(colorFromHsv(353, 715, 291) === 9, 'renk: kırmızı');
check(colorFromHsv(270, 0, 1) === -1, 'renk: önünde bir şey yok');
check(colorFromHsv(240, 800, 300) === 3, 'renk: mavi');
check(colorFromHsv(55, 750, 500) === 7, 'renk: sarı');
check(colorFromHsv(140, 700, 300) === 6, 'renk: yeşil');
check(colorFromHsv(0, 100, 700) === 10, 'renk: beyaz');

console.log(fail ? `${fail} test başarısız` : 'Tüm testler geçti');
process.exit(fail ? 1 : 0);
