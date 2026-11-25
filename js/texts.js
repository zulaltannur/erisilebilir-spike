// All user-facing Turkish texts live here so the app can be translated later.
// Keyboard shortcuts are NOT translated: they are the same in every language.

export const COLORS = {
  0: 'siyah',
  1: 'pembe',
  2: 'mor',
  3: 'koyu mavi',
  4: 'açık mavi',
  5: 'turkuaz',
  6: 'yeşil',
  7: 'sarı',
  8: 'turuncu',
  9: 'kırmızı',
  10: 'beyaz',
};

export const colorName = (c) => (c in COLORS ? COLORS[c] : 'renk yok');
export const isRealColor = (c) => c in COLORS;

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
    'Hub\'ın üzerinde tek bir düğme var. Hub\'ı açmak için bu düğmeyi birkaç saniye basılı tutun. Sonra Bağlan düğmesine basın. Chrome bir eşleme penceresi açar; ekran okuyucu bu penceredeki listeyi okumayabilir, bu yüzden size sesle yol gösteririz. Önce birkaç tık sesi duyacaksınız. Ardından zil sesi gelince Aşağı ok tuşuna, sonra Enter tuşuna basın. Bağlantı kurulunca Hub bağlandı diye okunur. Bu işlem sadece ilk seferde gerekir.',
  connecting: 'Eşleme penceresi açılıyor. Zil sesini bekleyin; sonra Aşağı ok ve Enter.',
  connected: (name, battery, ports) =>
    `Hub bağlandı: ${name || 'isimsiz Hub'}.${battery != null ? ` Pil yüzde ${battery}.` : ''}${ports ? ` ${ports}.` : ''}`,
  connectingKnown: (name) =>
    `Daha önce eşlenen Hub aranıyor${name ? `: ${name}` : ''}. Hub açık değilse üzerindeki düğmeyi basılı tutun.`,
  knownNotNearby:
    'Kayıtlı Hub bulunamadı. Hub\'ın üzerindeki düğmeyi basılı tutup açın ve tekrar Bağlan\'a basın. Başka bir Hub kullanacaksanız Yeni Hub eşle düğmesine basın.',
  connectCancelled:
    'Hub seçilmedi. Listede Hub görünmediyse: Hub\'ın açık olduğundan emin olun ve LEGO uygulaması açıksa kapatın, çünkü Hub aynı anda tek bir uygulamaya bağlanabilir. Sonra tekrar Bağlan düğmesine basın. Yine görünmezse Ayarlar bölümündeki Sorun giderme düğmesini deneyin.',
  pairHelp: 'Pencere açılıyor. Zil sesinden sonra Aşağı ok tuşuyla cihazları gezin ve Enter ile seçin.',
  diagnoseResult: (r) =>
    r.error
      ? `Sorun giderme: ${r.name || 'isimsiz cihaz'} seçildi ama bağlanılamadı. ${r.error}`
      : `Sorun giderme: ${r.name || 'isimsiz cihaz'}. Yeni protokol: ${r.app3 ? 'var' : 'yok'}. Eski protokol: ${r.lwp ? 'var' : 'yok'}.`,
  bluetoothOff:
    'Bilgisayarın Bluetooth\'u kapalı görünüyor. Windows ayarlarından Bluetooth\'u açıp tekrar deneyin.',
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
  nothingRunning: 'Şu an çalışan bir program yok, motorlar da duruyor.',
  motorsStopped: 'Motorlar durduruldu.',
  ifOnceTip:
    'İpucu: Eğer bloğu sadece bir kez, program başlar başlamaz kontrol edildi. Sensörün sürekli izlenmesi için Eğer bloğunu Sonsuza kadar tekrarla bloğunun içine koyun. Örnek programlardaki Renk dedektörü buna bir örnek.',
  newVersion:
    'Uygulamanın yeni bir sürümü yayımlandı. Hazır olduğunuzda Ctrl, Shift ve R tuşlarıyla sayfayı yenileyin; Hub bağlantısını sonra yeniden kurun.',
  programDoneSpinning: (ports) =>
    `Program bitti. Motor ${ports} hâlâ dönüyor. Durdurmak için Escape tuşuna ya da Durdur düğmesine basın.`,
  programEmpty: 'Program boş. Önce A tuşuyla ya da Komut ekle düğmesiyle komut ekleyin.',
  programNeedsEssential: 'Program şimdilik sadece SPIKE Essential Hub\'ında çalışıyor.',
  programRound: (r, t) => (t ? `Tekrar: ${r}. tur, ${t} turdan.` : `Sonsuz tekrar: ${r}. tur.`),
  programRunError: (m) => `Program durdu. ${m}`,

  whereAmI: (section, connected) =>
    `${section} bölümündesiniz. Hub ${connected ? 'bağlı' : 'bağlı değil'}.`,
  sectionUnknown: 'Sayfa',
};
