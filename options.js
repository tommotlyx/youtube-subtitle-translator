const $ = id => document.getElementById(id);
const send = m => chrome.runtime.sendMessage({target: 'background', ...m});
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function values() {
  return {base: YTSTCore.apiBase($('base').value.trim()), key: $('key').value.trim(), translationModel: $('translationModel').value.trim()};
}
$('form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const api = values(); if (!api.key || !api.translationModel) throw new Error('请填写密钥和模型名称。');
    const origin = new URL(api.base).origin + '/*';
    const granted = await chrome.permissions.request({origins: [origin]});
    if (!granted) throw new Error('未授权 API 站点，设置尚未保存。');
    await chrome.storage.local.set({api}); status('设置已保存。可点击测试，或返回 YouTube 开始使用。');
  } catch (e) { status(e.message, true); }
});
$('test').addEventListener('click', async () => {
  $('test').disabled = true; status('正在测试已保存的翻译配置…');
  try { const result = await send({type: 'TEST_API'}); if (!result?.ok) throw new Error(result?.error || '测试失败。'); status(`翻译接口连接成功：${result.translations[0].text}`); }
  catch (e) { status(e.message, true); } finally { $('test').disabled = false; }
});
$('clear').addEventListener('click', async () => { await chrome.storage.local.remove('api'); $('key').value = ''; status('本地 API 配置和密钥已删除。'); });
$('show').addEventListener('change', () => { $('key').type = $('show').checked ? 'text' : 'password'; });
chrome.storage.local.get('api').then(({api = {}}) => {
  $('base').value = api.base || 'https://api.openai.com/v1'; $('key').value = api.key || '';
  $('translationModel').value = api.translationModel || 'gpt-4o-mini';
});
