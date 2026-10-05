const $ = id => document.getElementById(id);
let prefs = {...YTSTCore.defaults}, tab, saveTask = Promise.resolve();
function note(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
async function read() {
  try {
    if (!tab?.url?.startsWith('https://www.youtube.com/')) { note('请先打开 YouTube 视频，再点击扩展。'); return; }
    let page; try { page = await chrome.tabs.sendMessage(tab.id, {target: 'content', type: 'STATUS'}); } catch { note('请刷新 YouTube 页面，让扩展加载。'); return; }
    note(page.status || '正在等待字幕。');
  } catch (e) { note(e.message, true); }
}
function save() {
  for (const field of ['enabled', 'mode', 'bilingual', 'fontSize', 'bottom', 'offset']) {
    const el = $(field); prefs[field] = el.type === 'checkbox' ? el.checked : ['fontSize','bottom','offset'].includes(field) ? Number(el.value) : el.value;
  }
  prefs.fontSize = Math.max(16, Math.min(48, prefs.fontSize || 26)); prefs.bottom = Math.max(5, Math.min(45, prefs.bottom || 14)); prefs.offset = Math.max(-10, Math.min(10, prefs.offset || 0));
  const saved = {...prefs};
  saveTask = saveTask.then(() => chrome.storage.sync.set({prefs: saved})); return saveTask;
}
async function action(fn) { try { const result = await fn(); if (result?.ok === false) throw new Error(result.error); } catch (e) { note(e.message, true); } }
$('reload').addEventListener('click', () => action(async () => { await saveTask; await chrome.tabs.sendMessage(tab.id, {target: 'content', type: 'RELOAD'}); note('正在重新读取字幕…'); }));
$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
(async () => {
  const data = await chrome.storage.sync.get('prefs'); prefs = YTSTCore.preferences(data.prefs);
  for (const field of Object.keys(YTSTCore.defaults)) { const el = $(field); if (el.type === 'checkbox') el.checked = prefs[field]; else el.value = prefs[field]; el.addEventListener('change', () => action(save)); }
  [tab] = await chrome.tabs.query({active: true, currentWindow: true}); await read(); setInterval(read, 1800);
})();
