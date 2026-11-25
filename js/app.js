import { Hub } from './hub.js';
import { Announcer } from './announcer.js';
import { play, setSoundsEnabled, unlockAudio } from './sounds.js';
import { EXAMPLES } from './examples.js';
import { setCalibrationSample, clearCalibration, getCalibration } from './colorcal.js';
import { T, PORT_NAMES, DEVICE_NAMES, colorName, isRealColor } from './texts.js';
import { motorOneTurnProgram, parseConsoleLine } from './programs.js';
import { Editor } from './editor.js';
import { Runner, tiltWords } from './runner.js';
import { validate } from './program-model.js';

const $ = (id) => document.getElementById(id);

const PROGRAM_SLOT = 0;
const LOW_BATTERY = 20;
const MOTOR_MOVE_THRESHOLD = 3; // degrees between two updates
const MOTOR_STILL_COUNT = 2; // updates without movement = stopped
const MOTOR_TURN_MIN = 10; // degrees: smaller movements are jitter, not a turn
const TILT_SETTLE_MS = 500; // a new posture is announced after being held this long
const COLOR_CONFIRM_COUNT = 2; // same new color this many updates in a row (about 0.4 s)

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
  motorRest: [null, null], // position where each motor last rested
  confirmedColor: [null, null], // color shown and announced
  pendingColor: [null, null], // new color waiting for confirmation
  pendingCount: [0, 0],
  programRunning: false,
  programSteps: [],
  batteryWarned: false,
  awaitingFirstSnapshot: false, // set on connect; first data is reported in one sentence
  programEndedAt: 0,
  lastGestureAt: 0,
  tiltCandidate: null, // posture being held
  tiltSince: 0,
  tiltSaid: null, // posture last announced
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

    // Motor turned by hand (or by a program) and then held still.
    // A real motor jitters a few degrees on its own, so only a real turn counts:
    // at least MOTOR_TURN_MIN degrees away from where it last rested.
    if (after && after.kind === 'motor') {
      if (!before || before.kind !== 'motor' || state.motorRest[i] === null) state.motorRest[i] = after.position;
      const step = before && before.kind === 'motor' ? Math.abs(after.position - before.position) : 0;
      const away = Math.abs(after.position - state.motorRest[i]);
      if (step >= MOTOR_MOVE_THRESHOLD && away >= MOTOR_TURN_MIN) {
        state.motorMoving[i] = true;
        state.motorStill[i] = 0;
      } else if (state.motorMoving[i]) {
        state.motorStill[i] += 1;
        if (state.motorStill[i] >= MOTOR_STILL_COUNT) {
          state.motorMoving[i] = false;
          state.motorRest[i] = after.position;
          const justFinished = Date.now() - state.programEndedAt < 1500;
          if (!state.programRunning && !justFinished) {
            say(T.motorStopped(p, normalizeDegrees(after.absPosition)));
          }
        }
      } else if (step < MOTOR_MOVE_THRESHOLD) {
        // small jitter while resting: follow it slowly so drift is not announced later
        state.motorRest[i] = after.position;
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

  // While exploring: say how the Hub is held when that changes (after it has been held
  // still for a moment), when it is shaken and when it is tapped. Being put down is not
  // announced: the new posture ("Hub düz duruyor") already tells it.
  if (!state.programRunning && hub.lwp) {
    const g = hub.lwp.gesture;
    if (g && g.at !== state.lastGestureAt) {
      state.lastGestureAt = g.at;
      if (g.kind === 'shake') say({ forwardBack: 'Hub öne-arkaya sallandı.', sideways: 'Hub sağa-sola sallandı.' }[g.dir] || 'Hub sallandı.');
      if (g.kind === 'tap') say('Hub\'a vuruldu.');
    }
    const t = hub.lwp.tilt;
    if (t) {
      const words = tiltWords(t.pitch, t.roll);
      if (words !== state.tiltCandidate) {
        state.tiltCandidate = words;
        state.tiltSince = Date.now();
      } else if (words !== state.tiltSaid && Date.now() - state.tiltSince >= TILT_SETTLE_MS) {
        const first = state.tiltSaid === null;
        state.tiltSaid = words;
        if (!first) say(`${words}.`);
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
  const tilt = hub.lwp && hub.lwp.tilt ? `, ${tiltWords(hub.lwp.tilt.pitch, hub.lwp.tilt.roll)}` : '';
  opts[0].textContent = hub.connected
    ? T.hubOption(hub.name, state.battery) + tilt
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
  if (!opt) return;
  list.focus(); // puts a screen reader into focus mode, so letter keys work
  setActive(options().indexOf(opt), 'reread');
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
  findPort: (kind) => {
    const i = state.ports.findIndex((d) => d && d.kind === kind);
    return i >= 0 ? i : null;
  },
});

// An "Eğer" that is not inside a repeat is checked only once, at the moment the
// program reaches it. Children often expect it to keep watching, so we say so.
function ifCheckedOnlyOnce(program) {
  let repeatDepth = 0;
  for (const c of program) {
    if (c.type === 'repeatStart') repeatDepth++;
    if (c.type === 'repeatEnd') repeatDepth--;
    if (c.type === 'ifStart' && repeatDepth === 0) return true;
  }
  return false;
}

// In loops the same step comes back again and again. Say a step only the first time
// and whenever its result changes (for example "Eğer ...: evet" after "hayır").
const lastSpoken = new Map();
function repeatsItself(key, text) {
  if (lastSpoken.get(key) === text) return true;
  lastSpoken.set(key, text);
  return false;
}

const runner = new Runner({
  getSession: () => hub.lwp,
  onStep: (index, n, text, inEndlessLoop) => {
    editor.setRunning(index);
    if (inEndlessLoop && repeatsItself(`step-${index}`, text)) return;
    say(T.programStep(n, text));
  },
  onRound: (index, round, times) => {
    editor.setRunning(index);
    // Fast endless loops (for example watching a sensor) would flood the screen reader:
    // announce only the first round and then every 20th.
    if (times || round === 1 || round % 20 === 0) say(T.programRound(round, times), { logIt: round === 1 || !!times });
  },
  onInfo: (index, text, inEndlessLoop) => {
    editor.setRunning(index);
    // In an endless loop say "Eğer ...: evet / hayır" only when the answer changes.
    const key = `info-${index}`;
    const answer = text.replace(/, sensör şu an .* görüyor\.$/, '');
    if (inEndlessLoop && repeatsItself(key, answer)) return;
    say(text);
  },
  onDone: (completed) => {
    state.programRunning = false;
    state.programEndedAt = Date.now();
    editor.setRunning(-1);
    if (completed) {
      play('programEnd');
      const spinning = hub.lwp ? [...hub.lwp.spinning] : [];
      say(spinning.length ? T.programDoneSpinning(spinning.map((p) => PORT_NAMES[p]).join(' ve ')) : T.programDone);
      if (ifCheckedOnlyOnce(editor.program)) say(T.ifOnceTip);
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
  },
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
  lastSpoken.clear();
  play('programStart');
  say(T.programStarted);
  runner.run(editor.program);
}

// Stop always means: the robot must stand still now. Even when no program is
// running, motors may still be turning (for example after "Motoru sürekli döndür").
async function stopProgram() {
  if (runner.running) {
    runner.stop();
    return;
  }
  if (!hub.connected) return;
  if (hub.protocol === 'lwp') {
    const wasSpinning = hub.lwp.spinning.size > 0;
    await hub.lwp.stopAll();
    say(wasSpinning ? T.motorsStopped : T.nothingRunning, { urgent: wasSpinning });
    return;
  }
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
    const spinning = hub.lwp && hub.lwp.spinning.size > 0;
    if (state.programRunning || runner.running || spinning) stopProgram();
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

// Audio may only start after a user action: unlock it on every key press and click.
document.addEventListener('keydown', unlockAudio, true);
document.addEventListener('pointerdown', unlockAudio, true);

// ---------- Example programs ----------

const examplesDialog = $('ornek-dialog');
const examplesList = $('ornek-liste');
EXAMPLES.forEach((ex, i) => {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = ex.name;
  btn.setAttribute('aria-describedby', `ornek-aciklama-${i}`);
  const p = document.createElement('p');
  p.id = `ornek-aciklama-${i}`;
  p.textContent = ex.about;
  btn.addEventListener('click', () => {
    examplesDialog.close();
    editor.replaceProgram(
      JSON.parse(JSON.stringify(ex.program)),
      `Örnek yüklendi: ${ex.name}. Programda ${ex.program.length} komut var. Eski programa dönmek için Ctrl ve Z.`,
    );
    editor.list.focus();
  });
  li.append(btn, p);
  examplesList.append(li);
});
$('ornek-btn').addEventListener('click', () => {
  examplesDialog.showModal();
  examplesList.querySelector('button').focus();
});

// ---------- Save to / open from a file ----------

$('kaydet-btn').addEventListener('click', () => {
  if (!editor.program.length) return say(T.programEmpty);
  const blob = new Blob([JSON.stringify({ app: 'erisilebilir-spike', version: 1, program: editor.program }, null, 2)], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'robot-programi.json';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  say('Program, İndirilenler klasörüne robot-programi.json adıyla kaydedildi.');
});

$('ac-btn').addEventListener('click', () => $('dosya-girdi').click());
$('dosya-girdi').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const program = Array.isArray(data) ? data : data.program;
    if (!Array.isArray(program)) throw new Error('format');
    editor.replaceProgram(program, `Dosya açıldı: ${file.name}. Programda ${program.length} komut var.`);
    editor.list.focus();
  } catch {
    say('Bu dosya açılamadı. Bu uygulamayla kaydedilmiş bir program dosyası seçin.', { urgent: true });
  }
});
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

// ---------- Color sensor calibration ----------
// The user shows each color to the sensor; the app stores its hue/saturation/brightness.

const CAL_ORDER = [7, 8, 9, 2, 3, 4, 5, 6, 1, 10, 0];
const calDialog = $('renk-dialog');
let calStep = 0;
let calSaved = 0;

function colorSensor() {
  if (!hub.lwp) return null;
  for (const dev of hub.lwp.ports.values()) if (dev.kind === 'color') return dev;
  return null;
}

function showCalStep() {
  if (calStep >= CAL_ORDER.length) {
    calDialog.close();
    say(calSaved >= 2
      ? `Renk ayarı tamamlandı. ${calSaved} renk kaydedildi. Artık renkler bu ölçümlere göre tanınıyor.`
      : 'Renk ayarı bitti. En az iki renk ölçülmediği için hazır ayarlar kullanılmaya devam ediyor.');
    return;
  }
  const name = colorName(CAL_ORDER[calStep]);
  const text = `${calStep + 1}. renk, ${CAL_ORDER.length} renkten: ${name}. ${name} bir parçayı sensörün önüne, neredeyse değecek kadar yakın tutun ve Ölç düğmesine basın. Bu renkte parçanız yoksa Bu rengi atla düğmesine basın.`;
  $('renk-adim').textContent = text;
  say(text, { logIt: false });
}

$('renk-ayar-btn').addEventListener('click', () => {
  if (!hub.connected || hub.protocol !== 'lwp') return say(T.notConnected, { urgent: true });
  if (!colorSensor()) return say('Önce renk sensörünü Hub\'a takın.', { urgent: true });
  calStep = 0;
  calSaved = 0;
  calDialog.showModal();
  $('renk-olc-btn').focus();
  showCalStep();
});

$('renk-olc-btn').addEventListener('click', async () => {
  const dev = colorSensor();
  if (!dev) return say('Renk sensörü bulunamadı. Takılı olduğundan emin olun.', { urgent: true });
  say('Ölçülüyor, parçayı oynatmayın.', { logIt: false });
  const readings = [];
  for (let k = 0; k < 8; k++) {
    if (dev.hsv) readings.push({ ...dev.hsv });
    await new Promise((r) => setTimeout(r, 150));
  }
  const med = (key) => readings.map((r) => r[key]).sort((a, b) => a - b)[readings.length >> 1];
  if (!readings.length || med('v') < 15) {
    say('Sensörün önünde bir parça algılanmadı. Parçayı daha yakın tutup tekrar Ölç düğmesine basın.', { urgent: true });
    return;
  }
  // Hue wraps around at 360: use the reading closest to the others (red can be 2 or 358).
  const hs = readings.map((r) => r.h);
  const h = hs.reduce((best, x) => {
    const cost = (c) => hs.reduce((sum, y) => sum + Math.min(Math.abs(c - y), 360 - Math.abs(c - y)), 0);
    return cost(x) < cost(best) ? x : best;
  }, hs[0]);
  setCalibrationSample(CAL_ORDER[calStep], { h, s: med('s'), v: med('v') });
  calSaved += 1;
  say(`${colorName(CAL_ORDER[calStep])} kaydedildi.`);
  calStep += 1;
  showCalStep();
});

$('renk-atla-btn').addEventListener('click', () => {
  calStep += 1;
  showCalStep();
});
$('renk-bitir-btn').addEventListener('click', () => {
  calStep = CAL_ORDER.length;
  showCalStep();
});
$('renk-sifirla-btn').addEventListener('click', () => {
  const n = Object.keys(getCalibration()).length;
  clearCalibration();
  say(n ? 'Renk ayarı sıfırlandı. Hazır ayarlar kullanılıyor.' : 'Kayıtlı bir renk ayarı yoktu.');
});

// ---------- New version notice ----------
// The page tells the user once when a newer version has been published.
const APP_VERSION = '2026-11-25.24';
let versionNoticeGiven = false;
async function checkForUpdate() {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    const { version } = await res.json();
    if (version && version !== APP_VERSION && !versionNoticeGiven) {
      versionNoticeGiven = true;
      say(T.newVersion);
    }
  } catch {
    /* offline or file missing: ignore */
  }
}
setInterval(checkForUpdate, 120000);

// Test hook: lets the automated tests load programs directly.
window.__erisilebilir = { editor, hub };
