// Sends short messages to screen readers through two live regions
// and keeps a readable history list (for braille display users).

export class Announcer {
  constructor({ politeEl, assertiveEl, logEl, maxLog = 30 }) {
    this.polite = politeEl;
    this.assertive = assertiveEl;
    this.log = logEl;
    this.maxLog = maxLog;
    this.lastText = '';
    this.lastTime = 0;
  }

  // urgent = true interrupts the screen reader (errors, safety stop).
  say(text, { urgent = false, logIt = true } = {}) {
    const now = Date.now();
    // Avoid repeating the exact same message within one second.
    if (text === this.lastText && now - this.lastTime < 1000) return;
    this.lastText = text;
    this.lastTime = now;

    const region = urgent ? this.assertive : this.polite;
    // Each message is added as its own element, so quick messages in a row are all
    // read instead of overwriting each other. Old ones are removed after a while.
    const item = document.createElement('p');
    item.textContent = text;
    setTimeout(() => region.append(item), 50);
    setTimeout(() => item.remove(), 8000);

    if (logIt) this.addToLog(text);
  }

  addToLog(text) {
    if (!this.log) return;
    const li = document.createElement('li');
    const time = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    li.textContent = `${time}: ${text}`;
    this.log.prepend(li);
    while (this.log.children.length > this.maxLog) this.log.lastElementChild.remove();
  }
}
