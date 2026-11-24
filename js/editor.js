// Accessible program editor: a listbox of commands plus an add/edit dialog.

import { COMMAND_TYPES, describe, newCommand, depths } from './program-model.js';

const STORAGE_KEY = 'erisilebilir-spike-program';
const ADD_ID = 'komut-ekle-secenek';

const load = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return Array.isArray(data) ? data.filter((c) => c && COMMAND_TYPES[c.type]) : [];
  } catch {
    return [];
  }
};

export class Editor {
  constructor({ list, dialog, form, fields, title, cancelBtn, say }) {
    this.list = list;
    this.dialog = dialog;
    this.form = form;
    this.fields = fields;
    this.title = title;
    this.cancelBtn = cancelBtn;
    this.say = say;
    this.program = load();
    this.active = 0;
    this.undoStack = [];
    this.redoStack = [];
    this.clipboard = null;
    this.runningIndex = -1;
    this.dialogMode = null; // { kind: 'add' | 'edit', index }

    this.list.addEventListener('keydown', (e) => this._onKey(e));
    this.list.addEventListener('click', (e) => {
      const opt = e.target.closest('[role="option"]');
      if (!opt) return;
      this.setActive(Number(opt.dataset.index));
      this.activate();
    });
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this._submitDialog();
    });
    // Enter on a drop-down list does nothing by default; here it means "Tamam",
    // so the dialog can be finished from any field.
    this.form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'SELECT' && !e.altKey) {
        e.preventDefault();
        this.form.requestSubmit();
      }
    });
    this.cancelBtn.addEventListener('click', () => this.dialog.close());
    this.dialog.addEventListener('close', () => {
      this.dialogMode = null;
      this.list.focus();
    });
    this.render();
  }

  // ---------- State ----------

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.program));
    } catch {
      /* storage may be unavailable; the program still works in memory */
    }
  }

  _change(mutator, message, newActive) {
    this.undoStack.push(JSON.stringify(this.program));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    mutator();
    this._save();
    if (newActive !== undefined) this.active = newActive;
    this.render();
    if (message) this.say(message);
  }

  undo() {
    if (!this.undoStack.length) return this.say('Geri alınacak bir şey yok.');
    this.redoStack.push(JSON.stringify(this.program));
    this.program = JSON.parse(this.undoStack.pop());
    this._save();
    this.render();
    this.say(`Geri alındı. ${this._summary()}`);
  }

  redo() {
    if (!this.redoStack.length) return this.say('Yinelenecek bir şey yok.');
    this.undoStack.push(JSON.stringify(this.program));
    this.program = JSON.parse(this.redoStack.pop());
    this._save();
    this.render();
    this.say(`Yinelendi. ${this._summary()}`);
  }

  _summary() {
    const n = this.program.length;
    return n === 0 ? 'Program boş.' : `Programda ${n} komut var.`;
  }

  clear() {
    if (!this.program.length) return this.say('Program zaten boş.');
    this._change(() => (this.program = []), 'Program temizlendi. Geri almak için Ctrl ve Z.', 0);
  }

  // ---------- Rendering ----------

  _optionText(i) {
    const d = depths(this.program)[i];
    const inside = d > 0 ? (d === 1 ? 'İçeride: ' : `${d} kat içeride: `) : '';
    return `${i + 1}. ${inside}${describe(this.program[i])}`;
  }

  render() {
    const ds = depths(this.program);
    this.list.textContent = '';
    this.program.forEach((cmd, i) => {
      const opt = document.createElement('div');
      opt.setAttribute('role', 'option');
      opt.id = `komut-${i}`;
      opt.dataset.index = String(i);
      opt.textContent = this._optionText(i);
      opt.style.paddingInlineStart = `${1 + ds[i] * 2}rem`;
      if (i === this.runningIndex) opt.classList.add('calisan');
      this.list.append(opt);
    });
    const add = document.createElement('div');
    add.setAttribute('role', 'option');
    add.id = ADD_ID;
    add.dataset.index = String(this.program.length);
    add.textContent = this.program.length ? 'Yeni komut ekle' : 'Program boş. Yeni komut ekle';
    add.classList.add('ekle-secenek');
    this.list.append(add);
    this.setActive(this.active);
  }

  setActive(i) {
    const opts = this.list.querySelectorAll('[role="option"]');
    this.active = Math.max(0, Math.min(i, opts.length - 1));
    opts.forEach((o, k) => o.setAttribute('aria-selected', String(k === this.active)));
    const current = opts[this.active];
    this.list.setAttribute('aria-activedescendant', current.id);
    current.scrollIntoView({ block: 'nearest' });
  }

  setRunning(index) {
    this.runningIndex = index;
    this.list.querySelectorAll('[role="option"]').forEach((o) => {
      o.classList.toggle('calisan', Number(o.dataset.index) === index);
    });
  }

  readAll() {
    if (!this.program.length) return this.say('Program boş.');
    const text = this.program.map((_, i) => this._optionText(i)).join('. ');
    this.say(`${this._summary()} ${text}.`, { logIt: false });
  }

  // ---------- Editing ----------

  activate() {
    if (this.active >= this.program.length) this.openAdd();
    else this.openEdit(this.active);
  }

  remove() {
    const i = this.active;
    if (i >= this.program.length) return;
    const cmd = this.program[i];
    if (cmd.type === 'repeatStart' || cmd.type === 'repeatEnd') {
      // Remove the whole pair but keep the commands inside.
      const pair = this._pairOf(i);
      const [a, b] = [Math.min(i, pair), Math.max(i, pair)];
      this._change(
        () => {
          this.program.splice(b, 1);
          this.program.splice(a, 1);
        },
        `Tekrar kaldırıldı, içindeki komutlar yerinde kaldı. ${this._summaryAfter(-2)}`,
        Math.min(a, this.program.length - 2),
      );
      return;
    }
    const text = describe(cmd);
    this._change(() => this.program.splice(i, 1), `Silindi: ${text}. ${this._summaryAfter(-1)}`, i);
  }

  _summaryAfter(delta) {
    const n = this.program.length + delta;
    return n <= 0 ? 'Program boş.' : `${n} komut kaldı.`;
  }

  _pairOf(i) {
    const step = this.program[i].type === 'repeatStart' ? 1 : -1;
    let depth = 0;
    for (let j = i; j >= 0 && j < this.program.length; j += step) {
      const t = this.program[j].type;
      if (t === 'repeatStart') depth += step;
      if (t === 'repeatEnd') depth -= step;
      if (depth === 0) return j;
    }
    return i;
  }

  move(delta) {
    const i = this.active;
    const j = i + delta;
    if (i >= this.program.length) return;
    if (j < 0 || j >= this.program.length) {
      return this.say(delta < 0 ? 'Zaten en üstte.' : 'Zaten en altta.');
    }
    this._change(
      () => {
        const [cmd] = this.program.splice(i, 1);
        this.program.splice(j, 0, cmd);
      },
      undefined,
      j,
    );
    this.say(`Taşındı: ${this._optionText(j)}`);
  }

  copy() {
    if (this.active >= this.program.length) return;
    this.clipboard = { ...this.program[this.active] };
    this.say(`Kopyalandı: ${describe(this.clipboard)}`);
  }

  paste() {
    if (!this.clipboard) return this.say('Önce bir komut kopyalayın.');
    const at = Math.min(this.active + 1, this.program.length);
    const cmd = { ...this.clipboard };
    this._change(() => this.program.splice(at, 0, cmd), undefined, at);
    this.say(`Yapıştırıldı: ${this._optionText(at)}`);
  }

  // ---------- Dialog ----------

  // Adding happens in two steps: first a plain list of buttons, one per command
  // (every command is visible and read aloud), then the settings of the chosen one.
  openAdd() {
    this.dialogMode = {
      kind: 'add',
      index: Math.min(this.active + (this.active < this.program.length ? 1 : 0), this.program.length),
    };
    this._showPicker();
    if (!this.dialog.open) this.dialog.showModal();
    this.fields.querySelector('button').focus();
  }

  _showPicker() {
    this.title.textContent = 'Komut ekle: bir komut seçin';
    this.fields.textContent = '';
    delete this.fields.dataset.type;
    this._submitButton().hidden = true;
    const list = document.createElement('ul');
    list.className = 'komut-secici';
    list.setAttribute('aria-label', 'Komutlar');
    for (const [type, def] of Object.entries(COMMAND_TYPES)) {
      if (def.hidden) continue;
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = def.name;
      btn.addEventListener('click', () => this._chooseType(type));
      li.append(btn);
      list.append(li);
    }
    this.fields.append(list);
  }

  _chooseType(type) {
    this.title.textContent = `Komut ekle: ${COMMAND_TYPES[type].name}`;
    this._renderFields(newCommand(type));
    this._submitButton().hidden = false;
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'geri';
    back.textContent = 'Başka bir komut seç';
    back.addEventListener('click', () => {
      this._showPicker();
      this.fields.querySelector('button').focus();
    });
    this.fields.append(back);
    const first = this.fields.querySelector('select, input');
    (first || this._submitButton()).focus();
  }

  _submitButton() {
    return this.form.querySelector('button[type="submit"]');
  }

  openEdit(i) {
    const cmd = this.program[i];
    if (cmd.type === 'repeatEnd') return this.say('Tekrar sonunun ayarı yok. Tekrarı değiştirmek için başlangıcına gidin.');
    this.dialogMode = { kind: 'edit', index: i };
    this.title.textContent = `Komutu düzenle: ${COMMAND_TYPES[cmd.type].name}`;
    this._renderFields(cmd);
    this._submitButton().hidden = false;
    this.dialog.showModal();
    const first = this.fields.querySelector('select, input');
    if (first) first.focus();
  }

  _renderFields(cmd) {
    this.fields.textContent = '';
    for (const f of COMMAND_TYPES[cmd.type].fields) {
      if (f.type === 'choice') this._select(`alan-${f.key}`, f.label, f.options, cmd[f.key]);
      else this._number(`alan-${f.key}`, f.label, f, cmd[f.key]);
    }
    if (!COMMAND_TYPES[cmd.type].fields.length) {
      const p = document.createElement('p');
      p.textContent = 'Bu komutun ayarı yok.';
      this.fields.append(p);
    }
    this.fields.dataset.type = cmd.type;
  }

  _row(id, label) {
    const row = document.createElement('div');
    row.className = 'alan';
    const l = document.createElement('label');
    l.htmlFor = id;
    l.textContent = label;
    row.append(l);
    this.fields.append(row);
    return row;
  }

  _select(id, label, options, value) {
    const row = this._row(id, label);
    const select = document.createElement('select');
    select.id = id;
    for (const [v, text] of Object.entries(options)) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = text;
      if (String(v) === String(value)) o.selected = true;
      select.append(o);
    }
    row.append(select);
    return select;
  }

  _number(id, label, f, value) {
    const row = this._row(id, label);
    const input = document.createElement('input');
    // A text field (not type=number) so both "1,5" and "1.5" work on every keyboard.
    input.type = 'text';
    input.id = id;
    input.value = String(value).replace('.', ',');
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    const hint = document.createElement('span');
    hint.id = `${id}-ipucu`;
    hint.className = 'ipucu';
    hint.textContent = `${String(f.min).replace('.', ',')} ile ${f.max} arasında bir sayı.`;
    input.setAttribute('aria-describedby', hint.id);
    row.append(input, hint);
    return input;
  }

  _readFields() {
    const type = this.fields.dataset.type;
    const cmd = { type };
    for (const f of COMMAND_TYPES[type].fields) {
      const el = this.fields.querySelector(`#alan-${f.key}`);
      if (f.type === 'number') {
        let n = parseFloat(String(el.value).replace(',', '.'));
        if (Number.isNaN(n)) n = COMMAND_TYPES[type].defaults[f.key];
        n = Math.max(f.min, Math.min(f.max, n));
        if (f.step >= 1) n = Math.round(n);
        cmd[f.key] = Math.round(n * 10) / 10;
      } else {
        const raw = el.value;
        cmd[f.key] = /^-?\d+$/.test(raw) ? Number(raw) : raw;
      }
    }
    return cmd;
  }

  _submitDialog() {
    const mode = this.dialogMode;
    if (!mode || !this.fields.dataset.type) return;
    const cmd = this._readFields();
    if (mode.kind === 'add') {
      const at = mode.index;
      if (cmd.type === 'repeatStart') {
        this._change(
          () => this.program.splice(at, 0, cmd, { type: 'repeatEnd' }),
          `Eklendi: ${at + 1}. ${describe(cmd)} ve ${at + 2}. Tekrar sonu. Tekrarlanacak komutları bu ikisinin arasına ekleyin.`,
          at,
        );
      } else {
        this._change(() => this.program.splice(at, 0, cmd), `Eklendi: ${at + 1}. ${describe(cmd)}`, at);
      }
    } else {
      const i = mode.index;
      this._change(() => (this.program[i] = cmd), `Değiştirildi: ${i + 1}. ${describe(cmd)}`, i);
    }
    this.dialog.close();
  }

  // ---------- Keyboard ----------

  _onKey(e) {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      this.move(e.key === 'ArrowUp' ? -1 : 1);
    } else if (ctrl && e.key.toLowerCase() === 'z') {
      this.undo();
    } else if (ctrl && e.key.toLowerCase() === 'y') {
      this.redo();
    } else if (ctrl && e.key.toLowerCase() === 'c') {
      this.copy();
    } else if (ctrl && e.key.toLowerCase() === 'v') {
      this.paste();
    } else if (ctrl || e.altKey) {
      return;
    } else if (e.key === 'ArrowDown') {
      this.setActive(this.active + 1);
    } else if (e.key === 'ArrowUp') {
      this.setActive(this.active - 1);
    } else if (e.key === 'Home') {
      this.setActive(0);
    } else if (e.key === 'End') {
      this.setActive(this.program.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      this.activate();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      this.remove();
    } else if (e.key.toLowerCase() === 'a') {
      this.openAdd();
    } else if (e.key.toLowerCase() === 'p') {
      this.readAll();
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }
}
