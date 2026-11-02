// Presentation is derived from the current beat, never stored in save data.
// Loading a save restores the same clothing, CG and cat without replaying cues.
export const CHARACTER_NAMES = {perth:'Perth', santa:'Santa', add:'Add', mother:'Santa妈妈', c:'C', nin:'Nin', may:'May'};
const guests = {Add:'add', '妈妈':'mother', C:'c', Nin:'nin', May:'may'};
const stageIndexes=new WeakMap();
function getStageIndex(story,cues) {
  let byCue=stageIndexes.get(story);
  if(!byCue){byCue=new WeakMap();stageIndexes.set(story,byCue);}
  let index=byCue.get(cues);if(index)return index;
  const chapters=[],places=[];let chapter=null,place=null;
  for(const e of story.events){if(e.type==='chapter')chapter=e;if(e.type==='chapter'||e.type==='scene')place=e;chapters.push(chapter);places.push(place);}
  const maps=new Map([['main',new Map(story.events.map((e,i)=>[e.id,i]))]]);
  for(const [key,data] of Object.entries(story.endings))maps.set(key,new Map(data.events.map((e,i)=>[e.id,i])));
  const ranges=cues.ranges.map(r=>({...r,fromIndex:maps.get(r.scope||'main')?.get(r.from)??-1,toIndex:maps.get(r.scope||'main')?.get(r.to)??-1}));
  index={chapters,places,ranges};byCue.set(cues,index);return index;
}

export function resolveStage({story, state, event, ending, cues}) {
  const main = state.cursor < story.events.length || event.type === 'episodeEnd';
  const timeline = main ? story.events : story.endings[ending].events;
  const index = main ? state.cursor : state.endingCursor - 1;
  const lookup=getStageIndex(story,cues),position=Math.min(state.cursor,story.events.length-1);
  const chapter=lookup.chapters[position],place=lookup.places[position];
  const outfit = cues.workDays.includes(chapter?.day) ? 'work' : 'home';
  const stage = {bg: place?.bg || 'BG01', location:place?.location || '公司 · 会议室',
    outfits:{perth:outfit, santa:outfit}, cast:['perth','santa'], cg:null, cat:null, reaction:null, prop:null, timeframe:'present'};
  if ((event.speechType||event.type) === 'dialogue' && !event.channel && guests[event.speaker]) stage.cast = [guests[event.speaker], 'santa'];
  const apply = cue => {
    if (!cue) return;
    const {outfits, beatSteps=[], ...rest} = cue;
    Object.assign(stage, rest);
    if (outfits) Object.assign(stage.outfits, outfits);
    for (const step of beatSteps) {
      const beat=state.beat||0;
      if(beat>=step.fromBeat && (step.toBeat==null||beat<=step.toBeat))apply(step.stage);
    }
  };
  for (const range of lookup.ranges) {
    if ((range.scope || 'main') !== (main ? 'main' : ending)) continue;
    const from=range.fromIndex,to=range.toIndex;
    if (index===from && (state.beat||0)<(range.fromBeat||0)) continue;
    if (index===to && range.toBeat!=null && (state.beat||0)>range.toBeat) continue;
    if (from >= 0 && to >= from && index >= from && index <= to) apply(range.stage);
  }
  apply(cues.events[event.originId||event.id]);
  if (event.type === 'result') apply(cues.results[state.choices.at(-1)]);
  // Do not let an illustration from a result leak into the next beat or ending.
  if (event.type === 'choice' || event.type === 'chapter' || event.type === 'ending' || event.type === 'finished') stage.reaction = null;
  if (stage.cg) stage.reaction = null;
  if (['chapter','scene','ending','finished'].includes(event.type)) stage.prop = null;
  if (stage.prop) {
    const {afterBeat=0, steps=[], ...prop}=stage.prop;
    const beat=state.beat||0;
    stage.prop=beat<afterBeat?null:{...prop,...steps.filter(step=>step.fromBeat<=beat).at(-1)};
    if(stage.prop)delete stage.prop.fromBeat;
  }
  return stage;
}

export function characterArt(assets, key, outfit = 'work') {
  return assets.outfits?.[key]?.[outfit] || assets.characters[key].normal;
}

export function artFiles(assets) {
  return [...new Set([...Object.values(assets.backgrounds),
    ...Object.values(assets.characters).flatMap(x => Object.values(x)),
    ...assets.installed,...Object.values(assets.illustrations||{})])];
}
