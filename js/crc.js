// CRC32 as used by the SPIKE protocol: standard CRC-32 (same as zlib),
// calculated on data padded with zeros to a multiple of 4 bytes.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data, seed = 0, align = 4) {
  const remainder = data.length % align;
  let bytes = data;
  if (remainder) {
    bytes = new Uint8Array(data.length + (align - remainder));
    bytes.set(data);
  }
  let c = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
