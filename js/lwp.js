// LEGO Wireless Protocol 3 (LWP3) session.
// The SPIKE Essential Small Hub speaks this protocol (the official app "streams"
// commands to it instead of uploading programs).
// Docs: https://lego.github.io/lego-ble-wireless-protocol-docs/
//
// This class turns LWP3 messages into the same events the rest of the app uses:
//   'devices'        -> snapshot list (battery + one entry per external port)
//   'consoleLine'    -> '@BASLA', '@ADIM n', '@BITTI' markers while a command runs
//   'programStopped' -> a running command was stopped

import { colorFromHsv } from './colorcal.js';

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
const RGB_LIGHT = 0x17; // the Hub's own status light (internal port)
// Internal motion sensors of the Essential Small Hub (found on a real Hub):
// port 0x63 mode 0 "POS" = yaw, pitch, roll in tenths of a degree;
// port 0x5f mode 0 "GEST" = gesture: 1 = tap, 3 = shake (0 = nothing).
const TILT_PORT = 0x63;
const GESTURE_PORT = 0x5f;
const GESTURE_MEMORY_MS = 700; // a tap or shake counts for this long
const TAP_STILL_MS = 800;
const TAP_AFTER_MS = 300;
const TAP_MAX_MOVE_DEG = 10;

// Device type ids -> our device kinds
const MOTOR_TYPES = new Set([0x26, 0x2e, 0x2f, 0x30, 0x31, 0x41, 0x4b, 0x4c]);
const COLOR_SENSOR = 0x3d;
const DISTANCE_SENSOR = 0x3e;
const FORCE_SENSOR = 0x3f;
const COLOR_MATRIX = 0x40;

const MOTOR_MODE_APOS = 3; // absolute position, int16 degrees (-180..179)
// On real Essential Hubs the sensor's own color mode (0) did not report color numbers,
// so we read hue/saturation/brightness (mode 6, three int16) and decide the color here.
const COLOR_MODE_HSV = 6;
const MATRIX_MODE_PIXELS = 2; // 9 bytes: (brightness << 4) | color

const SNAPSHOT_MS = 200;
const STARTUP_SETTLE_MS = 600;
const COMMAND_TIMEOUT_MS = 15000;

