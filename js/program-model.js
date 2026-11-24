// Level 1 program model: a flat list of commands.
// Repeat blocks are two list items ("repeatStart" ... "repeatEnd") so the list stays
// a simple, flat list that is easy to move through with a screen reader.

import { COLORS, PORT_NAMES } from './texts.js';

// 3x3 light matrix patterns. Index = row * 3 + column.
export const PATTERNS = {
  all: { name: 'tüm kareler', cells: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
  center: { name: 'ortadaki nokta', cells: [4] },
  smile: { name: 'gülen yüz', cells: [0, 2, 6, 7, 8] },
  plus: { name: 'artı', cells: [1, 3, 4, 5, 7] },
  cross: { name: 'çarpı', cells: [0, 2, 4, 6, 8] },
  right: { name: 'sağa ok', cells: [0, 4, 6] },
  left: { name: 'sola ok', cells: [2, 4, 8] },
  up: { name: 'yukarı ok', cells: [1, 3, 5] },
  down: { name: 'aşağı ok', cells: [3, 5, 7] },
};

export const SOUNDS = {
  beep: 'bip',
  bell: 'zil',
  success: 'başarı',
};

export const UNITS = { rotations: 'tur', degrees: 'derece', seconds: 'saniye' };
export const DIRECTIONS = { cw: 'saat yönünde', ccw: 'saat yönünün tersine' };

// Field definitions drive the add/edit dialog.
const portField = { key: 'port', label: 'Port', type: 'choice', options: { 0: 'A', 1: 'B' } };
const colorField = (label = 'Renk') => ({
  key: 'color',
  label,
  type: 'choice',
  options: Object.fromEntries(Object.entries(COLORS).filter(([k]) => k !== '0')),
});

export const COMMAND_TYPES = {
  motorRun: {
    name: 'Motoru döndür',
    fields: [
      portField,
      { key: 'amount', label: 'Ne kadar', type: 'number', min: 0.1, max: 100, step: 0.1 },
      { key: 'unit', label: 'Birim', type: 'choice', options: UNITS },
      { key: 'direction', label: 'Yön', type: 'choice', options: DIRECTIONS },
    ],
    defaults: { port: 0, amount: 1, unit: 'rotations', direction: 'cw' },
  },
  motorStart: {
    name: 'Motoru sürekli döndür',
    fields: [portField, { key: 'direction', label: 'Yön', type: 'choice', options: DIRECTIONS }],
    defaults: { port: 0, direction: 'cw' },
  },
  motorStop: { name: 'Motoru durdur', fields: [portField], defaults: { port: 0 } },
  speed: {
    name: 'Motor hızını ayarla',
    fields: [{ key: 'percent', label: 'Hız yüzdesi', type: 'number', min: 10, max: 100, step: 5 }],
    defaults: { percent: 50 },
  },
  wait: {
    name: 'Bekle',
    fields: [{ key: 'seconds', label: 'Kaç saniye', type: 'number', min: 0.1, max: 60, step: 0.1 }],
    defaults: { seconds: 1 },
  },
  lightOn: {
    name: 'Işık matrisinde desen göster',
    fields: [
      portField,
      { key: 'pattern', label: 'Desen', type: 'choice', options: Object.fromEntries(Object.entries(PATTERNS).map(([k, v]) => [k, v.name])) },
      colorField(),
    ],
    defaults: { port: 1, pattern: 'smile', color: 9 },
  },
  lightOff: { name: 'Işık matrisini kapat', fields: [portField], defaults: { port: 1 } },
  sound: {
    name: 'Bilgisayardan ses çal',
    fields: [{ key: 'sound', label: 'Ses', type: 'choice', options: SOUNDS }],
    defaults: { sound: 'beep' },
  },
  waitColor: {
    name: 'Renk görene kadar bekle',
    fields: [portField, colorField('Hangi renk')],
    defaults: { port: 1, color: 9 },
  },
  repeatStart: {
    name: 'Tekrarla',
    fields: [{ key: 'times', label: 'Kaç kez', type: 'number', min: 2, max: 100, step: 1 }],
    defaults: { times: 3 },
  },
  repeatEnd: { name: 'Tekrar sonu', fields: [], defaults: {}, hidden: true },
};

const fmt = (n) => String(n).replace('.', ',');

export function describe(cmd) {
  const p = PORT_NAMES[cmd.port];
  switch (cmd.type) {
    case 'motorRun':
      return `Motor ${p}, ${fmt(cmd.amount)} ${UNITS[cmd.unit]}, ${DIRECTIONS[cmd.direction]}`;
    case 'motorStart':
      return `Motor ${p} sürekli dönsün, ${DIRECTIONS[cmd.direction]}`;
    case 'motorStop':
      return `Motor ${p} dursun`;
    case 'speed':
      return `Motor hızı yüzde ${cmd.percent}`;
    case 'wait':
      return `${fmt(cmd.seconds)} saniye bekle`;
    case 'lightOn':
      return `Işık ${p}: ${PATTERNS[cmd.pattern].name}, ${COLORS[cmd.color]}`;
    case 'lightOff':
      return `Işık ${p} kapansın`;
    case 'sound':
      return `Ses çal: ${SOUNDS[cmd.sound]}`;
    case 'waitColor':
      return `Renk sensörü ${p} ${COLORS[cmd.color]} görene kadar bekle`;
    case 'repeatStart':
      return `Tekrarla ${cmd.times} kez`;
    case 'repeatEnd':
      return 'Tekrar sonu';
    default:
      return cmd.type;
  }
}

export function newCommand(type) {
  return { type, ...COMMAND_TYPES[type].defaults };
}

// Nesting depth of each item (0 = top level). repeatEnd shares the depth of its start.
export function depths(program) {
  const out = [];
  let d = 0;
  for (const cmd of program) {
    if (cmd.type === 'repeatEnd') d = Math.max(0, d - 1);
    out.push(d);
    if (cmd.type === 'repeatStart') d += 1;
  }
  return out;
}

// Returns null if the program is valid, otherwise { index, message }.
export function validate(program) {
  const stack = [];
  for (let i = 0; i < program.length; i++) {
    if (program[i].type === 'repeatStart') stack.push(i);
    if (program[i].type === 'repeatEnd') {
      if (!stack.length) return { index: i, message: `Komut ${i + 1}: başlangıcı olmayan bir tekrar sonu var.` };
      stack.pop();
    }
  }
  if (stack.length) {
    const i = stack.pop();
    return { index: i, message: `Komut ${i + 1}: bu tekrarın sonu yok.` };
  }
  return null;
}

// Expands repeats into the exact sequence of steps that will run.
// Each step keeps its list index so the editor can follow along.
export function flatten(program) {
  const run = (from, to) => {
    const steps = [];
    let i = from;
    while (i < to) {
      const cmd = program[i];
      if (cmd.type === 'repeatStart') {
        let depth = 1;
        let j = i + 1;
        while (j < to && depth) {
          if (program[j].type === 'repeatStart') depth++;
          if (program[j].type === 'repeatEnd') depth--;
          j++;
        }
        const body = run(i + 1, j - 1);
        for (let k = 0; k < cmd.times; k++) {
          steps.push({ index: i, cmd: { type: 'repeatTick', round: k + 1, times: cmd.times } });
          steps.push(...body);
        }
        i = j;
      } else {
        steps.push({ index: i, cmd });
        i++;
      }
    }
    return steps;
  };
  return run(0, program.length);
}
