import { Hub } from './hub.js';
import { Announcer } from './announcer.js';
import { play, setSoundsEnabled } from './sounds.js';
import { T, PORT_NAMES, DEVICE_NAMES, colorName, isRealColor } from './texts.js';
import { motorOneTurnProgram, parseConsoleLine } from './programs.js';
import { Editor } from './editor.js';
import { Runner } from './runner.js';
import { validate } from './program-model.js';

const $ = (id) => document.getElementById(id);

const PROGRAM_SLOT = 0;
const LOW_BATTERY = 20;
const MOTOR_MOVE_THRESHOLD = 3; // degrees between two updates
const MOTOR_STILL_COUNT = 2; // updates without movement = stopped
const COLOR_CONFIRM_COUNT = 3; // same new color this many updates in a row (about 0.6 s)

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
  pendingCount: [0, 0],
  programRunning: false,
  programSteps: [],
  batteryWarned: false,
  awaitingFirstSnapshot: false, // set on connect; first data is reported in one sentence
  programEndedAt: 0,
};

// ---------- Connection ----------

// Chrome's pairing window is not read by screen readers. While it is open we guide
// with sounds: a tick every second while Chrome scans, then a bell meaning
// "the Hub should be in the list now: press Down arrow, then Enter".
// The bell repeats every 5 seconds until the window closes.
const PAIRING_SCAN_SECONDS = 4;
function startPairingCues() {
  let seconds = 0;
  const id = setInterval(() => {
    seconds += 1;
    if (seconds < PAIRING_SCAN_SECONDS) play('tick', { essential: true });
    else if ((seconds - PAIRING_SCAN_SECONDS) % 5 === 0) play('ready', { essential: true });
    if (seconds > 60) clearInterval(id);
  }, 1000);
  play('tick', { essential: true });
  return () => clearInterval(id);
}

