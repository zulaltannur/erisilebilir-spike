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
    page.wait_for_timeout(2200)
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
    expect(page.evaluate("document.querySelectorAll('#komut-alanlar .komut-secici button').length") == 19, 'editör: 19 komut listelendi')
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
    expect('Eğer renk sensörü B kırmızı görüyorsa: evet.' in out and page.evaluate('window.__lastSound') == 'beep', 'eğer: evet dalı')
    page.evaluate('window.__fake.color = 3')
    page.wait_for_timeout(700)
    out = run_program([{'type': 'ifStart', 'condition': 'colorIs', 'port': 1, 'color': 9}, {'type': 'sound', 'sound': 'beep'},
                       {'type': 'else'}, {'type': 'sound', 'sound': 'drop'}, {'type': 'ifEnd'}], 1000)
    expect('Eğer renk sensörü B kırmızı görüyorsa: hayır.' in out and page.evaluate('window.__lastSound') == 'drop', 'eğer: değilse dalı')

    out = run_program([{'type': 'repeatStart', 'forever': 'yes', 'times': 3}, {'type': 'wait', 'seconds': 0.3}, {'type': 'repeatEnd'}], 1100)
    page.keyboard.press('Escape')
    page.wait_for_timeout(300)
    out = said()[-12:]
    expect(any('Sonsuz tekrar: 3. tur.' in x for x in said()) and 'Program durduruldu.' in out, 'sonsuz tekrar ve Escape')

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

    out = run_program([{'type': 'speak', 'text': 'Merhaba'}], 2500)
    expect(page.evaluate('window.__lastSound') == 'speak:Merhaba' and 'Program bitti.' in out, 'bilgisayar konuştu')

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
    expect(len(heads) == 5 and count == 19, f'seçici: 5 grup, {count} komut')
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
