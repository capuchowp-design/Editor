/* Service Worker do Editor Único (pasta /unico) — escopo próprio, reaproveita ../vendor */
const VERSION = 'v1.0.1';
const SHELL_CACHE = 'ushell-' + VERSION;
const LIB_CACHE = 'libs-v1'; // compartilhado com o editor de violão (mesmos arquivos)

const SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.json',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png'];
const VENDOR = ['../vendor/ffmpeg.js', '../vendor/814.ffmpeg.js', '../vendor/util.js',
  '../vendor/ffmpeg-core.js', '../vendor/ffmpeg-core.wasm'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL);
    const libs = await caches.open(LIB_CACHE);
    await Promise.allSettled(VENDOR.map((u) => libs.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('ushell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

const isLib = (url) =>
  url.pathname.includes('/vendor/') || url.hostname === 'unpkg.com' || url.hostname === 'cdn.jsdelivr.net';

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (isLib(url)) { // libs: cache primeiro
    e.respondWith((async () => {
      const cache = await caches.open(LIB_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }
  if (url.origin === location.origin) { // app: rede primeiro, cache se offline
    e.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (_) {
        return (await cache.match(req, { ignoreSearch: true })) ||
               (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
      }
    })());
  }
});
