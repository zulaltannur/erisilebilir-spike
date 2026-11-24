# Erişilebilir SPIKE (geçici ad)

SPIKE Essential robotik setiyle uyumlu, **ekran okuyucu öncelikli** bir web uygulaması. Görme engelli ve az gören çocukların robotu kendi başlarına bağlayıp keşfetmesi ve programlaması için geliştiriliyor.

> LEGO ve SPIKE, LEGO Group'un ticari markalarıdır. Bu proje LEGO Group ile bağlantılı değildir.

## Bu sürümde neler var (ilk dilim)

- **Bağlan:** Web Bluetooth ile Hub'a bağlanır. Hub'ın adını, pil durumunu ve portlara takılı parçaları tek cümlede bildirir.
- **Keşfet listesi:** Hub'ı, Port A'yı ve Port B'yi canlı gösterir. Bir parça takılınca ya da çıkarılınca, motor elle çevrilince veya renk sensörü yeni bir renk görünce ekran okuyucuya bildirir.
- **Program editörü:** Klavyeyle kurulan komut listesi. Komut eklerken bütün komutlar gruplar halinde düğme olarak listelenir:
  - Motor: döndür (tur, derece, saniye), bir konuma getir, sürekli döndür, durdur, hız
  - Işık: matriste desen, tek kare, matrisi kapat, Hub ışığı
  - Ses: bilgisayardan ses (bip, zil, davul, alkış, siren ve diğerleri), nota çal, bilgisayar konuşsun
  - Bekleme: süre kadar bekle, renk görene kadar bekle
  - Akış: tekrarla (belli sayıda ya da sonsuza kadar), eğer / değilse, aynı anda yap, programı bitir

  Program tarayıcıda kaydedilir, dosyaya kaydedilip dosyadan açılabilir. Hazır örnek programlar var. Essential Hub'ında adım adım çalışır; her adım, her tekrar turu ve her koşulun sonucu duyurulur.
- **Motor denemesi:** Seçilen porttaki motoru bir tur döndürür. Programın her adımı çalışırken bildirilir.
- **Olay geçmişi:** Bütün bildirimlerin yazılı listesi. Braille ekran kullanıcıları için de uygundur.
- **Uyarı sesleri:** Bağlanma, program bitti ve hata için kısa sesler. Ayarlardan kapatılabilir.

## Kısayollar

Kısayollar her dilde aynıdır.

| Tuş | Görev |
|---|---|
| Ctrl + Enter | Programı çalıştır |
| Escape | Robotu hemen durdur |
| ? | Kısayol listesini aç |
| Ok tuşları, Home, End | Keşfet listesinde gezin |
| Enter | Seçili satırı yeniden oku |
| A (Add) | Komut ekle (Program listesindeyken) |
| Enter | Program listesinde seçili komutu düzenle |
| Delete | Komutu sil |
| Alt + Yukarı / Aşağı ok | Komutu taşı |
| Ctrl + Z / Ctrl + Y | Geri al / yinele |
| Ctrl + C / Ctrl + V | Komutu kopyala / yapıştır |
| P (Program) | Programı baştan oku |
| R (Run) | Programı çalıştır |
| H (Hub) | Hub durumunu oku (Keşfet listesindeyken) |
| W (Where am I) | Neredeyim (Keşfet listesindeyken) |

## Gerçek setle test

1. Bilgisayarda Google Chrome ya da Microsoft Edge ile uygulamayı açın.
2. Hub'ı ortadaki düğmeye basarak açın.
3. **Bağlan** düğmesine basın ve açılan listeden Hub'ı seçin.
4. Port A'ya bir motor, Port B'ye renk sensörü takıp çıkarın. Motoru elle çevirin, sensöre farklı renkte parçalar tutun.
5. **Motoru bir tur döndür** düğmesine ya da Ctrl + Enter'a basın.

Not: Motor denemesi Hub'daki **0 numaralı program yuvasının** üzerine yazar.

## Geliştirici testleri

```
npm install
npm test                                   # protokol testleri
CHROME_PATH=/yol/chrome python3 test/e2e.py # sahte Hub ile uçtan uca test ve erişilebilirlik taraması
```

Uçtan uca test, iki protokolü de konuşabilen sahte bir Hub (`test/fake_hub.js`) kullanır ve sayfayı axe-core ile WCAG 2.2 AA kurallarına göre tarar.

## Mimari

- `js/lwp.js`: SPIKE Essential'ın küçük Hub'ının konuştuğu LEGO Wireless Protocol 3 ([belgeler](https://lego.github.io/lego-ble-wireless-protocol-docs/)). Komutlar Hub'a canlı gönderilir.
- `js/cobs.js`, `js/crc.js`, `js/protocol.js`: SPIKE Prime Hub'ının SPIKE App 3 protokolü ([belgeler](https://lego.github.io/spike-prime-docs)). Programlar Hub'a yüklenir.
- `js/hub.js`: Bağlantı, istek-yanıt sırası, program yükleme.
- `js/announcer.js`: Ekran okuyucu bildirimleri ve olay geçmişi.
- `js/texts.js`: Arayüzdeki bütün Türkçe metinler. Çeviri için tek dosya.
- `js/programs.js`: Hub'da çalışan Python programları. Her adım `@ADIM n` satırı yazar, uygulama bunu sesli bildirime çevirir.
- `js/app.js`: Arayüz ve klavye kısayolları.
