const CACHE='registro-ocurrencias-v1-7';
const ASSETS=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png','./favicon-32.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const isPage=e.request.mode==='navigate'||e.request.url.endsWith('/index.html');if(isPage){e.respondWith(fetch(e.request).then(resp=>{let clone=resp.clone();caches.open(CACHE).then(c=>c.put('./index.html',clone));return resp}).catch(()=>caches.match('./index.html')));return;}e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{let clone=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,clone));return resp})));});
