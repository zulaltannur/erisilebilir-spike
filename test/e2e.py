import os, sys, json, threading, functools, http.server, socketserver
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.join(HERE, '..')
FAKE = open(os.path.join(HERE, 'fake_hub.js')).read()
AXE = open(os.path.join(HERE, '..', 'node_modules', 'axe-core', 'axe.min.js')).read()

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=APP_DIR)
Handler.log_message = lambda *a: None
httpd = socketserver.TCPServer(('127.0.0.1', 0), Handler)
port = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()

results = []
def expect(cond, name):
    results.append((bool(cond), name))

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROME_PATH'), args=['--no-sandbox'])
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.add_init_script(FAKE)
    page.goto(f'http://127.0.0.1:{port}/index.html')
    page.wait_for_timeout(300)

    said = lambda: page.evaluate('window.__said')
    def has(text):
        return any(text in s for s in said())

    page.click('#calistir-btn', force=True)
    page.wait_for_timeout(200)
    expect(has('Önce Hub'), 'bağlı değilken çalıştır uyarısı')

    page.click('#baglan-btn')
    page.wait_for_timeout(1200)
    expect(has('Hub bağlandı: Test Hub. Pil yüzde 80. Port A: motor, Port B: renk sensörü.'), 'bağlantı duyurusu')
    expect(page.evaluate('document.activeElement.id') == 'kes-btn', 'odak Bağlantıyı kes düğmesinde')

    page.evaluate('window.__fake.color = 9')
    page.wait_for_timeout(500)
    expect(has('Renk: kırmızı.'), 'renk değişimi duyurusu')

    page.evaluate('window.__fake.motorPos = 30')
    page.wait_for_timeout(120)
    page.evaluate('window.__fake.motorPos = 90')
    page.wait_for_timeout(600)
    expect(has('Motor A durdu, 90 derece.'), 'motor elle çevrildi duyurusu')

    page.focus('#kesfet-liste')
    page.keyboard.press('ArrowDown')
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)
    expect(has('Port A: motor, 90 derece'), 'liste satırı yeniden okundu')
    expect(page.get_attribute('#kesfet-liste', 'aria-activedescendant') == 'secenek-a', 'aktif seçenek')

    page.keyboard.press('h')
    page.wait_for_timeout(200)
    expect(has('Hub: Test Hub, pil yüzde 80. Port A: motor, 90 derece. Port B: renk sensörü, kırmızı.'), 'H kısayolu')

    page.keyboard.press('w')
    page.wait_for_timeout(200)
    expect(has('Keşfet bölümündesiniz. Hub bağlı.'), 'W kısayolu')

    page.click('#calistir-btn', force=True)
    page.wait_for_function("window.__said.includes('Program bitti.')", timeout=8000)
    expect(has('Program başladı.'), 'program başladı')
    expect(has('Adım 1: Motor A bir tur dönüyor'), 'adım duyurusu')
    expect(has('Program bitti.'), 'program bitti')
    expect(not any('Takıldı' in x or 'takıldı' in x for x in said()[:3]), 'bağlanırken tek tek takıldı duyurusu yok')
    expect(sum(1 for x in said() if x.startswith('Motor A durdu')) == 1, 'program sonrası gereksiz motor duyurusu yok')

    page.check('input[name="motor-port"][value="1"]')
    page.click('#calistir-btn', force=True)
    page.wait_for_timeout(200)
    expect(has("Port B'de motor yok. Motor Port A'da."), 'yanlış port uyarısı')

    page.evaluate('window.__fake.colorAttached = false')
    page.wait_for_timeout(400)
    expect(has('Port B boşaldı.'), 'parça çıkarıldı')
    page.evaluate('window.__fake.colorAttached = true')
    page.wait_for_timeout(400)
    expect(has("Port B'ye renk sensörü takıldı."), 'parça takıldı')

    page.focus('#kesfet-liste')
    page.keyboard.press('?')
    page.wait_for_timeout(200)
    expect(page.evaluate("document.getElementById('yardim-dialog').open"), 'yardım penceresi açıldı')
    page.keyboard.press('Escape')
    page.wait_for_timeout(200)
    expect(not page.evaluate("document.getElementById('yardim-dialog').open"), 'yardım penceresi kapandı')

    # Accessibility scan
    page.add_script_tag(content=AXE)
    axe = page.evaluate("axe.run(document, {runOnly: ['wcag2a','wcag2aa','wcag21aa','wcag22aa','best-practice']})")
    violations = [(v['id'], v['help'], len(v['nodes'])) for v in axe['violations']]
    expect(not violations, 'axe erişilebilirlik taraması: ' + json.dumps(violations, ensure_ascii=False))

    page.click('#kes-btn')
    page.wait_for_timeout(300)
    expect(has('Hub bağlantısı koptu.'), 'bağlantı koptu duyurusu')
    expect(page.evaluate('document.activeElement.id') == 'baglan-btn', 'odak Bağlan düğmesine döndü')

    page.set_viewport_size({'width': 320, 'height': 800})
    sw = page.evaluate('document.documentElement.scrollWidth')
    expect(sw <= 320, f'320px genişlikte yatay kaydırma yok ({sw})')
    page.screenshot(path=os.path.join(HERE, 'mobile.png'), full_page=True)
    page.set_viewport_size({'width': 1100, 'height': 900})
    page.screenshot(path=os.path.join(HERE, 'desktop.png'), full_page=True)

    # Remembered Hub: connects without Chrome's device list
    page.goto(f'http://127.0.0.1:{port}/index.html?hafiza')
    page.wait_for_timeout(300)
    expect(page.is_visible('#yeni-hub-btn'), 'Yeni Hub eşle düğmesi görünüyor')
    page.click('#baglan-btn')
    page.wait_for_timeout(1500)
    expect(has('Daha önce eşlenen Hub aranıyor: Test Hub.'), 'kayıtlı Hub duyurusu')
    expect(has('Hub bağlandı: Test Hub.'), 'kayıtlı Hub ile bağlantı')

    # SPIKE Essential: LEGO Wireless Protocol 3
    page.goto(f'http://127.0.0.1:{port}/index.html?lwp')
    page.wait_for_timeout(300)
    page.click('#baglan-btn')
    page.wait_for_timeout(1500)
    expect(has('Hub bağlandı: Test Hub. Pil yüzde 80. Port A: motor, Port B: renk sensörü.'), 'LWP: bağlantı duyurusu')
    expect(not has('eski'), 'LWP: yazılım eski uyarısı yok')
    page.evaluate('window.__fake.color = 9')
    page.wait_for_timeout(600)
    expect(has('Renk: kırmızı.'), 'LWP: renk duyurusu')
    page.evaluate('window.__fake.motorPos += 45')
    page.wait_for_timeout(100)
    page.evaluate('window.__fake.motorPos += 45')
    page.wait_for_timeout(900)
    expect(has('Motor A durdu, 90 derece.'), 'LWP: motor elle çevrildi')
    page.click('#calistir-btn', force=True)
    page.wait_for_timeout(1800)
    expect(has('Program başladı.') and has('Adım 1: Motor A bir tur dönüyor') and has('Program bitti.'), 'LWP: motor bir tur')
    sent = page.evaluate('window.__lwpSent')
    turn = [m for m in sent if len(m) > 5 and m[2] == 0x81 and m[5] == 0x0b]
    expect(turn and turn[0][6:10] == [0x68, 0x01, 0, 0], 'LWP: 360 derece komutu doğru kodlandı ' + json.dumps(turn[:1]))
    page.evaluate('window.__fake.colorAttached = false')
    page.wait_for_timeout(500)
    expect(has('Port B boşaldı.'), 'LWP: parça çıkarıldı')

    # ---- Program editor (keyboard only) ----
    page.evaluate('window.__fake.colorAttached = true')
    page.wait_for_timeout(400)
    page.click('#program-temizle-btn')
    page.focus('#program-liste')
    page.keyboard.press('a')
    page.wait_for_timeout(200)
    expect(page.evaluate("document.getElementById('komut-dialog').open"), 'editör: ekleme penceresi açıldı')
    expect(page.evaluate("document.activeElement.textContent") == 'Motoru döndür', 'editör: odak ilk komut düğmesinde')
    expect(page.evaluate("document.querySelectorAll('#komut-alanlar .komut-secici button').length") == 21, 'editör: 21 komut listelendi')
    page.add_script_tag(content=AXE)
    axe2 = page.evaluate("axe.run(document, {runOnly: ['wcag2a','wcag2aa','wcag21aa','wcag22aa','best-practice']})")
    v2 = [(v['id'], len(v['nodes'])) for v in axe2['violations']]
    expect(not v2, 'axe: komut penceresi açıkken: ' + json.dumps(v2))
    page.screenshot(path=os.path.join(HERE, 'dialog.png'))
    page.click('.komut-secici button:has-text("Tekrarla")')
    page.fill('#alan-times', '2')
    page.press('#alan-times', 'Enter')
    page.wait_for_timeout(300)
    expect(has('Eklendi: 1. Tekrarla 2 kez ve 2. Tekrar sonu.'), 'editör: tekrar eklendi')
    expect(page.evaluate('document.activeElement.id') == 'program-liste', 'editör: odak listeye döndü')
    page.keyboard.press('a')
    page.wait_for_timeout(200)
    page.keyboard.press('Enter')
    page.wait_for_timeout(100)
    expect(page.evaluate('document.activeElement.id') == 'alan-port', 'editör: odak ilk ayarda')
    page.keyboard.press('Enter')
    page.wait_for_timeout(300)
    expect(has('Eklendi: 2. Motor A, 1 tur, saat yönünde'), 'editör: motor komutu tekrarın içine eklendi')
    page.keyboard.press('p')
    page.wait_for_timeout(200)
    expect(has('Programda 3 komut var. 1. Tekrarla 2 kez. 2. İçeride: Motor A, 1 tur, saat yönünde. 3. Tekrar sonu.'), 'editör: P programı okudu')

    page.keyboard.press('Control+Enter')
    page.wait_for_timeout(3000)
    expect(has('Tekrar: 1. tur, 2 turdan.') and has('Tekrar: 2. tur, 2 turdan.'), 'çalıştırma: tekrar turları')
    expect(has('Adım 1: Motor A, 1 tur, saat yönünde') and has('Adım 2: Motor A, 1 tur, saat yönünde'), 'çalıştırma: adımlar')
    turns = [m for m in page.evaluate('window.__lwpSent') if len(m) > 5 and m[2] == 0x81 and m[5] == 0x0b]
    expect(len(turns) == 3, f'çalıştırma: Hub’a 2 tur komutu gitti (deneme dahil 3): {len(turns)}')
    expect(sum(1 for x in said() if x == 'Program bitti.') >= 2, 'çalıştırma: program bitti')

    page.keyboard.press('Delete')
    page.wait_for_timeout(200)
    expect(has('Silindi: Motor A, 1 tur, saat yönünde. 2 komut kaldı.'), 'editör: silme')
    page.keyboard.press('Control+z')
    page.wait_for_timeout(200)
    expect(has('Geri alındı. Programda 3 komut var.'), 'editör: geri alma')
    page.keyboard.press('Alt+ArrowUp')
    page.wait_for_timeout(200)
    expect(has('Taşındı: 1. Motor A, 1 tur, saat yönünde'), 'editör: taşıma')
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)
    page.select_option('#alan-unit', 'seconds')
    page.fill('#alan-amount', '1,5')
    page.press('#alan-amount', 'Enter')
    page.wait_for_timeout(200)
    expect(has('Değiştirildi: 1. Motor A, 1,5 saniye, saat yönünde'), 'editör: düzenleme (virgüllü sayı)')

    # Stop with Escape during a long wait
    page.click('#program-temizle-btn')
    page.focus('#program-liste')
    page.keyboard.press('End')
    page.keyboard.press('Enter')
    page.wait_for_timeout(100)
    page.click('.komut-secici button:has-text("Bekle")')
    page.fill('#alan-seconds', '10')
    page.press('#alan-seconds', 'Enter')
    page.wait_for_timeout(200)
    page.keyboard.press('Control+Enter')
    page.wait_for_timeout(500)
    page.keyboard.press('Escape')
    page.wait_for_timeout(300)
    expect(has('Program durduruldu.'), 'çalıştırma: Escape ile durdu')

    # ---- New commands, run on the simulated Essential Hub ----
    def run_program(prog, wait_ms):
        page.evaluate('p => window.__erisilebilir.editor.replaceProgram(p, "")', prog)
        start = len(said())
        page.focus('#program-liste')
        page.keyboard.press('Control+Enter')
        page.wait_for_timeout(wait_ms)
        return said()[start:]

    out = run_program([{'type': 'sound', 'sound': 'drum'}], 1200)
    expect(page.evaluate('window.__lastSound') == 'drum' and 'Program bitti.' in out, 'ses: davul çaldı')

    out = run_program([{'type': 'parallelStart'}, {'type': 'motorRun', 'port': 0, 'amount': 1, 'unit': 'rotations', 'direction': 'cw'},
                       {'type': 'note', 'note': 'C', 'seconds': 0.4}, {'type': 'parallelEnd'}], 2000)
    expect('Aynı anda 2 komut başlıyor.' in out and 'Program bitti.' in out, 'aynı anda: iki komut birlikte ' + json.dumps(out, ensure_ascii=False))
    i_motor = next((k for k, x in enumerate(out) if 'Motor A, 1 tur' in x), 99)
    i_note = next((k for k, x in enumerate(out) if 'Nota çal' in x), 99)
    i_done = out.index('Program bitti.') if 'Program bitti.' in out else -1
    expect(i_motor < i_done and i_note < i_done, 'aynı anda: ikisi de bitmeden program bitmedi')

    page.evaluate('window.__fake.color = 9')
    page.wait_for_timeout(700)
    out = run_program([{'type': 'ifStart', 'condition': 'colorIs', 'port': 1, 'color': 9}, {'type': 'sound', 'sound': 'beep'},
                       {'type': 'else'}, {'type': 'sound', 'sound': 'drop'}, {'type': 'ifEnd'}], 1000)
    expect(any('Eğer şu doğruysa: renk sensörü B kırmızı görüyor: evet, sensör şu an kırmızı görüyor.' in x for x in out) and page.evaluate('window.__lastSound') == 'beep', 'eğer: evet dalı')
    page.keyboard.press('Escape')
    page.wait_for_timeout(300)
    page.evaluate('window.__fake.color = 3')
    page.wait_for_timeout(700)
    out = run_program([{'type': 'ifStart', 'condition': 'colorIs', 'port': 1, 'color': 9}, {'type': 'sound', 'sound': 'beep'},
                       {'type': 'else'}, {'type': 'sound', 'sound': 'drop'}, {'type': 'ifEnd'}], 1000)
    expect(any('Eğer şu doğruysa: renk sensörü B kırmızı görüyor: hayır, sensör şu an koyu mavi görüyor.' in x for x in out) and page.evaluate('window.__lastSound') == 'drop', 'eğer: değilse dalı ' + json.dumps(out, ensure_ascii=False))
    page.keyboard.press('Escape')
    page.wait_for_timeout(300)

    out = run_program([{'type': 'repeatStart', 'forever': 'yes', 'times': 3}, {'type': 'wait', 'seconds': 0.3}, {'type': 'repeatEnd'}], 1100)
    page.keyboard.press('Escape')
    page.wait_for_timeout(300)
    out = said()[-12:]
    expect(any('Sonsuz tekrar: 1. tur.' in x for x in said()) and 'Program durduruldu.' in out, 'sonsuz tekrar ve Escape')

    out = run_program([{'type': 'sound', 'sound': 'beep'}, {'type': 'stopProgram'}, {'type': 'sound', 'sound': 'siren'}], 1000)
    expect('Program bitti.' in out and page.evaluate('window.__lastSound') == 'beep', 'programı bitir komutu')

    out = run_program([{'type': 'parallelStart'}, {'type': 'sound', 'sound': 'beep'}, {'type': 'parallelEnd'}], 300)
    expect(any('en az iki komut' in x for x in out), 'doğrulama: aynı anda bloğunda tek komut')

    out = run_program([{'type': 'hubLight', 'color': 9}], 500)
    hub_light = [m for m in page.evaluate('window.__lwpSent') if len(m) > 6 and m[2] == 0x81 and m[3] == 0x32]
    expect(hub_light and hub_light[-1][5:] == [0x51, 0, 9], 'Hub ışığı komutu ' + json.dumps(hub_light[-1:]))

    out = run_program([{'type': 'motorGoTo', 'port': 0, 'position': 180}], 1500)
    goto = [m for m in page.evaluate('window.__lwpSent') if len(m) > 9 and m[2] == 0x81 and m[5] == 0x0b][-1]
    expect('Program bitti.' in out, 'motoru konuma getir ' + json.dumps(goto))

    # Small jitter of a resting motor is not announced
    page.wait_for_timeout(500)
    start = len(said())
    for d in [3, -4, 4, -3, 2]:
        page.evaluate(f'window.__fake.motorPos += {d}')
        page.wait_for_timeout(250)
    page.wait_for_timeout(600)
    expect(not any('durdu' in x for x in said()[start:]), 'motor titremesi duyurulmadı')

    # A motor left turning: the end message says so, and Durdur stops it even with no program running
    out = run_program([{'type': 'motorStart', 'port': 0, 'direction': 'cw'}, {'type': 'speed', 'percent': 70}], 600)
    expect(any('Motor A hâlâ dönüyor' in x for x in out), 'sürekli motor: program sonunda uyarı ' + json.dumps(out, ensure_ascii=False))
    before = len(page.evaluate('window.__lwpSent'))
    page.click('#program-durdur-btn')
    page.wait_for_timeout(300)
    brakes = [m for m in page.evaluate('window.__lwpSent')[before:] if m[2] == 0x81 and m[5:] == [0x51, 0, 127]]
    expect(brakes and has('Motorlar durduruldu.'), 'Durdur: program bitmiş olsa da motoru durdurdu')
    page.click('#program-durdur-btn')
    page.wait_for_timeout(200)
    expect(has('Şu an çalışan bir program yok, motorlar da duruyor.'), 'Durdur: duran robotta doğru mesaj')

    # A long motor turn does not time out early
    out = run_program([{'type': 'motorRun', 'port': 0, 'amount': 10, 'unit': 'rotations', 'direction': 'cw'}, {'type': 'sound', 'sound': 'beep'}], 2500)
    expect('Adım 2: Ses çal: bip' in out and 'Program bitti.' in out, 'sıralı: uzun motor komutundan sonra devam etti')

    out = run_program([{'type': 'speak', 'text': 'Merhaba'}], 2500)
    expect(page.evaluate('window.__lastSound') == 'speak:Merhaba' and 'Program bitti.' in out, 'bilgisayar konuştu')

    # ---- Building blocks with the keyboard only ----
    def add(button_text, fill=None):
        page.keyboard.press('a')
        page.wait_for_timeout(100)
        page.click(f'#komut-alanlar .komut-secici button:text-is("{button_text}")')
        page.wait_for_timeout(100)
        for sel, val in (fill or {}).items():
            page.select_option(sel, val) if sel.startswith('select') else page.fill(sel, val)
        page.click('#komut-form button[type=submit]')
        page.wait_for_timeout(150)

    page.click('#program-temizle-btn')
    page.focus('#program-liste')
    add('Aynı anda yap')
    add('Motoru döndür')
    add('Nota çal')
    texts = page.evaluate("[...document.querySelectorAll('#program-liste [role=option]')].map(o => o.textContent)")
    expect(texts[:4] == ['1. Aynı anda yap', '2. İçeride: Motor A, 1 tur, saat yönünde', '3. İçeride: Nota çal: Do, 0,5 saniye', '4. Aynı anda sonu'],
           'blok: A ile eklenenler bloğun içine girdi ' + json.dumps(texts, ensure_ascii=False))
    start = len(said())
    page.keyboard.press('Control+Enter')
    page.wait_for_timeout(1800)
    out = said()[start:]
    expect('Aynı anda 2 komut başlıyor.' in out and 'Program bitti.' in out, 'blok: aynı anda çalıştı')
    # On the block's end line, A adds inside the block (last)
    page.keyboard.press('End')
    page.keyboard.press('ArrowUp')
    add('Bekle')
    texts = page.evaluate("[...document.querySelectorAll('#program-liste [role=option]')].map(o => o.textContent)")
    expect(texts[3] == '4. İçeride: 1 saniye bekle' and texts[4] == '5. Aynı anda sonu', 'blok: son satırda A içeri ekledi')

    page.click('#program-temizle-btn')
    page.focus('#program-liste')
    add('Eğer / aksi halde')
    add('Bilgisayardan ses çal')
    page.keyboard.press('ArrowDown')
    add('Bilgisayardan ses çal', {'select#alan-sound': 'drop'})
    texts = page.evaluate("[...document.querySelectorAll('#program-liste [role=option]')].map(o => o.textContent)")
    expect(texts[:7] == ['1. Sonsuza kadar tekrarla', '2. İçeride: Eğer şu doğruysa: renk sensörü B kırmızı görüyor', '3. 2 kat içeride: Ses çal: bip', '4. İçeride: Aksi halde', '5. 2 kat içeride: Ses çal: su damlası', '6. İçeride: Eğer sonu', '7. Tekrar sonu'],
           'eğer/değilse: klavyeyle kuruldu ' + json.dumps(texts, ensure_ascii=False))
    page.evaluate('window.__fake.color = 3')
    page.wait_for_timeout(700)
    start = len(said())
    page.keyboard.press('Control+Enter')
    page.wait_for_timeout(1000)
    page.keyboard.press('Escape')
    page.wait_for_timeout(300)
    expect(page.evaluate('window.__lastSound') == 'drop' and 'Program durduruldu.' in said()[start:], 'eğer/değilse: değilse dalı çalıştı')

    # An empty block gives a clear message and moves to the block
    page.click('#program-temizle-btn')
    page.focus('#program-liste')
    add('Aynı anda yap')
    start = len(said())
    page.keyboard.press('Control+Enter')
    page.wait_for_timeout(300)
    expect(any('A tuşuna basın' in x for x in said()[start:]), 'boş blok: yol gösteren uyarı')

    # Color calibration: teach yellow and orange, then recognize them
    page.evaluate('window.__fake.color = 7')
    page.wait_for_timeout(500)
    page.click('#renk-ayar-btn')
    page.wait_for_timeout(200)
    expect(page.evaluate("document.getElementById('renk-dialog').open"), 'renk ayarı: pencere açıldı')
    expect('sarı' in page.inner_text('#renk-adim'), 'renk ayarı: ilk istenen sarı')
    page.click('#renk-olc-btn')
    page.wait_for_timeout(1600)
    expect(has('sarı kaydedildi.'), 'renk ayarı: sarı ölçüldü')
    page.evaluate('window.__fake.color = 8')
    page.wait_for_timeout(500)
    page.click('#renk-olc-btn')
    page.wait_for_timeout(1600)
    expect(has('turuncu kaydedildi.'), 'renk ayarı: turuncu ölçüldü')
    page.click('#renk-bitir-btn')
    page.wait_for_timeout(200)
    expect(has('Renk ayarı tamamlandı. 2 renk kaydedildi.'), 'renk ayarı: tamamlandı')
    stored = page.evaluate("JSON.parse(localStorage.getItem('erisilebilir-spike-renk-ayari'))")
    expect(set(stored.keys()) == {'7', '8'}, 'renk ayarı: tarayıcıda saklandı')
    page.evaluate('window.__fake.color = 7')
    page.wait_for_timeout(900)
    expect('sarı' in page.inner_text('#kesfet-liste'), 'renk ayarı: öğretilen renk tanındı')
    page.click('#renk-sifirla-btn')
    page.wait_for_timeout(200)
    expect(has('Renk ayarı sıfırlandı.'), 'renk ayarı: sıfırlandı')

    # A loose "Eğer" is allowed (checked once); the tip explains the loop options
    out = run_program([{'type': 'ifStart', 'condition': 'colorIs', 'port': 1, 'color': 3}, {'type': 'sound', 'sound': 'beep'}, {'type': 'ifEnd'}], 900)
    expect('Program bitti.' in out and any('İpucu: Eğer bloğu sadece bir kez' in x for x in out), 'tek Eğer: bir kez çalıştı, ipucu verildi')

    # A loop reacts quickly to a new color (well under half a second)
    page.evaluate('window.__fake.color = 3')
    page.wait_for_timeout(500)
    page.evaluate("window.__lastSound = null")
    run_program([{'type': 'repeatStart', 'mode': 'forever', 'times': 3}, {'type': 'ifStart', 'condition': 'colorIs', 'port': 1, 'color': 9},
                 {'type': 'sound', 'sound': 'beep'}, {'type': 'ifEnd'}, {'type': 'repeatEnd'}], 300)
    page.evaluate('window.__t0 = performance.now(); window.__fake.color = 9')
    waited = page.evaluate("new Promise(r => { const t = setInterval(() => { if (window.__lastSound === 'beep') { clearInterval(t); r(performance.now() - window.__t0); } }, 10); setTimeout(() => r(9999), 3000); })")
    page.keyboard.press('Escape')
    page.wait_for_timeout(300)
    expect(waited < 350, f'hızlı tepki: renk {int(waited)} ms içinde fark edildi')

    # "Bir renk görülene kadar tekrarla"
    page.evaluate('window.__fake.color = 3')
    page.wait_for_timeout(600)
    out = run_program([{'type': 'repeatStart', 'mode': 'until', 'times': 3, 'port': 1, 'color': 9}, {'type': 'wait', 'seconds': 0.2}, {'type': 'repeatEnd'}], 800)
    page.evaluate('window.__fake.color = 9')
    page.wait_for_timeout(1200)
    out = said()[-8:]
    expect(any('Şu doğru olana kadar tekrarla: renk sensörü B kırmızı görüyor: tekrar bitti' in x for x in out) and 'Program bitti.' in out, 'renk görülene kadar tekrarla ' + json.dumps(out, ensure_ascii=False))

    # Negated conditions: "görmüyorsa", "artık görmeyene kadar", "gördüğü sürece"
    page.evaluate('window.__fake.color = 3')
    page.wait_for_timeout(500)
    out = run_program([{'type': 'ifStart', 'condition': 'colorIs', 'port': 1, 'color': 9, 'sees': 'no'}, {'type': 'sound', 'sound': 'clap'}, {'type': 'ifEnd'}], 1300)
    expect(any('Eğer şu doğru değilse: renk sensörü B kırmızı görüyor: evet' in x for x in out) and page.evaluate('window.__lastSound') == 'clap', 'görmüyorsa: kırmızı yokken çalıştı ' + json.dumps(out, ensure_ascii=False))
    out = run_program([{'type': 'waitColor', 'port': 1, 'color': 3, 'sees': 'no'}, {'type': 'sound', 'sound': 'boing'}], 600)
    expect(page.evaluate('window.__lastSound') != 'boing', 'artık görmeyene kadar bekle: renk varken bekliyor')
    page.evaluate('window.__fake.color = 7')
    page.wait_for_timeout(900)
    expect(page.evaluate('window.__lastSound') == 'boing' and any('Şu artık doğru olmayana kadar bekle: renk sensörü B koyu mavi görüyor' in x for x in said()[-8:]), 'artık görmeyene kadar bekle: renk gidince devam etti')
    out = run_program([{'type': 'repeatStart', 'mode': 'until', 'times': 3, 'port': 1, 'color': 7, 'sees': 'no'}, {'type': 'wait', 'seconds': 0.2}, {'type': 'repeatEnd'}], 700)
    page.evaluate('window.__fake.color = 6')
    page.wait_for_timeout(1000)
    out = said()[-8:]
    expect(any('Şu doğru olduğu sürece tekrarla: renk sensörü B sarı görüyor: tekrar bitti' in x for x in out) and 'Program bitti.' in out, 'gördüğü sürece tekrarla ' + json.dumps(out, ensure_ascii=False))

    # Other conditions: time passed, something in front of the sensor, coin toss, motor angle
    out = run_program([{'type': 'waitColor', 'cond': 'timer', 'seconds': 0.6, 'negate': 'no'}, {'type': 'sound', 'sound': 'laser'}], 400)
    expect(page.evaluate('window.__lastSound') != 'laser', 'süre koşulu: süre dolmadan beklendi')
    page.wait_for_timeout(700)
    expect(page.evaluate('window.__lastSound') == 'laser', 'süre koşulu: süre dolunca devam edildi')
    out = run_program([{'type': 'ifStart', 'cond': 'colorAny', 'port': 1, 'negate': 'no'}, {'type': 'sound', 'sound': 'up'}, {'type': 'ifEnd'}], 900)
    expect(any('Eğer şu doğruysa: renk sensörü B önünde bir şey var: evet' in x for x in out), 'önünde bir şey var koşulu ' + json.dumps(out, ensure_ascii=False))
    out = run_program([{'type': 'ifStart', 'cond': 'random', 'negate': 'no'}, {'type': 'sound', 'sound': 'up'}, {'type': 'ifEnd'}], 900)
    expect(any('yazı tura yazı geldi: ' in x and ('yazı geldi.' in x or 'tura geldi.' in x) for x in out), 'yazı tura koşulu')
    out = run_program([{'type': 'ifStart', 'cond': 'motorAngle', 'port': 0, 'angle': 359, 'negate': 'yes'}, {'type': 'sound', 'sound': 'down'}, {'type': 'ifEnd'}], 900)
    expect(any('Eğer şu doğru değilse: motor A konumu 359 dereceden büyük: evet, motor şu an' in x for x in out), 'motor konumu koşulu (değilse) ' + json.dumps(out, ensure_ascii=False))
    # Hub tilt, upside down, shake and tap
    page.wait_for_timeout(300)
    expect('Hub düz duruyor' in page.inner_text('#secenek-hub'), 'eğim: Keşfet Hub satırında düz')
    page.evaluate('window.__fake.pitch = -40')
    page.wait_for_timeout(400)
    out = run_program([{'type': 'ifStart', 'cond': 'hubBackward', 'negate': 'no'}, {'type': 'sound', 'sound': 'drum'}, {'type': 'ifEnd'}], 900)
    expect(any('Eğer şu doğruysa: Hub arkaya eğik: evet, Hub arkaya eğik.' in x for x in out) and page.evaluate('window.__lastSound') == 'drum', 'eğim: arkaya eğik ' + json.dumps(out, ensure_ascii=False))
    page.evaluate('window.__fake.pitch = 2; window.__fake.roll = 178')
    page.wait_for_timeout(400)
    out = run_program([{'type': 'ifStart', 'cond': 'hubUpsideDown', 'negate': 'no'}, {'type': 'sound', 'sound': 'bell'}, {'type': 'ifEnd'}], 1200)
    expect(any('Hub ters çevrilmiş: evet' in x for x in out), 'eğim: ters çevrilmiş')
    page.evaluate('window.__fake.roll = 1')
    page.wait_for_timeout(400)
    out = run_program([{'type': 'waitColor', 'cond': 'hubShaken', 'negate': 'no'}, {'type': 'sound', 'sound': 'siren'}], 500)
    expect(page.evaluate('window.__lastSound') != 'siren', 'sallama: sallanmadan beklendi')
    page.evaluate('window.__gesture(3)')
    page.wait_for_timeout(500)
    expect(page.evaluate('window.__lastSound') == 'siren', 'sallama: sallanınca devam etti')
    page.wait_for_timeout(1500)
    start = len(said())
    page.evaluate('window.__gesture(1)')
    page.wait_for_timeout(500)
    expect("Hub'a vuruldu." in said()[start:], 'vurma: Keşfet sırasında duyuruldu')

    # In the dialog, only the settings of the chosen condition are shown
    page.click('#program-temizle-btn')
    page.focus('#program-liste')
    page.keyboard.press('a')
    page.wait_for_timeout(100)
    page.click('#komut-alanlar .komut-secici button:text-is("Eğer")')
    page.wait_for_timeout(100)
    vis = lambda sel: page.evaluate(f"!document.querySelector('{sel}').closest('.alan').hidden")
    expect(vis('#alan-color') and not vis('#alan-seconds'), 'koşul ayarları: renk koşulunda renk görünüyor')
    page.select_option('#alan-cond', 'timer')
    expect(vis('#alan-seconds') and not vis('#alan-color') and not vis('#alan-port'), 'koşul ayarları: süre koşulunda sadece süre görünüyor')
    page.select_option('#alan-cond', 'motorTurning')
    expect(page.input_value('#alan-port') == '0', 'koşul ayarları: motor koşulunda motorun portu seçildi')
    page.keyboard.press('Escape')
    page.wait_for_timeout(100)

    # Adding "Eğer" with "Sadece bir kez": no loop is added
    page.click('#program-temizle-btn')
    page.focus('#program-liste')
    add('Eğer', {'select#alan-when': 'once'})
    texts = page.evaluate("[...document.querySelectorAll('#program-liste [role=option]')].map(o => o.textContent)")
    expect(texts[0].startswith('1. Eğer') and len(texts) == 3, 'eğer bir kez: tekrar eklenmedi ' + json.dumps(texts, ensure_ascii=False))
    # Loop shortcuts in the command list
    page.click('#program-temizle-btn')
    page.focus('#program-liste')
    add('Koşula göre tekrarla')
    texts = page.evaluate("[...document.querySelectorAll('#program-liste [role=option]')].map(o => o.textContent)")
    expect(texts[0] == '1. Şu doğru olana kadar tekrarla: renk sensörü B kırmızı görüyor' and texts[1] == '2. Tekrar sonu', 'döngü: renk görülene kadar eklendi ' + json.dumps(texts, ensure_ascii=False))
    page.keyboard.press('Home')
    page.keyboard.press('Enter')
    page.wait_for_timeout(150)
    expect('Koşula göre tekrarla' in page.inner_text('#komut-dialog-baslik') and page.is_visible('#alan-color'), 'döngü: düzenlerken kendi ayarları açıldı')
    page.keyboard.press('Escape')
    page.wait_for_timeout(100)
    # Smart default port: the color sensor is on B, so a new "Eğer" uses B
    page.focus('#program-liste')
    page.keyboard.press('a')
    page.wait_for_timeout(100)
    page.click('#komut-alanlar .komut-secici button:text-is("Eğer")')
    page.wait_for_timeout(100)
    expect(page.input_value('#alan-port') == '1', 'akıllı port: renk sensörünün portu seçili geldi')
    page.keyboard.press('Escape')
    page.wait_for_timeout(100)
    # Adding "Eğer" on its own wraps it in "Sonsuza kadar tekrarla"; parts on swapped ports are found
    page.click('#program-temizle-btn')
    page.focus('#program-liste')
    add('Eğer')
    add('Bilgisayardan ses çal')
    texts = page.evaluate("[...document.querySelectorAll('#program-liste [role=option]')].map(o => o.textContent)")
    expect(texts[:5] == ['1. Sonsuza kadar tekrarla', '2. İçeride: Eğer şu doğruysa: renk sensörü B kırmızı görüyor', '3. 2 kat içeride: Ses çal: bip', '4. İçeride: Eğer sonu', '5. Tekrar sonu'],
           'eğer: sonsuz tekrarın içine kondu ' + json.dumps(texts, ensure_ascii=False))
    page.evaluate('window.__fake.color = 3')
    page.wait_for_timeout(600)
    start = len(said())
    page.keyboard.press('Control+Enter')
    page.wait_for_timeout(800)
    page.evaluate('window.__fake.color = 9')
    page.wait_for_timeout(1200)
    page.keyboard.press('Escape')
    page.wait_for_timeout(300)
    out = said()[start:]
    hayir = sum(1 for x in out if 'görüyor: hayır' in x)
    evet = sum(1 for x in out if 'görüyor: evet' in x)
    expect(hayir == 1 and evet == 1 and 'Program durduruldu.' in out, f'eğer döngüde: sadece değişince söylendi (hayır {hayir}, evet {evet}) ' + json.dumps(out[:12], ensure_ascii=False))
    out = run_program([{'type': 'repeatStart', 'forever': 'no', 'times': 2}, {'type': 'ifStart', 'condition': 'colorIs', 'port': 0, 'color': 9}, {'type': 'sound', 'sound': 'beep'}, {'type': 'ifEnd'}, {'type': 'repeatEnd'}], 1500)
    expect(any("Program Port B'yi kullanıyor" in x for x in out) and page.evaluate('window.__lastSound') == 'beep', 'yer değişen parça: diğer port kullanıldı ' + json.dumps(out, ensure_ascii=False))

    # "koyu mavi" everywhere, never plain "mavi"
    import re as _re
    body = page.inner_text('body')
    expect(not _re.search(r'(?<!koyu )(?<!açık )\bmavi\b', body.replace('koyu mavi', '').replace('açık mavi', '')), 'mavi: sayfada hep koyu mavi')

    # Examples dialog
    page.click('#ornek-btn')
    page.wait_for_timeout(200)
    expect(page.evaluate("document.activeElement.textContent") == 'Merhaba robot', 'örnekler: odak ilk örnekte')
    page.click('#ornek-liste button:has-text("İleri geri")')
    page.wait_for_timeout(200)
    expect(has('Örnek yüklendi: İleri geri. Programda 5 komut var.'), 'örnekler: yüklendi')
    page.add_script_tag(content=AXE)
    page.click('#ornek-btn')
    axe3 = page.evaluate("axe.run(document, {runOnly: ['wcag2a','wcag2aa','wcag21aa','wcag22aa','best-practice']})")
    expect(not axe3['violations'], 'axe: örnekler penceresi ' + json.dumps([(v['id'], len(v['nodes'])) for v in axe3['violations']]))
    page.keyboard.press('Escape')

    # Picker groups
    page.focus('#program-liste')
    page.keyboard.press('a')
    page.wait_for_timeout(200)
    heads = page.evaluate("[...document.querySelectorAll('#komut-alanlar h3')].map(h => h.textContent)")
    count = page.evaluate("document.querySelectorAll('#komut-alanlar .komut-secici button').length")
    expect(len(heads) == 5 and count == 21, f'seçici: 5 grup, {count} komut')
    page.screenshot(path=os.path.join(HERE, 'picker.png'), full_page=True)
    page.keyboard.press('Escape')

    # Save to file
    with page.expect_download() as dl:
        page.click('#kaydet-btn')
    expect(dl.value.suggested_filename == 'robot-programi.json', 'dosyaya kaydet')

    # Program survives a page reload
    page.reload()
    page.wait_for_timeout(500)
    expect('Tekrarla 3 kez' in page.inner_text('#program-liste'), 'editör: program kaydedildi')

    expect(not errors, 'konsol hatası yok: ' + '; '.join(errors))
    print('\n'.join(said()))
    browser.close()

print('---')
for ok, name in results:
    print(('GEÇTİ  ' if ok else 'KALDI  ') + name)
httpd.shutdown()
