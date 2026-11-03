// =============================================================
// Ters Ses - online bağlantı (2-8 kişi, oda koduyla)
// Bağlantı PeerJS ile telefonlar arasında doğrudan kurulur (kendi sunucumuz yok).
// Herkes odayı açan telefona ("ev") bağlanır. Oyunu ev yönetir (oyun.js'teki Ev):
// süreleri tutar, tahminleri kontrol eder, puanları verir ve herkese kendi ekranını yollar.
//
// Mesajlar:
//   misafir → ev: { tip: 'katil', ad, surum }  { tip: 'eylem', ad, ... }  { tip: 'nabiz' }
//   ev → misafir: { tip: 'kabul', no, surum }  { tip: 'lobi', isimler }  { tip: 'red', neden }
//                 { tip: 'durum', d }  { tip: 'ses', kim, tur, oran, veri }  { tip: 'sonuc', ... }  { tip: 'nabiz' }
// =============================================================

const AG = { mod: 'yerel', benimNo: 0 };

const Ag = (() => {
  // Online kısmı her değiştiğinde 1 artır: eski sürümle gelen oyuncu odaya alınmaz
  const SURUM = 3;
  const ODA_ONEKI = 'ters-ses-oda-';
  const KOD_HARFLERI = 'ABCDEFGHJKLMNPRSTUVYZ23456789';  // karışabilecek O/0, I/1 yok
  const KOD_UZUNLUK = 5;
  const EN_FAZLA = 8;
  const NABIZ_ARALIGI = 3000;
  const NABIZ_ZAMAN_ASIMI = 30000;
  const AD_ANAHTARI = 'tersSes.onlineAd';
  const OTOMATIK_KATIL = 'tersSes.otomatikKatil';

  const ag = {
    peer: null,
    baglanti: null,    // misafirde: eve olan bağlantı
    misafirler: [],    // evde: { baglanti, no, ad, sonMesaj }
    basladi: false,
    isimler: [],
    kod: '',
    sonMesaj: 0,
    nabiz: null,
  };

  // ---------- Gönderme ----------
  function birine(no, mesaj) {
    if (no === AG.benimNo) {
      Istemci.mesajAl(mesaj);
      return;
    }
    const m = ag.misafirler.find(x => x.no === no);
    if (m?.baglanti.open) m.baglanti.send(mesaj);
  }

  function herkese(mesaj) {
    ag.misafirler.forEach(m => {
      if (m.baglanti.open) m.baglanti.send(mesaj);
    });
    Istemci.mesajAl(mesaj);
  }

  // Oyuncunun hamlesi: misafirse eve gider, evse doğrudan uygulanır
  function eylem(ad, veri = {}) {
    if (AG.mod === 'misafir') {
      if (ag.baglanti?.open) ag.baglanti.send({ tip: 'eylem', ad, ...veri });
    } else if (AG.mod === 'ev') {
      Ev.eylem(AG.benimNo, { ad, ...veri });
    }
  }

  // Oyun sırasında üstte oda kodu görünür: biri çıkarsa aynı kodla geri girebilsin
  function odaKodunuGoster(kod) {
    $('odaBilgisi').innerHTML = `🔑 Oda: <b>${kod}</b>`;
    $('odaBilgisi').hidden = false;
  }

  function durumYaz(html) {
    $('onlineDurum').innerHTML = html;
  }

  function adiAl() {
    const kutu = $('onlineAd');
    const ad = kutu.value.trim().slice(0, 12);
    if (!ad) {
      kutu.classList.remove('eksik');
      void kutu.offsetWidth;
      kutu.classList.add('eksik');
      kutu.focus();
      durumYaz('✏️ Önce adını yaz.');
      return null;
    }
    try {
      localStorage.setItem(AD_ANAHTARI, ad);
    } catch (e) { /* hatırlanmasa da olur */ }
    return ad;
  }

  function peerVarMi() {
    if (typeof Peer !== 'undefined') return true;
    durumYaz('❌ Online bağlantı kütüphanesi yüklenemedi. İnternet bağlantını kontrol et.');
    return false;
  }

  function kilitle(evet = true) {
    ['odaAcBtn', 'katilBtn', 'odaKodu', 'onlineAd'].forEach(id => ($(id).disabled = evet));
  }

  function sunucuyaYenidenBaglan(peer) {
    peer.on('disconnected', () => {
      setTimeout(() => {
        if (peer.destroyed || !peer.disconnected) return;
        try {
          peer.reconnect();
        } catch (e) { /* bir sonraki denemede yine denenir */ }
      }, 2000);
    });
  }

  function nabziBaslat() {
    ag.sonMesaj = Date.now();
    clearInterval(ag.nabiz);
    ag.nabiz = setInterval(() => {
      if (AG.mod === 'ev') {
        ag.misafirler.forEach(m => m.baglanti.open && m.baglanti.send({ tip: 'nabiz' }));
        ag.misafirler.filter(m => Date.now() - m.sonMesaj > NABIZ_ZAMAN_ASIMI).forEach(m => {
          m.baglanti.close();
          misafirKoptu(m);
        });
      } else if (ag.baglanti) {
        if (ag.baglanti.open) ag.baglanti.send({ tip: 'nabiz' });
        if (Date.now() - ag.sonMesaj > NABIZ_ZAMAN_ASIMI) baglantiKoptu();
      }
    }, NABIZ_ARALIGI);
  }

  // ---------- Ev: oda açma ----------
  function odaAc() {
    const ad = adiAl();
    if (!ad || !peerVarMi()) return;
    Ses.motor();
    const kod = [...Array(KOD_UZUNLUK)].map(() => KOD_HARFLERI[Math.floor(Math.random() * KOD_HARFLERI.length)]).join('');
    durumYaz('⏳ Oda açılıyor...');
    try {
      ag.peer?.destroy();
    } catch (e) { /* eski deneme zaten kapanmış */ }
    ag.peer = new Peer(ODA_ONEKI + kod);
    ag.peer.on('open', () => {
      if (AG.mod === 'ev') return;
      AG.mod = 'ev';
      AG.benimNo = 0;
      ag.kod = kod;
      ag.isimler = [ad];
      odaKodunuGoster(kod);
      kilitle();
      nabziBaslat();
      $('ayarlar').hidden = false;
      lobiyiCiz();
    });
    sunucuyaYenidenBaglan(ag.peer);
    ag.peer.on('connection', baglanti => {
      const misafir = { baglanti, no: null, ad: '', sonMesaj: Date.now() };
      baglanti.on('data', m => {
        misafir.sonMesaj = Date.now();
        if (m?.tip !== 'nabiz') evMesaji(misafir, m);
      });
      baglanti.on('close', () => misafirKoptu(misafir));
      baglanti.on('error', () => misafirKoptu(misafir));
    });
    ag.peer.on('error', e => {
      if (e.type === 'unavailable-id') odaAc();
      else if (AG.mod !== 'ev') durumYaz(`❌ Oda açılamadı (${e.type}). İnternet bağlantını kontrol et.`);
    });
  }

  function lobiyiCiz() {
    const isimler = [ag.isimler[0], ...ag.misafirler.map(m => m.ad)];
    durumYaz(`Oda kodun: <b class="odaKodu">${ag.kod}</b><br>Bu kodu arkadaşlarına söyle, "Katıl" kısmına yazsınlar.`
      + lobiListesi(isimler, 0)
      + (ag.misafirler.length ? 'Herkes geldiyse ayarları seç ve "Oyunu başlat"a bas.' : '⏳ Arkadaşların bekleniyor...'));
    $('baslaBtn').hidden = false;
    $('baslaBtn').disabled = !ag.misafirler.length;
    ag.misafirler.forEach(m => m.baglanti.open && m.baglanti.send({ tip: 'lobi', isimler }));
  }

  function lobiListesi(isimler, benimNo) {
    return `<ol class="lobiListesi">${isimler.map((ad, i) => `<li><span class="nokta" style="background:${renk(i)}"></span>`
      + `${guvenli(ad)}${i === 0 ? ' <small>(oda sahibi)</small>' : ''}${i === benimNo ? ' <b>(sen)</b>' : ''}</li>`).join('')}</ol>`;
  }

  function reddet(baglanti, neden) {
    baglanti.send({ tip: 'red', neden });
    setTimeout(() => baglanti.close(), 500);
  }

  function evMesaji(misafir, m) {
    if (m?.tip === 'katil' && misafir.no === null) {
      if (m.surum !== SURUM) {
        reddet(misafir.baglanti, 'Uygulaman eski sürümde kalmış. Uygulamayı tamamen kapatıp yeniden aç (tarayıcıdaysan sayfayı yenile), sonra tekrar katıl.');
        return;
      }
      const ad = String(m.ad ?? '').trim().slice(0, 12) || 'Oyuncu';
      if (ag.basladi) {
        geriAl(misafir, ad);
        return;
      }
      if (ag.misafirler.length >= EN_FAZLA - 1) {
        reddet(misafir.baglanti, `Oda dolu (${EN_FAZLA} kişi).`);
        return;
      }
      misafir.ad = ad;
      ag.misafirler.push(misafir);
      numaralariDagit();
      lobiyiCiz();
      Ses.secim();
      return;
    }
    if (m?.tip === 'eylem' && misafir.no !== null && ag.basladi && typeof m.ad === 'string') Ev.eylem(misafir.no, m);
  }

  function numaralariDagit() {
    ag.misafirler.forEach((m, i) => {
      m.no = i + 1;
      if (m.baglanti.open) m.baglanti.send({ tip: 'kabul', no: m.no, surum: SURUM });
    });
  }

  // Oyun başladıktan sonra gelen: aynı adla kopmuş bir oyuncu varsa onun yerine geri girer
  function geriAl(misafir, ad) {
    const kucuk = s => s.trim().toLocaleLowerCase('tr');
    const no = ag.isimler.findIndex((x, i) => i > 0 && kucuk(x) === kucuk(ad));
    if (no === -1) {
      reddet(misafir.baglanti, 'Oyun başlamış. Bağlantısı kopan bir oyuncuysan oyundaki adının aynısını yazıp tekrar katıl.');
      return;
    }
    const eski = ag.misafirler.find(x => x.no === no);
    if (eski) {
      ag.misafirler.splice(ag.misafirler.indexOf(eski), 1);
      eski.baglanti.close();
    }
    misafir.no = no;
    misafir.ad = ag.isimler[no];
    ag.misafirler.push(misafir);
    misafir.baglanti.send({ tip: 'kabul', no, surum: SURUM });
    Ev.geriDondu(no);
  }

  function misafirKoptu(misafir) {
    const sira = ag.misafirler.indexOf(misafir);
    if (sira === -1) return;
    ag.misafirler.splice(sira, 1);
    if (!ag.basladi) {
      numaralariDagit();
      lobiyiCiz();
      return;
    }
    Ev.koptu(misafir.no);
  }

  function oyunuBaslatEv() {
    if (AG.mod !== 'ev' || !ag.misafirler.length || ag.basladi) return;
    ag.basladi = true;
    ag.isimler = [ag.isimler[0], ...ag.misafirler.map(m => m.ad)];
    Ev.baslat(ag.isimler, {
      liste: $('unluListesi').value,
      taklit: Number($('taklitSuresi').value),
      tahmin: Number($('tahminSuresi').value),
      tekrar: Number($('turSayisi').value),
    });
  }

  // ---------- Misafir: odaya katılma ----------
  function odayaKatil(kod = $('odaKodu').value.trim().toUpperCase()) {
    const ad = adiAl();
    if (!ad || !peerVarMi()) return;
    Ses.motor();
    if (kod.length !== KOD_UZUNLUK) {
      durumYaz(`Oda kodu ${KOD_UZUNLUK} karakter olmalı.`);
      return;
    }
    ag.kod = kod;
    durumYaz('⏳ Odaya bağlanılıyor...');
    try {
      ag.peer?.destroy();
    } catch (e) { /* eski bağlantı zaten kapanmış */ }
    const peer = new Peer();
    ag.peer = peer;
    sunucuyaYenidenBaglan(peer);
    // 15 saniyede bağlanılamazsa sonsuza kadar "bağlanılıyor" yazmasın, ne yapılacağını söylesin
    setTimeout(() => {
      if (ag.peer !== peer || ag.baglanti) return;
      durumYaz('❌ 15 saniyedir bağlanılamadı. Şunları dene:<br>'
        + '• Oda sahibi oyunu <b>açık</b> tutsun, ekranı kilitlenmesin (kodu göndermek için WhatsApp’a geçtiyse oyuna geri dönsün).<br>'
        + '• İkiniz de aynı Wi-Fi’ye bağlanın ya da ikiniz de mobil veriye geçin.<br>'
        + '• Sonra tekrar <b>Katıl</b>’a bas.');
      ['katilBtn', 'odaKodu', 'onlineAd'].forEach(id => $(id) && ($(id).disabled = false));
    }, 15000);
    peer.on('open', () => {
      if (ag.peer !== peer || ag.baglanti) return;
      const baglanti = peer.connect(ODA_ONEKI + kod, { reliable: true });
      baglanti.on('open', () => {
        ag.baglanti = baglanti;
        AG.mod = 'misafir';
        baglanti.send({ tip: 'katil', ad, surum: SURUM });
        nabziBaslat();
        try {
          sessionStorage.setItem(OTOMATIK_KATIL, JSON.stringify({ kod, ad }));
        } catch (e) { /* kopunca kodu elle yazar */ }
      });
      baglanti.on('data', m => {
        ag.sonMesaj = Date.now();
        if (m?.tip !== 'nabiz') misafirMesaji(m);
      });
      baglanti.on('close', () => ag.baglanti === baglanti && baglantiKoptu());
      baglanti.on('error', () => ag.baglanti === baglanti && baglantiKoptu());
    });
    peer.on('error', e => {
      if (ag.peer !== peer || ag.baglanti) return;
      durumYaz(e.type === 'peer-unavailable'
        ? '❌ Bu kodla açık bir oda bulunamadı. Kodu kontrol et. Oda sahibinin oyunu açık mı? (Kodu göndermek için oyundan çıktıysa telefon oyunu uyutur: oyuna geri dönsün, sonra tekrar Katıl’a bas.)'
        : `❌ Bağlanılamadı (${e.type}). İnternet bağlantını kontrol et.`);
    });
  }

  function misafirMesaji(m) {
    if (m?.tip === 'kabul' && Number.isInteger(m.no)) {
      if (m.surum !== SURUM) {
        ag.baglanti.close();
        ag.baglanti = null;
        AG.mod = 'yerel';
        durumYaz('❌ Oda sahibinin uygulaması farklı sürümde. İkiniz de uygulamayı kapatıp yeniden açın.');
        return;
      }
      AG.benimNo = m.no;
      odaKodunuGoster(ag.kod);
      kilitle();
    } else if (m?.tip === 'lobi' && Array.isArray(m.isimler)) {
      durumYaz(`✅ Odaya bağlandın! Oyunu oda sahibi başlatacak, bekle...${lobiListesi(m.isimler, AG.benimNo)}`);
    } else if (m?.tip === 'red') {
      ag.baglanti = null;
      AG.mod = 'yerel';
      kilitle(false);
      durumYaz(`❌ Odaya girilemedi: ${guvenli(m.neden ?? '')}`);
    } else {
      Istemci.mesajAl(m);
    }
  }

  // Misafirde: oda sahibiyle bağlantı koptu. "Yeniden bağlan" sayfayı yenileyip aynı odaya otomatik girer.
  function baglantiKoptu() {
    if (!ag.baglanti) return;
    ag.baglanti = null;
    if ($('oyun').hidden) {
      AG.mod = 'yerel';
      kilitle(false);
      durumYaz('📡 Oda sahibiyle bağlantı koptu. Tekrar katılmayı dene.');
      return;
    }
    $('baglantiMetni').textContent = 'Oda sahibiyle bağlantın kesildi. İnternetin geldiyse yeniden bağlanıp kaldığın yerden devam edebilirsin.';
    $('baglantiEkrani').hidden = false;
  }

  // ---------- Kurulum ----------
  try {
    $('onlineAd').value = localStorage.getItem(AD_ANAHTARI) ?? '';
  } catch (e) { /* hatırlanmadıysa boş */ }
  $('onlineAd').addEventListener('input', () => $('onlineAd').classList.remove('eksik'));
  $('odaAcBtn').addEventListener('click', odaAc);
  $('katilBtn').addEventListener('click', () => odayaKatil());
  $('odaKodu').addEventListener('keydown', e => {
    if (e.key === 'Enter') odayaKatil();
  });
  $('baslaBtn').addEventListener('click', oyunuBaslatEv);
  $('yenidenBaglanBtn').addEventListener('click', () => location.reload());
  $('surumNotu').textContent = `sürüm ${SURUM}`;

  // Bağlantı kopup sayfa yenilenince aynı odaya otomatik geri girilir
  try {
    const otomatik = JSON.parse(sessionStorage.getItem(OTOMATIK_KATIL));
    if (otomatik?.kod) {
      $('onlineAd').value = otomatik.ad;
      $('odaKodu').value = otomatik.kod;
      setTimeout(() => odayaKatil(otomatik.kod), 300);
    }
  } catch (e) { /* elle katılınır */ }

  return { eylem, birine, herkese };
})();
