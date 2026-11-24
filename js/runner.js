// Runs a Level 1 program on a SPIKE Essential Hub (LWP3), one step at a time,
// so every step can be announced while the robot is doing it.

import { flatten, describe, PATTERNS } from './program-model.js';
import { PORT_NAMES } from './texts.js';

const POLL_MS = 50;

export class Runner {
  constructor({ getSession, onStep, onRound, onDone, onError, playSound }) {
    this.getSession = getSession;
    this.onStep = onStep; // (listIndex, stepNumber, text)
    this.onRound = onRound; // (listIndex, round, times)
    this.onDone = onDone; // (completed: boolean)
    this.onError = onError; // (message)
    this.playSound = playSound;
    this.running = false;
    this.stopRequested = false;
    this._wakers = new Set();
  }

  async run(program) {
    if (this.running) return;
    this.running = true;
    this.stopRequested = false;
    let speed = 50;
    let stepNumber = 0;
    try {
      for (const { index, cmd } of flatten(program)) {
        if (this.stopRequested) break;
        if (cmd.type === 'repeatTick') {
          this.onRound(index, cmd.round, cmd.times);
          continue;
        }
        if (cmd.type === 'repeatEnd') continue;
        stepNumber += 1;
        this.onStep(index, stepNumber, describe(cmd));
        const session = this.getSession();
        if (!session) throw new Error('Hub bağlı değil.');
        speed = await this._exec(session, cmd, speed);
      }
      const completed = !this.stopRequested;
      this.running = false;
      this.onDone(completed);
    } catch (err) {
      this.running = false;
      this.onError(err.message);
    }
  }

  stop() {
    if (!this.running) return;
    this.stopRequested = true;
    for (const wake of this._wakers) wake();
    const session = this.getSession();
    if (session) session.stopAll();
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

  _requireDevice(session, port, kind, label) {
    const dev = session.deviceAt(port);
    if (!dev || dev.kind !== kind) {
      throw new Error(`Port ${PORT_NAMES[port]}'${port === 0 ? 'da' : 'de'} ${label} yok.`);
    }
    return dev;
  }

  async _exec(session, cmd, speed) {
    const dir = cmd.direction === 'ccw' ? -1 : 1;
    switch (cmd.type) {
      case 'motorRun': {
        this._requireDevice(session, cmd.port, 'motor', 'motor');
        if (cmd.unit === 'seconds') {
          await session.runForTime(cmd.port, cmd.amount * 1000, dir * speed);
        } else {
          const degrees = cmd.unit === 'rotations' ? cmd.amount * 360 : cmd.amount;
          await session.runForDegrees(cmd.port, dir * degrees, speed);
        }
        return speed;
      }
      case 'motorStart':
        this._requireDevice(session, cmd.port, 'motor', 'motor');
        await session.startSpeed(cmd.port, dir * speed);
        return speed;
      case 'motorStop':
        this._requireDevice(session, cmd.port, 'motor', 'motor');
        await session.brake(cmd.port);
        return speed;
      case 'speed':
        return Math.max(10, Math.min(100, cmd.percent));
      case 'wait':
        await this._sleep(cmd.seconds * 1000);
        return speed;
      case 'lightOn': {
        this._requireDevice(session, cmd.port, 'matrix3x3', 'ışık matrisi');
        const cells = new Set(PATTERNS[cmd.pattern].cells);
        const pixels = Array.from({ length: 9 }, (_, i) =>
          cells.has(i) ? { brightness: 10, color: cmd.color } : { brightness: 0, color: 0 },
        );
        await session.setMatrix(cmd.port, pixels);
        return speed;
      }
      case 'lightOff':
        this._requireDevice(session, cmd.port, 'matrix3x3', 'ışık matrisi');
        await session.setMatrix(cmd.port, Array.from({ length: 9 }, () => ({ brightness: 0, color: 0 })));
        return speed;
      case 'sound':
        this.playSound(cmd.sound);
        await this._sleep(600);
        return speed;
      case 'waitColor': {
        this._requireDevice(session, cmd.port, 'color', 'renk sensörü');
        let seen = 0;
        while (!this.stopRequested) {
          const dev = session.deviceAt(cmd.port);
          if (!dev) throw new Error('Renk sensörü çıkarıldı.');
          seen = dev.color === cmd.color ? seen + 1 : 0;
          if (seen >= 2) break; // seen twice in a row: not a flicker
          await this._sleep(POLL_MS);
        }
        return speed;
      }
      default:
        return speed;
    }
  }
}
