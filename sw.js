const CACHE='sage-v1-9';
const CORE=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png','./favicon-32.png','./logo-sage.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  const isPage=event.request.mode==='navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/registro-ocurrencias/');
  if(isPage){
    event.respondWith(fetch(event.request,{cache:'no-store'}).then(resp=>{const clone=resp.clone();caches.open(CACHE).then(c=>c.put('./index.html',clone));return resp;}).catch(()=>caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(resp=>{if(resp && resp.ok){const clone=resp.clone();caches.open(CACHE).then(c=>c.put(event.request,clone));}return resp;})));
});
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting();});
