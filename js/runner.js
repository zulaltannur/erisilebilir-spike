// Runs a program on a SPIKE Essential Hub (LWP3) one step at a time,
// so every step can be announced while the robot is doing it.
// Supports repeat (counted and forever), if/else and "together" blocks.

import { parse, describe, PATTERNS } from './program-model.js';
import { PORT_NAMES } from './texts.js';
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
    this.background = []; // commands running "together with the next one"
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
        const forever = node.cmd.forever === 'yes';
        for (let round = 1; forever || round <= node.cmd.times; round++) {
          this._check();
          this.onRound(node.index, round, forever ? null : node.cmd.times);
          await this._nodes(node.body);
          await this._sleep(0); // let the page breathe in tight loops
        }
        return undefined;
      }
      case 'if': {
        const yes = this._condition(node.cmd);
        this.onInfo(node.index, `${describe(node.cmd)}: ${yes ? 'evet' : 'hayır'}.`);
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

  _condition(cmd) {
    const session = this._session();
    const dev = this._device(session, cmd.port, 'color', 'renk sensörü');
    return dev.color === cmd.color;
  }

  _device(session, port, kind, label) {
    const dev = session.deviceAt(port);
    if (!dev || dev.kind !== kind) throw new Error(`Port ${da(port)} ${label} yok.`);
    return dev;
  }

  async _command(node, { inParallel = false } = {}) {
    const { cmd, index } = node;
    this.step += 1;
    this.onStep(index, this.step, describe(cmd));
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
        this._device(s, cmd.port, 'motor', 'motor');
        if (cmd.unit === 'seconds') await s.runForTime(cmd.port, cmd.amount * 1000, dir * this.speed);
        else {
          const degrees = cmd.unit === 'rotations' ? cmd.amount * 360 : cmd.amount;
          await s.runForDegrees(cmd.port, dir * degrees, this.speed);
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
        if (Math.abs(delta) >= 2) await s.runForDegrees(cmd.port, delta, this.speed);
        return;
      }
      case 'motorStart': {
        const s = this._session();
        this._device(s, cmd.port, 'motor', 'motor');
        await s.startSpeed(cmd.port, dir * this.speed);
        return;
      }
      case 'motorStop': {
        const s = this._session();
        this._device(s, cmd.port, 'motor', 'motor');
        await s.brake(cmd.port);
        return;
      }
      case 'speed':
        this.speed = Math.max(10, Math.min(100, cmd.percent));
        return;
      case 'lightOn': {
        const s = this._session();
        this._device(s, cmd.port, 'matrix3x3', 'ışık matrisi');
        const cells = new Set(PATTERNS[cmd.pattern].cells);
        await s.setMatrix(
          cmd.port,
          Array.from({ length: 9 }, (_, i) => (cells.has(i) ? { brightness: 10, color: cmd.color } : { brightness: 0, color: 0 })),
        );
        return;
      }
      case 'lightPixel': {
        const s = this._session();
        const dev = this._device(s, cmd.port, 'matrix3x3', 'ışık matrisi');
        const pixels = dev.pixels.map((p) => ({ ...p }));
        pixels[cmd.row * 3 + cmd.col] = { brightness: 10, color: cmd.color };
        await s.setMatrix(cmd.port, pixels);
        return;
      }
      case 'lightOff': {
        const s = this._session();
        this._device(s, cmd.port, 'matrix3x3', 'ışık matrisi');
        await s.setMatrix(cmd.port, Array.from({ length: 9 }, () => ({ brightness: 0, color: 0 })));
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
        const s = this._session();
        this._device(s, cmd.port, 'color', 'renk sensörü');
        let seen = 0;
        while (seen < 2) {
          this._check();
          const dev = s.deviceAt(cmd.port);
          if (!dev) throw new Error('Renk sensörü çıkarıldı.');
          seen = dev.color === cmd.color ? seen + 1 : 0;
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

