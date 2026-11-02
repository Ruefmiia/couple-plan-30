// Keep unchanged stage/image nodes alive instead of decoding a new stage every line.
const key=node=>node.nodeType===1?(node.getAttribute('data-render-key')||
  (node.hasAttribute('data-action')?`action:${node.dataset.action}:${node.dataset.id||node.dataset.slot||''}`:'')):'';
const sameType=(a,b)=>a.nodeType===b.nodeType&&a.nodeName===b.nodeName;
const signatures=new WeakMap();
export function invalidateRenderCache(node) {
  for(let current=node;current;current=current.parentNode)signatures.delete(current);
}
function attributes(target,next) {
  for(const attr of [...target.attributes])if(!next.hasAttribute(attr.name))target.removeAttribute(attr.name);
  for(const attr of next.attributes)if(target.getAttribute(attr.name)!==attr.value)target.setAttribute(attr.name,attr.value);
}
export function renderInto(root,html,images) {
  const template=document.createElement('template');template.innerHTML=html;
  function sync(parent,incoming) {
    const old=[...parent.childNodes],used=new Set(),keyed=new Map(old.filter(key).map(n=>[key(n),n]));let cursor=parent.firstChild;
    for(const next of [...incoming.childNodes]) {
      const nextKey=key(next);
      const candidate=nextKey?keyed.get(nextKey):old.find(n=>!used.has(n)&&!key(n)&&sameType(n,next));
      const match=candidate&&sameType(candidate,next)?candidate:null;
      const signature=next.nodeType===1&&nextKey&&nextKey!=='game'?next.outerHTML:null;
      let node=match;
      if(node) {
        used.add(node);
        if(node.nodeType===1&&(!signature||signatures.get(node)!==signature)){attributes(node,next);sync(node,next);}
        else if(node.nodeValue!==next.nodeValue)node.nodeValue=next.nodeValue;
      } else {
        const warm=next.nodeType===1&&next.tagName==='IMG'?images?.peek(next.getAttribute('src')):null;
        node=warm&&!warm.isConnected?warm:next.cloneNode(true);
        if(warm&&node===warm)attributes(node,next);
      }
      if(signature)signatures.set(node,signature);
      if(node!==cursor)parent.insertBefore(node,cursor);
      cursor=node.nextSibling;
    }
    for(const node of old)if(!used.has(node)&&node.parentNode===parent)node.remove();
  }
  sync(root,template.content);
}

// Two concurrent background decodes; bounded retained images avoid warming the
// whole game into memory on phones. Browser/image nodes can share decoded data.
export function createImageCache({maxEntries=6,maxPixels=12000000}={}) {
  const entries=new Map();let queue=[],active=0;
  const url=path=>new URL(path,document.baseURI).href;
  function trim() {
    let pixels=[...entries.values()].reduce((n,e)=>n+(e.pixels||0),0);
    for(const [path,entry] of entries){
      if(entries.size<=maxEntries&&pixels<=maxPixels)break;
      if(entry.status==='loading')continue;
      entries.delete(path);pixels-=entry.pixels||0;
    }
  }
  function pump() {
    while(active<2&&queue.length){
      const path=queue.shift();if(entries.has(path))continue;
      const image=new Image(),entry={image,status:'loading',pixels:0};entries.set(path,entry);active++;
      image.decoding='async';image.fetchPriority='low';
      const finish=()=>{image.onload=null;image.onerror=null;active--;trim();pump();};
      image.onload=async()=>{
        try{await image.decode();entry.status='ready';entry.pixels=image.naturalWidth*image.naturalHeight;}
        catch{entry.status='failed';}
        finish();
      };
      image.onerror=()=>{entry.status='failed';finish();};image.src=path;
    }
  }
  return {
    warm(paths){
      paths=[...new Set(paths.filter(Boolean).map(url))].slice(0,maxEntries);
      queue=paths.filter(p=>!entries.has(p));
      // Refresh LRU priority for images needed by the current/lookahead stage.
      for(const path of paths){const e=entries.get(path);if(e){entries.delete(path);entries.set(path,e);}}
      trim();pump();
    },
    peek(path){const e=entries.get(url(path));return e?.status==='ready'?e.image:null;}
  };
}
