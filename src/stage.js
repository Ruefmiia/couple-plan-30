// Presentation is derived from the current beat, never stored in save data.
// Loading a save restores the same clothing, CG and cat without replaying cues.
export const CHARACTER_NAMES = {perth:'Perth', santa:'Santa', add:'Add', mother:'Santa妈妈', c:'C', nin:'Nin', may:'May'};
const guests = {Add:'add', '妈妈':'mother', C:'c', Nin:'nin', May:'may'};

export function resolveStage({story, state, event, ending, cues}) {
  const main = state.cursor < story.events.length || event.type === 'episodeEnd';
  const timeline = main ? story.events : story.endings[ending].events;
  const index = main ? state.cursor : state.endingCursor - 1;
  const chapter = story.events.slice(0, state.cursor + 1).filter(e => e.type === 'chapter').at(-1);
  const place = story.events.slice(0, state.cursor + 1).filter(e => e.type === 'chapter' || e.type === 'scene').at(-1);
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
  for (const range of cues.ranges) {
    if ((range.scope || 'main') !== (main ? 'main' : ending)) continue;
    const from = timeline.findIndex(e => e.id === range.from), to = timeline.findIndex(e => e.id === range.to);
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
