import {createEngine} from './engine.js';
import {createLibrary, STORAGE_KEY} from './storage.js';
import {resolveStage, characterArt, CHARACTER_NAMES} from './stage.js';
import {renderInto,createImageCache,invalidateRenderCache} from './view.js';

const app = document.querySelector('#app'), modal = document.querySelector('#modal');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let engine, library, story, rules, stageAssets, stageCues, state, inGame = false, timer, mode = '', toastTimer, focusReturn;
let imported = null;
const imageCache=createImageCache();
let warmupTask=null;
function stageImagePaths(scene) {
  return [stageAssets.backgrounds[scene.bg],scene.cg&&stageAssets.cg[scene.cg],
    ...(!scene.cg&&!stageAssets.backgroundPresentation[scene.bg]?.embeddedCast?scene.cast.map(k=>characterArt(stageAssets,k,scene.outfits[k])):[]),
    scene.prop&&stageAssets.props[scene.prop.key],scene.cat&&stageAssets.cats[scene.cat.pose],scene.reaction&&stageAssets.reactions[scene.reaction.key]].filter(Boolean).map(p=>'./'+p);
}
function scheduleWarmup(from=state) {
  if(warmupTask!==null){if('cancelIdleCallback' in window)cancelIdleCallback(warmupTask);else clearTimeout(warmupTask);}
  const snapshot=structuredClone(from);
  const run=()=>{
    warmupTask=null;if(document.hidden)return;
    const paths=[];
    const add=s=>paths.push(...stageImagePaths(resolveStage({story,state:s,event:engine.current(s),ending:engine.ending(s),cues:stageCues})));
    let probe=snapshot;
    for(let i=0;i<12;i++){
      add(probe);const e=engine.current(probe);
      if(['episodeEnd','finished'].includes(e.type))break;
      if(e.type==='choice'){for(const o of e.node.options)add(engine.choose(probe,o.id));break;}
      probe=engine.next(probe);
    }
    imageCache.warm([...new Set(paths)]);
  };
  warmupTask='requestIdleCallback' in window?requestIdleCallback(run,{timeout:500}):setTimeout(run,50);
}
function saveAndRender(){library.batch(()=>{persist();render();});}
const UPDATE_HANDOFF='couple-plan-30.auto-update-handoff';
let updateRegistration=null,updateCheck=null,pendingAutoUpdate=false;
function prepareAutoUpdate() {
  stop();updateModeButtons();
  if(!inGame||!library)return true;
  // A stale tab must not overwrite the newer progress saved by another tab.
  if(!library.canWrite()) {
    try{if(JSON.parse(localStorage.getItem(STORAGE_KEY))?.slots?.auto){sessionStorage.removeItem(UPDATE_HANDOFF);return true;}}catch{}
  }
  const saved=library.canWrite()&&library.save('auto',state,label());
  let handoff=false;
  try{
    sessionStorage.setItem(UPDATE_HANDOFF,JSON.stringify({save:engine.pack(state,label()),settings:library.data.settings,
      ...(saved?{}:{librarySnapshot:library.data})}));handoff=true;
  }catch{}
  if(!saved&&!handoff)toast('有新版本，但进度暂时无法保存。已保留当前页面，稍后会自动重试更新。');
  return saved||handoff;
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message',event=>{
    if(event.data?.type!=='PREPARE_AUTO_UPDATE')return;
    let ready=false;
    try{ready=prepareAutoUpdate();}catch{}
    pendingAutoUpdate=!ready;
    event.ports[0]?.postMessage({ready});
  });
}
function checkForUpdates() {
  if(!updateRegistration||!navigator.onLine||document.hidden||updateCheck)return;
  if(pendingAutoUpdate)updateRegistration.active?.postMessage({type:'RETRY_AUTO_UPDATE'});
  updateCheck=updateRegistration.update().catch(()=>{}).finally(()=>{updateCheck=null;});
}
function initializeUpdates() {
  if(!('serviceWorker' in navigator)||location.protocol==='file:')return;
  navigator.serviceWorker.register(new URL('../sw.js',import.meta.url),{
    scope:new URL('../',import.meta.url).pathname,updateViaCache:'none'
  }).then(reg=>{updateRegistration=reg;checkForUpdates();}).catch(()=>{});
  window.addEventListener('focus',checkForUpdates);
  window.addEventListener('online',checkForUpdates);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkForUpdates();});
  setInterval(checkForUpdates,60000);
}
// A missing later upload must not stop reading or show a broken image icon.
app.addEventListener('error', e=>{
  const img=e.target;
  if(img.tagName!=='IMG')return;
  const fallback=img.dataset.fallback;
  if(fallback){delete img.dataset.fallback;img.src=fallback;img.closest('.sprite')?.classList.replace('photo','placeholder');}
  else if(img.closest('.prop-layer'))img.closest('.prop-layer').hidden=true;
  else img.style.visibility='hidden';
},true);
function toast(text) {
  const el = document.querySelector('#toast'); el.textContent = text; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 6000);
}
function stop() {clearTimeout(timer); mode = '';}
const button = (action, text, extra = '') => `<button type="button" data-action="${action}" ${extra}>${text}</button>`;
function settings() {
  document.documentElement.dataset.theme = library.data.settings.theme;
  document.documentElement.style.setProperty('--reading-size', `${library.data.settings.fontSize}px`);
}
function chapter() {return story.chapters[Math.min(29, engine.stats(state).day - 1)];}
function label(saveState = state) {
  const e = engine.current(saveState), d = engine.stats(saveState).day;
  return `D${d} · ${e.type === 'episodeEnd' ? '本期已完' : e.type === 'choice' ? e.node.title : e.type === 'result' ? '选择之后' : saveState.cursor >= story.events.length ? '尾声' : story.chapters[d-1].title}`;
}
function persist() {
  library.save('auto', state, label());
  const e = engine.current(state);
  if (e.type === 'chapter') library.save('day', state, `D${e.day} · 当天开场`);
  if (e.type === 'choice') library.save('checkpoint', state, `D${engine.stats(state).day} · 选择之前`);
  if (e.type === 'ending' || e.type === 'finished') library.unlock(engine.ending(state));
}
function home() {
  stop(); inGame = false;
  document.body.dataset.view='title';
  const latest = library.data.slots.auto;
  app.innerHTML = `<main class="vn-screen title-screen" aria-label="30天情侣计划标题画面">
    ${stageBackground({bg:'BG03'})}${stageCharacters({type:'title'},{outfits:{perth:'home',santa:'home'},cast:['perth','santa']},true)}<div class="title-wash"></div>
    <header class="title-header"><span class="wordmark">PERTH × SANTA</span>${button('fullscreen','全屏','class="glass-button"')}</header>
    <section class="title-block"><p class="eyebrow">一份通告，两位临时当事人。</p><h1><span class="thirty">30<span>天</span></span><span class="title-words">情侣计划<span>。</span></span></h1><p class="intro">假装情侣这件事，<br>好像比想象中更需要演技。</p>
    <nav class="title-menu" aria-label="游戏菜单">${button(latest?'continue':'new',latest?'继续游戏':'开始游戏','class="primary"')}${latest?button('new','重新开始'):''}${button('load','读取存档')}${button('collection','结局收藏')}${button('settings','游戏设置')}</nav><p class="resume-hint">${latest?esc(latest.label):story.release?'Perth视角 · 第一期 D1—D12':'Perth视角 · 30天 · 5个结局'}</p></section>
    <footer class="title-footer"><span>轻喜剧 / 假装情侣 / 全程虚构</span><span class="preview-label">${story.release?'第一期 · D1—D12 · 结局尚未开放':'素材陆续更新中'}</span></footer><span class="portrait-tip">横屏游玩体验更佳</span>
  </main>`;
  scheduleWarmup(engine.fresh());
}
function artImage(path, attributes, alt='') {
  const fallback=stageAssets.fallbacks[path];
  return `<img src="./${esc(path)}" ${attributes} ${fallback?`data-fallback="./${esc(fallback)}"`:''} alt="${esc(alt)}" draggable="false" decoding="async">`;
}
function stageBackground(stage) {
  const path=stageAssets.backgrounds[stage.bg] || stageAssets.backgrounds.BG03;
  const position=stageAssets.backgroundPresentation[stage.bg]?.position || 'center';
  return `${artImage(path,`class="stage-background" data-render-key="background" style="object-position:${position}"`)}${stage.cg&&stageAssets.cg[stage.cg]?artImage(stageAssets.cg[stage.cg],`class="stage-cg" data-render-key="cg" data-cg="${esc(stage.cg)}"`,stageAssets.cgLabels?.[stage.cg]||'剧情照片'):''}<div class="stage-light" data-render-key="light"></div>`;
}
function stageCharacters(event, stage, title=false) {
  if (stage.cg && stageAssets.cg[stage.cg] || stageAssets.backgroundPresentation[stage.bg]?.embeddedCast) return '';
  const speaker=event.speaker;
  return `<div data-render-key="characters" class="character-layer ${title?'title-characters':''} ${stage.cast.length===1?'single-character':''}" aria-label="出场人物">${stage.cast.map((key,i)=>{
    const active=CHARACTER_NAMES[key]===speaker||(key==='mother'&&speaker==='妈妈');
    const path=characterArt(stageAssets,key,stage.outfits[key]);
    const photo=path.endsWith('.webp');
    const medium=stageAssets.characterPresentation?.[key]?.medium||(photo?'photo':'placeholder');
    return `<figure data-render-key="sprite-${i}" class="sprite sprite-${i} ${photo?'photo':'placeholder'} ${active?'speaking':''} ${speaker&&event.type==='dialogue'&&!active?'listening':''}" data-character="${key}" data-art="${medium}" data-outfit="${stage.outfits[key]||''}">${artImage(path,'',`${CHARACTER_NAMES[key]}${medium==='illustration'?'卡通':photo?'':'示意'}立绘`)}<figcaption>${CHARACTER_NAMES[key]}</figcaption></figure>`;
  }).join('')}</div>`;
}
function stageExtras(stage) {
  let html='';
  const cat=stage.cat, reaction=stage.reaction;
  const reactionSide=reaction&&stage.cast.indexOf(reaction.owner)===0?'left':'right';
  const prop=stage.prop;
  if(prop && stageAssets.props?.[prop.key]) {
    const catSide=reaction&&reactionSide==='right'?'left':'right';
    const side=cat?(catSide==='left'?'right':'left'):reaction?(reactionSide==='left'?'right':'left'):'left';
    const form=prop.form||'object';
    const text=prop.text?`<div class="prop-writing prop-writing-${esc(form)}">${esc(prop.text).replace(/\n/g,'<br>')}</div>`:'';
    const stamp=prop.stamp?`<span class="prop-stamp">${esc(prop.stamp)}</span>`:'';
    html+=`<figure data-render-key="prop" class="prop-layer prop-${side} prop-${esc(form)}" data-prop="${esc(prop.key)}" aria-label="${esc([prop.label,prop.text,prop.stamp].filter(Boolean).join('，'))}"><div class="prop-art">${artImage(stageAssets.props[prop.key],'',prop.label)}${text}${stamp}</div><figcaption>${esc(prop.label)}</figcaption></figure>`;
  }
  if(cat && stageAssets.cats[cat.pose]) html+=`<figure data-render-key="cat" class="felix-layer ${cat.mode==='video'?'cat-video':'cat-live'} ${reaction&&reactionSide==='right'?'cat-left':''}" aria-label="${cat.mode==='video'?'视频里的Felix':'Felix'}">${artImage(stageAssets.cats[cat.pose],'',`Felix · ${{box:'趴纸箱',paw:'伸爪',ball:'拨玩具',bag:'闻纸袋',calm:'安静坐着'}[cat.pose]}`)}<figcaption>${cat.mode==='video'?'视频画面 · Felix':'Felix'}</figcaption></figure>`;
  if(reaction && stageAssets.reactions[reaction.key]) {
    const side=reactionSide;
    html+=`<figure data-render-key="reaction" class="reaction-layer reaction-${side}" aria-label="${CHARACTER_NAMES[reaction.owner]}：${esc(reaction.label)}">${artImage(stageAssets.reactions[reaction.key],'','')}<figcaption><span>${CHARACTER_NAMES[reaction.owner]}</span>${esc(reaction.label)}</figcaption></figure>`;
  }
  return html;
}
function render() {
  settings();
  if (!inGame) return home();
  document.body.dataset.view='game';
  const e = engine.current(state), s = engine.stats(state), scene = resolveStage({story,state,event:e,ending:engine.ending(state),cues:stageCues});
  const pct = Math.round((state.cursor + 1) / story.events.length * 100);
  let content='', text=e.text||'', name=e.speaker==='Perth'?'Perth':e.speaker||'旁白';
  if (e.type === 'chapter') {
    content = `<div class="chapter-card"><p class="eyebrow">DAY ${String(e.day).padStart(2,'0')} / 30</p><h1>${esc(e.title)}</h1><p>${esc(e.location)}</p></div>`;
    name='30天情侣计划';text=`第${e.day}天，计划继续。`;
  } else if (e.type === 'choice') {
    const previous=engine.history(state).filter(x=>x.text).at(-1);
    text=previous?.text || e.node.title;name=previous?.speaker || '旁白';
    content = `<section class="decision" aria-label="选择回答"><h1>${esc(e.node.title.split('：').at(-1))}</h1><div class="options">${e.node.options.map((o,i) => button('choose',`<span class="option-num">${String(i+1).padStart(2,'0')}</span><span>${esc(o.text)}</span><span class="option-arrow" aria-hidden="true">›</span>`,`data-id="${o.id}" class="option"`)).join('')}</div></section>`;
  } else if (e.type === 'ending' || e.type === 'finished') {
    const title = story.endings[engine.ending(state)].title;
    content = `<div class="ending-card"><p class="eyebrow">${e.type==='finished' ? '本次计划 · 已完成' : '第三十天之后'}</p><div class="ending-stamp">${engine.ending(state)==='没盖章' ? '隐藏尾声' : '计划归档'}</div><h1>${esc(title.split('｜').at(-1))}</h1><p>${e.type==='finished' ? '这三十天，已经收进你的通告夹。' : '排期走到了这里，接下来的话由你们自己说。'}</p>${e.type==='finished' ? `<div class="finish-actions">${button('collection','查看结局收藏','class="primary"')}${button('new','重新开始')}${button('home','回到标题')}</div>` : ''}</div>`;
    name='30天情侣计划';text=e.type==='finished'?'这次相处已经归档。下一次，会怎样开始？':'三十天过去了，有些话才刚刚开始。';
  } else if (e.type === 'episodeEnd') {
    content = `<div class="ending-card episode-card"><p class="eyebrow">第一期 · D1—D12</p><h1>本期已完</h1><p>选择已经记下，通告还在继续。</p><div class="finish-actions">${button('save','保存进度','class="primary"')}${button('export','导出备份')}${button('home','返回标题')}</div></div>`;
    name='30天情侣计划';text='本期开放至第12天。你可以保存或导出进度，后续版本开放后继续游玩。';
  } else if (e.type === 'scene') {
    content = `<div class="chapter-card"><p class="eyebrow">下一站</p><h1>${esc(e.location)}</h1><p>动作先确认，机位慢慢想。</p></div>`;
    text='你们来到地下停车场。摄影师还在找一个看起来不像安排过的机位。';
  }
  renderInto(app, `<main data-render-key="game" class="vn-screen game-screen" data-bg="${scene.bg}" data-event="${e.type}" data-timeframe="${esc(scene.timeframe)}" aria-label="剧情舞台">
    ${stageBackground(scene)}${stageCharacters(e,scene)}${stageExtras(scene)}
    <header data-render-key="header" class="stage-header"><div class="scene-label"><span class="day-label">DAY <b>${String(s.day).padStart(2,'0')}</b><small> / 30</small></span><span>${scene.timeframe==='replay'?'录像重播 · 昨晚':esc(scene.location)}</span></div><nav aria-label="游戏快捷菜单">${button('home','标题')}${button('fullscreen','全屏')}${button('menu','菜单 <span aria-hidden="true">≡</span>')}</nav></header>
    ${!scene.cg&&stageAssets.backgrounds[scene.bg]?.endsWith('.svg')?'<span class="art-note">背景待补</span>':''}<div data-render-key="content" class="story-content">${content}</div>
    <section data-render-key="dialogue" class="dialogue-box passage ${e.type}" aria-label="剧情对话" data-speaker="${esc(e.speaker||'')}"><div class="speaker-label">${scene.timeframe==='replay'?'录像重播 · ':''}${e.channel?`${esc(e.channel)} · `:e.type==='message'?'消息 · ':''}${esc(name)}</div><div data-render-key="dialogue-body" class="dialogue-body" tabindex="0" aria-label="当前台词">${e.chosen?`<p data-render-key="chosen-line" class="chosen-line">「${esc(e.chosen)}」</p>`:''}<div data-render-key="reading-text" class="reading-text">${esc(text).replace(/\n/g,'<br>')}</div></div>
      <footer class="dialogue-footer"><div class="reading-tools">${button('history','回看')}${button('save','存档')}${button('load','读档')}${button('auto',mode==='auto'?'停止自动':'自动',`aria-pressed="${mode==='auto'}"`)}${button('skip',mode==='skip'?'停止快进':'已读快进',`aria-pressed="${mode==='skip'}"`)}</div>${e.type==='finished'?'<span class="done-label">已归档</span>':e.type==='episodeEnd'?'<span class="done-label">等待下期开放</span>':button('next',e.type==='choice'?'等待选择':e.type==='chapter'?'开始今天 ▸':'继续 ▸',`class="next-button" ${e.type==='choice'?'disabled':''}`)}</footer>
      <div class="reading-progress" role="progressbar" aria-label="主线阅读进度" aria-valuenow="${Math.min(100,pct)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${Math.min(100,pct)}%"></span></div>
    </section><span class="portrait-tip">横屏游玩体验更佳</span>
  </main>`,imageCache);
  document.querySelector('.dialogue-body').scrollTop=0;
  scheduleWarmup();
  if (e.id && e.type !== 'choice') library.markRead(e.id);
  schedule();
}
function schedule() {
  clearTimeout(timer);
  if (!mode || modal.open || !inGame) return;
  const e=engine.current(state);
  if (['choice','finished','ending','episodeEnd'].includes(e.type)) {stop(); updateModeButtons(); return;}
  const upcoming=engine.current(engine.next(state));
  if (mode==='skip' && (!upcoming.id || !library.data.read.includes(upcoming.id) || upcoming.type==='choice')) {stop();updateModeButtons();return;}
  const delay=mode==='skip' ? 120 : Math.max(library.data.settings.autoDelay*1000, (e.text?.length || 0)*85);
  timer=setTimeout(advance,delay);
}
function updateModeButtons() {
  for (const name of ['auto','skip']) {
    const b=app.querySelector(`[data-action="${name}"]`);
    if (b) {b.textContent=name==='auto' ? '自动' : '已读快进'; b.setAttribute('aria-pressed','false');invalidateRenderCache(b);}
  }
}
function advance() {state=engine.next(state); saveAndRender();}
function openModal(title, body, wide = false) {
  stop(); updateModeButtons(); focusReturn=document.activeElement;
  modal.className=wide ? 'wide' : '';
  modal.innerHTML=`<header class="modal-header"><h2 id="modal-title">${title}</h2>${button('close','关闭 <span aria-hidden="true">×</span>')}</header><div class="modal-body">${body}</div>`;
  if (!modal.open) modal.showModal();
  modal.querySelector('button,input,select')?.focus();
}
function closeModal() {modal.close(); focusReturn?.isConnected && focusReturn.focus();}
function confirmAction(title, text, action) {openModal(title,`<p>${text}</p><div class="dialog-actions">${button('close','取消')}${button(action,'确认','class="primary"')}</div>`);}
function saveMenu(loading = false) {
  const autos=[['auto','最近进度'],['checkpoint','最近选择之前'],['day','当天开场'],['quick','快速存档']];
  const slots=[...autos,...Array.from({length:12},(_,i)=>[`slot-${i+1}`,`手动 ${String(i+1).padStart(2,'0')}`])];
  openModal(loading ? '读取存档' : '保存进度', `<p class="subtle">自动存档随阅读更新，手动存档由你保留。跨设备请导出文件。</p>${!loading && inGame ? '<label class="save-label">本次存档备注<input id="save-label" maxlength="60" placeholder="例如：停车场，想换个回答"></label>' : ''}<div class="slot-grid">${slots.map(([id,title])=>{
    const entry=library.data.slots[id]; let valid=true;
    if(entry) try{engine.unpack(entry);}catch{valid=false;}
    const canSave=!loading && inGame && !['auto','day','checkpoint'].includes(id);
    return `<article class="save-slot ${entry?'occupied':''}"><span class="slot-name">${title}</span><strong>${entry ? valid ? esc(entry.label) : '存档损坏或版本不兼容' : '空白存档'}</strong><time>${entry && Number.isFinite(Date.parse(entry.savedAt)) ? new Date(entry.savedAt).toLocaleString('zh-CN',{hour12:false}) : '还没有记录'}</time><div>${canSave ? button('save-slot',entry?'覆盖保存':'保存在这里',`data-slot="${id}"`) : ''}${entry && valid ? button('load-slot','读取',`data-slot="${id}"`) : ''}</div></article>`;
  }).join('')}</div><div class="file-actions">${inGame?button('export','导出当前进度'):''}<label class="file-button">导入存档文件<input type="file" id="import-save" accept=".json,application/json"></label></div><p class="subtle">清理浏览器数据会移除本地存档。导出文件可长期备份；不同网址的存档互不相通。</p>`,true);
}
function collection() {
  if(story.release) return openModal('结局收藏','<p>结局尚未开放。本期更新至D12，已作出的选择会保留到后续版本。</p>');
  openModal('结局收藏',`<p class="subtle">已收录 ${library.data.unlocked.length} / 5。未到达的结局不会提前展示。</p><div class="ending-list">${Object.entries(story.endings).map(([key,e],i)=>`<article><span>${String(i+1).padStart(2,'0')}</span><div><h3>${library.data.unlocked.includes(key)?esc(e.title):'尚未收录'}</h3><p>${library.data.unlocked.includes(key)?'已归档 · 可重温尾声':'继续你的三十天。'}</p></div>${library.data.unlocked.includes(key)?button('replay-ending','重温',`data-key="${key}"`):'<span class="subtle">未解锁</span>'}</article>`).join('')}</div>`,true);
}
function showSettings() {
  const s=library.data.settings;
  openModal('游戏设置',`<form id="settings-form"><label>文字大小<select name="fontSize">${[17,19,22,25].map(n=>`<option value="${n}" ${n===s.fontSize?'selected':''}>${n} · ${n===17?'较小':n===19?'标准':n===22?'较大':'最大'}</option>`).join('')}</select></label><label>对话框样式<select name="theme"><option value="light" ${s.theme==='light'?'selected':''}>日间 · 浅色</option><option value="dark" ${s.theme==='dark'?'selected':''}>夜间 · 深色</option></select></label><label>自动阅读最短停留<select name="autoDelay">${[3,5,8].map(n=>`<option value="${n}" ${n===s.autoDelay?'selected':''}>${n} 秒</option>`).join('')}</select></label></form><p class="subtle">自动阅读会为长段落延长停留，并在选项处暂停。已读快进遇到新内容会停止。长台词可在对话框内滚动查看。</p><p class="subtle">快捷键：空格 / → 继续，S 存档，L 读档，H 回看，Esc 菜单。当前版本没有音乐。</p><div class="file-actions">${button('download-offline',story.release?'下载本期供离线游玩':'下载素材供离线游玩')}</div><p id="offline-status" class="subtle" role="status">离线下载需要联网；下载成功后再断网。清理网站数据仍会移除进度。</p>`);
}
function showHistory() {
  openModal('刚才说到哪里',`<div class="history">${engine.history(state).map(e=>e.type==='chapter'?`<h3>D${e.day} · ${esc(e.title)}</h3>`:e.text?`<article class="history-row"><strong>${e.channel?`${esc(e.channel)} · `:''}${esc(e.speaker || (e.chosen?'你的选择':'旁白'))}</strong>${e.chosen?`<p class="history-choice">${esc(e.chosen)}</p>`:''}<p>${esc(e.text)}</p></article>`:'').join('')}</div>`,true);
  modal.querySelector('.modal-body').scrollTop=modal.querySelector('.modal-body').scrollHeight;
}
function menu() {
  const s=engine.stats(state);
  const band=rules.ui.actingBands.find(([a,b])=>s.acting>=a&&s.acting<=b);
  openModal('计划进行中',`<p class="eyebrow">DAY ${String(s.day).padStart(2,'0')} / 30</p><h3>${esc(chapter().title)}</h3><div class="relationship-note"><span>外界风向</span><p>${esc(band[2])}</p>${s.heartVisible?`<span>私下的认真</span><div class="heart-track" role="img" aria-label="私人投入已显现"><i style="width:${s.heart*10}%"></i></div><p class="subtle">有些靠近，已经不用写在通告上。</p>`:''}</div><div class="menu-buttons">${button('save','保存进度')}${button('load','读取存档')}${button('quick-save','快速保存')}${button('quick-load','快速读取')}${button('history','对话回看')}${button('collection','结局收藏')}${button('settings','阅读设置')}${button('home','返回标题')}</div><details class="calendar"><summary>30天通告表</summary><ol>${story.chapters.map(c=>`<li class="${c.day===s.day?'today':''}"><span>D${String(c.day).padStart(2,'0')}</span>${c.day<=s.day?esc(c.title):'尚未翻开'}</li>`).join('')}</ol></details>`);
}
let pendingSlot='', pendingLabel='';
async function handle(action, el) {
  try {
    if(action==='download-offline') {
      if(!('caches' in window)||!('serviceWorker' in navigator))throw Error('当前浏览器无法下载离线资源，请保持联网游玩。');
      el.disabled=true;
      const status=document.querySelector('#offline-status');
      try {
        status.textContent='正在准备离线下载……';
        await navigator.serviceWorker.ready;
        const cache=await caches.open('couple-plan-30-vn-v5-'+stageAssets.revision);
        const files=[...new Set([...stageAssets.installed,...Object.values(stageAssets.cg||{}),...Object.values(stageAssets.fonts||{}),...Object.values(stageAssets.fallbacks||{})])];
        for(let i=0;i<files.length;i+=3){
          await Promise.all(files.slice(i,i+3).map(async path=>{
            const url=new URL('../'+path,import.meta.url);if(!await cache.match(url))await cache.add(url);
          }));
          status.textContent=`离线下载 ${Math.min(i+3,files.length)} / ${files.length}`;
        }
        status.textContent='离线资源已下载，可以断网续玩。浏览器仍可能清理缓存，请保留进度备份。';
      } catch(err) {status.textContent='离线下载未完成，请保持联网并重试。已下载的资源会保留。';throw err;}
      finally {el.disabled=false;}
      return;
    }
    if(action==='fullscreen') {
      if(document.fullscreenElement)await document.exitFullscreen();
      else if(document.documentElement.requestFullscreen){await document.documentElement.requestFullscreen();try{await screen.orientation?.lock?.('landscape');}catch{}}
      else toast('当前浏览器不支持全屏按钮，请横置设备游玩。');
      return;
    }
    if(action==='close')return closeModal();
    if(action==='home'){if(modal.open)closeModal();return home();}
    if(action==='new') {
      if(library.data.slots.auto) return confirmAction('开始新的三十天','最近自动进度将被更新，手动存档和结局收藏会保留。','new-confirm');
      action='new-confirm';
    }
    if(action==='new-confirm'){if(modal.open)closeModal();state=engine.fresh();inGame=true;saveAndRender();return;}
    if(action==='continue'){state=library.load('auto');inGame=true;render();return;}
    if(action==='next'){stop();advance();return;}
    if(action==='choose') {stop();state=engine.choose(state,el.dataset.id);saveAndRender();return;}
    if(action==='menu')return menu();
    if(action==='save')return saveMenu();
    if(action==='load')return saveMenu(true);
    if(action==='settings')return showSettings();
    if(action==='collection')return collection();
    if(action==='history'&&inGame)return showHistory();
    if(action==='auto'||action==='skip') {const active=mode===action;stop();if(!active)mode=action;render();return;}
    if(action==='quick-save') {
      pendingSlot='quick';pendingLabel=label();
      if(library.data.slots.quick)return confirmAction('覆盖快速存档','将用当前进度替换快速存档。','save-confirm');
      action='save-confirm';
    }
    if(action==='save-slot'){
      pendingSlot=el.dataset.slot;pendingLabel=document.querySelector('#save-label')?.value.trim() || label();
      if(library.data.slots[pendingSlot])return confirmAction('覆盖存档',`将替换“${esc(library.data.slots[pendingSlot].label)}”。`,'save-confirm');
      action='save-confirm';
    }
    if(action==='save-confirm'){const ok=library.save(pendingSlot,state,pendingLabel);if(modal.open)closeModal();if(ok)toast('进度已保存。');return;}
    if(action==='load-slot'||action==='quick-load') {
      pendingSlot=action==='quick-load'?'quick':el.dataset.slot;
      engine.unpack(library.data.slots[pendingSlot]);
      if(inGame)return confirmAction('读取存档','回到这份记录。当前进度仍可在其他手动存档位保留。','load-confirm');
      action='load-confirm';
    }
    if(action==='load-confirm'){state=library.load(pendingSlot);inGame=true;closeModal();saveAndRender();toast('已读取存档。');return;}
    if(action==='export') {
      const data=engine.pack(state,label());
      const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download=`30天情侣计划-D${engine.stats(state).day}-${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已导出当前进度。');return;
    }
    if(action==='import-confirm'){state=engine.unpack(imported);imported=null;inGame=true;closeModal();saveAndRender();toast('已导入存档，手动存档位保持不变。');return;}
    if(action==='replay-ending') {
      const key=el.dataset.key;
      if(!library.data.unlocked.includes(key))return;
      openModal(esc(story.endings[key].title),`<div class="history">${story.endings[key].events.flatMap(e=>e.beats||[e]).map(e=>`<article class="history-row"><strong>${e.channel?`${esc(e.channel)} · `:''}${esc(e.speaker||'旁白')}</strong><p>${esc(e.text)}</p></article>`).join('')}</div>`,true);
    }
  } catch(err) {toast(err.message || '未能完成操作，请重试。');}
}
let dialoguePress = null;
document.addEventListener('pointerdown',e=>{
  const box=e.target.closest('.dialogue-box');
  dialoguePress=box?{box,x:e.clientX,y:e.clientY,moved:false}:null;
});
document.addEventListener('pointermove',e=>{
  if(dialoguePress && Math.hypot(e.clientX-dialoguePress.x,e.clientY-dialoguePress.y)>8)dialoguePress.moved=true;
});
document.addEventListener('pointercancel',()=>{if(dialoguePress)dialoguePress.moved=true;});
document.addEventListener('scroll',e=>{
  if(dialoguePress && e.target instanceof Element && e.target.closest('.dialogue-body'))dialoguePress.moved=true;
},true);
document.addEventListener('click',e=>{
  const press=dialoguePress;dialoguePress=null;
  const el=e.target.closest('[data-action]');
  if(el){if(!el.disabled)handle(el.dataset.action,el);return;}
  const box=e.target.closest('.dialogue-box');
  if(!box || !inGame || modal.open || e.defaultPrevented || (press?.box===box && press.moved))return;
  if(e.target.closest('button,a,input,select,textarea,label,.reading-text,.chosen-line,.speaker-label'))return;
  if(!window.getSelection()?.isCollapsed)return;
  const next=box.querySelector('[data-action="next"]');
  if(next && !next.disabled)handle('next');
});
document.addEventListener('change',async e=>{
  if(e.target.closest('#settings-form')){
    const f=new FormData(document.querySelector('#settings-form'));
    library.data.settings={fontSize:Number(f.get('fontSize')),theme:f.get('theme'),autoDelay:Number(f.get('autoDelay'))};library.commit();settings();
  }
  if(e.target.id==='import-save'){
    try {
      const file=e.target.files[0];if(!file)return;
      if(file.size>1024*1024)throw Error('存档文件过大，请选择游戏导出的 JSON 存档。');
      const parsed=JSON.parse(await file.text());const checked=engine.unpack(parsed);imported=parsed;
      confirmAction('导入存档',`将打开 D${engine.stats(checked).day} 的记录。手动存档和已收录结局会保留。`,'import-confirm');
    }catch(err){toast(err instanceof SyntaxError?'文件不是有效的 JSON 存档。':err.message);}
  }
});
document.addEventListener('keydown',e=>{
  if(!inGame||modal.open||e.altKey||e.ctrlKey||e.metaKey||/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName))return;
  const key=e.key.toLowerCase();
  if(key===' '||key==='arrowright'){e.preventDefault();handle('next');}
  else if(key==='s')handle('save');else if(key==='l')handle('load');else if(key==='h')handle('history');else if(key==='escape')handle('menu');
});
modal.addEventListener('close',()=>{focusReturn?.isConnected&&focusReturn.focus();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();updateModeButtons();}});
window.addEventListener('storage',e=>{
  if(e.key===STORAGE_KEY && library){
    stop();updateModeButtons();library.pauseWrites();
    toast('另一标签页更新了存档。本页已暂停写入；可先导出当前进度，再刷新读取最新存档。');
  }
});

async function boot(){
  try{
    const [s,r,a,c]=await Promise.all([fetch(new URL('./story.json',import.meta.url)),fetch(new URL('./rules.json',import.meta.url)),fetch(new URL('./stage-assets.json?v=5',import.meta.url)),fetch(new URL('./stage-cues.json?v=5',import.meta.url))]);
    if(!s.ok||!r.ok||!a.ok||!c.ok)throw Error('剧情或场景文件未能加载，请刷新页面。');
    story=await s.json();rules=await r.json();stageAssets=await a.json();stageCues=await c.json();engine=createEngine(story,rules);
    let storage;try{storage=window.localStorage;}catch{storage={getItem(){throw Error();},setItem(){throw Error();}};}
    library=createLibrary(storage,engine,toast);state=engine.fresh();
    let resumed=false;
    try{
      const handoff=JSON.parse(sessionStorage.getItem(UPDATE_HANDOFF)||'null');
      if(handoff){
        state=engine.unpack(handoff.save);
        if(handoff.librarySnapshot)Object.assign(library.data,handoff.librarySnapshot);
        if(handoff.settings)library.data.settings=handoff.settings;
        inGame=true;saveAndRender();resumed=true;
        sessionStorage.removeItem(UPDATE_HANDOFF);
      }
    }catch{toast('更新已完成，原存档仍保留。请从读取存档继续。');}
    if(!resumed){settings();home();}
    initializeUpdates();
  }catch(err){app.innerHTML=`<main class="boot-error"><h1>通告夹还没打开</h1><p>${esc(err.message)}</p><p>请通过项目自带的本地服务打开，然后刷新页面。</p>${button('reload','重新加载')}</main>`;document.querySelector('[data-action="reload"]')?.addEventListener('click',()=>location.reload());}
}
boot();
