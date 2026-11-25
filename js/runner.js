// Runs a program on a SPIKE Essential Hub (LWP3) one step at a time,
// so every step can be announced while the robot is doing it.
// Supports repeat (counted and forever), if/else and "together" blocks.

import { parse, describe, PATTERNS, repeatMode } from './program-model.js';
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
              const { yes } = this._condition(node.cmd);
              if (yes) {
                const why = node.cmd.sees === 'no' ? 'renk artık görülmüyor' : 'renk görüldü';
                this.onInfo(node.index, `${describe(node.cmd)}: ${why}, tekrar bitti.`, false);
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
        const { yes, seen } = this._condition(node.cmd);
        this.onInfo(node.index, `${describe(node.cmd)}: ${yes ? 'evet' : 'hayır'}, sensör şu an ${seen} görüyor.`, this.foreverDepth > 0);
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
    const color = sensorColor(dev);
    const matches = color === cmd.color;
    return { yes: cmd.sees === 'no' ? !matches : matches, seen: color >= 0 ? COLORS[color] || 'bir renk' : 'hiçbir renk' };
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
        const s = this._session();
        const { port } = this._device(s, cmd.port, 'color', 'renk sensörü');
        let seen = 0;
        while (seen < 2) {
          this._check();
          const dev = s.deviceAt(port);
          if (!dev) throw new Error('Renk sensörü çıkarıldı.');
          const matches = sensorColor(dev) === cmd.color;
          seen = (cmd.sees === 'no' ? !matches : matches) ? seen + 1 : 0;
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

