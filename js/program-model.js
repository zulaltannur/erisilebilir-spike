// Program model: a flat list of commands.
// Blocks (repeat, if/else, together) are marker items in the flat list
// ("repeatStart" ... "repeatEnd"), so the list stays simple to move through
// with a screen reader. parse() turns the flat list into a tree for running.

import { COLORS, PORT_NAMES } from './texts.js';
import { PROGRAM_SOUNDS, NOTES } from './sounds.js';

// 3x3 light matrix patterns. Index = row * 3 + column.
export const PATTERNS = {
  all: { name: 'tüm kareler', cells: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
  center: { name: 'ortadaki nokta', cells: [4] },
  smile: { name: 'gülen yüz', cells: [0, 2, 6, 7, 8] },
  plus: { name: 'artı', cells: [1, 3, 4, 5, 7] },
  cross: { name: 'çarpı', cells: [0, 2, 4, 6, 8] },
  frame: { name: 'çerçeve', cells: [0, 1, 2, 3, 5, 6, 7, 8] },
  right: { name: 'sağa ok', cells: [0, 4, 6] },
  left: { name: 'sola ok', cells: [2, 4, 8] },
  up: { name: 'yukarı ok', cells: [1, 3, 5] },
  down: { name: 'aşağı ok', cells: [3, 5, 7] },
};

export const SOUNDS = Object.fromEntries(Object.entries(PROGRAM_SOUNDS).map(([k, v]) => [k, v.name]));
export const NOTE_NAMES = Object.fromEntries(Object.entries(NOTES).map(([k, v]) => [k, v.name]));
export const UNITS = { rotations: 'tur', degrees: 'derece', seconds: 'saniye' };
export const DIRECTIONS = { cw: 'saat yönünde', ccw: 'saat yönünün tersine' };
export const ROWS = { 0: 'üst', 1: 'orta', 2: 'alt' };
export const COLUMNS = { 0: 'sol', 1: 'orta', 2: 'sağ' };

const portField = { key: 'port', label: 'Port', type: 'choice', options: { 0: 'A', 1: 'B' } };
const realColors = Object.fromEntries(Object.entries(COLORS).filter(([k]) => k !== '0'));
const colorField = (label = 'Renk') => ({ key: 'color', label, type: 'choice', options: realColors });
// For lights: "the color the color sensor sees right now"
const lightColorField = {
  key: 'color',
  label: 'Renk',
  type: 'choice',
  options: { ...realColors, sensor: 'renk sensörünün gördüğü renk' },
};
// Asked when adding an "Eğer": keep watching (put it in "Sonsuza kadar tekrarla") or check once.
// Only used while adding; not stored, and not asked when the Eğer is already inside a loop.
const whenField = {
  key: 'when',
  label: 'Ne zaman kontrol edilsin?',
  type: 'choice',
  options: { loop: 'Sürekli kontrol et (Sonsuza kadar tekrarla bloğuna koy)', once: 'Sadece bir kez, program o satıra gelince' },
  addOnly: true,
};
// ---- Conditions (used by Eğer, Koşula göre tekrarla, Koşula göre bekle) ----
// Every condition can be turned around ("doğru değilse"), whatever it is about.
export const CONDITIONS = {
  colorSees: 'Renk sensörü bir rengi görüyor',
  colorAny: 'Renk sensörünün önünde bir şey var',
  motorTurning: 'Motor dönüyor',
  motorAngle: 'Motorun konumu bir değerden büyük',
  timer: 'Program başlayalı belli bir süre geçti',
  random: 'Yazı tura: rastgele, yarı yarıya',
  hubTilted: 'Hub eğik (herhangi bir yöne)',
  hubForward: 'Hub öne eğik',
  hubBackward: 'Hub arkaya eğik',
  hubLeft: 'Hub sola eğik',
  hubRight: 'Hub sağa eğik',
  hubSide: 'Hub yana eğik (sola ya da sağa)',
  hubUpsideDown: 'Hub ters çevrilmiş',
  hubShaken: 'Hub sallandı',
  hubTapped: 'Hub\'a parmakla vuruldu',
};
// Which part a condition needs (null = none)
export const CONDITION_DEVICE = { colorSees: 'color', colorAny: 'color', motorTurning: 'motor', motorAngle: 'motor', timer: null, random: null,
  hubTilted: null, hubForward: null, hubBackward: null, hubLeft: null, hubRight: null, hubSide: null, hubUpsideDown: null, hubShaken: null, hubTapped: null };
// Older programs stored only color conditions ("sees": 'yes' | 'no').
export const condOf = (cmd) => cmd.cond || 'colorSees';
export const negated = (cmd) => (cmd.negate ? cmd.negate === 'yes' : cmd.sees === 'no');

const conditionFields = (negateLabel, positive, negative) => [
  { key: 'cond', label: 'Koşul', type: 'choice', options: CONDITIONS },
  { ...portField, showIf: ['colorSees', 'colorAny', 'motorTurning', 'motorAngle'] },
  { ...colorField('Hangi renk'), showIf: ['colorSees'] },
  { key: 'angle', label: 'Kaç dereceden büyük (0 ile 359 arası)', type: 'number', min: 0, max: 359, step: 1, showIf: ['motorAngle'] },
  { key: 'seconds', label: 'Kaç saniye', type: 'number', min: 0.1, max: 600, step: 0.1, showIf: ['timer'] },
  { key: 'negate', label: negateLabel, type: 'choice', options: { no: positive, yes: negative } },
];
const conditionDefaults = { cond: 'colorSees', port: 1, color: 9, angle: 90, seconds: 5, negate: 'no' };

// The condition in words, e.g. "renk sensörü B kırmızı görüyor".
export function conditionText(cmd) {
  const p = PORT_NAMES[cmd.port];
  switch (condOf(cmd)) {
    case 'colorSees':
      return `renk sensörü ${p} ${COLORS[cmd.color]} görüyor`;
    case 'colorAny':
      return `renk sensörü ${p} önünde bir şey var`;
    case 'motorTurning':
      return `motor ${p} dönüyor`;
    case 'motorAngle':
      return `motor ${p} konumu ${cmd.angle} dereceden büyük`;
    case 'timer':
      return `program başlayalı ${fmtNum(cmd.seconds)} saniye geçti`;
    case 'random':
      return 'yazı tura yazı geldi';
    case 'hubTilted':
      return 'Hub eğik';
    case 'hubForward':
      return 'Hub öne eğik';
    case 'hubBackward':
      return 'Hub arkaya eğik';
    case 'hubLeft':
      return 'Hub sola eğik';
    case 'hubRight':
      return 'Hub sağa eğik';
    case 'hubSide':
      return 'Hub yana eğik';
    case 'hubUpsideDown':
      return 'Hub ters çevrilmiş';
    case 'hubShaken':
      return 'Hub sallandı';
    case 'hubTapped':
      return 'Hub\'a vuruldu';
    default:
      return condOf(cmd);
  }
}
const fmtNum = (x) => String(x).replace('.', ',');

export const repeatMode = (cmd) => cmd.mode || (cmd.forever === 'yes' ? 'forever' : 'times');
const colorText = (c) => (c === 'sensor' ? 'renk sensörünün gördüğü renk' : COLORS[c]);
const hubColors = { 0: 'kapalı', ...realColors };

// Groups are used to sort the command list when adding a command.
export const GROUPS = {
  motor: 'Motor',
  light: 'Işık',
  sound: 'Ses',
  wait: 'Bekleme ve sensörler',
  control: 'Akış: tekrar, koşul, aynı anda',
};

export const COMMAND_TYPES = {
  // ---- Motor
  motorRun: {
    group: 'motor',
    name: 'Motoru döndür',
    fields: [
      portField,
      { key: 'amount', label: 'Ne kadar', type: 'number', min: 0.1, max: 100, step: 0.1 },
      { key: 'unit', label: 'Birim', type: 'choice', options: UNITS },
      { key: 'direction', label: 'Yön', type: 'choice', options: DIRECTIONS },
    ],
    defaults: { port: 0, amount: 1, unit: 'rotations', direction: 'cw' },
  },
  motorGoTo: {
    group: 'motor',
    name: 'Motoru bir konuma getir',
    fields: [portField, { key: 'position', label: 'Konum, derece', type: 'number', min: 0, max: 359, step: 1 }],
    defaults: { port: 0, position: 0 },
  },
  motorStart: {
    group: 'motor',
    name: 'Motoru sürekli döndür',
    fields: [portField, { key: 'direction', label: 'Yön', type: 'choice', options: DIRECTIONS }],
    defaults: { port: 0, direction: 'cw' },
  },
  motorStop: { group: 'motor', name: 'Motoru durdur', fields: [portField], defaults: { port: 0 } },
  speed: {
    group: 'motor',
    name: 'Motor hızını ayarla',
    fields: [{ key: 'percent', label: 'Hız yüzdesi', type: 'number', min: 10, max: 100, step: 5 }],
    defaults: { percent: 50 },
  },
  // ---- Light
  lightOn: {
    group: 'light',
    name: 'Işık matrisinde desen göster',
    fields: [
      portField,
      { key: 'pattern', label: 'Desen', type: 'choice', options: Object.fromEntries(Object.entries(PATTERNS).map(([k, v]) => [k, v.name])) },
      lightColorField,
    ],
    defaults: { port: 1, pattern: 'smile', color: 9 },
  },
  lightPixel: {
    group: 'light',
    name: 'Işık matrisinde tek kare yak',
    fields: [
      portField,
      { key: 'row', label: 'Satır', type: 'choice', options: ROWS },
      { key: 'col', label: 'Sütun', type: 'choice', options: COLUMNS },
      lightColorField,
    ],
    defaults: { port: 1, row: 1, col: 1, color: 3 },
  },
  lightOff: { group: 'light', name: 'Işık matrisini kapat', fields: [portField], defaults: { port: 1 } },
  hubLight: {
    group: 'light',
    name: 'Hub ışığının rengini ayarla',
    fields: [{ key: 'color', label: 'Renk', type: 'choice', options: hubColors }],
    defaults: { color: 6 },
  },
  // ---- Sound
  sound: {
    group: 'sound',
    name: 'Bilgisayardan ses çal',
    fields: [{ key: 'sound', label: 'Ses', type: 'choice', options: SOUNDS }],
    defaults: { sound: 'beep' },
  },
  note: {
    group: 'sound',
    name: 'Nota çal',
    fields: [
      { key: 'note', label: 'Nota', type: 'choice', options: NOTE_NAMES },
      { key: 'seconds', label: 'Kaç saniye', type: 'number', min: 0.1, max: 4, step: 0.1 },
    ],
    defaults: { note: 'C', seconds: 0.5 },
  },
  speak: {
    group: 'sound',
    name: 'Bilgisayar konuşsun',
    fields: [{ key: 'text', label: 'Ne söylesin', type: 'text', maxLength: 120 }],
    defaults: { text: 'Merhaba' },
  },
  // ---- Waiting and sensors
  wait: {
    group: 'wait',
    name: 'Bekle',
    fields: [{ key: 'seconds', label: 'Kaç saniye', type: 'number', min: 0.1, max: 60, step: 0.1 }],
    defaults: { seconds: 1 },
  },
  waitColor: {
    group: 'wait',
    name: 'Koşula göre bekle',
    fields: conditionFields('Ne zamana kadar beklesin?', 'koşul doğru olana kadar', 'koşul artık doğru olmayana kadar'),
    defaults: { ...conditionDefaults },
  },
  // ---- Control flow
  // Three kinds of loop. All are stored as "repeatStart" with a mode; the other two
  // entries are shortcuts in the command list (alias) with their own settings.
  repeatStart: {
    group: 'control',
    name: 'Belli sayıda tekrarla',
    block: 'repeat',
    fields: [{ key: 'times', label: 'Kaç kez', type: 'number', min: 2, max: 100, step: 1 }],
    defaults: { mode: 'times', times: 3 },
  },
  repeatForeverStart: {
    group: 'control',
    name: 'Sonsuza kadar tekrarla',
    alias: 'repeatStart',
    fields: [],
    defaults: { mode: 'forever', times: 3 },
  },
  repeatUntilStart: {
    group: 'control',
    name: 'Koşula göre tekrarla',
    alias: 'repeatStart',
    fields: conditionFields('Ne zamana kadar tekrarlasın?', 'koşul doğru olana kadar', 'koşul doğru olduğu sürece'),
    defaults: { mode: 'until', times: 3, ...conditionDefaults },
  },
  repeatEnd: { group: 'control', name: 'Tekrar sonu', fields: [], defaults: {}, hidden: true },
  ifStart: {
    group: 'control',
    name: 'Eğer',
    block: 'if',
    fields: [...conditionFields('Ne zaman çalışsın?', 'koşul doğruysa', 'koşul doğru değilse'), whenField],
    defaults: { ...conditionDefaults },
  },
  // Adds "Eğer", "Aksi halde" and "Eğer sonu" together; never stored as its own command.
  ifElseStart: {
    group: 'control',
    name: 'Eğer / aksi halde',
    block: 'ifelse',
    fields: [...conditionFields('İlk kısım ne zaman çalışsın?', 'koşul doğruysa', 'koşul doğru değilse'), whenField],
    defaults: { ...conditionDefaults },
  },
  else: { group: 'control', name: 'Aksi halde', fields: [], defaults: {}, hidden: true },
  ifEnd: { group: 'control', name: 'Eğer sonu', fields: [], defaults: {}, hidden: true },
  parallelStart: { group: 'control', name: 'Aynı anda yap', block: 'parallel', fields: [], defaults: {} },
  parallelEnd: { group: 'control', name: 'Aynı anda sonu', fields: [], defaults: {}, hidden: true },
  stopProgram: { group: 'control', name: 'Programı bitir', fields: [], defaults: {} },
};

// Which part a command needs on its port (used to pick the right port automatically).
export const DEVICE_FOR = {
  motorRun: 'motor', motorGoTo: 'motor', motorStart: 'motor', motorStop: 'motor',
  lightOn: 'matrix3x3', lightPixel: 'matrix3x3', lightOff: 'matrix3x3',
  waitColor: 'color', ifStart: 'color', ifElseStart: 'color', repeatUntilStart: 'color', // default condition
};

const BLOCK_END = { repeatStart: 'repeatEnd', ifStart: 'ifEnd', parallelStart: 'parallelEnd' };
const END_START = { repeatEnd: 'repeatStart', ifEnd: 'ifStart', parallelEnd: 'parallelStart' };
export const isBlockStart = (t) => t in BLOCK_END;
export const isBlockEnd = (t) => t in END_START;
export const blockEndFor = (t) => BLOCK_END[(COMMAND_TYPES[t] && COMMAND_TYPES[t].alias) || t];

const fmt = (n) => String(n).replace('.', ',');

export function describe(cmd) {
  const p = PORT_NAMES[cmd.port];
  switch (cmd.type) {
    case 'motorRun':
      return `Motor ${p}, ${fmt(cmd.amount)} ${UNITS[cmd.unit]}, ${DIRECTIONS[cmd.direction]}`;
    case 'motorGoTo':
      return `Motor ${p} ${cmd.position} derece konumuna gitsin`;
    case 'motorStart':
      return `Motor ${p} sürekli dönsün, ${DIRECTIONS[cmd.direction]}`;
    case 'motorStop':
      return `Motor ${p} dursun`;
    case 'speed':
      return `Motor hızı yüzde ${cmd.percent}`;
    case 'lightOn':
      return `Işık ${p}: ${PATTERNS[cmd.pattern].name}, ${colorText(cmd.color)}`;
    case 'lightPixel':
      return `Işık ${p}: ${ROWS[cmd.row]} satır, ${COLUMNS[cmd.col]} sütun, ${colorText(cmd.color)}`;
    case 'lightOff':
      return `Işık ${p} kapansın`;
    case 'hubLight':
      return cmd.color === 0 ? 'Hub ışığı kapansın' : `Hub ışığı ${COLORS[cmd.color]}`;
    case 'sound':
      return `Ses çal: ${SOUNDS[cmd.sound]}`;
    case 'note':
      return `Nota çal: ${NOTE_NAMES[cmd.note]}, ${fmt(cmd.seconds)} saniye`;
    case 'speak':
      return `Bilgisayar söylesin: ${cmd.text}`;
    case 'wait':
      return `${fmt(cmd.seconds)} saniye bekle`;
    case 'waitColor':
      return negated(cmd)
        ? `Şu artık doğru olmayana kadar bekle: ${conditionText(cmd)}`
        : `Şu doğru olana kadar bekle: ${conditionText(cmd)}`;
    case 'repeatStart':
      if (repeatMode(cmd) === 'forever') return 'Sonsuza kadar tekrarla';
      if (repeatMode(cmd) === 'until') {
        return negated(cmd)
          ? `Şu doğru olduğu sürece tekrarla: ${conditionText(cmd)}`
          : `Şu doğru olana kadar tekrarla: ${conditionText(cmd)}`;
      }
      return `Tekrarla ${cmd.times} kez`;
    case 'repeatEnd':
      return 'Tekrar sonu';
    case 'ifStart':
      return `Eğer şu ${negated(cmd) ? 'doğru değilse' : 'doğruysa'}: ${conditionText(cmd)}`;
    case 'else':
      return 'Aksi halde';
    case 'ifEnd':
      return 'Eğer sonu';
    case 'parallelStart':
      return 'Aynı anda yap';
    case 'parallelEnd':
      return 'Aynı anda sonu';
    case 'stopProgram':
      return 'Programı bitir';
    default:
      return cmd.type;
  }
}

export function newCommand(type) {
  return { type, ...COMMAND_TYPES[type].defaults };
}

// Nesting depth of each item (0 = top level). Ends and "else" sit at the level of their start.
export function depths(program) {
  const out = [];
  let d = 0;
  for (const cmd of program) {
    if (isBlockEnd(cmd.type) || cmd.type === 'else') d = Math.max(0, d - 1);
    out.push(d);
    if (isBlockStart(cmd.type) || cmd.type === 'else') d += 1;
  }
  return out;
}

// Index of the item that belongs with a block marker (start <-> end), or -1.
export function partnerOf(program, i) {
  const t = program[i].type;
  if (isBlockStart(t)) {
    let depth = 0;
    for (let j = i; j < program.length; j++) {
      if (isBlockStart(program[j].type)) depth++;
      if (isBlockEnd(program[j].type)) depth--;
      if (depth === 0) return j;
    }
  } else if (isBlockEnd(t)) {
    let depth = 0;
    for (let j = i; j >= 0; j--) {
      if (isBlockEnd(program[j].type)) depth++;
      if (isBlockStart(program[j].type)) depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

const n = (i) => `Komut ${i + 1}`;
const HOW_TO_FILL = 'Bloğun içine komut eklemek için bloğun ilk ya da son satırına gidip A tuşuna basın.';

// Returns null if the program can run, otherwise { index, message }.
export function validate(program) {
  try {
    parse(program);
    return null;
  } catch (err) {
    return { index: err.index ?? 0, message: err.message };
  }
}

function fail(index, message) {
  const err = new Error(message);
  err.index = index;
  throw err;
}

// Turns the flat list into a tree:
//   { kind: 'cmd', index, cmd }
//   { kind: 'repeat', index, cmd, body }
//   { kind: 'if', index, cmd, then, otherwise }
//   { kind: 'parallel', index, body }
export function parse(program) {
  let i = 0;

  const parseUntil = (endTypes) => {
    const nodes = [];
    while (i < program.length) {
      const cmd = program[i];
      if (endTypes.includes(cmd.type)) return nodes;
      if (isBlockEnd(cmd.type)) fail(i, `${n(i)}: ${describe(cmd)} için bir başlangıç yok.`);
      if (cmd.type === 'else') fail(i, `${n(i)}: Aksi halde, sadece bir Eğer bloğunun içinde kullanılabilir.`);
      if (cmd.type === 'repeatStart') {
        const start = i++;
        const body = parseUntil(['repeatEnd']);
        if (i >= program.length) fail(start, `${n(start)}: bu tekrarın sonu yok.`);
        if (!body.length) fail(start, `${n(start)}: tekrarın içinde hiç komut yok. ${HOW_TO_FILL}`);
        i++;
        nodes.push({ kind: 'repeat', index: start, cmd, body });
      } else if (cmd.type === 'ifStart') {
        const start = i++;
        const then = parseUntil(['else', 'ifEnd']);
        let otherwise = [];
        if (i < program.length && program[i].type === 'else') {
          i++;
          otherwise = parseUntil(['ifEnd']);
        }
        if (i >= program.length) fail(start, `${n(start)}: bu Eğer bloğunun sonu yok.`);
        if (!then.length && !otherwise.length) fail(start, `${n(start)}: Eğer bloğunun içinde hiç komut yok. ${HOW_TO_FILL}`);
        i++;
        nodes.push({ kind: 'if', index: start, cmd, then, otherwise });
      } else if (cmd.type === 'parallelStart') {
        const start = i++;
        const body = parseUntil(['parallelEnd']);
        if (i >= program.length) fail(start, `${n(start)}: Aynı anda bloğunun sonu yok.`);
        if (body.length < 2) fail(start, `${n(start)}: Aynı anda bloğunun içinde en az iki komut olmalı, şu an ${body.length} komut var. Bloğun dışındaki bir komutu içeri almak için o komuta gidip Alt ve ok tuşlarıyla bloğun içine taşıyın. ${HOW_TO_FILL}`);
        const ports = new Set();
        for (const node of body) {
          if (node.kind !== 'cmd') fail(node.index, `${n(node.index)}: Aynı anda bloğunun içine başka bir blok konamaz.`);
          if (node.cmd.type === 'stopProgram') fail(node.index, `${n(node.index)}: Programı bitir, Aynı anda bloğunun içinde kullanılamaz.`);
          const usesPort = 'port' in node.cmd && node.cmd.type !== 'waitColor';
          if (usesPort) {
            const key = `${node.cmd.type.startsWith('light') ? 'L' : 'M'}${node.cmd.port}`;
            if (ports.has(key)) fail(node.index, `${n(node.index)}: Aynı anda bloğunda aynı port iki kez kullanılıyor.`);
            ports.add(key);
          }
        }
        i++;
        nodes.push({ kind: 'parallel', index: start, cmd, body });
      } else {
        nodes.push({ kind: 'cmd', index: i, cmd });
        i++;
      }
    }
    return nodes;
  };

  const tree = parseUntil([]);
  return tree;
}
