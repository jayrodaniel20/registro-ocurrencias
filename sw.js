const CACHE_NAME='sage-v2.2.33';
const CORE=[
  './',
  './index.html',
  './manifest.webmanifest',
  './version.json',
  './favicon-32.png',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './logo-sage.png'
];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache=>cache.addAll(CORE))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;

  const url=new URL(req.url);

  // version.json siempre se consulta desde red para detectar actualizaciones.
  if(url.pathname.endsWith('/version.json')){
    event.respondWith(fetch(req,{cache:'no-store'}).catch(()=>caches.match(req)));
    return;
  }

  // Navegación: red primero, caché como respaldo.
  if(req.mode==='navigate'){
    event.respondWith(
      fetch(req).then(res=>{
        const copy=res.clone();
        caches.open(CACHE_NAME).then(c=>c.put('./index.html',copy));
        return res;
      }).catch(()=>caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached=>cached||fetch(req).then(res=>{
      if(url.origin===self.location.origin && res.ok){
        const copy=res.clone();
        caches.open(CACHE_NAME).then(c=>c.put(req,copy));
      }
      return res;
    }))
  );
});

self.addEventListener('message',event=>{
  if(event.data==='SKIP_WAITING') self.skipWaiting();
});
