// All user-facing Turkish texts live here so the app can be translated later.
// Keyboard shortcuts are NOT translated: they are the same in every language.

export const COLORS = {
  0: 'siyah',
  1: 'pembe',
  2: 'mor',
  3: 'mavi',
  4: 'açık mavi',
  5: 'turkuaz',
  6: 'yeşil',
  7: 'sarı',
  8: 'turuncu',
  9: 'kırmızı',
  10: 'beyaz',
};

export const colorName = (c) => (c in COLORS ? COLORS[c] : 'renk yok');

export const PORT_NAMES = ['A', 'B', 'C', 'D', 'E', 'F'];

// Turkish suffixes follow how the letter is read aloud: "a" vs "be, ce, de...".
const back = (p) => p === 'A';
const da = (p) => `${p}'${back(p) ? 'da' : 'de'}`; // Port A'da, Port B'de
const ya = (p) => `${p}'${back(p) ? 'ya' : 'ye'}`; // Port A'ya, Port B'ye

export const DEVICE_NAMES = {
  motor: 'motor',
  color: 'renk sensörü',
  matrix3x3: 'ışık matrisi',
  force: 'kuvvet sensörü',
  distance: 'mesafe sensörü',
};

export const T = {
  notSupported:
    'Bu tarayıcı Bluetooth bağlantısını desteklemiyor. Lütfen bilgisayarda Google Chrome ya da Microsoft Edge kullanın. iPhone ve iPad şu an desteklenmiyor.',
  connectHelp:
    'Hub\'ın üzerinde tek bir düğme var. Hub\'ı açmak için bu düğmeye bir kez basın. Sonra bu sayfadaki Bağlan düğmesine basın. Chrome bir liste açar. Bu listede sadece LEGO Hub\'ları görünür; ekran okuyucu adını okumasa bile listedeki satır Hub\'dır. Aşağı ok tuşuyla satırı seçin, Tab tuşuyla Eşle düğmesine gidin ve Enter\'a basın.',
  connecting:
    'Chrome bir liste açıyor. Bu listede sadece LEGO Hub\'ları görünür. Ekran okuyucu Hub\'ın adını okumayabilir. Aşağı ok tuşuyla ilk satırı seçin, sonra Tab tuşuyla Eşle düğmesine gidip Enter\'a basın.',
  connected: (name, battery, ports) =>
    `Hub bağlandı: ${name || 'isimsiz Hub'}.${battery != null ? ` Pil yüzde ${battery}.` : ''}${ports ? ` ${ports}.` : ''}`,
  connectingKnown: (name) =>
    `Daha önce eşlenen Hub aranıyor${name ? `: ${name}` : ''}. Hub açık değilse üzerindeki düğmeye basın.`,
  knownNotNearby:
    'Kayıtlı Hub bulunamadı. Hub\'ın üzerindeki düğmeye basıp açın ve tekrar Bağlan\'a basın. Başka bir Hub kullanacaksanız Yeni Hub eşle düğmesine basın.',
  connectCancelled:
    'Hub seçilmedi. Listede Hub görünmediyse: Hub\'ın açık olduğundan emin olun ve LEGO uygulaması açıksa kapatın, çünkü Hub aynı anda tek bir uygulamaya bağlanabilir. Sonra tekrar Bağlan düğmesine basın. Yine görünmezse Ayarlar bölümündeki Sorun giderme düğmesini deneyin.',
  pairHelp:
    'Chrome\'un açtığı pencerede Eşle düğmesi, listeden bir cihaz seçilene kadar pasif kalır. Liste boşsa Chrome Hub\'ı göremiyor demektir.',
  diagnoseResult: (r) =>
    r.error
      ? `Sorun giderme: ${r.name || 'isimsiz cihaz'} seçildi ama bağlanılamadı. ${r.error}`
      : `Sorun giderme: ${r.name || 'isimsiz cihaz'}. Yeni protokol: ${r.app3 ? 'var' : 'yok'}. Eski protokol: ${r.lwp ? 'var' : 'yok'}.`,
  bluetoothOff:
    'Bilgisayarın Bluetooth\'u kapalı görünüyor. Windows ayarlarından Bluetooth\'u açıp tekrar deneyin.',
  oldFirmware:
    'Hub bulundu ama yazılımı eski. Hub\'ı kabloyla bilgisayara takıp spike.legoeducation.com adresindeki güncelleme aracıyla güncelleyin, sonra tekrar deneyin.',
  connectFailed: (msg) => `Bağlanamadı. ${msg} Hub'ın açık olduğundan emin olup tekrar deneyin.`,
  disconnected: 'Hub bağlantısı koptu.',
  notConnected: 'Önce Hub\'a bağlanın.',
  batteryLow: (n) => `Dikkat: Hub pili azaldı, yüzde ${n}.`,

  portEmpty: (p) => `Port ${p}: boş`,
  attached: (p, dev) => `Port ${ya(p)} ${dev} takıldı.`,
  detached: (p) => `Port ${p} boşaldı.`,
  motorValue: (p, deg) => `Port ${p}: motor, ${deg} derece`,
  motorStopped: (p, deg) => `Motor ${p} durdu, ${deg} derece.`,
  colorValue: (p, c) => `Port ${p}: renk sensörü, ${c}`,
  colorSeen: (c) => `Renk: ${c}.`,
  matrixValue: (p, lit, colors) =>
    lit === 0
      ? `Port ${p}: ışık matrisi, tüm kareler kapalı`
      : `Port ${p}: ışık matrisi, ${lit} kare açık: ${colors}`,
  otherValue: (p, dev) => `Port ${p}: ${dev}`,
  hubOption: (name, battery) =>
    `Hub: ${name || 'isimsiz'}${battery != null ? `, pil yüzde ${battery}` : ''}`,
  hubNotConnectedOption: 'Hub: bağlı değil',

  programStarting: 'Program Hub\'a gönderiliyor.',
  programStarted: 'Program başladı.',
  programStep: (n, text) => `Adım ${n}: ${text}`,
  programDone: 'Program bitti.',
  programStopped: 'Program durduruldu.',
  programError: 'Programda bir hata oluştu. Ayrıntılar olay geçmişinde.',
  programUploadFailed: (msg) => `Program gönderilemedi. ${msg}`,
  noMotorAt: (p, other) =>
    other ? `Port ${da(p)} motor yok. Motor Port ${da(other)}.` : `Port ${da(p)} motor yok. Önce bir motor takın.`,
  motorTurnStep: (p) => `Motor ${p} bir tur dönüyor`,
  nothingRunning: 'Şu an çalışan bir program yok.',

  whereAmI: (section, connected) =>
    `${section} bölümündesiniz. Hub ${connected ? 'bağlı' : 'bağlı değil'}.`,
  sectionUnknown: 'Sayfa',
};
