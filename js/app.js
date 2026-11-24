import { Hub } from './hub.js';
import { Announcer } from './announcer.js';
import { play, setSoundsEnabled } from './sounds.js';
import { T, PORT_NAMES, DEVICE_NAMES, colorName } from './texts.js';
import { motorOneTurnProgram, parseConsoleLine } from './programs.js';

const $ = (id) => document.getElementById(id);

const PROGRAM_SLOT = 0;
const LOW_BATTERY = 20;
const MOTOR_MOVE_THRESHOLD = 3; // degrees between two updates
const MOTOR_STILL_COUNT = 2; // updates without movement = stopped

const hub = new Hub();
const announcer = new Announcer({
  politeEl: $('duyuru-normal'),
  assertiveEl: $('duyuru-acil'),
  logEl: $('gecmis'),
});
const say = (text, opts) => announcer.say(text, opts);

const state = {
  battery: null,
  ports: [null, null], // latest device on port A and B
  motorMoving: [false, false],
  motorStill: [0, 0],
  confirmedColor: [null, null], // color shown and announced
  pendingColor: [null, null], // new color waiting for confirmation
  programRunning: false,
  programSteps: [],
  batteryWarned: false,
  awaitingFirstSnapshot: false, // set on connect; first data is reported in one sentence
  programEndedAt: 0,
};

// ---------- Connection ----------

function setConnectedUI(connected) {
  $('baglan-btn').hidden = connected;
  $('kes-btn').hidden = !connected;
  $('baglanti-durum').textContent = connected
    ? `Bağlı: ${hub.name || 'isimsiz Hub'}`
    : 'Bağlı değil';
  $('calistir-btn').setAttribute('aria-disabled', String(!connected));
  if (!connected) {
    state.ports = [null, null];
    state.battery = null;
    state.programRunning = false;
  }
  renderList();
}

async function connect() {
  if (!Hub.isSupported()) {
    say(T.notSupported, { urgent: true });
    return;
  }
  if (!(await Hub.isAvailable())) {
    say(T.bluetoothOff, { urgent: true });
    return;
  }
  say(T.connecting);
  try {
    await hub.connect();
    state.awaitingFirstSnapshot = true;
    setConnectedUI(true);
    play('connected');
    $('kes-btn').focus();
    // The connected message is spoken when the first live data arrives (see 'devices').
    setTimeout(() => {
      if (state.awaitingFirstSnapshot) {
        state.awaitingFirstSnapshot = false;
        say(T.connected(hub.name, state.battery, ''));
      }
    }, 1500);
  } catch (err) {
    if (err && err.message) announcer.addToLog(`Teknik ayrıntı: ${err.name}: ${err.message}`);
    if (err && err.name === 'NotFoundError') {
      say(T.connectCancelled);
    } else if (err && err.name === 'OldFirmwareError') {
      play('error');
      say(T.oldFirmware, { urgent: true });
    } else {
      play('error');
      say(T.connectFailed(err && err.message ? err.message : ''), { urgent: true });
    }
    setConnectedUI(false);
  }
}

hub.addEventListener('disconnected', () => {
  const hadFocusOnDisconnect = document.activeElement === $('kes-btn');
  setConnectedUI(false);
  play('disconnected');
  say(T.disconnected, { urgent: true });
  if (hadFocusOnDisconnect) $('baglan-btn').focus();
});

// ---------- Live device data ----------

function describePort(i) {
  const p = PORT_NAMES[i];
  const dev = state.ports[i];
  if (!dev) return T.portEmpty(p);
  switch (dev.kind) {
    case 'motor':
      return T.motorValue(p, normalizeDegrees(dev.absPosition));
    case 'color':
      return T.colorValue(p, colorName(state.confirmedColor[i] ?? dev.color));
    case 'matrix3x3': {
      const lit = dev.pixels.filter((px) => px.brightness > 0);
      const names = [...new Set(lit.map((px) => colorName(px.color)))].join(', ');
      return T.matrixValue(p, lit.length, names);
    }
    default:
      return T.otherValue(p, DEVICE_NAMES[dev.kind] || dev.kind);
  }
}

const normalizeDegrees = (d) => ((d % 360) + 360) % 360;

function portsSummary() {
  return state.ports
    .map((dev, i) => `Port ${PORT_NAMES[i]}: ${dev ? DEVICE_NAMES[dev.kind] || dev.kind : 'boş'}`)
    .join(', ');
}

