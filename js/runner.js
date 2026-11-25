// Runs a program on a SPIKE Essential Hub (LWP3) one step at a time,
// so every step can be announced while the robot is doing it.
// Supports repeat (counted and forever), if/else and "together" blocks.

import { parse, describe, PATTERNS, repeatMode, condOf, negated, CONDITION_DEVICE } from './program-model.js';
import { PORT_NAMES, COLORS } from './texts.js';

import { stableColor as sensorColor } from './lwp.js';
import { playProgramSound, playNote, speak, stopSpeaking } from './sounds.js';

const POLL_MS = 50;
const da = (port) => `${PORT_NAMES[port]}'${port === 0 ? 'da' : 'de'}`;

class StopSignal extends Error {}

export class Runner {
  constructor({ getSession, onStep, onRound, onInfo, onDone, onError }) {
    this.getSession = getSession;
    this.onStep = onStep; // (listIndex, stepNumber, text)
    this.onRound = onRound; // (listIndex, round, timesOrNull)
    this.onInfo = onInfo; // (listIndex, text) e.g. if-results and "together" starts
    this.onDone = onDone; // (completed: boolean)
    this.onError = onError; // (message)
    this.running = false;
    this.stopRequested = false;
    this._wakers = new Set();
  }

  async run(program) {
    if (this.running) return;
    const tree = parse(program);
    this.running = true;
    this.stopRequested = false;
    this.finishedByCommand = false;
    this.step = 0;
    this.speed = 50;
    this.startedAt = Date.now();
    this.background = [];
    this.portNotes = new Set();
    this.foreverDepth = 0; // "used the other port" notes already given in this run
    try {
      await this._nodes(tree);
      await this._waitBackground();
      this.running = false;
      this.onDone(!this.stopRequested || this.finishedByCommand);
    } catch (err) {
      this.running = false;
      if (err instanceof StopSignal) this.onDone(this.finishedByCommand);
      else {
        this.stopRequested = true;
        this._halt();
        this.onError(err.message);
      }
    }
  }

  stop() {
    if (!this.running) return;
    this.stopRequested = true;
    this._halt();
  }

  _halt() {
    for (const wake of this._wakers) wake();
    stopSpeaking();
    const session = this.getSession();
    if (session) session.stopAll();
  }

  _check() {
    if (this.stopRequested) throw new StopSignal();
  }