function setConnectedUI(connected) {
  $('baglan-btn').hidden = connected;
  $('kes-btn').hidden = !connected;
  $('yeni-hub-btn').hidden = connected || !Hub.canRemember();
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

async function connect({ forceChooser = false } = {}) {
  if (!Hub.isSupported()) {
    say(T.notSupported, { urgent: true });
    return;
  }
  if (!(await Hub.isAvailable())) {
    say(T.bluetoothOff, { urgent: true });
    return;
  }
  try {
    // A remembered Hub connects without Chrome's device list, which screen readers
    // can't read well. The list is only needed the first time (or for a new Hub).
    const known = forceChooser ? [] : await Hub.knownHubs();
    if (known.length) {
      let lastErr = null;
      let ok = false;
      for (const device of known) {
        say(T.connectingKnown(device.name));
        try {
          await hub.connectKnown(device);
          ok = true;
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!ok) throw lastErr;
    } else {
      say(T.connecting);
      const stopCues = startPairingCues();
      try {
        await hub.connect();
      } finally {
        stopCues();
      }
    }
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
    } else if (err && err.name === 'NotNearbyError') {
      say(T.knownNotNearby, { urgent: true });
    } else {
      play('error');
      say(T.connectFailed(err && err.message ? err.message : ''), { urgent: true });
    }
    setConnectedUI(false);
  }
}

hub.addEventListener('disconnected', () => {
  if (runner.running) runner.stop();
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

    // Color: announce only after the same new color is seen several times in a row,
    // and never announce "no color" (the sensor flickers when nothing is in front of it).
    if (after && after.kind === 'color') {
      const freshlyAttached = !before || before.kind !== 'color';
      if (freshlyAttached) {
        state.confirmedColor[i] = after.color;
        state.pendingColor[i] = null;
        state.pendingCount[i] = 0;
      } else if (after.color === state.confirmedColor[i]) {
        state.pendingColor[i] = null;
        state.pendingCount[i] = 0;
      } else if (after.color === state.pendingColor[i]) {
        state.pendingCount[i] += 1;
        if (state.pendingCount[i] >= COLOR_CONFIRM_COUNT) {
          state.confirmedColor[i] = after.color;
          state.pendingColor[i] = null;
          state.pendingCount[i] = 0;
          if (isRealColor(after.color)) say(T.colorSeen(colorName(after.color)));
        }
      } else {
        state.pendingColor[i] = after.color;
        state.pendingCount[i] = 1;
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
    await hub.runMotorTurn(i, motorOneTurnProgram, PROGRAM_SLOT);
  } catch (err) {
    state.programRunning = false;
    play('error');
    say(T.programUploadFailed(err.message), { urgent: true });
  }
}

// ---------- Program editor ----------

const editor = new Editor({
  list: $('program-liste'),
  dialog: $('komut-dialog'),
  form: $('komut-form'),
  fields: $('komut-alanlar'),
  title: $('komut-dialog-baslik'),
  cancelBtn: $('komut-iptal'),
  say,
});

const PROGRAM_SOUNDS = { beep: 'attach', bell: 'ready', success: 'programEnd' };

const runner = new Runner({
  getSession: () => hub.lwp,
  onStep: (index, n, text) => {
    editor.setRunning(index);
    say(T.programStep(n, text));
  },
  onRound: (index, round, times) => {
    editor.setRunning(index);
    say(T.programRound(round, times));
  },
  onDone: (completed) => {
    state.programRunning = false;
    state.programEndedAt = Date.now();
    editor.setRunning(-1);
    if (completed) {
      play('programEnd');
      say(T.programDone);
    } else {
      say(T.programStopped, { urgent: true });
    }
  },
  onError: (message) => {
    state.programRunning = false;
    state.programEndedAt = Date.now();
    editor.setRunning(-1);
    play('error');
    say(T.programRunError(message), { urgent: true });
    if (hub.lwp) hub.lwp.stopAll();
  },
  playSound: (name) => play(PROGRAM_SOUNDS[name] || 'attach', { essential: true }),
});

function runProgram() {
  if (!hub.connected) return say(T.notConnected, { urgent: true });
  if (hub.protocol !== 'lwp') return say(T.programNeedsEssential, { urgent: true });
  if (runner.running) return;
  if (!editor.program.length) return say(T.programEmpty, { urgent: true });
  const problem = validate(editor.program);
  if (problem) {
    say(problem.message, { urgent: true });
    editor.setActive(problem.index);
    editor.list.focus();
    return;
  }
  state.programRunning = true;
  play('programStart');
  say(T.programStarted);
  runner.run(editor.program);
}

async function stopProgram() {
  if (runner.running) {
    runner.stop();
    return;
  }
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
    if (state.programRunning || runner.running) stopProgram();
    return;
  }

  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    runProgram();
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
      runProgram();
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

$('baglan-btn').addEventListener('click', () => connect());
$('yeni-hub-btn').addEventListener('click', () => connect({ forceChooser: true }));
$('yeni-hub-btn').hidden = !Hub.canRemember();
$('kes-btn').addEventListener('click', () => hub.disconnect());
$('calistir-btn').addEventListener('click', runMotorTest);
$('ekle-btn').addEventListener('click', () => editor.openAdd());
$('program-calistir-btn').addEventListener('click', runProgram);
$('program-durdur-btn').addEventListener('click', stopProgram);
$('program-temizle-btn').addEventListener('click', () => editor.clear());
$('durdur-btn').addEventListener('click', stopProgram);
$('yardim-btn').addEventListener('click', () => $('yardim-dialog').showModal());
$('tani-btn').addEventListener('click', async () => {
  if (!Hub.isSupported()) return say(T.notSupported, { urgent: true });
  say(T.pairHelp);
  const stopCues = startPairingCues();
  try {
    const result = await Hub.diagnose();
    stopCues();
    say(T.diagnoseResult(result));
  } catch (err) {
    stopCues();
    if (err && err.message) announcer.addToLog(`Teknik ayrıntı: ${err.name}: ${err.message}`);
    if (err && err.name === 'NotFoundError') say(T.connectCancelled);
    else say(T.connectFailed(err && err.message ? err.message : ''), { urgent: true });
  }
});
$('ses-ayari').addEventListener('change', (e) => setSoundsEnabled(e.target.checked));

$('baglanti-yardim').textContent = Hub.isSupported() ? T.connectHelp : T.notSupported;
setConnectedUI(false);
