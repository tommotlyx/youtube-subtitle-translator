(function (root) {
  'use strict';
  const defaults = {enabled: true, mode: 'youtube', bilingual: true, fontSize: 26, bottom: 14, offset: 0};
  function clean(text) { return String(text || '').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim(); }
  function languageMatch(actual, requested) { return actual === requested || actual.split('-')[0] === requested; }
  function selectTrack(tracks, language, chinese) {
    let available = tracks.filter(t => typeof t.languageCode === 'string');
    if (chinese) available = available.filter(t => /^zh(?:-Hans|-CN)?$/i.test(t.languageCode));
    else if (language !== 'auto') available = available.filter(t => languageMatch(t.languageCode, language));
    if (!chinese && language === 'auto') {
      const original = available.filter(t => !t.translationLanguage);
      return original.find(t => t.isDefault) || original.find(t => t.kind !== 'asr') || original[0] || available[0] || null;
    }
    return available.find(t => t.kind !== 'asr' && !t.translationLanguage) || available[0] || null;
  }
  function parseCues(data) {
    const events = data && Array.isArray(data.events) ? data.events : [];
    const cues = [];
    for (const e of events) {
      if (!Array.isArray(e.segs) || !Number.isFinite(e.tStartMs)) continue;
      const text = clean(e.segs.map(s => s.utf8 || '').join(''));
      if (!text) continue;
      const start = e.tStartMs / 1000;
      const end = start + Math.max(0.15, (e.dDurationMs || 3000) / 1000);
      const last = cues[cues.length - 1];
      // Rolling ASR windows: later complete text supersedes the earlier partial window.
      if (last && last.start === start) { last.text = text; last.end = end; }
      else cues.push({id: cues.length, start, end, text});
    }
    cues.sort((a, b) => a.start - b.start);
    cues.forEach((c, i) => { c.id = i; if (cues[i + 1]) c.end = Math.min(c.end, cues[i + 1].start); });
    return cues;
  }
  function cueAt(cues, time) {
    let lo = 0, hi = cues.length - 1, index = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (cues[mid].start <= time) { index = mid; lo = mid + 1; } else hi = mid - 1; }
    return index >= 0 && time < cues[index].end ? cues[index] : null;
  }
  function apiBase(value) {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw new Error('API 地址必须为 HTTPS，且不能含用户名、密码、查询参数或片段。');
    return u.href.replace(/\/+$/, '');
  }
  function parseTranslation(value, items) {
    const stripped = String(value).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const data = JSON.parse(stripped);
    if (!Array.isArray(data.translations)) throw new Error('翻译服务没有返回 translations 数组。');
    const map = new Map(data.translations.map(t => [String(t.id), clean(t.text)]));
    const source = items.map(item => item.text).join('\n');
    const names = Array.isArray(data.names) ? data.names.filter(n => typeof n.original === 'string' && typeof n.translated === 'string' && n.original.length >= 2 && n.original.length <= 100 && n.translated.length >= 2 && n.translated.length <= 100 && source.includes(n.original)).slice(0, 50) : [];
    return items.map(item => {
      const text = map.get(String(item.id));
      if (!text || text.length > 5000) throw new Error('翻译结果缺少字幕，或内容过长。请检查模型是否遵循 JSON 格式。');
      let restored = text;
      for (const name of names) if (name.original !== name.translated) restored = restored.split(name.translated).join(name.original);
      return {id: item.id, text: restored};
    });
  }
  function preferences(value) {
    const result = Object.fromEntries(Object.keys(defaults).map(key => [key, value?.[key] ?? defaults[key]]));
    if (!['youtube', 'ai'].includes(result.mode)) result.mode = 'youtube';
    return result;
  }
  const api = {defaults, clean, selectTrack, parseCues, cueAt, apiBase, parseTranslation, preferences};
  root.YTSTCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
