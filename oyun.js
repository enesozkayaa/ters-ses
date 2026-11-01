// =============================================================
// Ters Ses - oyun akışı ve ekranlar
// Bir tur:
//   1) ebe:     ebeye bir Türk ünlü çıkar; ismi kaydeder, düz ve tersten dinler, onaylar
//   2) taklit:  diğerleri sadece tersten hâlini dinler, duyduğunu aynen taklit edip kaydeder;
//               kendi taklidini tersten dinleyince ünlünün adına benzer bir şey duyar (ya da duymaz 😄)
//   3) tahmin:  herkes ünlüyü tahmin edip yazar; ne kadar hızlı bilirse o kadar çok puan
//   4) gösteri: doğru cevap, ebenin kaydı ve herkesin taklidinin tersten hâli sırayla çalınır
//   5) skor:    puan tablosu; oda sahibi sonraki tura geçer
//
// Ev (odayı açan telefon) oyunu yönetir; İstemci her telefonda (ev dahil) ekranı çizer.
// =============================================================

const RENKLER = ['#ff4d6d', '#4dabff', '#3ddc84', '#ffd23f', '#b07cff', '#ff8c42', '#2ee6d6', '#ff7ad9'];
const renk = i => RENKLER[i % RENKLER.length];
const EBE_SURESI = 90;          // ebenin kaydedip onaylaması için saniye
const EBE_KAYIT_SINIRI = 4;     // ünlünün adını söylemek için en fazla saniye
const TAKLIT_KAYIT_SINIRI = 5;  // taklit kaydı en fazla saniye
const EN_AZ_PUAN = 100, EN_COK_PUAN = 500, EBE_PUANI = 150;

const $ = id => document.getElementById(id);
const guvenli = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const adEtiketi = (ad, i) => `<span style="color:${renk(i)}">${guvenli(ad)}</span>`;

// Türkçe iyelik eki: "Ali'nin", "Enes'in", "Ayşe'nin"
function ekNin(ad) {
  const unluler = ad.toLocaleLowerCase('tr').match(/[aeıioöuü]/g) || ['e'];
  const u = { a: 'ı', ı: 'ı', o: 'u', u: 'u', e: 'i', i: 'i', ö: 'ü', ü: 'ü' }[unluler[unluler.length - 1]];
  return `'${/[aeıioöuü]$/i.test(ad) ? 'n' : ''}${u}n`;
}

// ---------- Tahmin kontrolü ----------
// Büyük/küçük harf, Türkçe karakter, boşluk ve noktalama önemsenmez; küçük yazım hataları kabul edilir.
function sadelestir(metin) {
  return String(metin).toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]/g, h => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' })[h])
    .replace(/[^a-z0-9]/g, '');
}