hub.addEventListener('devices', (e) => {
  const devices = e.detail;
  const newPorts = [null, null];

  for (const dev of devices) {
    if (dev.kind === 'battery') {
      state.battery = dev.level;
      if (dev.level <= LOW_BATTERY && !state.batteryWarned) {
        state.batteryWarned = true;
        say(T.batteryLow(dev.level), { urgent: true });
      }
    } else if (dev.port === 0 || dev.port === 1) {
      newPorts[dev.port] = dev;
    }
  }

  if (state.awaitingFirstSnapshot) {
    // First data after connecting: record silently, announce everything in one sentence.
    state.awaitingFirstSnapshot = false;
    state.ports = newPorts;
    newPorts.forEach((dev, i) => {
      if (dev && dev.kind === 'color') state.confirmedColor[i] = dev.color;
    });
    renderList();
    say(T.connected(hub.name, state.battery, portsSummary()));
    return;
  }

  for (let i = 0; i < 2; i++) {
    const before = state.ports[i];
    const after = newPorts[i];
    const p = PORT_NAMES[i];

    // Attach / detach
    if (!before && after) {
      play('attach');
      say(T.attached(p, DEVICE_NAMES[after.kind] || after.kind));
    } else if (before && !after) {
      play('detach');
      say(T.detached(p));
    } else if (before && after && before.kind !== after.kind) {
      say(T.attached(p, DEVICE_NAMES[after.kind] || after.kind));
    }

    // Motor turned by hand (or by a program) and then held still
    if (after && after.kind === 'motor') {
      const delta = before && before.kind === 'motor' ? Math.abs(after.position - before.position) : 0;
      if (delta >= MOTOR_MOVE_THRESHOLD) {
        state.motorMoving[i] = true;
        state.motorStill[i] = 0;
      } else if (state.motorMoving[i]) {
        state.motorStill[i] += 1;
        if (state.motorStill[i] >= MOTOR_STILL_COUNT) {
          state.motorMoving[i] = false;
          const justFinished = Date.now() - state.programEndedAt < 1500;
          if (!state.programRunning && !justFinished) {
            say(T.motorStopped(p, normalizeDegrees(after.absPosition)));
          }
        }
      }
    }

    // Color: announce only after the same new color is seen twice in a row
    if (after && after.kind === 'color') {
      const freshlyAttached = !before || before.kind !== 'color';
      if (freshlyAttached) {
        state.confirmedColor[i] = after.color;
        state.pendingColor[i] = null;
      } else if (after.color === state.confirmedColor[i]) {
        state.pendingColor[i] = null;
      } else if (after.color === state.pendingColor[i]) {
        state.confirmedColor[i] = after.color;
        state.pendingColor[i] = null;
        if (after.color !== -1) say(T.colorSeen(colorName(after.color)));
      } else {
        state.pendingColor[i] = after.color;
      }
    }
  }

  state.ports = newPorts;
  renderList();
});

// ---------- Keşfet listbox ----------

const list = $('kesfet-liste');
const options = () => Array.from(list.querySelectorAll('[role="option"]'));
let activeIndex = 0;

function renderList() {
  const opts = options();
  opts[0].textContent = hub.connected
    ? T.hubOption(hub.name, state.battery)
    : T.hubNotConnectedOption;
  opts[1].textContent = describePort(0);
  opts[2].textContent = describePort(1);
  setActive(activeIndex, false);
}

function setActive(index, announce = true) {
  const opts = options();
  activeIndex = Math.max(0, Math.min(index, opts.length - 1));
  opts.forEach((o, i) => o.setAttribute('aria-selected', String(i === activeIndex)));
  list.setAttribute('aria-activedescendant', opts[activeIndex].id);
  opts[activeIndex].scrollIntoView({ block: 'nearest' });
  if (announce === 'reread') say(opts[activeIndex].textContent, { logIt: false });
}

list.addEventListener('keydown', (e) => {
  const opts = options();
  switch (e.key) {
    case 'ArrowDown':
      setActive(activeIndex + 1);
      break;
    case 'ArrowUp':
      setActive(activeIndex - 1);
      break;
    case 'Home':
      setActive(0);
      break;
    case 'End':
      setActive(opts.length - 1);
      break;
    case 'Enter':
    case ' ':
      setActive(activeIndex, 'reread');
      break;
    default:
      return;
  }
  e.preventDefault();
});

list.addEventListener('click', (e) => {
  const opt = e.target.closest('[role="option"]');
  if (opt) setActive(options().indexOf(opt), 'reread');
});

// ---------- Programs ----------

function selectedMotorPort() {
  return Number(document.querySelector('input[name="motor-port"]:checked').value);
}

