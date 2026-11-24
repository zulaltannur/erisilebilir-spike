// Connection to a SPIKE hub over Web Bluetooth.
// Emits events: 'disconnected', 'devices', 'consoleLine', 'programStopped'.

import { pack, FrameDecoder } from './cobs.js';
import { crc32 } from './crc.js';
import * as P from './protocol.js';

const REQUEST_TIMEOUT_MS = 5000;

export class Hub extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.rx = null;
    this.tx = null;
    this.info = null;
    this.name = '';
    this.decoder = new FrameDecoder();
    this.pending = null; // { id, resolve, reject, timer }
    this.queue = Promise.resolve(); // serializes requests
    this.consoleBuffer = '';
  }

  static isSupported() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  get connected() {
    return !!(this.device && this.device.gatt && this.device.gatt.connected);
  }

  async connect(notificationIntervalMs = 200) {
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [P.SERVICE_UUID] }],
    });
    this.device.addEventListener('gattserverdisconnected', () => this._onDisconnected());

    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(P.SERVICE_UUID);
    this.rx = await service.getCharacteristic(P.RX_UUID);
    this.tx = await service.getCharacteristic(P.TX_UUID);
    this.decoder.reset();
    this.tx.addEventListener('characteristicvaluechanged', (e) => this._onData(e.target.value));
    await this.tx.startNotifications();

    // The first message must always be an InfoRequest.
    const info = await this.request(P.infoRequest(), P.MSG.INFO_RES);
    this.info = P.parseInfoResponse(info);

    try {
      const nameRes = await this.request(P.getHubNameRequest(), P.MSG.GET_NAME_RES);
      this.name = P.parseString(nameRes);
    } catch {
      this.name = this.device.name || '';
    }

    const notif = await this.request(
      P.deviceNotificationRequest(notificationIntervalMs),
      P.MSG.DEVICE_NOTIF_RES,
    );
    if (!P.parseStatus(notif)) throw new Error('Hub canlı veri göndermeyi kabul etmedi.');
  }

  disconnect() {
    if (this.connected) this.device.gatt.disconnect();
  }

  // ---------- Sending ----------

  async _write(payload) {
    const frame = pack(payload);
    const size = this.info ? this.info.maxPacketSize : frame.length;
    for (let i = 0; i < frame.length; i += size) {
      await this.rx.writeValueWithoutResponse(frame.slice(i, i + size));
    }
  }

  // Send a message and wait for a response with the given message id.
  request(payload, responseId) {
    const run = () =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending = null;
          reject(new Error('Hub yanıt vermedi.'));
        }, REQUEST_TIMEOUT_MS);
        this.pending = { id: responseId, resolve, reject, timer };
        this._write(payload).catch((err) => {
          clearTimeout(timer);
          this.pending = null;
          reject(err);
        });
      });
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  // ---------- Programs ----------

  async uploadAndRun(code, slot = 0) {
    const bytes = new TextEncoder().encode(code);
    // Clearing may be "not acknowledged" if the slot is already empty; that's fine.
    await this.request(P.clearSlotRequest(slot), P.MSG.CLEAR_SLOT_RES).catch(() => {});

    const start = await this.request(
      P.startFileUploadRequest('program.py', slot, crc32(bytes)),
      P.MSG.START_UPLOAD_RES,
    );
    if (!P.parseStatus(start)) throw new Error('Hub program yüklemeyi başlatmadı.');

    const chunkSize = this.info.maxChunkSize;
    let running = 0;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.slice(i, i + chunkSize);
      running = crc32(chunk, running);
      const res = await this.request(P.transferChunkRequest(running, chunk), P.MSG.CHUNK_RES);
      if (!P.parseStatus(res)) throw new Error('Program parçası yüklenemedi.');
    }

    const flow = await this.request(P.programFlowRequest(false, slot), P.MSG.PROGRAM_FLOW_RES);
    if (!P.parseStatus(flow)) throw new Error('Program başlatılamadı.');
  }

  async stopProgram(slot = 0) {
    await this.request(P.programFlowRequest(true, slot), P.MSG.PROGRAM_FLOW_RES);
  }

  // ---------- Receiving ----------

  _onData(dataView) {
    const chunk = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
    for (const msg of this.decoder.push(chunk)) this._handleMessage(msg);
  }

  _handleMessage(d) {
    if (!d.length) return;
    const id = d[0];

    if (this.pending && id === this.pending.id) {
      const { resolve, timer } = this.pending;
      clearTimeout(timer);
      this.pending = null;
      resolve(d);
      return;
    }

    switch (id) {
      case P.MSG.DEVICE_NOTIF:
        this._emit('devices', P.parseDeviceNotification(d));
        break;
      case P.MSG.CONSOLE_NOTIF:
        this._handleConsole(P.parseString(d));
        break;
      case P.MSG.PROGRAM_FLOW_NOTIF:
        if (d[1] === 1) this._emit('programStopped');
        break;
      default:
        break;
    }
  }

  _handleConsole(text) {
    this.consoleBuffer += text;
    const lines = this.consoleBuffer.split('\n');
    this.consoleBuffer = lines.pop();
    for (const line of lines) {
      const clean = line.replace(/\r$/, '');
      if (clean) this._emit('consoleLine', clean);
    }
  }

  _onDisconnected() {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error('Bağlantı koptu.'));
      this.pending = null;
    }
    this._emit('disconnected');
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
