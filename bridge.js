(() => {
  'use strict';
  const channel = 'ytst-v1';
  let saved = null, restorePlayer = null;
  const player = () => document.querySelector('#movie_player') || document.querySelector('ytd-player #player');
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  function response(p) { try { return p?.getPlayerResponse?.(); } catch { return null; } }
  function info() {
    const p = player(), r = response(p);
    const id = r?.videoDetails?.videoId || p?.getVideoData?.()?.video_id || '';
    const renderer = r?.captions?.playerCaptionsTracklistRenderer;
    let tracks = renderer?.captionTracks;
    const audio = renderer?.audioTracks?.[renderer?.defaultAudioTrackIndex || 0];
    const defaultIndex = Number.isInteger(audio?.defaultCaptionTrackIndex) ? audio.defaultCaptionTrackIndex : audio?.captionTrackIndices?.[0];
    if (!tracks?.length) { try { tracks = p?.getOption?.('captions', 'tracklist'); } catch {} }
    return {videoId: id, title: r?.videoDetails?.title || document.title.replace(/ - YouTube$/, ''), tracks: (tracks || []).map((t, index) => ({languageCode: t.languageCode, kind: t.kind, vssId: t.vssId, isDefault: index === defaultIndex || t.isDefault === true, translationLanguage: t.translationLanguage, isTranslatable: t.isTranslatable, baseUrl: t.baseUrl, name: t.name?.simpleText || t.name?.runs?.map(r => r.text).join('') || t.languageName || t.languageCode})), live: !!r?.videoDetails?.isLiveContent};
  }
  async function handle(m) {
    const p = player();
    if (m.type === 'INFO') {
      if (p && !info().tracks.length) { p.loadModule?.('captions'); await wait(200); }
      return info();
    }
    if (m.type === 'RESTORE') {
      if (saved && restorePlayer?.isConnected) {
        restorePlayer.setOption?.('captions', 'track', saved.track || {});
        if (!saved.on) restorePlayer.unloadModule?.('captions');
      }
      saved = null; restorePlayer = null; return {};
    }
    if (!p?.setOption) throw new Error('YouTube 播放器尚未就绪。');
    if (m.type === 'SELECT') {
      if (!saved || restorePlayer !== p) { saved = {track: p.getOption?.('captions', 'track'), on: document.querySelector('.ytp-subtitles-button')?.getAttribute('aria-pressed') === 'true'}; restorePlayer = p; }
      p.loadModule?.('captions'); await wait(150);
      const i = info();
      if (i.videoId !== m.videoId) throw new Error('视频已切换，请重试。');
      const chosen = i.tracks.find(t => t.vssId === m.track?.vssId && t.languageCode === m.track?.languageCode);
      if (!chosen) throw new Error('字幕轨道已变化，请重试。');
      const selection = {languageCode: chosen.languageCode, vssId: chosen.vssId, kind: chosen.kind};
      if (m.target) selection.translationLanguage = {languageCode: 'zh-Hans'};
      p.setOption('captions', 'track', selection);
      const button = document.querySelector('.ytp-subtitles-button');
      if (button?.getAttribute('aria-pressed') === 'false') button.click();
      await wait(550);
      const active = p.getOption?.('captions', 'track') || {};
      const confirmed = m.target ? /^zh(?:-Hans|-CN)?$/i.test(active.translationLanguage?.languageCode || active.languageCode || '') : active.languageCode === chosen.languageCode;
      return {confirmed, active: {languageCode: active.languageCode, translation: active.translationLanguage?.languageCode}};
    }
    if (m.type === 'CUES') {
      const i = info();
      if (i.videoId !== m.videoId) throw new Error('视频已切换。');
      const t = i.tracks.find(t => t.vssId === m.track?.vssId && t.languageCode === m.track?.languageCode);
      if (!t?.baseUrl) throw new Error('字幕下载地址不可用。');
      const u = new URL(t.baseUrl);
      if (u.origin !== location.origin || u.pathname !== '/api/timedtext') throw new Error('字幕地址不属于 YouTube timedtext 通道。');
      u.searchParams.set('fmt', 'json3');
      const r = await fetch(u.href, {credentials: 'include', signal: AbortSignal.timeout(10000)});
      if (!r.ok) throw new Error('字幕下载失败。');
      const text = await r.text();
      if (!text || text.length > 10000000) throw new Error('字幕接口没有提供可下载的字幕。');
      return JSON.parse(text);
    }
    throw new Error('未知播放器操作。');
  }
  window.addEventListener('message', async e => {
    if (e.source !== window || e.origin !== location.origin || e.data?.channel !== channel || e.data?.direction !== 'request') return;
    const m = e.data;
    if (!['INFO', 'SELECT', 'CUES', 'RESTORE'].includes(m.type) || typeof m.id !== 'string') return;
    try { window.postMessage({channel, direction: 'response', id: m.id, result: await handle(m)}, location.origin); }
    catch (error) { window.postMessage({channel, direction: 'response', id: m.id, error: String(error.message || error)}, location.origin); }
  });
})();
