(() => {
  'use strict';
  const C = YTSTCore;
  let prefs = {...C.defaults}, videoId = '', info = {}, version = 0, generation = 0;
  let host, shadow, chinese, original, badge, hiddenStyle, currentVideo;
  let cues = [], translations = new Map(), domCache = new Map(), busy = false, retryAt = 0;
  let lastNative = '', lastChange = 0, pendingSince = 0;
  let status = '正在等待 YouTube 视频。', configuring = false, reconfigure = false, ready = false;
  const pending = new Map();
  const send = m => chrome.runtime.sendMessage({target: 'background', ...m});
  function idFromUrl() { const u = new URL(location.href); return u.pathname === '/watch' ? u.searchParams.get('v') || '' : /^\/shorts\/([^/?]+)/.exec(u.pathname)?.[1] || ''; }
  function video() { return document.querySelector('#movie_player video') || document.querySelector('ytd-reel-video-renderer[is-active] video'); }
  function bridge(type, data = {}) {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('YouTube 播放器响应超时，请刷新页面。')); }, 13000);
      pending.set(id, {resolve, reject, timer});
      window.postMessage({channel: 'ytst-v1', direction: 'request', id, type, ...data}, location.origin);
    });
  }
  window.addEventListener('message', e => {
    if (e.source !== window || e.origin !== location.origin || e.data?.channel !== 'ytst-v1' || e.data?.direction !== 'response') return;
    const job = pending.get(e.data.id); if (!job) return;
    clearTimeout(job.timer); pending.delete(e.data.id);
    e.data.error ? job.reject(new Error(e.data.error)) : job.resolve(e.data.result);
  });
  function mount() {
    const player = document.querySelector('#movie_player') || video()?.parentElement;
    if (!player) return;
    if (host?.parentElement === player) return;
    host?.remove(); hiddenStyle?.remove();
    host = document.createElement('div'); host.id = 'ytst-overlay';
    host.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:60;';
    shadow = host.attachShadow({mode: 'open'});
    shadow.innerHTML = `<style>
      :host{font-family:system-ui,"Microsoft YaHei",sans-serif;color:#fff} .lines{position:absolute;left:6%;right:6%;bottom:var(--bottom,14%);text-align:center;line-height:1.4;white-space:pre-wrap;overflow-wrap:anywhere;pointer-events:none}
      .zh,.original{width:fit-content;max-width:100%;margin:4px auto;padding:4px 12px;border-radius:4px;background:rgba(0,0,0,.8);text-shadow:0 1px 2px #000}
      .zh{font-size:var(--size,26px);font-weight:600}.original{font-size:calc(var(--size,26px) * .66);color:#eee}
      .zh:empty,.original:empty{display:none}.status{position:absolute;top:12px;left:12px;font-size:12px;padding:5px 9px;border-radius:3px;background:rgba(0,0,0,.75);max-width:65%;opacity:0;transition:opacity .2s}
      :host(.show-status) .status{opacity:1} :host([hidden]){display:none}
    </style><div class="status"></div><div class="lines"><div class="zh"></div><div class="original"></div></div>`;
    chinese = shadow.querySelector('.zh'); original = shadow.querySelector('.original'); badge = shadow.querySelector('.status');
    player.append(host);
    hiddenStyle = document.createElement('style'); hiddenStyle.textContent = '#movie_player.ytst-hides-native .ytp-caption-window-container{visibility:hidden!important}';
    document.head.append(hiddenStyle); style(); setStatus(status);
  }
  function style() {
    if (!host) return;
    host.style.setProperty('--size', `${Math.max(16, Math.min(48, Number(prefs.fontSize) || 26))}px`);
    host.style.setProperty('--bottom', `${Math.max(5, Math.min(45, Number(prefs.bottom) || 14))}%`);
    host.hidden = !prefs.enabled;
    if (!prefs.bilingual && original) original.textContent = '';
  }
  let statusTimer;
  function setStatus(message) {
    status = String(message);
    if (!badge) return;
    badge.textContent = status; host.classList.add('show-status'); clearTimeout(statusTimer);
    statusTimer = setTimeout(() => host?.classList.remove('show-status'), 5500);
  }
  function render(text = '', source = '') { if (chinese) chinese.textContent = C.clean(text); if (original) original.textContent = prefs.bilingual ? C.clean(source) : ''; }
  function hideNative(hide) { document.querySelector('#movie_player')?.classList.toggle('ytst-hides-native', hide); }
  function state() { const v = video(); return {videoId: idFromUrl(), title: info.title || document.title, ad: !!document.querySelector('#movie_player.ad-showing')}; }
  function invalidate() {
    generation++; render(); lastNative = ''; pendingSince = 0;
  }
  function watchVideo() {
    const v = video(); if (v === currentVideo) return;
    if (currentVideo) for (const type of ['seeking', 'pause', 'play', 'ended']) currentVideo.removeEventListener(type, invalidate);
    currentVideo = v;
    if (v) for (const type of ['seeking', 'pause', 'play', 'ended']) v.addEventListener(type, invalidate);
    generation++;
  }
  async function reset() {
    version++; ready = false; invalidate(); cues = []; translations.clear(); domCache.clear(); busy = false; retryAt = 0; hideNative(false);
    send({type: 'CANCEL'}).catch(() => {});
    await bridge('RESTORE').catch(() => {});
  }
  async function configure() {
    if (configuring) { reconfigure = true; return; }
    configuring = true;
    try {
      await reset(); const localVersion = version; videoId = idFromUrl(); mount(); watchVideo();
      if (!prefs.enabled || !videoId) { setStatus(prefs.enabled ? '请打开 YouTube 视频。' : '字幕翻译已关闭。'); return; }
      setStatus('正在读取视频字幕轨道…');
      for (let i = 0; i < 5; i++) {
        info = await bridge('INFO');
        if (localVersion !== version || idFromUrl() !== videoId) return;
        if (info.videoId === videoId && info.tracks?.length) break;
        await new Promise(r => setTimeout(r, 700));
      }
      if (info.videoId !== videoId) { setStatus('播放器尚未就绪，请点击扩展中的“重新读取字幕”。'); return; }
      const chineseTrack = C.selectTrack(info.tracks || [], 'auto', true);
      const selected = prefs.mode === 'youtube' && chineseTrack ? chineseTrack : C.selectTrack(info.tracks || [], 'auto', false);
      if (!selected) { setStatus('视频没有可用字幕；请选择有人工字幕／自动生成字幕的视频。'); return; }
      const result = await bridge('SELECT', {videoId, track: selected, target: prefs.mode === 'youtube' && !chineseTrack});
      if (localVersion !== version || idFromUrl() !== videoId) return;
      if (!result.confirmed) { setStatus('未能确认字幕语言。请在 YouTube 齿轮菜单中手动选择字幕，再点“重新读取字幕”。'); return; }
      ready = true;
      if (prefs.mode === 'youtube') { hideNative(true); setStatus(`简体中文字幕已选择（${chineseTrack ? '原生中文轨道' : 'YouTube 自动翻译'}）。`); return; }
      setStatus('正在准备 AI 字幕翻译…');
      try {
        const downloaded = await bridge('CUES', {videoId, track: selected});
        if (localVersion !== version) return;
        cues = C.parseCues(downloaded);
      } catch {}
      if (localVersion !== version) return;
      setStatus(cues.length ? `自动选择原文字幕：${selected.name || selected.languageCode}。AI 翻译已启用，保留人名原拼写。` : `自动选择原文字幕：${selected.name || selected.languageCode}。已切换逐句 AI 翻译，会有 API 延迟。`);
    } catch (e) { setStatus(e.message); }
    finally { configuring = false; if (reconfigure) { reconfigure = false; configure(); } }
  }
  async function translate(items, context) {
    const result = await send({type: 'TRANSLATE', items, context});
    if (!result?.ok) throw new Error(result?.error || '翻译服务不可用。');
    return result.translations;
  }
  async function prefetch(time) {
    if (busy || Date.now() < retryAt || configuring) return;
    const ahead = cues.filter(c => c.end > time && c.start < time + 35 && !translations.has(c.id)).slice(0, 8);
    if (!ahead.length) return;
    busy = true; const localVersion = version;
    try {
      const result = await translate(ahead.map(c => ({id: c.id, text: c.text})), info.title);
      if (version === localVersion) for (const t of result) translations.set(t.id, t.text);
    } catch (e) { if (version === localVersion) { setStatus(e.message); retryAt = Date.now() + 15000; } }
    finally { if (version === localVersion) busy = false; }
  }
  async function translateDOM(text) {
    if (busy || configuring || Date.now() < retryAt || domCache.has(text)) return;
    busy = true; const localVersion = version, localGeneration = generation;
    try {
      const result = await translate([{id: 0, text: text.slice(0, 3000)}], `${info.title || ''}\n前文：${[...domCache.keys()].slice(-2).join(' ')}`);
      if (localVersion !== version) return;
      domCache.set(text, result[0].text); if (domCache.size > 200) domCache.delete(domCache.keys().next().value);
      if (lastNative === text && generation === localGeneration) { render(result[0].text, text); hideNative(true); }
    } catch (e) { if (localVersion === version) { setStatus(e.message); retryAt = Date.now() + 15000; hideNative(false); } }
    finally { if (localVersion === version) busy = false; }
  }
  function tick() {
    if (!chrome.runtime?.id) { hideNative(false); host?.remove(); clearInterval(interval); return; }
    const id = idFromUrl();
    if (id !== videoId && !configuring) configure();
    mount(); watchVideo();
    if (!prefs.enabled || !id) return;
    const v = video(); if (!v || state().ad || v.seeking) { render(); return; }
    if (configuring || !ready) return;
    if (prefs.mode === 'ai' && cues.length) {
      const time = v.currentTime - (Number(prefs.offset) || 0), cue = C.cueAt(cues, time);
      const text = cue && translations.get(cue.id);
      render(text || '', cue?.text || ''); hideNative(!!text); prefetch(time); return;
    }
    const text = C.clean([...document.querySelectorAll('#movie_player .ytp-caption-segment')].map(el => el.textContent).join(' '));
    if (prefs.mode === 'youtube') { render(text); return; }
    if (text !== lastNative) { lastNative = text; lastChange = Date.now(); if (!pendingSince) pendingSince = lastChange; render(domCache.get(text) || '', text); hideNative(domCache.has(text)); }
    if (!text) { render(); pendingSince = 0; return; }
    if (domCache.has(text)) { render(domCache.get(text), text); hideNative(true); return; }
    if (Date.now() - lastChange > 250 || Date.now() - pendingSince > 1000) { pendingSince = 0; translateDOM(text); }
  }
  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (m?.target !== 'content') return;
    if (m.type === 'STATUS') reply({status, videoId: idFromUrl(), tracks: info.tracks?.map(t => ({name: t.name, language: t.languageCode}))});
    if (m.type === 'RELOAD') { configure(); reply({ok: true}); }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.prefs) return;
    const previous = prefs; prefs = C.preferences(changes.prefs.newValue); style();
    if (previous.mode !== prefs.mode || previous.enabled !== prefs.enabled) {
        configure();
    }
  });
  const interval = setInterval(tick, 200);
  window.addEventListener('pagehide', () => { hideNative(false); send({type: 'CANCEL'}).catch(() => {}); });
  chrome.storage.sync.get('prefs').then(data => { prefs = C.preferences(data.prefs); configure(); });
})();