  _sleep(ms) {
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this._wakers.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, ms);
      this._wakers.add(wake);
    });
  }

  _session() {
    const s = this.getSession();
    if (!s) throw new Error('Hub bağlı değil.');
    return s;
  }

  // ---------- Tree ----------

  async _nodes(nodes) {
    for (const node of nodes) {
      this._check();
      await this._node(node);
    }
  }

  async _node(node) {
    switch (node.kind) {
      case 'cmd':
        return this._command(node);
      case 'repeat': {
        const mode = repeatMode(node.cmd);
        const forever = mode !== 'times'; // "forever" and "until a color" have no fixed count
        if (forever) this.foreverDepth += 1;
        try {
          for (let round = 1; forever || round <= node.cmd.times; round++) {
            this._check();
            if (mode === 'until') {
              // "olana kadar": stop when the condition becomes true.
              // "olduğu sürece" (negated): stop when it is no longer true.
              const raw = this._rawCondition(node.cmd);
              const stop = negated(node.cmd) ? !raw.value : raw.value;
              if (stop) {
                this.onInfo(node.index, `${describe(node.cmd)}: tekrar bitti, ${raw.detail}.`, false);
                break;
              }
            }
            this.onRound(node.index, round, forever ? null : node.cmd.times);
            const t0 = Date.now();
            await this._nodes(node.body);
            // Each round takes at least 50 ms, so fast loops do not flood the Hub with messages.
            await this._sleep(Math.max(0, 50 - (Date.now() - t0)));
          }
        } finally {
          if (forever) this.foreverDepth -= 1;
        }
        return undefined;
      }
      case 'if': {
        const { yes, detail } = this._condition(node.cmd);
        this.onInfo(node.index, `${describe(node.cmd)}: ${yes ? 'evet' : 'hayır'}, ${detail}.`, this.foreverDepth > 0);
        return this._nodes(yes ? node.then : node.otherwise);
      }
      case 'parallel': {
        this.onInfo(node.index, `Aynı anda ${node.body.length} komut başlıyor.`);
        await Promise.all(node.body.map((child) => this._command(child, { inParallel: true })));
        return undefined;
      }
      default:
        return undefined;
    }
  }

  // Evaluates a condition. Returns { yes, detail }: yes already takes "doğru değilse"
  // into account; detail says what was measured, for the announcement.
  _condition(cmd) {
    const raw = this._rawCondition(cmd);
    return { yes: negated(cmd) ? !raw.value : raw.value, detail: raw.detail };
  }

  _rawCondition(cmd) {
    const cond = condOf(cmd);
    const kind = CONDITION_DEVICE[cond];
    const session = kind ? this._session() : null;
    const label = kind === 'color' ? 'renk sensörü' : 'motor';
    const dev = kind ? this._device(session, cmd.port, kind, label) : null;
    switch (cond) {
      case 'colorSees':
      case 'colorAny': {
        const color = sensorColor(dev);
        const seen = color >= 0 ? COLORS[color] || 'bir renk' : 'hiçbir renk';
        return {
          value: cond === 'colorSees' ? color === cmd.color : color !== -1,
          detail: `sensör şu an ${seen} görüyor`,
        };
      }
      case 'motorTurning': {
        const turning = Date.now() - (dev.lastMoveAt || 0) < 300;
        return { value: turning, detail: turning ? 'motor dönüyor' : 'motor duruyor' };
      }
      case 'motorAngle': {
        const angle = ((dev.absPosition % 360) + 360) % 360;
        return { value: angle > cmd.angle, detail: `motor şu an ${angle} derecede` };
      }
      case 'timer': {
        const elapsed = (Date.now() - this.startedAt) / 1000;
        return { value: elapsed >= cmd.seconds, detail: `${Math.floor(elapsed)} saniye geçti` };
      }
      case 'random': {
        const heads = Math.random() < 0.5;
        return { value: heads, detail: heads ? 'yazı geldi' : 'tura geldi' };
      }
      default:
        return { value: false, detail: '' };
    }
  }

  // A light color, or "what the color sensor sees" (black or nothing = light off).
  _lightColor(session, color) {
    if (color !== 'sensor') return color;
    for (const dev of session.ports.values()) {
      if (dev.kind === 'color') {
        const c = sensorColor(dev);
        return c > 0 ? c : 0;
      }
    }
    throw new Error('Renk sensörü takılı değil.');
  }

  // Finds the part a command needs. If it is not on the port the command names but is
  // on the other port (children often swap the plugs), the program uses that port and
  // says so once. Returns the device; its .port is the port actually used.
  _device(session, port, kind, label) {
    const dev = session.deviceAt(port);
    if (dev && dev.kind === kind) return dev;
    const other = port === 0 ? 1 : 0;
    const there = session.deviceAt(other);
    if (there && there.kind === kind) {
      const key = `${port}-${kind}`;
      if (!this.portNotes.has(key)) {
        this.portNotes.add(key);
        this.onInfo(-1, `Not: ${label} Port ${da(port)} değil, Port ${da(other)}. Program Port ${PORT_NAMES[other]}'yi kullanıyor.`.replace(`Port A'yi`, `Port A'yı`));
      }
      return there;
    }
    throw new Error(`Port ${da(port)} ${label} yok. Önce ${label} takın.`);
  }

  async _command(node, { inParallel = false } = {}) {
    const { cmd, index } = node;
    this.step += 1;
    this.onStep(index, this.step, describe(cmd), this.foreverDepth > 0);
    await this._exec(cmd);
  }

  async _waitBackground() {
    const results = await Promise.all(this.background);
    this.background = [];
    const err = results.find((r) => r instanceof Error && !(r instanceof StopSignal));
    if (err) throw err;
  }

  // ---------- Commands ----------

  async _exec(cmd) {
    const dir = cmd.direction === 'ccw' ? -1 : 1;
    switch (cmd.type) {
      case 'motorRun': {
        const s = this._session();
        const { port } = this._device(s, cmd.port, 'motor', 'motor');
        if (cmd.unit === 'seconds') await s.runForTime(port, cmd.amount * 1000, dir * this.speed);
        else {
          const degrees = cmd.unit === 'rotations' ? cmd.amount * 360 : cmd.amount;
          await s.runForDegrees(port, dir * degrees, this.speed);
        }
        return;
      }
      case 'motorGoTo': {
        const s = this._session();
        const dev = this._device(s, cmd.port, 'motor', 'motor');
        const current = ((dev.absPosition % 360) + 360) % 360;
        let delta = cmd.position - current;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        if (Math.abs(delta) >= 2) await s.runForDegrees(dev.port, delta, this.speed);
        return;
      }
      case 'motorStart': {
        const s = this._session();
        const { port } = this._device(s, cmd.port, 'motor', 'motor');
        await s.startSpeed(port, dir * this.speed);
        return;
      }
      case 'motorStop': {
        const s = this._session();
        const { port } = this._device(s, cmd.port, 'motor', 'motor');
        await s.brake(port);
        return;
      }
      case 'speed':
        this.speed = Math.max(10, Math.min(100, cmd.percent));
        return;
      case 'lightOn': {
        const s = this._session();
        const { port } = this._device(s, cmd.port, 'matrix3x3', 'ışık matrisi');
        const color = this._lightColor(s, cmd.color);
        const cells = new Set(PATTERNS[cmd.pattern].cells);
        await s.setMatrix(
          port,
          Array.from({ length: 9 }, (_, i) =>
            cells.has(i) && color > 0 ? { brightness: 10, color } : { brightness: 0, color: 0 },
          ),
        );
        return;
      }
      case 'lightPixel': {
        const s = this._session();
        const dev = this._device(s, cmd.port, 'matrix3x3', 'ışık matrisi');
        const pixels = dev.pixels.map((p) => ({ ...p }));
        const color = this._lightColor(s, cmd.color);
        pixels[cmd.row * 3 + cmd.col] = color > 0 ? { brightness: 10, color } : { brightness: 0, color: 0 };
        await s.setMatrix(dev.port, pixels);
        return;
      }
      case 'lightOff': {
        const s = this._session();
        const { port } = this._device(s, cmd.port, 'matrix3x3', 'ışık matrisi');
        await s.setMatrix(port, Array.from({ length: 9 }, () => ({ brightness: 0, color: 0 })));
        return;
      }
      case 'hubLight':
        await this._session().setHubLight(cmd.color);
        return;
      case 'sound':
        await this._sleep(playProgramSound(cmd.sound) * 1000);
        return;
      case 'note':
        await this._sleep(playNote(cmd.note, cmd.seconds) * 1000);
        return;
      case 'speak':
        await speak(cmd.text);
        return;
      case 'wait':
        await this._sleep(cmd.seconds * 1000);
        return;
      case 'waitColor': {
        // "Koşula göre bekle": wait until the condition is true (or, negated, no longer true).
        // It must hold for two checks in a row, so a single odd reading does not count.
        let seen = 0;
        while (seen < 2) {
          this._check();
          seen = this._condition(cmd).yes ? seen + 1 : 0;
          if (seen < 2) await this._sleep(POLL_MS);
        }
        return;
      }
      case 'stopProgram':
        this.finishedByCommand = true;
        this.stopRequested = true;
        this._halt();
        throw new StopSignal();
      default:
        return;
    }
  }
}

