const REVISION='11edfd80fa9b';
const CACHE='couple-plan-30-vn-v5-'+REVISION;
const FILES=['./','./index.html','./src/fonts.css','./src/style.css?v=5','./src/app.js?v=5','./src/engine.js','./src/storage.js','./src/stage.js','./src/view.js','./src/story.json','./src/rules.json','./src/stage-assets.json','./src/stage-assets.json?v=5','./src/stage-cues.json','./src/stage-cues.json?v=5','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',e=>e.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await cache.addAll(FILES);
  // Art is cached as it is read. Full-episode download is an explicit player action.
  await cache.put('./__auto_update__',new Response(self.registration.active?'1':'0'));
  await self.skipWaiting();
})()));
async function refreshClient(client) {
  if(!client||new URL(client.url).origin!==self.location.origin||!client.url.startsWith(self.registration.scope))return;
  const ready=await new Promise(resolve=>{
    const channel=new MessageChannel();
    // Older releases already save every page/choice, but cannot answer this handshake.
    const timer=setTimeout(()=>{channel.port1.close();resolve(true);},2000);
    channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data?.ready===true);};
    try{client.postMessage({type:'PREPARE_AUTO_UPDATE'},[channel.port2]);}catch{clearTimeout(timer);resolve(false);}
  });
  // Navigation can wait for activation; queue it without blocking activation.
  if(ready)client.navigate(client.url).catch(()=>{});
}
self.addEventListener('message',e=>{
  if(e.data?.type==='ACTIVATE_UPDATE')e.waitUntil(self.skipWaiting());
  if(e.data?.type==='RETRY_AUTO_UPDATE')e.waitUntil(refreshClient(e.source));
});
self.addEventListener('activate',e=>e.waitUntil((async()=>{
  const cache=await caches.open(CACHE),marker=await cache.match('./__auto_update__');
  const upgrade=marker&&(await marker.text())==='1';
  await self.clients.claim();
  if(upgrade)await Promise.all((await self.clients.matchAll({type:'window',includeUncontrolled:true})).map(refreshClient));
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k.startsWith('couple-plan-30-')&&k!==CACHE).map(k=>caches.delete(k)));
})()));
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
