importScripts('core.js', 'api.js');
const EXT = chrome.runtime.getURL('');
const youtube = url => /^https:\/\/www\.youtube\.com\/(watch\?|shorts\/)/.test(url || '');
const jobs = new Map();
chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'}).catch(() => {});
async function config() {
  const {api = {}} = await chrome.storage.local.get('api');
  if (!api.key?.trim()) throw new Error('请先在 API 设置中填写密钥。');
  const base = YTSTCore.apiBase(api.base || 'https://api.openai.com/v1');
  if (!await chrome.permissions.contains({origins: [new URL(base).origin + '/*']})) throw new Error('请在 API 设置中保存并授权该服务地址。');
  return {...api, base};
}
async function handle(m, sender) {
  const ui = sender.url?.startsWith(EXT);
  const content = sender.tab && youtube(sender.url);
  if (m.type === 'TRANSLATE' && content) {
    if (!Array.isArray(m.items) || !m.items.length || m.items.length > 12 || m.items.some(i => !['string','number'].includes(typeof i.id) || typeof i.text !== 'string' || i.text.length > 3000)) throw new Error('字幕请求格式无效。');
    const tabId = sender.tab.id;
    if (jobs.has(tabId)) throw new Error('上一次翻译尚未完成。');
    const controller = new AbortController(); jobs.set(tabId, controller);
    try { return {ok: true, translations: await YTSTApi.translate(await config(), m.items, m.context, controller.signal)}; }
    finally { if (jobs.get(tabId) === controller) jobs.delete(tabId); }
  }
  if (m.type === 'CANCEL' && content) { jobs.get(sender.tab.id)?.abort(); jobs.delete(sender.tab.id); return {}; }
  if (!ui) throw new Error('此操作仅供扩展设置界面使用。');
  if (m.type === 'TEST_API') return {ok: true, translations: await YTSTApi.translate(await config(), [{id: 0, text: 'Hello, welcome to this video.'}], 'API connection test')};
  throw new Error('未知操作。');
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m?.target !== 'background') return;
  handle(m, sender).then(reply, e => reply({ok: false, error: e.message || String(e)})); return true;
});
chrome.tabs.onRemoved.addListener(tabId => { jobs.get(tabId)?.abort(); jobs.delete(tabId); });
chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.url && !youtube(change.url)) { jobs.get(tabId)?.abort(); jobs.delete(tabId); } });
