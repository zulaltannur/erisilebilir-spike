// LEGO Wireless Protocol 3 (LWP3) session.
// The SPIKE Essential Small Hub speaks this protocol (the official app "streams"
// commands to it instead of uploading programs).
// Docs: https://lego.github.io/lego-ble-wireless-protocol-docs/
//
// This class turns LWP3 messages into the same events the rest of the app uses:
//   'devices'        -> snapshot list (battery + one entry per external port)
//   'consoleLine'    -> '@BASLA', '@ADIM n', '@BITTI' markers while a command runs
//   'programStopped' -> a running command was stopped

export const LWP_SERVICE_UUID = '00001623-1212-efde-1623-785feabcd123';
export const LWP_CHAR_UUID = '00001624-1212-efde-1623-785feabcd123';

const T = {
  HUB_PROPERTIES: 0x01,
  HUB_ATTACHED_IO: 0x04,
  PORT_INPUT_FORMAT_SETUP: 0x41,
  PORT_VALUE_SINGLE: 0x45,
  PORT_OUTPUT_COMMAND: 0x81,
  PORT_OUTPUT_FEEDBACK: 0x82,
};

const PROP_BATTERY = 0x06;

// Device type ids -> our device kinds
const MOTOR_TYPES = new Set([0x26, 0x2e, 0x2f, 0x30, 0x31, 0x41, 0x4b, 0x4c]);
const COLOR_SENSOR = 0x3d;
const DISTANCE_SENSOR = 0x3e;
const FORCE_SENSOR = 0x3f;
const COLOR_MATRIX = 0x40;

const MOTOR_MODE_APOS = 3; // absolute position, int16 degrees (-180..179)
const COLOR_MODE_COLOR = 0; // color index, same numbering as SPIKE (-1 = none)
const MATRIX_MODE_PIXELS = 2; // 9 bytes: (brightness << 4) | color

const SNAPSHOT_MS = 200;
const STARTUP_SETTLE_MS = 600;
const COMMAND_TIMEOUT_MS = 15000;

const kindOf = (type) => {
  if (MOTOR_TYPES.has(type)) return 'motor';
  if (type === COLOR_SENSOR) return 'color';
  if (type === COLOR_MATRIX) return 'matrix3x3';
  if (type === DISTANCE_SENSOR) return 'distance';
  if (type === FORCE_SENSOR) return 'force';
  return null;
};

const msg = (type, ...payload) => {
  const len = 3 + payload.length;
  return Uint8Array.of(len, 0x00, type, ...payload);
};

export class LwpSession {
  constructor(characteristic, emit) {
    this.char = characteristic;
    this.emit = emit;
    this.battery = null;
    this.ports = new Map(); // port -> { kind, type, ...values }
    this.pendingCommand = null; // { port, resolve, timer }
    this.writeQueue = Promise.resolve();
    this.snapshotTimer = null;
    this._onValue = (e) => this._onData(e.target.value);
  }

  async start() {
    this.char.addEventListener('characteristicvaluechanged', this._onValue);
    await this.char.startNotifications();
    // Battery level updates
    await this._send(msg(T.HUB_PROPERTIES, PROP_BATTERY, 0x02)); // enable updates
    await this._send(msg(T.HUB_PROPERTIES, PROP_BATTERY, 0x05)); // request now
    // The hub reports attached devices by itself after notifications start.
    // Wait briefly so the first snapshot already includes every attached device and the battery.
    this.ready = false;
    await new Promise((r) => setTimeout(r, STARTUP_SETTLE_MS));
    this.ready = true;
    this._emitSnapshot();
    this.snapshotTimer = setInterval(() => this._emitSnapshot(), SNAPSHOT_MS);
  }

  stop() {
    clearInterval(this.snapshotTimer);
    this.char.removeEventListener('characteristicvaluechanged', this._onValue);
    if (this.pendingCommand) this._finishCommand(false);
  }

  // ---------- Writing ----------

  _send(bytes) {
    const write = async () => {
      if (this.char.writeValueWithoutResponse) await this.char.writeValueWithoutResponse(bytes);
      else await this.char.writeValue(bytes);
    };
    this.writeQueue = this.writeQueue.then(write, write);
    return this.writeQueue;
  }

  _subscribe(port, mode) {
    // delta = 1, notifications on
    return this._send(msg(T.PORT_INPUT_FORMAT_SETUP, port, mode, 1, 0, 0, 0, 1));
  }

  // ---------- Commands ----------

  // Turn a motor by a number of degrees and resolve when it is done.
  async motorDegrees(port, degrees, speed = 50) {
    if (this.pendingCommand) this._finishCommand(false);
    const d = new DataView(new ArrayBuffer(4));
    d.setInt32(0, degrees, true);
    this.emit('consoleLine', '@BASLA');
    this.emit('consoleLine', '@ADIM 1');
    const done = new Promise((resolve) => {
      const timer = setTimeout(() => this._finishCommand(true), COMMAND_TIMEOUT_MS);
      this.pendingCommand = { port, resolve, timer, sawProgress: false };
    });
    await this._send(
      msg(
        T.PORT_OUTPUT_COMMAND,
        port,
        0x11, // execute immediately + command feedback
        0x0b, // StartSpeedForDegrees
        ...new Uint8Array(d.buffer),
        speed & 0xff,
        100, // max power
        127, // end state: brake
        0, // no acceleration profile
      ),
    );
    return done;
  }

