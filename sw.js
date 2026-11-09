// =============================================================
// Ters Ses - servis çalışanı (service worker)
// Telefonda "ana ekrana ekle" için gerekli. Oyun dosyalarını telefona kaydeder:
// internet varken her zaman en yeni dosyalar indirilir (oyun güncellenince herkes yenisini alır),
// internet yoksa kaydedilmiş kopya açılır. Online oynamak için yine internet gerekir.
// Oyunu güncelleyip yüklerken ONBELLEK numarasını 1 artır.
// =============================================================

const ONBELLEK = 'ters-ses-v5';
const DOSYALAR = [
  './', 'index.html', 'style.css', 'unluler.js', 'ses.js', 'oyun.js', 'ag.js',
  'manifest.webmanifest', 'ikonlar/ikon-192.png', 'ikonlar/ikon-512.png',
];

self.addEventListener('install', olay => {
  olay.waitUntil(caches.open(ONBELLEK).then(onbellek => onbellek.addAll(DOSYALAR.map(d => new Request(d, { cache: 'reload' })))));
  self.skipWaiting();
});

// Eski sürümün kayıtlarını temizle
self.addEventListener('activate', olay => {
  olay.waitUntil(caches.keys().then(adlar =>
    Promise.all(adlar.filter(ad => ad !== ONBELLEK).map(ad => caches.delete(ad)))));
  self.clients.claim();
});

// Önce internetten dene (en yeni sürüm), olmazsa kaydedilmiş kopyayı ver.
// Oyunun kendi dosyaları tarayıcının kısa süreli önbelleği atlanarak sunucuya sorulur;
// yoksa güncellemeden sonra bir süre eski dosya gelebiliyor (eski sürümle online oyun bozulur).
self.addEventListener('fetch', olay => {
  if (olay.request.method !== 'GET') return;
  const ayniSite = new URL(olay.request.url).origin === self.location.origin;
  olay.respondWith(
    (ayniSite ? fetch(olay.request.url, { cache: 'no-cache' }) : fetch(olay.request))
      .then(cevap => {
        if (cevap.ok) {
          const kopya = cevap.clone();
          caches.open(ONBELLEK).then(onbellek => onbellek.put(olay.request, kopya));
        }
        return cevap;
      })
      .catch(() => caches.match(olay.request)),
  );
});