function mesafe(a, b) {  // iki kelime arasında kaç harf farkı var (Levenshtein)
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

// Soyadı listede başka kimsede yoksa tek başına soyadı da kabul edilir
const SOYAD_SAYISI = {};
[...UNLULER, ...UNLULER_YABANCI].forEach(([ad]) => {
  const parca = ad.split(' ');
  if (parca.length > 1) {
    const s = sadelestir(parca[parca.length - 1]);
    SOYAD_SAYISI[s] = (SOYAD_SAYISI[s] || 0) + 1;
  }
});

function dogruMu(metin, unlu) {
  const t = sadelestir(metin);
  if (t.length < 2) return false;
  const adaylar = [unlu.ad, ...(unlu.kabul || [])].map(sadelestir);
  const parca = unlu.ad.split(' ');
  if (parca.length > 1) {
    const soyad = sadelestir(parca[parca.length - 1]);
    // Ebenin kendi yazdığı ünlüde soyadı her zaman kabul; listedekilerde soyadı tek kişiye aitse
    if (soyad.length >= 4 && (unlu.ozel || SOYAD_SAYISI[soyad] === 1)) adaylar.push(soyad);
  }
  return adaylar.some(a => {
    const tolerans = a.length <= 4 ? 0 : a.length <= 9 ? 1 : 2;
    return mesafe(t, a) <= tolerans;
  });
}

// Online'da gelen kayıt: ham sayılar ArrayBuffer olarak gelir (çok uzunsa kabul edilmez)
function kayitCoz(k) {
  if (!k || !(k.veri instanceof ArrayBuffer || ArrayBuffer.isView(k.veri))) return null;
  const veri = new Int16Array(k.veri instanceof ArrayBuffer ? k.veri : k.veri.buffer.slice(k.veri.byteOffset, k.veri.byteOffset + k.veri.byteLength));
  const oran = Number(k.oran);
  if (!veri.length || veri.length > 16000 * 8 || !(oran >= 8000 && oran <= 48000)) return null;
  return { oran, veri };
}
const kayitPaketi = k => ({ oran: k.oran, veri: k.veri.buffer.slice(k.veri.byteOffset, k.veri.byteOffset + k.veri.byteLength) });

// =============================================================
// Ev: oyunu yöneten taraf (sadece odayı açan telefonda çalışır)
// =============================================================
const Ev = (() => {
  const ev = {
    ayar: { taklit: 30, tahmin: 45, tekrar: 1 },
    oyuncular: [],     // { ad, puan, koptu, turPuani }
    tur: 0,
    toplamTur: 0,
    asama: 'lobi',     // ebe | taklit | tahmin | gosteri | skor | bitti
    ebe: 0,
    unlu: null,
    degisti: false,
    bitis: 0,
    ebeKayit: null,
    taklitler: {},     // oyuncu no → kayıt
    tahminler: {},     // oyuncu no → { dogru, puan, sira, deneme, sure }
    kullanilan: new Set(),
    zamanlayici: null,
    atlandi: '',
  };

  function baslat(isimler, ayar) {
    ev.ayar = ayar;
    ev.oyuncular = isimler.map(ad => ({ ad, puan: 0, koptu: false, turPuani: 0 }));
    ev.toplamTur = isimler.length * ayar.tekrar;
    ev.tur = 0;
    turBaslat();
  }

  // Ayara göre sadece Türk ya da Türk + yabancı ünlülerden, bu oyunda henüz çıkmamış biri
  function yeniUnlu() {
    const havuz = ev.ayar.liste === 'karisik' ? [...UNLULER, ...UNLULER_YABANCI] : UNLULER;
    let adaylar = havuz.filter(u => !ev.kullanilan.has(u[0]));
    if (!adaylar.length) {
      ev.kullanilan.clear();
      adaylar = havuz;
    }
    const [ad, kategori, kabul] = adaylar[Math.floor(Math.random() * adaylar.length)];
    ev.kullanilan.add(ad);
    return { ad, kategori, kabul };
  }

  function zamanla(ms, fn) {
    clearTimeout(ev.zamanlayici);
    ev.zamanlayici = setTimeout(fn, ms);
  }

  const tahminEdenler = () => ev.oyuncular.map((o, i) => i).filter(i => i !== ev.ebe && !ev.oyuncular[i].koptu);

  function turBaslat() {
    ev.tur++;
    if (ev.tur > ev.toplamTur) {
      bitir();
      return;
    }
    // Ebe sırayla değişir; bağlantısı kopan atlanır
    const n = ev.oyuncular.length;
    let ebe = (ev.tur - 1) % n;
    for (let k = 0; k < n && ev.oyuncular[ebe].koptu; k++) ebe = (ebe + 1) % n;
    Object.assign(ev, {
      ebe, unlu: yeniUnlu(), degisti: false, ebeKayit: null, taklitler: {}, tahminler: {}, atlandi: '',
      asama: 'ebe', bitis: Date.now() + EBE_SURESI * 1000, ebeDenemesi: 1, uyari: '',
    });
    ev.oyuncular.forEach(o => (o.turPuani = 0));
    zamanla(EBE_SURESI * 1000 + 1500, () => ebeligiDevret('zamanında kaydedemedi'));
    yayinla();
  }

  // Ebe süresinde kaydedemezse (ya da çıkarsa) 0 puan alır; ebelik sıradaki arkadaşa yeni bir ünlüyle geçer
  function ebeligiDevret(neden) {
    if (ev.asama !== 'ebe') return;
    const n = ev.oyuncular.length;
    const eski = ev.oyuncular[ev.ebe];
    let yeni = (ev.ebe + 1) % n;
    for (let k = 0; k < n && ev.oyuncular[yeni].koptu; k++) yeni = (yeni + 1) % n;
    const kalan = ev.oyuncular.filter(o => !o.koptu).length;
    if (ev.ebeDenemesi >= kalan || ev.oyuncular[yeni].koptu || kalan < 2) {
      turuAtla(`${eski.ad} ${neden}.`);
      return;
    }
    Object.assign(ev, {
      ebe: yeni, unlu: yeniUnlu(), degisti: false, bitis: Date.now() + EBE_SURESI * 1000,
      ebeDenemesi: ev.ebeDenemesi + 1,
      uyari: `${eski.ad} ${neden}, 0 puan aldı. Ebelik ${ev.oyuncular[yeni].ad} oyuncusuna geçti!`,
    });
    zamanla(EBE_SURESI * 1000 + 1500, () => ebeligiDevret('zamanında kaydedemedi'));
    yayinla();
  }

  function turuAtla(neden) {
    if (ev.asama !== 'ebe') return;
    ev.atlandi = neden;
    ev.asama = 'skor';
    clearTimeout(ev.zamanlayici);
    yayinla();
  }

  function taklitBaslat() {
    ev.asama = 'taklit';
    ev.bitis = Date.now() + ev.ayar.taklit * 1000;
    zamanla(ev.ayar.taklit * 1000 + 2500, tahminBaslat);  // süre bitince 2,5 sn pay: son kayıtlar gelsin
    Ag.herkese({ tip: 'ses', kim: 'ebe', tur: ev.tur, ...kayitPaketi(ev.ebeKayit) });
    yayinla();
  }

  function tahminBaslat() {
    if (ev.asama !== 'taklit') return;
    ev.asama = 'tahmin';
    ev.bitis = Date.now() + ev.ayar.tahmin * 1000;
    zamanla(ev.ayar.tahmin * 1000 + 800, gosteriBaslat);
    yayinla();
  }

  function gosteriBaslat() {
    if (ev.asama !== 'tahmin') return;
    clearTimeout(ev.zamanlayici);
    // Ebe, ünlüyü bilen her kişi için puan alır (ismi anlaşılır söylediği için)
    const bilen = Object.values(ev.tahminler).filter(t => t.dogru).length;
    const ebe = ev.oyuncular[ev.ebe];
    ebe.turPuani = bilen * EBE_PUANI;
    ebe.puan += ebe.turPuani;
    ev.asama = 'gosteri';
    Object.entries(ev.taklitler).forEach(([no, k]) => Ag.herkese({ tip: 'ses', kim: Number(no), tur: ev.tur, ...kayitPaketi(k) }));
    yayinla();
  }

  function bitir() {
    clearTimeout(ev.zamanlayici);
    ev.asama = 'bitti';
    yayinla();
  }

  // Bir oyuncunun hamlesi geldi
  function eylem(no, m) {
    const o = ev.oyuncular[no];
    if (!o) return;
    if (m.ad === 'degistir' && ev.asama === 'ebe' && no === ev.ebe && !ev.degisti) {
      ev.degisti = true;
      ev.unlu = yeniUnlu();
      yayinla();
    } else if (m.ad === 'ozelUnlu' && ev.asama === 'ebe' && no === ev.ebe) {
      // Ebe aklındaki ünlüyü kendisi yazdı
      const ad = String(m.metin ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);
      if (sadelestir(ad).length < 2) return;
      ev.unlu = { ad, kategori: 'Ebenin seçimi', ozel: true };
      yayinla();
    } else if (m.ad === 'ebeOnay' && ev.asama === 'ebe' && no === ev.ebe) {
      ev.ebeKayit = kayitCoz(m);
      if (ev.ebeKayit) taklitBaslat();
    } else if (m.ad === 'taklitOnay' && ev.asama === 'taklit' && no !== ev.ebe && !ev.taklitler[no]) {
      const k = kayitCoz(m);
      if (!k) return;
      ev.taklitler[no] = k;
      yayinla();
      if (tahminEdenler().every(i => ev.taklitler[i])) setTimeout(tahminBaslat, 800);
    } else if (m.ad === 'tahmin' && ev.asama === 'tahmin' && no !== ev.ebe && !ev.tahminler[no]) {  // tek hak
      tahminKontrol(no, String(m.metin ?? '').slice(0, 60));
    } else if (m.ad === 'sonraki' && no === AG.benimNo) {
      if (ev.asama === 'gosteri') {
        ev.asama = 'skor';
        yayinla();
      } else if (ev.asama === 'skor') {
        turBaslat();
      }
    }
  }

  // Her oyuncunun tek tahmin hakkı var: yanlışsa 0 puan, doğruysa hızına göre puan
  function tahminKontrol(no, metin) {
    const t = { dogru: false, puan: 0, son: metin };
    ev.tahminler[no] = t;
    const herkesTahminEtti = () => tahminEdenler().every(i => ev.tahminler[i]);
    if (!dogruMu(metin, ev.unlu)) {
      Ag.birine(no, { tip: 'sonuc', dogru: false, metin });
      yayinla();
      if (herkesTahminEtti()) setTimeout(gosteriBaslat, 1200);
      return;
    }
    // Hız puanı: kalan süreye göre 100 ile 500 arası
    const kalan = Math.max(0, ev.bitis - Date.now()) / (ev.ayar.tahmin * 1000);
    t.dogru = true;
    t.puan = Math.round(EN_AZ_PUAN + (EN_COK_PUAN - EN_AZ_PUAN) * kalan);
    t.sira = Object.values(ev.tahminler).filter(x => x.dogru).length;
    t.sure = Math.round((ev.ayar.tahmin * 1000 - Math.max(0, ev.bitis - Date.now())) / 100) / 10;
    ev.oyuncular[no].puan += t.puan;
    ev.oyuncular[no].turPuani += t.puan;
    Ag.birine(no, { tip: 'sonuc', dogru: true, puan: t.puan, sira: t.sira, metin });
    yayinla();
    if (herkesTahminEtti()) setTimeout(gosteriBaslat, 1200);
  }

  // Her oyuncuya kendi ekranı: ünlünün adı sadece ebeye (ve tur sonunda herkese) gösterilir
  function durumOlustur(no) {
    const acik = ['gosteri', 'skor', 'bitti'].includes(ev.asama);
    return {
      asama: ev.asama,
      tur: ev.tur,
      toplamTur: ev.toplamTur,
      ebe: ev.ebe,
      kalanMs: Math.max(0, ev.bitis - Date.now()),
      unlu: no === ev.ebe || acik ? { ad: ev.unlu?.ad, kategori: ev.unlu?.kategori } : null,
      kategori: ev.asama !== 'ebe' ? ev.unlu?.kategori : null,
      degistirebilir: !ev.degisti,
      atlandi: ev.atlandi,
      uyari: ev.asama === 'ebe' ? ev.uyari : '',
      oyuncular: ev.oyuncular.map((o, i) => ({
        ad: o.ad, puan: o.puan, turPuani: o.turPuani, koptu: o.koptu,
        taklitVar: !!ev.taklitler[i],
        bildi: !!ev.tahminler[i]?.dogru,
        tahminEtti: !!ev.tahminler[i],
        sira: ev.tahminler[i]?.sira ?? null,
        tahminSure: acik ? ev.tahminler[i]?.sure ?? null : null,
        sonTahmin: acik ? ev.tahminler[i]?.son ?? null : null,
      })),
      benimTahmin: ev.tahminler[no] ?? null,
    };
  }

  function yayinla() {
    ev.oyuncular.forEach((o, no) => Ag.birine(no, { tip: 'durum', d: durumOlustur(no) }));
  }

  // Bağlantısı kopan oyuncu
  function koptu(no) {
    const o = ev.oyuncular[no];
    if (!o) return;
    o.koptu = true;
    if (ev.asama === 'ebe' && no === ev.ebe) ebeligiDevret('oyundan çıktı');
    else if (ev.asama === 'taklit' && tahminEdenler().every(i => ev.taklitler[i])) tahminBaslat();
    else if (ev.asama === 'tahmin' && tahminEdenler().every(i => ev.tahminler[i])) gosteriBaslat();
    yayinla();
  }

  // Geri dönen oyuncuya o anki durum ve gereken kayıtlar yollanır
  function geriDondu(no) {
    ev.oyuncular[no].koptu = false;
    if (ev.ebeKayit && ['taklit', 'tahmin', 'gosteri'].includes(ev.asama)) Ag.birine(no, { tip: 'ses', kim: 'ebe', tur: ev.tur, ...kayitPaketi(ev.ebeKayit) });
    if (ev.asama === 'gosteri') {
      Object.entries(ev.taklitler).forEach(([n, k]) => Ag.birine(no, { tip: 'ses', kim: Number(n), tur: ev.tur, ...kayitPaketi(k) }));
    }
    yayinla();
  }

  return { baslat, eylem, koptu, geriDondu };
})();

// =============================================================
// İstemci: her telefonda ekranı çizen taraf
// =============================================================
const Istemci = (() => {
  const ben = {
    d: null,             // evden gelen son durum
    bitis: 0,            // bu telefondaki saatle aşamanın bitişi
    anahtar: '',         // tur + aşama: değişince yerel her şey sıfırlanır
    kayit: null,         // benim son kaydım (ebe ya da taklit)
    kayitci: null,       // sürmekte olan kayıt
    gonderildi: false,
    ebeSesi: null,       // ebenin kaydı (düz hâli; dinlerken ters çevrilir)
    sesler: {},          // gösteri için herkesin taklidi
    tahminSonucu: null,
    gosteriCaliyor: false,
    calan: '',           // hangi düğme çalıyor (vurgulamak için)
  };

  const benim = () => AG.benimNo;
  const ebeMiyim = () => ben.d && ben.d.ebe === benim();
  const evMiyim = () => AG.mod === 'ev';

  function mesajAl(m) {
    if (m.tip === 'durum') durumAl(m.d);
    else if (m.tip === 'ses') sesAl(m);
    else if (m.tip === 'sonuc') tahminSonucu(m);
  }

  function durumAl(d) {
    const anahtar = `${d.tur}:${d.asama}:${d.ebe}`;
    const yeni = anahtar !== ben.anahtar;
    // Ebelik başkasına geçtiyse de yeni tur gibi: eski ebenin kaydı taklit sanılmasın
    const yeniTur = !ben.d || ben.d.tur !== d.tur || ben.d.ebe !== d.ebe;
    // Ebe ünlüyü değiştirdiyse (ya da kendisi yazdıysa) eski isimle yapılan kayıt silinir
    if (!yeniTur && d.asama === 'ebe' && d.unlu && ben.d?.unlu?.ad !== d.unlu.ad) {
      ben.kayit = null;
      ben.ozelAcik = false;
    }
    ben.d = d;
    ben.bitis = Date.now() + d.kalanMs;
    $('menu').hidden = true;
    $('oyun').hidden = false;
    $('menuBtn').hidden = false;
    // Kayıtlar tur boyunca saklanır: taklit eden, tahmin ederken de kendi taklidini dinleyebilsin
    if (yeniTur) {
      ben.ebeSesi = null;
      ben.sesler = {};
      ben.kayit = null;
      ben.gonderildi = false;
      ben.kayitSayisi = 0;
    }
    if (yeni) {
      ben.anahtar = anahtar;
      kayitIptal();
      ben.tahminSonucu = d.benimTahmin ?? null;
      ben.gosteriCaliyor = false;
      Ses.durdur();
      if (d.asama !== 'skor') Ses.asama();
      if (d.asama === 'bitti') Ses.kazanma();
    }
    ciz(yeni);
    if (yeni && d.asama === 'gosteri') setTimeout(gosteriyiOynat, 700);
  }

  function sesAl(m) {
    const k = kayitCoz(m);
    if (!k || !ben.d || m.tur !== ben.d.tur) return;
    if (m.kim === 'ebe') ben.ebeSesi = k;
    else ben.sesler[m.kim] = k;
    ciz(false);
  }

  // Tek tahmin hakkı: sonuç doğru da olsa yanlış da olsa tahmin ekranı kapanır
  function tahminSonucu(m) {
    ben.tahminSonucu = { dogru: m.dogru, puan: m.puan ?? 0, sira: m.sira, son: m.metin };
    if (m.dogru) Ses.dogru();
    else Ses.yanlis();
    ciz(true);
  }

  // ---------- 🎙️ Kayıt ----------
  // Ebe sınırsız kaydedebilir; taklit edenin 2 kayıt hakkı var (yoksa sürekli değiştirip dururlar)
  const TAKLIT_HAKKI = 2;
  const hakKaldi = () => ebeMiyim() || (ben.kayitSayisi ?? 0) < TAKLIT_HAKKI;

  async function kayitDugmesi(sinir) {
    if (ben.kayitci) {
      if (!ben.hazirlaniyor) ben.kayitci.durdur();  // mikrofon açılırken basılırsa yok say
      return;
    }
    if (!hakKaldi() || ben.mikAciliyor) return;
    Ses.durdur();
    // Mikrofon açılana kadar "açılıyor" yazar; gerçekten dinlemeye başlayınca bip + "KONUŞ!"
    ben.mikAciliyor = true;
    ben.hazirlaniyor = true;
    try {
      ben.kayitci = await Ses.kayitBaslat(sinir, {
        hazir: () => {
          ben.hazirlaniyor = false;
          ciz(false);
        },
      });
    } catch (e) {
      ben.mikAciliyor = false;
      ben.hazirlaniyor = false;
      $('ipucu').innerHTML = '🎙️ Mikrofona izin verilmedi. Telefonunun ayarlarından bu siteye mikrofon izni ver.';
      return;
    }
    ben.mikAciliyor = false;
    ciz(false);
    const kayitci = ben.kayitci;
    const anahtar = ben.anahtar;
    const kayit = await kayitci.sonuc;
    if (ben.kayitci !== kayitci || ben.anahtar !== anahtar) return;  // bu arada aşama değişti, kayıt iptal
    ben.kayitci = null;
    ben.hazirlaniyor = false;
    Ses.dur();
    if (kayit.veri.length < Ses.ORAN * 0.2) {
      $('ipucu').textContent = 'Ses çok kısa ya da çok sessiz geldi. Bir daha dene.';
      ciz(false);
      return;
    }
    ben.kayit = kayit;
    if (!ebeMiyim()) ben.kayitSayisi = (ben.kayitSayisi ?? 0) + 1;
    ciz(false);
    // Kayıttan hemen sonra: ebe düz hâlini, taklit eden tersini (yani sonucu) duyar
    cal(ebeMiyim() ? 'benimDuz' : 'benimTers');
  }

  function kayitIptal() {
    ben.hazirlaniyor = false;
    if (!ben.kayitci) return;
    const k = ben.kayitci;
    ben.kayitci = null;
    k.durdur();
  }

  // ---------- ▶️ Dinleme ----------
  function cal(ne) {
    const kaynaklar = {
      benimDuz: [ben.kayit, false],
      benimTers: [ben.kayit, true],
      ebeTers: [ben.ebeSesi, true],
      ebeDuz: [ben.ebeSesi, false],
    };
    const [k, ters] = kaynaklar[ne] ?? [];
    if (!k) return;
    ben.calan = ne;
    isaretleCalan();
    Ses.cal(k, ters).then(() => {
      if (ben.calan === ne) {
        ben.calan = '';
        isaretleCalan();
      }
    });
  }

  function isaretleCalan() {
    document.querySelectorAll('[data-cal]').forEach(b => b.classList.toggle('caliyor', b.dataset.cal === ben.calan));
  }

  // Gösteri: önce ebenin düz kaydı, sonra herkesin taklidinin tersten hâli sırayla çalar
  async function gosteriyiOynat() {
    if (ben.gosteriCaliyor || ben.d?.asama !== 'gosteri') return;
    ben.gosteriCaliyor = true;
    const anahtar = ben.anahtar;
    const sira = [['ebe', ben.ebeSesi, false], ...ben.d.oyuncular.map((o, i) => [i, ben.sesler[i], true]).filter(([i, k]) => k && i !== ben.d.ebe)];
    for (const [kim, k, ters] of sira) {
      if (ben.anahtar !== anahtar) return;
      ben.calan = `g${kim}`;
      isaretleCalan();
      await Ses.cal(k, ters);
      await new Promise(coz => setTimeout(coz, 600));
    }
    ben.calan = '';
    isaretleCalan();
  }

  // ---------- Çizim ----------
  function dalgaCiz(kanvas, kayit, ters = false) {
    if (!kanvas) return;
    const g = kanvas.getContext('2d');
    const gen = kanvas.width = kanvas.clientWidth * 2;
    const yuk = kanvas.height = kanvas.clientHeight * 2;
    g.clearRect(0, 0, gen, yuk);
    if (!kayit) return;
    const v = kayit.veri, cubuk = 60, aralik = gen / cubuk;
    const parca = Math.max(1, Math.floor(v.length / cubuk));
    g.fillStyle = ters ? '#b07cff' : '#2ee6d6';
    for (let i = 0; i < cubuk; i++) {
      let tepe = 0;
      const bas = (ters ? cubuk - 1 - i : i) * parca;
      for (let j = bas; j < bas + parca && j < v.length; j++) tepe = Math.max(tepe, Math.abs(v[j]));
      const h = Math.max(3, (tepe / 32768) * yuk * 0.9);
      g.fillRect(i * aralik + 1, (yuk - h) / 2, aralik - 2, h);
    }
  }

  function oyuncuListesi(d) {
    return d.oyuncular.map((o, i) => {
      let durum = '';
      if (i === d.ebe && ['ebe', 'taklit', 'tahmin'].includes(d.asama)) durum = '🎙️';
      else if (d.asama === 'taklit') durum = o.taklitVar ? '✅' : '⏳';
      else if (d.asama === 'tahmin') durum = o.bildi ? `✅${o.sira}` : o.tahminEtti ? '❌' : '🤔';
      return `<div class="oyuncu${o.koptu ? ' koptu' : ''}${i === benim() ? ' ben' : ''}" style="--renk:${renk(i)}">
        <span class="nokta"></span><b>${guvenli(o.ad)}</b><span class="puan">${o.puan}</span><span class="durum">${o.koptu ? '📡' : durum}</span></div>`;
    }).join('');
  }

  const dugme = (cal, metin, ek = '') => `<button class="ikinci dinle" data-cal="${cal}" ${ek}>${metin}</button>`;

  function kayitAlani(sinir, onayMetni) {
    const kaydediyor = !!ben.kayitci;
    const hakli = hakKaldi();
    const hak = ebeMiyim() ? '' : ` · Kayıt hakkı: <b>${TAKLIT_HAKKI - (ben.kayitSayisi ?? 0)}/${TAKLIT_HAKKI}</b>`;
    const hazirlaniyor = kaydediyor && ben.hazirlaniyor;
    const metin = hazirlaniyor ? '⏳ Mikrofon açılıyor...' : kaydediyor ? '🔴 KONUŞ!<br><small>bitince bas</small>' : !hakli ? '🔒 Hakkın bitti' : ben.kayit ? '🔁 Tekrar kaydet' : '🎙️ Kaydet';
    return `
      <button id="kayitBtn" class="kayitBtn${hazirlaniyor ? ' hazirlaniyor' : kaydediyor ? ' kaydediyor' : ''}" ${!kaydediyor && !hakli ? 'disabled' : ''}>${metin}</button>
      <div class="kayitNot">${hazirlaniyor ? 'Bip sesini ve "KONUŞ!" yazısını bekle...' : kaydediyor ? `Şimdi konuş! (en fazla ${sinir} saniye)` : `Basınca mikrofon açılır, bip sesinden sonra konuş (en fazla ${sinir} sn)${hak}`}</div>
      <canvas id="dalga" class="dalga"></canvas>
      ${ben.kayit && !kaydediyor ? `<button id="onayBtn" class="onay">${onayMetni}</button>` : ''}`;
  }

  function ciz(yeni) {
    const d = ben.d;
    if (!d) return;
    $('turBilgisi').textContent = d.asama === 'bitti' ? 'Oyun bitti' : `Tur ${Math.min(d.tur, d.toplamTur)}/${d.toplamTur}`;
    $('oyuncular').innerHTML = oyuncuListesi(d);
    const ebeAdi = adEtiketi(d.oyuncular[d.ebe]?.ad ?? '', d.ebe);
    const alan = $('alan');
    let html = '';

    const uyari = d.uyari ? `<div class="uyari">⏰ ${guvenli(d.uyari)}</div>` : '';
    if (d.asama === 'ebe') {
      if (ebeMiyim()) {
        html = `${uyari}<div class="etiket">Sen ebesin! 🎙️ Bu ünlünün adını kaydet:</div>
          <div class="unlu">${guvenli(d.unlu.ad)}</div><div class="kategori">${guvenli(d.unlu.kategori)}</div>
          <div class="dinleSatiri">
            ${d.degistirebilir ? '<button id="degistirBtn" class="ikinci kucuk">🔄 Başka ünlü (1 hak)</button>' : ''}
            <button id="ozelBtn" class="ikinci kucuk">✏️ Kendim yazayım</button>
          </div>
          ${ben.ozelAcik ? `<form id="ozelFormu" class="tahminFormu"><input id="ozelKutusu" class="giris" maxlength="30" placeholder="Aklındaki ünlünün adı..." autocomplete="off" autocapitalize="words"><button>Tamam</button></form>` : ''}
          ${kayitAlani(EBE_KAYIT_SINIRI, '✅ Onayla ve gönder')}
          ${ben.kayit && !ben.kayitci ? `<div class="dinleSatiri">${dugme('benimDuz', '▶️ Düz dinle')}${dugme('benimTers', '⏪ Tersten dinle')}</div>` : ''}
          <div id="ipucu" class="ipucu">İsmi net ve anlaşılır söyle. Arkadaşların sadece <b>tersten</b> hâlini duyacak! Süre biterse 0 puan alırsın ve ebelik sıradakine geçer.</div>`;
      } else {
        html = `${uyari}<div class="bekle">🎙️</div><div class="etiket">${ebeAdi} ebe. Gizli ünlüyü kaydediyor...</div>
          <div class="ipucu">Birazdan onun sesini <b>tersten</b> duyacaksın. Kulaklarını aç! 👂</div>`;
      }
    } else if (d.asama === 'taklit') {
      if (ebeMiyim()) {
        html = `<div class="bekle">🦜</div><div class="etiket">Arkadaşların senin ters sesini taklit ediyor...</div>
          <div class="dinleSatiri">${dugme('ebeTers', '⏪ Benim sesim tersten')}</div>`;
      } else if (ben.gonderildi || d.oyuncular[benim()].taklitVar) {
        html = `<div class="bekle">✅</div><div class="etiket">Taklidin gönderildi! Diğerleri bekleniyor...</div>
          <div class="dinleSatiri">${dugme('benimTers', '⏪ Taklidim tersten')}${dugme('ebeTers', '⏪ Ebenin sesi (ters)')}</div>
          <canvas id="dalga" class="dalga"></canvas>`;
      } else {
        html = `<div class="etiket">1️⃣ ${ebeAdi}${ekNin(d.oyuncular[d.ebe].ad)} sesini <b>tersten</b> dinle:</div>
          <div class="dinleSatiri">${ben.ebeSesi ? dugme('ebeTers', '⏪ Ters sesi dinle', 'id="ebeTersBtn"') : '<span class="ipucu">⏳ Ses geliyor...</span>'}</div>
          <div class="etiket">2️⃣ Duyduğunu <b>aynen</b> taklit edip kaydet:</div>
          ${kayitAlani(TAKLIT_KAYIT_SINIRI, '✅ Taklidimi onayla')}
          ${ben.kayit && !ben.kayitci ? `<div class="dinleSatiri">${dugme('benimTers', '⏪ Taklidim tersten')}${dugme('benimDuz', '▶️ Taklidim')}</div>` : ''}
          <div id="ipucu" class="ipucu">Sesleri istediğin kadar dinleyebilirsin ama <b>2 kayıt hakkın</b> var. Süre bitince son kaydın otomatik gönderilir.</div>`;
      }
    } else if (d.asama === 'tahmin') {
      if (ebeMiyim()) {
        const bilenler = d.oyuncular.filter(o => o.bildi).length;
        html = `<div class="bekle">🤔</div><div class="etiket">Arkadaşların ünlüyü tahmin ediyor...</div>
          <div class="unlu kucuk">${guvenli(d.unlu.ad)}</div><div class="ipucu">Şu ana kadar ${bilenler} kişi bildi. Bilen herkes için +${EBE_PUANI} puan alırsın!</div>`;
      } else if (ben.tahminSonucu?.dogru) {
        html = `<div class="bekle">🎉</div><div class="etiket">Bildin! <b>+${ben.tahminSonucu.puan}</b> puan (${ben.tahminSonucu.sira}. sırada)</div>
          <div class="ipucu">Diğerleri bekleniyor...</div>`;
      } else if (ben.tahminSonucu) {
        html = `<div class="bekle">😬</div><div class="etiket">Olmadı! "<b>${guvenli(ben.tahminSonucu.son ?? '')}</b>" değilmiş. 0 puan.</div>
          <div class="ipucu">Doğru cevap tur sonunda açıklanacak. Diğerleri bekleniyor...</div>`;
      } else {
        html = `<div class="etiket">Bu ünlü kim? <span class="kategori">İpucu: ${guvenli(d.kategori ?? '')}</span></div>
          <div class="dinleSatiri">${ben.kayit ? dugme('benimTers', '⏪ Taklidim tersten') : ''}${ben.ebeSesi ? dugme('ebeTers', '⏪ Ebenin sesi (ters)') : ''}</div>
          <form id="tahminFormu" class="tahminFormu"><input id="tahminKutusu" class="giris" maxlength="40" placeholder="Ünlünün adını yaz..." autocomplete="off" autocapitalize="words">
          <button>Tahmin et</button></form>
          <div class="ipucu">⚠️ <b>Tek hakkın var!</b> Ne kadar hızlı bilirsen o kadar çok puan. Küçük yazım hataları sorun değil.</div>`;
      }
    } else if (d.asama === 'gosteri') {
      const satirlar = d.oyuncular.map((o, i) => {
        if (i === d.ebe) return '';
        const sonuc = o.bildi ? `<span class="iyi">✅ ${o.turPuani} puan · ${o.tahminSure} sn</span>` : `<span class="kotu">❌ ${o.sonTahmin ? `"${guvenli(o.sonTahmin)}"` : 'tahmin yok'}</span>`;
        return `<div class="gosteriSatiri"><button class="ikinci dinle" data-cal="g${i}" data-oyuncu="${i}" ${ben.sesler[i] ? '' : 'disabled'}>⏪</button>
          <div>${adEtiketi(o.ad, i)}<div class="kucukYazi">${sonuc}</div></div></div>`;
      }).join('');
      html = `<div class="etiket">Doğru cevap:</div><div class="unlu">${guvenli(d.unlu.ad)}</div>
        <div class="gosteriSatiri ebeSatiri"><button class="ikinci dinle" data-cal="gebe" ${ben.ebeSesi ? '' : 'disabled'}>▶️</button>
          <div>${ebeAdi} <small>(ebe, düz kayıt)</small><div class="kucukYazi">+${d.oyuncular[d.ebe].turPuani} puan</div></div></div>
        ${satirlar}
        <div class="ipucu">Herkesin taklidi tersten çalıyor 😂 Tekrar dinlemek için ⏪ düğmelerine bas.</div>
        ${evMiyim() ? '<button id="sonrakiBtn" class="onay">📊 Puanlar</button>' : '<div class="ipucu">Oda sahibi devam ettirecek...</div>'}`;
    } else if (d.asama === 'skor') {
      const sirali = d.oyuncular.map((o, i) => ({ ...o, i })).sort((a, b) => b.puan - a.puan);
      const son = d.tur >= d.toplamTur;
      html = `${d.atlandi ? `<div class="etiket">⚠️ ${guvenli(d.atlandi)} Bu tur atlandı.</div>` : `<div class="etiket">Puan durumu</div>`}
        ${d.unlu?.ad && !d.atlandi ? `<div class="kategori">Ünlü: ${guvenli(d.unlu.ad)}</div>` : ''}
        <ol class="skorListesi">${sirali.map(o => `<li>${adEtiketi(o.ad, o.i)}<span>${o.puan}${o.turPuani ? ` <small class="iyi">+${o.turPuani}</small>` : ''}</span></li>`).join('')}</ol>
        ${evMiyim() ? `<button id="sonrakiBtn" class="onay">${son ? '🏆 Sonuçlar' : '▶️ Sonraki tur'}</button>` : '<div class="ipucu">Oda sahibi devam ettirecek...</div>'}`;
    } else if (d.asama === 'bitti') {
      const sirali = d.oyuncular.map((o, i) => ({ ...o, i })).sort((a, b) => b.puan - a.puan);
      html = `<div class="bekle">🏆</div><div class="unlu">${adEtiketi(sirali[0].ad, sirali[0].i)}</div><div class="etiket">kazandı!</div>
        <ol class="skorListesi">${sirali.map(o => `<li>${adEtiketi(o.ad, o.i)}<span>${o.puan}</span></li>`).join('')}</ol>
        <button id="anaMenuBtn" class="onay">Ana menü</button>`;
    }

    // Kayıt sürerken ya da tahmin yazarken ekranı baştan çizip kutuyu bozmayalım
    const tahminYaziliyor = !yeni && document.activeElement?.id === 'tahminKutusu' && d.asama === 'tahmin' && !ben.tahminSonucu;
    if (tahminYaziliyor) return;
    const eskiTahmin = $('tahminKutusu')?.value ?? '';
    alan.innerHTML = html;
    if ($('tahminKutusu')) $('tahminKutusu').value = yeni ? '' : eskiTahmin;
    baglaVeDalgaCiz();
  }

  function baglaVeDalgaCiz() {
    const d = ben.d;
    $('kayitBtn')?.addEventListener('click', () => kayitDugmesi(ebeMiyim() ? EBE_KAYIT_SINIRI : TAKLIT_KAYIT_SINIRI));
    $('degistirBtn')?.addEventListener('click', () => {
      Ses.secim();
      Ag.eylem('degistir');
    });
    $('ozelBtn')?.addEventListener('click', () => {
      Ses.secim();
      ben.ozelAcik = !ben.ozelAcik;
      ciz(false);
      $('ozelKutusu')?.focus();
    });
    $('ozelFormu')?.addEventListener('submit', e => {
      e.preventDefault();
      const metin = $('ozelKutusu').value.trim();
      if (sadelestir(metin).length < 2) return;
      Ses.secim();
      Ag.eylem('ozelUnlu', { metin });
    });
    $('onayBtn')?.addEventListener('click', () => {
      if (!ben.kayit) return;
      Ses.durdur();
      Ses.secim();
      if (ebeMiyim()) Ag.eylem('ebeOnay', kayitPaketi(ben.kayit));
      else {
        ben.gonderildi = true;
        Ag.eylem('taklitOnay', kayitPaketi(ben.kayit));
        ciz(false);
      }
    });
    document.querySelectorAll('[data-cal]').forEach(b => b.addEventListener('click', () => {
      const ne = b.dataset.cal;
      if (ne === 'gebe') {
        ben.calan = ne;
        isaretleCalan();
        Ses.cal(ben.ebeSesi, false);
      } else if (ne.startsWith('g')) {
        ben.calan = ne;
        isaretleCalan();
        Ses.cal(ben.sesler[+b.dataset.oyuncu], true);
      } else cal(ne);
    }));
    $('tahminFormu')?.addEventListener('submit', e => {
      e.preventDefault();
      const metin = $('tahminKutusu').value.trim();
      if (!metin) return;
      $('tahminKutusu').value = '';  // önce temizle: oda sahibinde cevap hemen gelip ekranı yeniden çizebilir
      Ag.eylem('tahmin', { metin });
    });
    $('sonrakiBtn')?.addEventListener('click', () => {
      Ses.secim();
      Ag.eylem('sonraki');
    });
    $('anaMenuBtn')?.addEventListener('click', menuyeDon);
    isaretleCalan();
    const dalga = $('dalga');
    if (dalga) dalgaCiz(dalga, ben.kayit, !ebeMiyim() && d.asama !== 'ebe');
  }

  // Süre göstergesi: her çeyrek saniyede güncellenir; taklit süresi bitince son kayıt kendiliğinden gider
  setInterval(() => {
    const d = ben.d;
    if (!d || !['ebe', 'taklit', 'tahmin'].includes(d.asama)) {
      $('sure').hidden = true;
      return;
    }
    const kalan = Math.max(0, ben.bitis - Date.now());
    const toplam = d.asama === 'ebe' ? 90000 : d.asama === 'taklit' ? (ben.taklitToplam ??= kalan + 1) : (ben.tahminToplam ??= kalan + 1);
    $('sure').hidden = false;
    $('sureYazi').textContent = Math.ceil(kalan / 1000);
    $('sure').style.setProperty('--oran', Math.min(1, kalan / toplam));
    $('sure').classList.toggle('az', kalan < 5000);
    const saniye = Math.ceil(kalan / 1000);
    if (kalan > 0 && saniye <= 5 && saniye !== ben.sonTik) {
      ben.sonTik = saniye;
      Ses.sure();
    }
    if (kalan === 0 && d.asama === 'taklit' && !ebeMiyim() && !ben.gonderildi) {
      if (ben.kayitci) ben.kayitci.durdur();
      else if (ben.kayit) {
        ben.gonderildi = true;
        Ag.eylem('taklitOnay', kayitPaketi(ben.kayit));
        ciz(false);
      }
    }
  }, 250);

  // Aşama değişince süre çubuğunun toplamı yeniden hesaplanır
  const asilDurumAl = durumAl;
  return {
    mesajAl(m) {
      if (m.tip === 'durum' && ben.d && `${m.d.tur}:${m.d.asama}` !== ben.anahtar) {
        ben.taklitToplam = undefined;
        ben.tahminToplam = undefined;
      }
      if (m.tip === 'durum') asilDurumAl(m.d);
      else mesajAl(m);
    },
  };
})();

function menuyeDon() {
  try {
    sessionStorage.removeItem('tersSes.otomatikKatil');
  } catch (e) { /* zaten yoksa sorun değil */ }
  location.reload();
}

// ---------- Menü ve genel düğmeler ----------
$('sesBtn').onclick = () => ($('sesBtn').textContent = Ses.acKapa() ? '🔊' : '🔇');
$('sesBtn').textContent = Ses.acik ? '🔊' : '🔇';
$('menuBtn').onclick = () => ($('cikisEkrani').hidden = false);
$('cikisHayir').onclick = () => ($('cikisEkrani').hidden = true);
$('cikisEvet').onclick = menuyeDon;

// iPhone'da iki parmakla ya da çift dokunuşla sayfa yakınlaşmasın
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });
