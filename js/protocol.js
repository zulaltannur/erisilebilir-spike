// Message definitions for the SPIKE App 3 BLE protocol.
// Source: https://lego.github.io/spike-prime-docs

export const SERVICE_UUID = '0000fd02-0000-1000-8000-00805f9b34fb';
export const RX_UUID = '0000fd02-0001-1000-8000-00805f9b34fb'; // hub receives
export const TX_UUID = '0000fd02-0002-1000-8000-00805f9b34fb'; // hub transmits

// Hubs with older firmware (SPIKE App 2 era) advertise the LEGO Wireless Protocol instead.
// We list them too, so we can tell the user that a Hub update is needed.
export const LWP_SERVICE_UUID = '00001623-1212-efde-1623-785feabcd123';

export const MSG = {
  INFO_REQ: 0x00,
  INFO_RES: 0x01,
  START_UPLOAD_REQ: 0x0c,
  START_UPLOAD_RES: 0x0d,
  CHUNK_REQ: 0x10,
  CHUNK_RES: 0x11,
  GET_NAME_REQ: 0x18,
  GET_NAME_RES: 0x19,
  PROGRAM_FLOW_REQ: 0x1e,
  PROGRAM_FLOW_RES: 0x1f,
  PROGRAM_FLOW_NOTIF: 0x20,
  CONSOLE_NOTIF: 0x21,
  DEVICE_NOTIF_REQ: 0x28,
  DEVICE_NOTIF_RES: 0x29,
  TUNNEL: 0x32,
  DEVICE_NOTIF: 0x3c,
  CLEAR_SLOT_REQ: 0x46,
  CLEAR_SLOT_RES: 0x47,
};

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- Requests ----------

export const infoRequest = () => Uint8Array.of(MSG.INFO_REQ);

export const getHubNameRequest = () => Uint8Array.of(MSG.GET_NAME_REQ);

export function deviceNotificationRequest(intervalMs) {
  const b = new Uint8Array(3);
  const v = new DataView(b.buffer);
  v.setUint8(0, MSG.DEVICE_NOTIF_REQ);
  v.setUint16(1, intervalMs, true);
  return b;
}

export const clearSlotRequest = (slot) => Uint8Array.of(MSG.CLEAR_SLOT_REQ, slot);

export function startFileUploadRequest(fileName, slot, crc) {
  const name = enc.encode(fileName);
  if (name.length > 31) throw new Error('Dosya adı çok uzun');
  const b = new Uint8Array(1 + name.length + 1 + 1 + 4);
  const v = new DataView(b.buffer);
  b[0] = MSG.START_UPLOAD_REQ;
  b.set(name, 1);
  b[1 + name.length] = 0; // null terminator
  b[2 + name.length] = slot;
  v.setUint32(3 + name.length, crc, true);
  return b;
}

export function transferChunkRequest(runningCrc, chunk) {
  const b = new Uint8Array(1 + 4 + 2 + chunk.length);
  const v = new DataView(b.buffer);
  b[0] = MSG.CHUNK_REQ;
  v.setUint32(1, runningCrc, true);
  v.setUint16(5, chunk.length, true);
  b.set(chunk, 7);
  return b;
}

// action: 0 = start, 1 = stop
export const programFlowRequest = (stop, slot) =>
  Uint8Array.of(MSG.PROGRAM_FLOW_REQ, stop ? 1 : 0, slot);

// ---------- Responses / notifications ----------

export function parseInfoResponse(d) {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return {
    rpcMajor: v.getUint8(1),
    rpcMinor: v.getUint8(2),
    rpcBuild: v.getUint16(3, true),
    firmwareMajor: v.getUint8(5),
    firmwareMinor: v.getUint8(6),
    firmwareBuild: v.getUint16(7, true),
    maxPacketSize: v.getUint16(9, true),
    maxMessageSize: v.getUint16(11, true),
    maxChunkSize: v.getUint16(13, true),
    productGroupDevice: v.getUint16(15, true),
  };
}

export const parseStatus = (d) => d[1] === 0x00; // 0 = acknowledged

export function parseString(d, offset = 1) {
  let end = d.indexOf(0, offset);
  if (end === -1) end = d.length;
  return dec.decode(d.subarray(offset, end));
}

// Device notification: a list of device messages.
export function parseDeviceNotification(d) {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const size = v.getUint16(1, true);
  const end = Math.min(3 + size, d.length);
  const devices = [];
  let o = 3;
  while (o < end) {
    const id = d[o];
    switch (id) {
      case 0x00: // battery
        devices.push({ kind: 'battery', level: d[o + 1] });
        o += 2;
        break;
      case 0x01: // IMU
        devices.push({
          kind: 'imu',
          faceUp: d[o + 1],
          yaw: v.getInt16(o + 3, true),
          pitch: v.getInt16(o + 5, true),
          roll: v.getInt16(o + 7, true),
        });
        o += 21;
        break;
      case 0x02: // 5x5 display (Prime)
        devices.push({ kind: 'matrix5x5', pixels: Array.from(d.subarray(o + 1, o + 26)) });
        o += 26;
        break;
      case 0x0a: // motor
        devices.push({
          kind: 'motor',
          port: d[o + 1],
          type: d[o + 2],
          absPosition: v.getInt16(o + 3, true),
          power: v.getInt16(o + 5, true),
          speed: v.getInt8(o + 7),
          position: v.getInt32(o + 8, true),
        });
        o += 12;
        break;
      case 0x0b: // force sensor (Prime)
        devices.push({ kind: 'force', port: d[o + 1], value: d[o + 2], pressed: d[o + 3] === 1 });
        o += 4;
        break;
      case 0x0c: // color sensor
        devices.push({
          kind: 'color',
          port: d[o + 1],
          color: v.getInt8(o + 2),
          r: v.getUint16(o + 3, true),
          g: v.getUint16(o + 5, true),
          b: v.getUint16(o + 7, true),
        });
        o += 9;
        break;
      case 0x0d: // distance sensor (Prime)
        devices.push({ kind: 'distance', port: d[o + 1], mm: v.getInt16(o + 2, true) });
        o += 4;
        break;
      case 0x0e: // 3x3 color light matrix (Essential)
        devices.push({
          kind: 'matrix3x3',
          port: d[o + 1],
          pixels: Array.from(d.subarray(o + 2, o + 11)).map((p) => ({
            brightness: p >> 4,
            color: p & 0x0f,
          })),
        });
        o += 11;
        break;
      default:
        // Unknown device message: stop parsing this notification.
        o = end;
    }
  }
  return devices;
}
