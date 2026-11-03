export const SAVE_VERSION = 1;
export const GAME_ID = 'couple-plan-30-perth';
const clamp = (v, [min, max]) => Math.max(min, Math.min(max, v));

export function createEngine(story, rules) {
  const nodes = new Map(rules.nodes.map(n => [n.id, n]));
  const choicePositions = story.events.flatMap((e, i) => e.type === 'choice' ? [i] : []);
  const options = new Map(rules.nodes.flatMap(n => n.options.map(o => [o.id, o])));
  const fresh = () => ({ cursor: 0, choices: [], result: false, endingCursor: 0, complete: false });
  function stats(state, before = Infinity) {
    let acting = rules.initial.acting, heart = rules.initial.heart, rises = 0;
    const flags = new Set();
    state.choices.forEach((id, i) => {
      if (choicePositions[i] >= before) return;
      const o = options.get(id), old = heart;
      acting = clamp(acting + o.actingDelta, rules.bounds.acting);
      heart = clamp(heart + o.heartDelta, rules.bounds.heart);
      if (heart > old) rises++;
      for (const f of o.flags || []) flags.add(f);
    });
    const chapter = story.events.slice(0, Math.min(state.cursor + 1, story.events.length)).filter(e => e.type === 'chapter').at(-1);
    const day = chapter?.day || 1;
    return { acting, heart, rises, flags: [...flags], day,
      heartVisible: day >= rules.ui.heartRevealNotBeforeDay && rises >= rules.ui.heartRevealAfterActualRises };
  }
  function ending(state) {
    const {acting: a, heart: t, flags} = stats(state);
    if (a >= rules.thresholds.acting) return t >= rules.thresholds.heart ? '官宣' : '续约';
    if (t >= rules.thresholds.heart) return rules.hiddenRequiredFlags.every(f => flags.includes(f)) ? '没盖章' : '穿帮';
    return '和平分手';
  }
  function matches(e, state, i = state.cursor) {
    if (!e.when) return true;
    const w = e.when;
    if (w.choice && !state.choices.includes(w.choice)) return false;
    const s = stats(state, i);
    return !(w.minHeart != null && s.heart < w.minHeart || w.maxHeart != null && s.heart > w.maxHeart);
  }
  function settle(state) {
    while (state.cursor < story.events.length && !matches(story.events[state.cursor], state)) state.cursor++;
    return state;
  }
  function paragraph(state) {
    if (state.cursor >= story.events.length) {
      if (story.release?.throughDay < 30) return {type:'episodeEnd', title:'第一期 · 本期已完'};
      const key = ending(state), data = story.endings[key];
      if (state.complete) return {type: 'finished', key, title: data.title};
      if (state.endingCursor === 0) return {type: 'ending', key, title: data.title};
      return data.events[state.endingCursor - 1];
    }
    const event = story.events[state.cursor];
    if (event.type === 'choice' && state.result) {
      const option = options.get(state.choices.at(-1));
      return {type: 'result', id: `${event.id}-result`, text: option.result.replace(/〔M[123]〕/g, '').trim(), chosen: option.text, beats:option.resultBeats};
    }
    return event.type === 'choice' ? {...event, node: nodes.get(event.nodeId)} : event;
  }
  function atBeat(event, index=0) {
    if (!event.beats?.length) return event;
    const {beats, ...base} = event, beat=beats[index];
    return {...base,...beat,speaker:beat.speaker,channel:beat.channel,type:base.type==='result'?'result':beat.type,speechType:beat.type,
      id:index?`${base.id}:beat:${index}`:base.id,originId:base.id,
      chosen:index?undefined:base.chosen};
  }
  function current(state) {return atBeat(paragraph(state),state.beat||0);}
  function next(state) {
    if (state.complete || ['choice','episodeEnd'].includes(current(state).type)) return state;
    const s = structuredClone(state);
    delete s.textOffset;
    if ((s.beat||0)+1 < (paragraph(s).beats?.length||1)) {
      s.beat=(s.beat||0)+1;
      return s;
    }
    delete s.beat;
    if (s.cursor >= story.events.length) {
      s.endingCursor++;
      if (s.endingCursor > story.endings[ending(s)].events.length) s.complete = true;
    } else { s.cursor++; s.result = false; }
    return settle(s);
  }
  function choose(state, id) {
    const event = current(state);
    if (event.type !== 'choice' || !event.node.options.some(o => o.id === id)) throw new Error('该选项不属于当前选择点。');
    const s = structuredClone(state);
    s.choices.push(id); s.result = true; delete s.beat; delete s.textOffset;
    return s;
  }
  function validate(value) {
    if (!value || typeof value !== 'object') throw new Error('存档格式不正确。');
    const {cursor, choices, result, endingCursor, complete} = value;
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > story.events.length || !Array.isArray(choices) || typeof result !== 'boolean' || typeof complete !== 'boolean' || !Number.isInteger(endingCursor) || endingCursor < 0) throw new Error('存档进度不正确。');
    const expected = choicePositions.filter(p => p < cursor).length + (result ? 1 : 0);
    if (choices.length !== expected || choices.some((id, i) => !rules.nodes[i]?.options.some(o => o.id === id))) throw new Error('存档选项记录不完整或顺序不正确。');
    if (result && story.events[cursor]?.type !== 'choice') throw new Error('存档选择点不正确。');
    if (cursor < story.events.length && (endingCursor !== 0 || complete)) throw new Error('存档结局状态不正确。');
    const clean = {cursor, choices: [...choices], result, endingCursor, complete};
    if (cursor === story.events.length) {
      if (story.release?.throughDay < 30) {
        if (result || endingCursor !== 0 || complete) throw new Error('本期尚未开放结局，存档状态不正确。');
      } else {
        const count = story.endings[ending(clean)].events.length;
        if (endingCursor > count + 1 || complete !== (endingCursor === count + 1)) throw new Error('存档结局进度不正确。');
      }
    }
    if (cursor < story.events.length && !matches(story.events[cursor], clean)) throw new Error('存档包含不属于本路线的剧情。');
    const beat=value.beat??0;
    if(!Number.isInteger(beat)||beat<0||beat>=(paragraph(clean).beats?.length||1))throw new Error('存档对白位置不正确。');
    if(beat)clean.beat=beat;
    // A reading offset is optional in older saves and specific to this beat.
    if (Number.isInteger(value.textOffset) && value.textOffset > 0) {
      const text = current(clean).text || '';
      if (value.textOffset < text.length && !/[\uDC00-\uDFFF]/.test(text[value.textOffset])) {
        clean.textOffset = value.textOffset;
      }
    }
    return clean;
  }
  function holdLaterProgress(value) {
    const limits = story.release?.heldProgress;
    if (!limits || !(value?.cursor > story.events.length)) return null;
    const {cursor, choices, result, endingCursor, complete, beat} = value;
    if (!Number.isInteger(cursor) || cursor > limits.maxCursor ||
        !Array.isArray(choices) || choices.length > limits.maxChoices || choices.some(id => typeof id !== 'string' || !/^N\d{2}-\d+$/.test(id)) ||
        typeof result !== 'boolean' || endingCursor !== 0 || complete !== false ||
        (beat !== undefined && (!Number.isInteger(beat) || beat < 0)) ||
        (cursor === limits.maxCursor && (result || beat))) throw new Error('存档进度不正确。');
    const heldProgress = {cursor, choices:[...choices], result, endingCursor, complete};
    if (beat !== undefined) heldProgress.beat = beat;
    if (Number.isInteger(value.textOffset) && value.textOffset > 0) heldProgress.textOffset = value.textOffset;
    // Show the released boundary while retaining the original position and
    // choices in the save format that the expanded edition already reads.
    const visible = validate({...fresh(), cursor:story.events.length, choices:choices.slice(0, choicePositions.length)});
    return {...visible, heldProgress};
  }
  function pack(state, label = '') {
    const savedState = state.heldProgress ? holdLaterProgress(state.heldProgress)?.heldProgress : validate(state);
    if (!savedState) throw new Error('存档进度不正确。');
    return {game: GAME_ID, saveVersion: SAVE_VERSION, storyVersion: story.version, savedAt: new Date().toISOString(), label: String(label).slice(0, 60), state: savedState};
  }
  function unpack(save) {
    if (save?.game !== GAME_ID || save.saveVersion !== SAVE_VERSION || save.storyVersion !== story.version) throw new Error('这不是兼容的《30天情侣计划》存档。');
    return holdLaterProgress(save.state) ?? validate(save.state);
  }
  function history(state) {
    const rows = [];
    const push=(event,limit=Infinity)=>{
      const count=event.beats?.length||1;
      for(let n=0;n<Math.min(count,limit);n++)rows.push(atBeat(event,n));
    };
    story.events.slice(0, Math.min(state.cursor + 1, story.events.length)).forEach((e, i) => {
      if (!matches(e, state, i)) return;
      if (e.type === 'choice') {
        const idx = choicePositions.indexOf(i), o = options.get(state.choices[idx]);
        if (o) push({type:'result',id:`${e.id}-result`,text:o.result.replace(/〔M[123]〕/g,''),chosen:o.text,beats:o.resultBeats},i===state.cursor?(state.beat||0)+1:Infinity);
      } else push(e,i===state.cursor?(state.beat||0)+1:Infinity);
    });
    if (state.cursor >= story.events.length && !(story.release?.throughDay < 30)) story.endings[ending(state)].events.slice(0,state.endingCursor).forEach((e,i)=>push(e,i===state.endingCursor-1?(state.beat||0)+1:Infinity));
    return rows;
  }
  return { fresh, stats, ending, current, next, choose, validate, pack, unpack, history, settle };
}