// The color a program should use: a new color counts once the sensor has kept seeing
// it for STABLE_MS. That ignores a single odd reading while a brick moves, but reacts
// almost at once (the sensor itself only reports when something changes).
export const STABLE_MS = 100;
export function stableColor(dev) {
  if (dev.colorSince === undefined) return dev.color;
  if (Date.now() - dev.colorSince >= STABLE_MS) return dev.color;
  return dev.prevStable !== undefined ? dev.prevStable : dev.color;
}

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
    this.rgbPort = null;
    this.tilt = null; // { pitch, roll } in degrees, when the Hub reports it
    this.gesture = null; // last tap, bump or shake
    this.tiltHistory = []; // recent tilt readings, to tell a tap from being put down
    this.ports = new Map(); // port -> { kind, type, ...values }
    this.pending = new Map(); // port -> { resolve, timer, sawProgress }
    this.spinning = new Set();
    this.stats = { messages: 0, lastAt: 0, lastValue: {} }; // motors started with "keep turning" and not stopped yet
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
    for (const port of [...this.pending.keys()]) this._finish(port, false);
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

  _subscribe(port, mode, delta = 1) {
    // delta (uint32), notifications on
    return this._send(msg(T.PORT_INPUT_FORMAT_SETUP, port, mode, delta, 0, 0, 0, 1));
  }

  // ---------- Commands ----------

  // Sends a port output command and resolves when the hub reports it finished
  // (true) or discarded (false).
  _command(port, subcommand, payload, { wait = true, timeoutMs = COMMAND_TIMEOUT_MS } = {}) {
    const previous = this.pending.get(port);
    if (previous) this._finish(port, false);
    const done = wait
      ? new Promise((resolve) => {
          const timer = setTimeout(() => this._finish(port, true), timeoutMs);
          this.pending.set(port, { resolve, timer, sawProgress: false });
        })
      : Promise.resolve(true);
    // 0x11 = execute immediately + send command feedback
    this._send(msg(T.PORT_OUTPUT_COMMAND, port, 0x11, subcommand, ...payload));
    return done;
  }

  _finish(port, completed) {
    const c = this.pending.get(port);
    if (!c) return;
    clearTimeout(c.timer);
    this.pending.delete(port);
    c.resolve(completed);
  }

  runForDegrees(port, degrees, speed) {
    this.spinning.delete(port);
    // Allow plenty of time: about 6 degrees per second per 1% speed, times two, plus 5 s.
    const timeoutMs = (Math.abs(degrees) / Math.max(1, Math.abs(speed) * 6)) * 2000 + 5000;
    const d = new DataView(new ArrayBuffer(4));
    d.setInt32(0, Math.abs(Math.round(degrees)), true);
    const sp = Math.sign(degrees || 1) * Math.abs(speed);
    // StartSpeedForDegrees: degrees, speed, max power, end state (127 = brake), profile
    return this._command(port, 0x0b, [...new Uint8Array(d.buffer), sp & 0xff, 100, 127, 0], { timeoutMs });
  }

  runForTime(port, ms, speed) {
    this.spinning.delete(port);
    const d = new DataView(new ArrayBuffer(2));
    d.setInt16(0, Math.min(32000, Math.round(ms)), true);
    // StartSpeedForTime: time, speed, max power, end state, profile
    return this._command(port, 0x09, [...new Uint8Array(d.buffer), speed & 0xff, 100, 127, 0], {
      timeoutMs: ms + 5000,
    });
  }

  startSpeed(port, speed) {
    this.spinning.add(port);
    // StartSpeed: speed, max power, profile. Runs until stopped.
    return this._command(port, 0x07, [speed & 0xff, 100, 0], { wait: false });
  }

  brake(port) {
    this.spinning.delete(port);
    // WriteDirectModeData, mode 0 = StartPower, 127 = brake
    return this._command(port, 0x51, [0x00, 127], { wait: false });
  }

  setMatrix(port, pixels) {
    // pixels: 9 x { color, brightness 0..10 }
    const bytes = pixels.map((p) => ((p.brightness & 0x0f) << 4) | (p.color & 0x0f));
    const dev = this.ports.get(port);
    if (dev) {
      // Same picture as last time: nothing to send (keeps fast loops light).
      if (dev.lastBytes && dev.lastBytes.join() === bytes.join()) return Promise.resolve(true);
      dev.lastBytes = bytes;
      dev.pixels = pixels;
    }
    return this._command(port, 0x51, [MATRIX_MODE_PIXELS, ...bytes], { wait: false });
  }

  setHubLight(color) {
    if (this.rgbPort == null) return Promise.resolve(false);
    // WriteDirectModeData, mode 0 = color index (0 = off)
    return this._command(this.rgbPort, 0x51, [0x00, color], { wait: false });
  }

  // The Hub sends the same signal (1) for a tap and for being put down on a table.
  // Measured on a real Hub: when it is put down, it was tilting a lot just before;
  // a tap comes while the Hub is resting. So: still for the last 0.8 s = tap.
  // Looks at the tilt from 0.8 s before the signal until a moment after it.
  _tapOrBump(at) {
    const around = this.tiltHistory.filter((x) => x.at >= at - TAP_STILL_MS && x.at <= at + TAP_AFTER_MS);
    if (around.length < 2) return 'tap';
    let moved = 0;
    for (const a of around) {
      for (const b of around) moved = Math.max(moved, Math.abs(a.pitch - b.pitch) + Math.abs(a.roll - b.roll));
    }
    return moved < TAP_MAX_MOVE_DEG ? 'tap' : 'bump';
  }

  // True if the Hub reported this gesture a moment ago: 'tap', 'bump' or 'shake'.
  recentGesture(kind) {
    return !!(this.gesture && this.gesture.kind === kind && Date.now() - this.gesture.at < GESTURE_MEMORY_MS);
  }

  deviceAt(port) {
    return this.ports.get(port) || null;
  }

  // Used by the quick motor test: one turn with progress markers.
  async motorDegrees(port, degrees, speed = 50) {
    this.emit('consoleLine', '@BASLA');
    this.emit('consoleLine', '@ADIM 1');
    this.testRunning = true;
    const ok = await this.runForDegrees(port, degrees, speed);
    if (this.testRunning && ok) this.emit('consoleLine', '@BITTI');
    this.testRunning = false;
  }

  async stopAll() {
    for (const port of [...this.pending.keys()]) this._finish(port, false);
    for (const [port, dev] of this.ports) {
      if (dev.kind === 'motor') this.brake(port);
    }
    if (this.testRunning) {
      this.testRunning = false;
      this.emit('programStopped');
    }
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
    // Diagnostics (read with the browser console): message count and last raw values per port.
    this.stats.messages += 1;
    this.stats.lastAt = Date.now();
    if (type === T.PORT_VALUE_SINGLE) this.stats.lastValue[m[headerLen + 2]] = Array.from(m);
    const p = headerLen + 2; // first payload byte
    const v = new DataView(m.buffer, m.byteOffset, m.byteLength);

    switch (type) {
      case T.HUB_PROPERTIES:
        if (m[p] === PROP_BATTERY && m[p + 1] === 0x06) this.battery = m[p + 2];
        break;

      case T.HUB_ATTACHED_IO: {
        const port = m[p];
        const event = m[p + 1];
        if (port > 1) {
          // internal ports: remember where the Hub's own light is, and use the motion sensors
          if (event === 1 && v.getUint16(p + 2, true) === RGB_LIGHT) this.rgbPort = port;
          if (event === 1 && port === TILT_PORT) this._subscribe(TILT_PORT, 0, 10);
          if (event === 1 && port === GESTURE_PORT) this._subscribe(GESTURE_PORT, 0, 1);
          break;
        }
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
            dev.hsv = null;
            this._subscribe(port, COLOR_MODE_HSV, 5);
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
        if (port === TILT_PORT && m.length >= p + 7) {
          this.tilt = { pitch: v.getInt16(p + 3, true) / 10, roll: v.getInt16(p + 5, true) / 10 };
          const now = Date.now();
          this.tiltHistory = [...this.tiltHistory.filter((x) => now - x.at < 1500), { ...this.tilt, at: now }];
          break;
        }
        if (port === GESTURE_PORT) {
          const code = m[p + 1];
          if (code === 3) this.gesture = { code, kind: 'shake', at: Date.now() };
          else if (code) {
            // Decide a moment later: lifting the Hub can send this signal just before it tilts.
            const at = Date.now();
            setTimeout(() => {
              this.gesture = { code, kind: this._tapOrBump(at), at };
              this._emitSnapshot();
            }, TAP_AFTER_MS);
          }
          break;
        }
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
            if (Math.abs(delta) >= 2) dev.lastMoveAt = Date.now();
          }
          dev._lastAbs = abs;
          dev.absPosition = abs;
        } else if (dev.kind === 'color' && m.length >= p + 7) {
          const h = v.getInt16(p + 1, true);
          const s = v.getInt16(p + 3, true);
          const b = v.getInt16(p + 5, true);
          dev.hsv = { h, s, v: b };
          const c = colorFromHsv(h, s, b);
          if (c !== dev.color) {
            dev.prevStable = stableColor(dev);
            dev.color = c;
            dev.colorSince = Date.now();
          }
        }
        break;
      }

      case T.PORT_OUTPUT_FEEDBACK: {
        // payload: (port, flags) pairs
        for (let i = p; i + 1 < m.length; i += 2) {
          const port = m[i];
          const flags = m[i + 1];
          const c = this.pending.get(port);
          if (!c) continue;
          if (flags & 0x01) c.sawProgress = true;
          if (flags & 0x02 || (c.sawProgress && flags & 0x08)) this._finish(port, true);
          else if (flags & 0x04) this._finish(port, false);
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
