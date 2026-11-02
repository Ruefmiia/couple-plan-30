export const STORAGE_KEY = 'couple-plan-30.library.v1';
export function createLibrary(storage, engine, onError = () => {}) {
  let data = {slots: {}, unlocked: [], read: [], settings: {fontSize: 19, theme: 'light', autoDelay: 5}};
  let blocked = false;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.slots || typeof parsed.slots !== 'object') throw Error();
      data.slots = parsed.slots;
      data.unlocked = Array.isArray(parsed.unlocked) ? parsed.unlocked.filter(x => ['官宣','续约','穿帮','和平分手','没盖章'].includes(x)) : [];
      data.read = Array.isArray(parsed.read) ? parsed.read.filter(x => typeof x === 'string').slice(-5000) : [];
      if (parsed.settings) {
        data.settings = {fontSize: [17,19,22,25].includes(parsed.settings.fontSize) ? parsed.settings.fontSize : 19, theme: parsed.settings.theme === 'dark' ? 'dark' : 'light', autoDelay: [3,5,8].includes(parsed.settings.autoDelay) ? parsed.settings.autoDelay : 5};
      }
    }
  } catch { blocked = true; onError('无法读取浏览器存档。已暂停写入以保留原数据；可继续试玩并导出存档。'); }
  function commit() {
    if (blocked) { onError('本次会话无法写入浏览器，请使用“导出当前进度”保存。'); return false; }
    try { storage.setItem(STORAGE_KEY, JSON.stringify(data)); return true; }
    catch { onError('浏览器未能保存进度，请导出当前进度备份。'); return false; }
  }
  function save(slot, state, label = '') {
    const entry = engine.pack(state, label);
    data.slots[slot] = entry;
    return commit();
  }
  function load(slot) {
    const entry = data.slots[slot];
    if (!entry) throw new Error('这个存档位还是空的。');
    return engine.unpack(entry);
  }
  function unlock(key) { if (!data.unlocked.includes(key)) {data.unlocked.push(key); commit();} }
  function markRead(id) { if (id && !data.read.includes(id)) {data.read.push(id); commit();} }
  return {data, save, load, unlock, markRead, commit, canWrite:()=>!blocked, pauseWrites() {blocked=true;}};
}
