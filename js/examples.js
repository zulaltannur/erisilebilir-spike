// Ready-made example programs, written for this app (not copied from LEGO lessons).
// Each one shows a different idea. Ports: motor on A, color sensor or light matrix on B.

export const EXAMPLES = [
  {
    name: 'Merhaba robot',
    about: 'Işık matrisinde gülen yüz, bir zil sesi ve motorun bir turu. Port A: motor, Port B: ışık matrisi.',
    program: [
      { type: 'lightOn', port: 1, pattern: 'smile', color: 7 },
      { type: 'sound', sound: 'bell' },
      { type: 'motorRun', port: 0, amount: 1, unit: 'rotations', direction: 'cw' },
      { type: 'speak', text: 'Merhaba, ben bir robotum' },
    ],
  },
  {
    name: 'İleri geri',
    about: 'Motor bir tur ileri, bir tur geri döner; bunu üç kez yapar. Port A: motor.',
    program: [
      { type: 'repeatStart', mode: 'times', times: 3 },
      { type: 'motorRun', port: 0, amount: 1, unit: 'rotations', direction: 'cw' },
      { type: 'sound', sound: 'beep' },
      { type: 'motorRun', port: 0, amount: 1, unit: 'rotations', direction: 'ccw' },
      { type: 'repeatEnd' },
    ],
  },
  {
    name: 'Renk dedektörü',
    about: 'Sensör kırmızı görürse siren çalar, görmezse kısa bir bip. Durdurmak için Escape. Port B: renk sensörü.',
    program: [
      { type: 'repeatStart', mode: 'forever', times: 3 },
      { type: 'ifStart', condition: 'colorIs', port: 1, color: 9 },
      { type: 'sound', sound: 'siren' },
      { type: 'else' },
      { type: 'sound', sound: 'drop' },
      { type: 'ifEnd' },
      { type: 'wait', seconds: 0.5 },
      { type: 'repeatEnd' },
    ],
  },
  {
    name: 'Renk aynası',
    about: 'Renk sensörü hangi rengi görürse ışık matrisi o renkte yanar; durdurmak için Escape. Renk sensörü bir porta, ışık matrisi diğer porta.',
    program: [
      { type: 'repeatStart', mode: 'forever', times: 3 },
      { type: 'lightOn', port: 1, pattern: 'all', color: 'sensor' },
      { type: 'wait', seconds: 0.2 },
      { type: 'repeatEnd' },
    ],
  },
  {
    name: 'Işık ve müzik birlikte',
    about: 'Aynı anda yap bloğu: motor dönerken notalar çalar. Port A: motor.',
    program: [
      { type: 'parallelStart' },
      { type: 'motorRun', port: 0, amount: 2, unit: 'rotations', direction: 'cw' },
      { type: 'note', note: 'C', seconds: 0.4 },
      { type: 'parallelEnd' },
      { type: 'note', note: 'E', seconds: 0.4 },
      { type: 'note', note: 'G', seconds: 0.4 },
      { type: 'note', note: 'C2', seconds: 0.8 },
    ],
  },
  {
    name: 'Trafik ışığı',
    about: 'Işık matrisi kırmızı, sarı, yeşil yanar; her renkte bilgisayar rengi söyler. Port B: ışık matrisi.',
    program: [
      { type: 'lightOn', port: 1, pattern: 'all', color: 9 },
      { type: 'speak', text: 'Kırmızı, dur' },
      { type: 'wait', seconds: 2 },
      { type: 'lightOn', port: 1, pattern: 'all', color: 7 },
      { type: 'speak', text: 'Sarı, hazırlan' },
      { type: 'wait', seconds: 1 },
      { type: 'lightOn', port: 1, pattern: 'all', color: 6 },
      { type: 'speak', text: 'Yeşil, geç' },
      { type: 'wait', seconds: 2 },
      { type: 'lightOff', port: 1 },
    ],
  },
];