  async stopAll() {
    const wasRunning = !!this.pendingCommand;
    for (const [port, dev] of this.ports) {
      if (dev.kind === 'motor') {
        // WriteDirectModeData, mode 0 = StartPower, 127 = brake
        await this._send(msg(T.PORT_OUTPUT_COMMAND, port, 0x11, 0x51, 0x00, 127));
      }
    }
    if (wasRunning) {
      this._finishCommand(false);
      this.emit('programStopped');
    }
  }

  async setMatrix(port, pixels) {
    // pixels: 9 x { color, brightness 0..10 }
    const bytes = pixels.map((p) => ((p.brightness & 0x0f) << 4) | (p.color & 0x0f));
    await this._send(msg(T.PORT_OUTPUT_COMMAND, port, 0x11, 0x51, MATRIX_MODE_PIXELS, ...bytes));
    const dev = this.ports.get(port);
    if (dev) dev.pixels = pixels;
  }

  _finishCommand(completed) {
    const c = this.pendingCommand;
    if (!c) return;
    clearTimeout(c.timer);
    this.pendingCommand = null;
    if (completed) this.emit('consoleLine', '@BITTI');
    c.resolve(completed);
  }

  // ---------- Reading ----------

  _onData(dataView) {
    const d = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
    let o = 0;
    while (o < d.length) {
      let len = d[o];
      let headerLen = 1;
      if (len & 0x80) {
        len = (len & 0x7f) | (d[o + 1] << 7);
        headerLen = 2;
      }
      if (len < 3 || o + len > d.length) break;
      this._handle(d.subarray(o, o + len), headerLen);
      o += len;
    }
  }

  _handle(m, headerLen) {
    const type = m[headerLen + 1];
    const p = headerLen + 2; // first payload byte
    const v = new DataView(m.buffer, m.byteOffset, m.byteLength);

    switch (type) {
      case T.HUB_PROPERTIES:
        if (m[p] === PROP_BATTERY && m[p + 1] === 0x06) this.battery = m[p + 2];
        break;

      case T.HUB_ATTACHED_IO: {
        const port = m[p];
        const event = m[p + 1];
        if (port > 1) break; // only external ports A and B
        if (event === 0) {
          this.ports.delete(port);
        } else if (event === 1) {
          const ioType = v.getUint16(p + 2, true);
          const kind = kindOf(ioType);
          if (!kind) break;
          const dev = { kind, type: ioType, port };
          if (kind === 'motor') {
            dev.absPosition = 0;
            dev.position = 0;
            dev._lastAbs = null;
            this._subscribe(port, MOTOR_MODE_APOS);
          } else if (kind === 'color') {
            dev.color = -1;
            this._subscribe(port, COLOR_MODE_COLOR);
          } else if (kind === 'matrix3x3') {
            dev.pixels = Array.from({ length: 9 }, () => ({ brightness: 0, color: 0 }));
          }
          this.ports.set(port, dev);
        }
        this._emitSnapshot();
        break;
      }

      case T.PORT_VALUE_SINGLE: {
        const port = m[p];
        const dev = this.ports.get(port);
        if (!dev) break;
        if (dev.kind === 'motor' && m.length >= p + 3) {
          const abs = v.getInt16(p + 1, true);
          if (dev._lastAbs !== null) {
            // accumulate the shortest change, so turning past 179 -> -180 still counts
            let delta = abs - dev._lastAbs;
            if (delta > 180) delta -= 360;
            if (delta < -180) delta += 360;
            dev.position += delta;
          }
          dev._lastAbs = abs;
          dev.absPosition = abs;
        } else if (dev.kind === 'color' && m.length >= p + 2) {
          dev.color = v.getInt8(p + 1);
        }
        break;
      }

      case T.PORT_OUTPUT_FEEDBACK: {
        const c = this.pendingCommand;
        // payload: (port, flags) pairs
        for (let i = p; i + 1 < m.length; i += 2) {
          const port = m[i];
          const flags = m[i + 1];
          if (!c || port !== c.port) continue;
          if (flags & 0x01) c.sawProgress = true;
          if (flags & 0x02 || (c.sawProgress && flags & 0x08)) this._finishCommand(true);
          else if (flags & 0x04) this._finishCommand(false);
        }
        break;
      }

      default:
        break;
    }
  }

  _emitSnapshot() {
    if (!this.ready) return;
    const list = [];
    if (this.battery != null) list.push({ kind: 'battery', level: this.battery });
    for (const dev of this.ports.values()) {
      const { _lastAbs, ...clean } = dev;
      list.push(clean);
    }
    this.emit('devices', list);
  }
}
