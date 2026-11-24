// COBS encoding/decoding and framing for the SPIKE App 3 BLE protocol.
// Direct port of LEGO's reference implementation:
// https://github.com/LEGO/spike-prime-docs/blob/main/examples/python/cobs.py

const DELIMITER = 0x02;
const NO_DELIMITER = 0xff;
const COBS_CODE_OFFSET = DELIMITER;
const MAX_BLOCK_SIZE = 84;
const XOR = 3;

export function encode(data) {
  const buffer = [];
  let codeIndex = 0;
  let block = 0;

  const beginBlock = () => {
    codeIndex = buffer.length;
    buffer.push(NO_DELIMITER);
    block = 1;
  };

  beginBlock();
  for (const byte of data) {
    if (byte > DELIMITER) {
      buffer.push(byte);
      block += 1;
    }
    if (byte <= DELIMITER || block > MAX_BLOCK_SIZE) {
      if (byte <= DELIMITER) {
        const delimiterBase = byte * MAX_BLOCK_SIZE;
        const blockOffset = block + COBS_CODE_OFFSET;
        buffer[codeIndex] = delimiterBase + blockOffset;
      }
      beginBlock();
    }
  }
  buffer[codeIndex] = block + COBS_CODE_OFFSET;
  return Uint8Array.from(buffer);
}

export function decode(data) {
  const buffer = [];

  const unescape = (code) => {
    if (code === 0xff) return [null, MAX_BLOCK_SIZE + 1];
    let value = Math.floor((code - COBS_CODE_OFFSET) / MAX_BLOCK_SIZE);
    let block = (code - COBS_CODE_OFFSET) % MAX_BLOCK_SIZE;
    if (block === 0) {
      block = MAX_BLOCK_SIZE;
      value -= 1;
    }
    return [value, block];
  };

  let [value, block] = unescape(data[0]);
  for (let i = 1; i < data.length; i++) {
    const byte = data[i];
    block -= 1;
    if (block > 0) {
      buffer.push(byte);
      continue;
    }
    if (value !== null) buffer.push(value);
    [value, block] = unescape(byte);
  }
  return Uint8Array.from(buffer);
}

// Encode, escape and frame a message for sending to the hub.
export function pack(data) {
  const encoded = encode(data);
  const out = new Uint8Array(encoded.length + 1);
  for (let i = 0; i < encoded.length; i++) out[i] = encoded[i] ^ XOR;
  out[encoded.length] = DELIMITER;
  return out;
}

// Unescape and decode a frame body (delimiters already removed).
export function unpackBody(body) {
  const unxored = Uint8Array.from(body, (b) => b ^ XOR);
  return decode(unxored);
}

// Splits the incoming byte stream into complete messages.
// 0x01 starts a high-priority message, 0x02 ends a message.
export class FrameDecoder {
  constructor() {
    this.low = [];
    this.high = [];
    this.inHigh = false;
  }

  push(chunk) {
    const messages = [];
    for (const b of chunk) {
      if (b === 0x01) {
        this.high = [];
        this.inHigh = true;
        continue;
      }
      if (b === 0x02) {
        if (this.inHigh) {
          if (this.high.length) messages.push(unpackBody(this.high));
          this.high = [];
          this.inHigh = false;
        } else {
          if (this.low.length) messages.push(unpackBody(this.low));
          this.low = [];
        }
        continue;
      }
      (this.inHigh ? this.high : this.low).push(b);
    }
    return messages;
  }

  reset() {
    this.low = [];
    this.high = [];
    this.inHigh = false;
  }
}