async function runMotorTest() {
  if (!hub.connected) {
    say(T.notConnected, { urgent: true });
    return;
  }
  const i = selectedMotorPort();
  const dev = state.ports[i];
  if (!dev || dev.kind !== 'motor') {
    const other = state.ports.findIndex((d) => d && d.kind === 'motor');
    say(T.noMotorAt(PORT_NAMES[i], other >= 0 ? PORT_NAMES[other] : null), { urgent: true });
    return;
  }
  state.programSteps = [T.motorTurnStep(PORT_NAMES[i])];
  say(T.programStarting);
  try {
    state.programRunning = true;
    await hub.uploadAndRun(motorOneTurnProgram(i), PROGRAM_SLOT);
  } catch (err) {
    state.programRunning = false;
    play('error');
    say(T.programUploadFailed(err.message), { urgent: true });
  }
}

async function stopProgram() {
  if (!hub.connected) return;
  if (!state.programRunning) {
    say(T.nothingRunning);
    return;
  }
  try {
    await hub.stopProgram(PROGRAM_SLOT);
  } catch {
    /* the stop notification or disconnect will update the state */
  }
}

hub.addEventListener('consoleLine', (e) => {
  const msg = parseConsoleLine(e.detail);
  switch (msg.type) {
    case 'start':
      play('programStart');
      say(T.programStarted);
      break;
    case 'step':
      say(T.programStep(msg.step, state.programSteps[msg.step - 1] || ''));
      break;
    case 'done':
      state.programRunning = false;
      state.programEndedAt = Date.now();
      play('programEnd');
      say(T.programDone);
      break;
    case 'error':
      play('error');
      say(T.programError, { urgent: true });
      announcer.addToLog(msg.text);
      break;
    default:
      announcer.addToLog(msg.text);
  }
});

hub.addEventListener('programStopped', () => {
  if (state.programRunning) {
    state.programRunning = false;
    state.programEndedAt = Date.now();
    say(T.programStopped, { urgent: true });
  }
});

// ---------- Keyboard shortcuts ----------
// Universal keys work everywhere; letter keys only inside [data-kisayol-alani],
// so they never clash with the screen reader's own browse-mode letters.

function currentSectionName() {
  const section = document.activeElement && document.activeElement.closest('section');
  const heading = section && section.querySelector('h2');
  return heading ? heading.textContent.trim() : T.sectionUnknown;
}

function hubSummary() {
  if (!hub.connected) return T.notConnected;
  return [T.hubOption(hub.name, state.battery), describePort(0), describePort(1)].join('. ') + '.';
}

const isTextField = (el) =>
  el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['radio', 'checkbox', 'button'].includes(el.type)) || el.isContentEditable);

document.addEventListener('keydown', (e) => {
  // Escape always stops the robot. We don't prevent default, so open dialogs still close.
  if (e.key === 'Escape') {
    if (state.programRunning) stopProgram();
    return;
  }

  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    runMotorTest();
    return;
  }

  if (isTextField(e.target)) return;

  if (e.key === '?') {
    e.preventDefault();
    $('yardim-dialog').showModal();
    return;
  }

  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (!e.target.closest || !e.target.closest('[data-kisayol-alani]')) return;

  switch (e.key.toLowerCase()) {
    case 'r':
      runMotorTest();
      break;
    case 'h':
      say(hubSummary(), { logIt: false });
      break;
    case 'w':
      say(T.whereAmI(currentSectionName(), hub.connected), { logIt: false });
      break;
    default:
      return;
  }
  e.preventDefault();
});

// ---------- Wiring ----------

$('baglan-btn').addEventListener('click', connect);
$('kes-btn').addEventListener('click', () => hub.disconnect());
$('calistir-btn').addEventListener('click', runMotorTest);
$('durdur-btn').addEventListener('click', stopProgram);
$('yardim-btn').addEventListener('click', () => $('yardim-dialog').showModal());
$('tani-btn').addEventListener('click', async () => {
  if (!Hub.isSupported()) return say(T.notSupported, { urgent: true });
  say(T.pairHelp);
  try {
    say(T.diagnoseResult(await Hub.diagnose()));
  } catch (err) {
    if (err && err.message) announcer.addToLog(`Teknik ayrıntı: ${err.name}: ${err.message}`);
    if (err && err.name === 'NotFoundError') say(T.connectCancelled);
    else say(T.connectFailed(err && err.message ? err.message : ''), { urgent: true });
  }
});
$('ses-ayari').addEventListener('change', (e) => setSoundsEnabled(e.target.checked));

$('baglanti-yardim').textContent = Hub.isSupported() ? T.connectHelp : T.notSupported;
setConnectedUI(false);
