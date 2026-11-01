// =============================================================
// Ters Ses - ses kaydı, düz/ters çalma ve oyun efektleri
// Kayıtlar ham sayılar olarak tutulur (16 kHz, tek kanal, 16 bit): böylece Android ve iPhone
// arasında "bu ses biçimini açamıyorum" sorunu olmaz, tersine çevirmek de diziyi ters dizmek kadar kolay.
// =============================================================

const Ses = (() => {
  const ANAHTAR = 'tersSes.ses';
  const ORAN = 16000;
  let ctx = null, ana = null, acik = true;
  let calan = null;  // şu an çalan kayıt (yenisi başlayınca eskisi susar)

  try {
    acik = localStorage.getItem(ANAHTAR) !== 'kapali';
  } catch (e) { /* hatırlanamazsa açık başlar */ }

  function motor() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      ana = ctx.createGain();
      ana.gain.value = acik ? 1 : 0;
      ana.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // ---------- 🎙️ Kayıt: başlat, istediğin an durdur (en fazla "enFazla" saniye) ----------
  // Telefonda mikrofonun açılması yarım saniye kadar sürer; o arada söylenen ilk hece kayboluyordu.
  // Bu yüzden kayıt, mikrofondan gerçekten ses gelmeye başladığı an başlar: o an "hazir" çağrılır,
  // ekranda "KONUŞ!" yazar ve kısa bir bip çalar.
  async function kayitBaslat(enFazla = 4, { hazir } = {}) {
    const c = motor();
    const akis = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const kaynak = c.createMediaStreamSource(akis);
    const isleyici = c.createScriptProcessor(2048, 1, 1);
    const parcalar = [];
    let basladi = false, bitti = false, cozucu, zamanlayici;
    let atlanacak = 3;  // bip sesinin kendisi kayda girmesin diye ilk ~0,13 saniye atlanır
    const sonuc = new Promise(coz => (cozucu = coz));

    function durdur() {
      if (bitti) return sonuc;
      bitti = true;
      clearTimeout(zamanlayici);
      isleyici.disconnect();
      kaynak.disconnect();
      sessiz.disconnect();
      akis.getTracks().forEach(t => t.stop());
      cozucu(hamdanKayda(parcalar, c.sampleRate));
      return sonuc;
    }

    function basla() {
      if (basladi || bitti) return;
      basladi = true;
      efektler.kayit();
      zamanlayici = setTimeout(durdur, enFazla * 1000);
      if (hazir) hazir();
    }

    isleyici.onaudioprocess = e => {
      if (bitti) return;
      const veri = e.inputBuffer.getChannelData(0);
      if (!basladi) {
        // Mikrofon açıldı mı? (açılırken ilk parçalar tamamen sessiz gelir)
        if (veri.some(x => x !== 0)) basla();
        return;
      }
      if (atlanacak > 0) {
        atlanacak--;
        return;
      }
      parcalar.push(new Float32Array(veri));
    };
    const sessiz = c.createGain();  // kayıt sırasında hoparlörden geri çalmasın
    sessiz.gain.value = 0;
    kaynak.connect(isleyici);
    isleyici.connect(sessiz);
    sessiz.connect(c.destination);
    setTimeout(basla, 1500);  // bazı telefonlarda ilk parçalar hiç sıfır olmayabilir: en geç 1,5 sn sonra başla
    return { durdur, sonuc };
  }

  // Parçaları birleştir, 16 kHz'e indir, baştaki/sondaki sessizliği kes ve sesi yükselt
  function hamdanKayda(parcalar, kaynakOrani) {
    const toplam = parcalar.reduce((a, p) => a + p.length, 0);
    const ham = new Float32Array(toplam);
    let yer = 0;
    parcalar.forEach(p => {
      ham.set(p, yer);
      yer += p.length;
    });
    const adim = kaynakOrani / ORAN;
    const n = Math.floor(toplam / adim);
    const ornek = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * adim), b = Math.max(a + 1, Math.floor((i + 1) * adim));
      let s = 0;
      for (let j = a; j < b; j++) s += ham[j];
      ornek[i] = s / (b - a);
    }
    let tepe = 0.0001;
    for (const x of ornek) tepe = Math.max(tepe, Math.abs(x));
    // Sessizlik kesme: tepenin %3'ünden kısık baş ve son kısım atılır. Pay geniş tutulur ki
    // "s", "h", "f" gibi yumuşak başlayan sesler kesilmesin.
    const esik = tepe * 0.03, pay = ORAN * 0.2;
    let bas = 0, son = n - 1;
    while (bas < n && Math.abs(ornek[bas]) < esik) bas++;
    while (son > bas && Math.abs(ornek[son]) < esik) son--;
    bas = Math.max(0, bas - pay);
    son = Math.min(n - 1, son + pay);
    const kazanc = Math.min(10, 0.95 / tepe);
    const veri = new Int16Array(Math.max(1, son - bas + 1));
    for (let i = 0; i < veri.length; i++) veri[i] = Math.max(-1, Math.min(1, ornek[bas + i] * kazanc)) * 32767;
    return { oran: ORAN, veri };
  }

  const tersCevir = kayit => ({ oran: kayit.oran, veri: Int16Array.from(kayit.veri).reverse() });

  // ---------- ▶️ Çalma ----------
  // Döndürdüğü söz, kayıt bitince (ya da başka bir kayıt başlayınca) tamamlanır
  function cal(kayit, ters = false) {
    durdur();
    if (!kayit?.veri?.length) return Promise.resolve();
    const c = motor();
    const k = ters ? tersCevir(kayit) : kayit;
    const tampon = c.createBuffer(1, k.veri.length, k.oran);
    const kanal = tampon.getChannelData(0);
    for (let i = 0; i < k.veri.length; i++) kanal[i] = k.veri[i] / 32768;
    const kaynak = c.createBufferSource();
    kaynak.buffer = tampon;
    kaynak.connect(ana);
    kaynak.start(c.currentTime + 0.05);  // ses motoru yeni uyandıysa ilk an yutulmasın
    calan = kaynak;
    return new Promise(coz => {
      kaynak.onended = () => {
        if (calan === kaynak) calan = null;
        coz();
      };
    });
  }

  function durdur() {
    if (!calan) return;
    try {
      calan.stop();
    } catch (e) { /* zaten bitmiş */ }
    calan = null;
  }

  // ---------- Efektler ----------
  function ton(frekans, { gecikme = 0, sure = 0.15, tip = 'sine', seviye = 0.15, bitis } = {}) {
    const c = motor();
    const t = c.currentTime + gecikme;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = tip;
    o.frequency.setValueAtTime(frekans, t);
    if (bitis) o.frequency.exponentialRampToValueAtTime(bitis, t + sure);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(seviye, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + sure);
    o.connect(g);
    g.connect(ana);
    o.start(t);
    o.stop(t + sure + 0.05);
  }

  const efektler = {
    tik: () => ton(1200, { sure: 0.05, seviye: 0.08, tip: 'square' }),
    secim: () => ton(660, { sure: 0.08, seviye: 0.1, tip: 'triangle' }),
    kayit: () => ton(880, { sure: 0.12, seviye: 0.12, tip: 'sine' }),
    dur: () => ton(440, { sure: 0.12, seviye: 0.12, tip: 'sine' }),
    asama: () => [523.3, 659.3, 784].forEach((f, k) => ton(f, { gecikme: k * 0.08, sure: 0.25, seviye: 0.1, tip: 'triangle' })),
    dogru: () => [784, 988, 1318.5].forEach((f, k) => ton(f, { gecikme: k * 0.07, sure: 0.3, seviye: 0.12, tip: 'triangle' })),
    yanlis: () => ton(220, { sure: 0.25, seviye: 0.12, tip: 'sawtooth', bitis: 150 }),
    bildi: () => ton(1046.5, { sure: 0.15, seviye: 0.08, tip: 'triangle' }),
    sure: () => ton(1500, { sure: 0.04, seviye: 0.06, tip: 'square' }),
    kazanma: () => [523.3, 659.3, 784, 1046.5, 1318.5].forEach((f, k) => ton(f, { gecikme: k * 0.12, sure: 0.5, seviye: 0.12, tip: 'triangle' })),
  };

  function acKapa() {
    acik = !acik;
    try {
      localStorage.setItem(ANAHTAR, acik ? 'acik' : 'kapali');
    } catch (e) { /* hatırlanmasa da olur */ }
    if (ana) ana.gain.setTargetAtTime(acik ? 1 : 0, ctx.currentTime, 0.05);
    return acik;
  }

  return {
    ORAN, motor, kayitBaslat, cal, durdur, tersCevir, acKapa, ...efektler,
    get acik() { return acik; },
  };
})();
