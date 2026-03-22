/**
 * sw.js — Gnoke GeoCompass
 * Service worker for offline-first PWA support.
 * Bump CACHE_NAME version on every new deploy.
 */

const CACHE_NAME = 'gnoke-geocompass-v2';

const ASSETS = [
  './',
  './index.html',
  './main/',
  './style.css',
  './global.png',
  './manifest.json',
  './js/state.js',
  './js/theme.js',
  './js/ui.js',
  './js/geo-compass.js',
  './js/speed.js',
  './js/update.js',
  './js/app.js',
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    )
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(res => res || fetch(e.request))
  );
});
