const REVISION='c92088ca7580';
const CACHE='couple-plan-30-vn-v5-'+REVISION;
const FILES=['./','./index.html','./src/fonts.css','./src/style.css?v=5','./src/app.js?v=5','./src/engine.js','./src/storage.js','./src/stage.js','./src/story.json','./src/rules.json','./src/stage-assets.json','./src/stage-assets.json?v=5','./src/stage-cues.json','./src/stage-cues.json?v=5','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',e=>e.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await cache.addAll(FILES);
  // Art is cached as it is read. Full-episode download is an explicit player action.
  // An update waits until the player saves and accepts it, or closes old tabs.
})()));
self.addEventListener('message',e=>{if(e.data?.type==='ACTIVATE_UPDATE')self.skipWaiting();});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('couple-plan-30-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(e.request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;
  // Each installed release uses a coherent cached script/story set, including offline play.
  e.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    // A fresh navigation can pick up a new release while keeping saves intact.
    if(e.request.mode==='navigate') {
      try{const response=await fetch(e.request);if(response.ok)return response;}catch{}
      return await cache.match('./index.html');
    }
    const cached=await cache.match(e.request);
    if(cached)return cached;
    const response=await fetch(e.request);
    if(response.ok && /\.(?:webp|svg|png|woff2|mp3)$/.test(url.pathname))await cache.put(e.request,response.clone());
    return response;
  })());
});
