// A fake SPIKE hub that speaks the real protocol, injected as navigator.bluetooth.
(() => {
  const said = [];
  window.__said = said;
  const state = { battery: 80, motorPos: 0, color: 3, colorAttached: true };
  window.__fake = state;

  let cobs = null;
  const ready = import('/js/cobs.js').then((m) => (cobs = m));

  const tx = new EventTarget();
  tx.value = null;
  tx.startNotifications = async () => tx;

  const send = (bytes) => {
    const framed = cobs.pack(Uint8Array.from(bytes));
    // deliver in 20-byte pieces like real BLE
    for (let i = 0; i < framed.length; i += 20) {
      const piece = framed.slice(i, i + 20);
      tx.value = new DataView(piece.buffer, piece.byteOffset, piece.byteLength);
      tx.dispatchEvent(new Event('characteristicvaluechanged'));
    }
  };
  const u16 = (n) => [n & 0xff, (n >> 8) & 0xff];
  const str = (s) => [...new TextEncoder().encode(s), 0];
  const consoleLine = (s) => send([0x21, ...str(s + '\n')]);

  let timer = null;
  let decoder = null;
  const device = new EventTarget();
  device.name = 'Test Hub';

  function deviceNotification() {
    const b = [0x00, state.battery];
    const m = new DataView(new ArrayBuffer(12));
    m.setUint8(0, 0x0a); m.setUint8(1, 0); m.setUint8(2, 0x41);
    const abs = ((((state.motorPos + 180) % 360) + 360) % 360) - 180;
    m.setInt16(3, abs, true); m.setInt16(5, 0, true); m.setInt8(7, 0); m.setInt32(8, state.motorPos, true);
    b.push(...new Uint8Array(m.buffer));
    if (state.colorAttached) {
      const c = new DataView(new ArrayBuffer(9));
      c.setUint8(0, 0x0c); c.setUint8(1, 1); c.setInt8(2, state.color);
      b.push(...new Uint8Array(c.buffer));
    }
    send([0x3c, ...u16(b.length), ...b]);
  }

  function handle(msg) {
    switch (msg[0]) {
      case 0x00:
        send([0x01, 1, 0, ...u16(1), 1, 0, ...u16(1), ...u16(20), ...u16(1000), ...u16(100), ...u16(0)]);
        break;
      case 0x18:
        send([0x19, ...str('Test Hub')]);
        break;
      case 0x28:
        send([0x29, 0]);
        clearInterval(timer);
        timer = setInterval(deviceNotification, 100);
        break;
      case 0x46: send([0x47, 0]); break;
      case 0x0c: send([0x0d, 0]); break;
      case 0x10: send([0x11, 0]); break;
      case 0x1e:
        send([0x1f, 0]);
        if (msg[1] === 0) {
          setTimeout(() => { consoleLine('@BASLA'); consoleLine('@ADIM 1'); }, 100);
          setTimeout(() => { state.motorPos += 360; consoleLine('@BITTI'); send([0x20, 1]); }, 1500);
        } else {
          send([0x20, 1]);
        }
        break;
    }
  }

  const rx = {
    async writeValueWithoutResponse(buf) {
      await ready;
      decoder = decoder || new cobs.FrameDecoder();
      for (const msg of decoder.push(new Uint8Array(buf))) handle(msg);
    },
  };

  const gatt = {
    connected: false,
    async connect() { await ready; this.connected = true; return server; },
    disconnect() {
      this.connected = false;
      clearInterval(timer);
      device.dispatchEvent(new Event('gattserverdisconnected'));
    },
  };
  device.gatt = gatt;
  const server = {
    async getPrimaryService() {
      return { async getCharacteristic(uuid) { return uuid.includes('0001') ? rx : tx; } };
    },
  };

  device.watchAdvertisements = async () => {
    setTimeout(() => device.dispatchEvent(new Event('advertisementreceived')), 200);
  };
  const bt = { async requestDevice() { return device; }, async getAvailability() { return true; } };
  // "?hafiza" simulates Chrome remembering a Hub (navigator.bluetooth.getDevices)
  if (location.search.includes('hafiza')) bt.getDevices = async () => [device];
  Object.defineProperty(navigator, 'bluetooth', { value: bt });

  // Record everything sent to the live regions.
  document.addEventListener('DOMContentLoaded', () => {
    for (const id of ['duyuru-normal', 'duyuru-acil']) {
      const el = document.getElementById(id);
      new MutationObserver(() => { if (el.textContent) said.push(el.textContent); })
        .observe(el, { childList: true, characterData: true, subtree: true });
    }
  });
})();
