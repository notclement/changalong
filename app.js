/* ChàngAlong (唱 Along) — PWA. Lyrics from LRCLIB, pinyin from pinyin-pro (bundled), song ID from iOS Shazam via a Shortcut. */
{
'use strict';
const VERSION = '0.1.1';
const API = 'https://lrclib.net/api';
const APP_URL = location.origin + location.pathname;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = s => { s = Math.max(0, s | 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const isZh = c => /[㐀-鿿豈-﫿]/.test(c);
const log = (...a) => console.log('[changalong v' + VERSION + ']', new Date().toISOString().slice(5, 19).replace('T', ' '), '|', ...a);
const store = {
  get(k, d) { try { const v = localStorage.getItem('pk.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('pk.' + k, JSON.stringify(v)); } catch (e) { log('storage full', e); } },
};
const PP = () => (window.pinyinPro && window.pinyinPro.pinyin) ? window.pinyinPro : null;

/* ---------- state ---------- */
let song = null;          // {key,title,artist,album,dur,timed,lines,alts}
let mode = 'idle';        // idle | wait | run | tap
let cur = -1, base = 0, t0 = 0, running = false, ended = false, follow = true, followT = 0, seeking = false;
let lastResults = [];
const prefs = { mode: store.get('mode', 'm-both'), size: store.get('size', 30), skin: store.get('skin', 'dark') };

/* ---------- LRC + pinyin ---------- */
function parseLRC(txt) {
  const out = []; let any = false;
  for (const raw of String(txt).split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    const text = raw.replace(/\[[^\]]*\]/g, '').replace(/<\d+:\d+(?:\.\d+)?>/g, '').trim();
    if (!tags.length && /^\s*\[[a-z]+:/i.test(raw)) continue;
    if (tags.length) { any = true; for (const m of tags) out.push({ t: +m[1] * 60 + parseFloat(m[2].replace(':', '.')), text }); }
    else if (text) out.push({ t: null, text });
  }
  if (any) return { timed: true, lines: out.filter(l => l.t != null).sort((a, b) => a.t - b.t).filter(l => l.text) };
  return { timed: false, lines: out.filter(l => l.text) };
}
function toUnits(text) {
  const P = PP(); let arr = null;
  if (P) { try { arr = P.pinyin(text, { type: 'array', toneType: 'symbol', toneSandhi: true, nonZh: 'removed' }); } catch (e) { log('pinyin failed', e); } }
  const units = []; let k = 0, buf = '';
  const flush = () => { if (buf.trim()) units.push({ h: buf.trim(), p: buf.trim(), zh: false }); buf = ''; };
  for (const ch of text) {
    if (isZh(ch)) { flush(); units.push({ h: ch, p: arr && arr[k] ? arr[k] : '?', zh: true }); k++; }
    else if (/[\s，。、！？,.!?；;：:“”"「」『』（）()…~～\-—]/.test(ch)) flush();
    else buf += ch;
  }
  flush(); return units;
}
function readings(ch) { const P = PP(); if (!P) return []; try { return P.pinyin(ch, { multiple: true, type: 'array', toneType: 'symbol' }); } catch (e) { return []; } }

/* ---------- LRCLIB ---------- */
async function api(path) {
  log('GET', path);
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 12000);
  try { const r = await fetch(API + path, { signal: ctl.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(to); }
}
const rank = list => list.filter(r => !r.instrumental && (r.syncedLyrics || r.plainLyrics)).sort((a, b) => (!!b.syncedLyrics - !!a.syncedLyrics));
async function searchQ(q) { return rank(await api('/search?q=' + encodeURIComponent(q))); }
async function findByMeta(title, artist) {
  const clean = s => String(s || '').replace(/[（(\[【].*?[）)\]】]/g, '').replace(/\s*[-–]\s*(live|remaster.*|伴奏|ktv).*$/i, '').trim();
  const tries = [];
  if (title && artist) tries.push('/search?track_name=' + encodeURIComponent(title) + '&artist_name=' + encodeURIComponent(artist));
  if (title && artist) tries.push('/search?q=' + encodeURIComponent(clean(title) + ' ' + clean(artist)));
  if (title) tries.push('/search?q=' + encodeURIComponent(clean(title)));
  for (const p of tries) { const r = rank(await api(p)); if (r.length) return r; }
  return [];
}

/* ---------- views ---------- */
function show(view) {
  $('#browse').hidden = view !== 'browse'; $('#sing').hidden = view !== 'sing';
  $('#nowbar').hidden = !(view === 'browse' && song);
  if (song) $('#nowT').textContent = song.title + (song.artist ? ' · ' + song.artist : '');
  if (view === 'sing' && cur >= 0) requestAnimationFrame(() => scrollToLine(cur, true));
}
function resultRow(r, extra) {
  const synced = !!r.syncedLyrics;
  return '<button class="res" data-id="' + esc(r.id) + '"><span class="art">' + esc((r.trackName || '?').trim().charAt(0)) + '</span><span class="mid"><div class="t">' + esc(r.trackName) + '</div><div class="a">' + esc(r.artistName) + (r.albumName ? ' · ' + esc(r.albumName) : '') + (r.duration ? ' · ' + fmt(r.duration) : '') + '</div></span><span class="badge' + (synced ? ' s' : '') + '">' + (extra || (synced ? 'Synced' : 'Text only')) + '</span></button>';
}
function renderResults(list, q) {
  lastResults = list;
  $('#results').innerHTML = list.length ? '<div class="sec">Results for “' + esc(q) + '”</div>' + list.slice(0, 25).map(r => resultRow(r)).join('')
    : '<p class="msg">No lyrics found for “' + esc(q) + '”. Try the Chinese title, or the singer’s name only.</p>';
}
function renderLists() {
  const fav = store.get('fav', []), hist = store.get('hist', []);
  const row = s => '<button class="res" data-key="' + esc(s.key) + '"><span class="art">' + esc((s.title || '?').charAt(0)) + '</span><span class="mid"><div class="t">' + esc(s.title) + '</div><div class="a">' + esc(s.artist || '') + '</div></span>' + (fav.some(f => f.key === s.key) ? '<span class="badge s">★</span>' : '') + '</button>';
  $('#lists').innerHTML = (fav.length ? '<div class="sec">Favourites</div>' + fav.map(row).join('') : '')
    + (hist.length ? '<div class="sec">Recent</div>' + hist.slice(0, 15).map(row).join('') : '');
}
async function doSearch(q) {
  q = q.trim(); if (!q) return;
  $('#results').innerHTML = '<p class="msg">Searching…</p>';
  try { renderResults(await searchQ(q), q); }
  catch (e) { log('search error', e); $('#results').innerHTML = '<p class="msg">Couldn’t reach the lyrics server. Check your connection and try again.</p>'; }
}

/* ---------- load a song ---------- */
function keyOf(r) { return 'l' + r.id; }
function cacheSong(rec) { store.set('song.' + rec.key, rec); }
function rememberHistory(rec) {
  const h = store.get('hist', []).filter(x => x.key !== rec.key);
  h.unshift({ key: rec.key, title: rec.title, artist: rec.artist }); store.set('hist', h.slice(0, 40));
  const keep = new Set(h.slice(0, 40).map(x => x.key).concat(store.get('fav', []).map(x => x.key)));
  try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith('pk.song.') && !keep.has(k.slice(8))) localStorage.removeItem(k); } } catch (e) {}
}
function recFromLrclib(r) {
  return { key: keyOf(r), title: r.trackName, artist: r.artistName, album: r.albumName, dur: r.duration || 0, lrc: r.syncedLyrics || r.plainLyrics || '' };
}
function openRecord(rec, alts) {
  log('open', rec.key, rec.title, rec.artist);
  cacheSong(rec); rememberHistory(rec);
  const parsed = parseLRC(rec.lrc);
  const ov = store.get('ov.' + rec.key, {});
  song = { ...rec, timed: parsed.timed, alts: alts || null };
  song.lines = parsed.lines.map((l, i) => {
    const u = toUnits(l.text); u.forEach((x, j) => { const o = ov[i + ':' + j]; if (o) { x.p = o; x.fix = true; } });
    return { t: l.t, text: l.text, u };
  });
  song.lines.forEach((l, i) => { const nx = song.lines[i + 1]; l.end = (nx && nx.t - l.t < 8) ? nx.t - 0.15 : l.t + Math.min(5, 0.42 * l.u.length + 0.8); });
  if (song.timed && !song.dur) song.dur = song.lines.at(-1).t + 10;
  $('#sT').textContent = song.title || 'Lyrics';
  $('#sA').textContent = (song.artist || '') + (song.alts && song.alts.length > 1 ? ' · ' + song.alts.length + ' versions' : '');
  $('#bFav').classList.toggle('on', store.get('fav', []).some(f => f.key === song.key));
  $('#tEnd').textContent = song.timed ? fmt(song.dur) : '—';
  $('#seek').disabled = !song.timed;
  renderStage(); cur = -1; ended = false; follow = true;
  if (song.timed) { mode = 'wait'; running = false; base = 0; banner('wait'); }
  else { mode = 'tap'; running = false; go(0); fillLine(0); banner(''); }
  $('#bTap').textContent = song.timed ? 'Tap as the next line starts' : 'Next line';
  show('sing'); renderLists();
  if (!song.lines.length) banner('This entry has no lyric lines.');
}

/* ---------- stage ---------- */
function renderStage() {
  $('#stage').innerHTML = song.lines.map((l, i) => '<div class="ln" data-i="' + i + '">' + l.u.map((u, j) =>
    '<span class="u' + (u.zh ? '' : ' x') + (u.fix ? ' fix' : '') + '" data-j="' + j + '"><b>' + esc(u.p) + '</b>' + (u.zh ? '<i>' + esc(u.h) + '</i>' : '') + '</span>').join('') + '</div>').join('');
  applyPrefs();
}
function applyPrefs() {
  const st = $('#stage'); st.classList.remove('m-py', 'm-both', 'm-hz'); st.classList.add(prefs.mode); st.classList.toggle('wait', mode === 'wait');
  document.documentElement.style.setProperty('--fs', prefs.size + 'px');
  document.documentElement.style.colorScheme = prefs.skin;
  const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = prefs.skin === 'light' ? '#fbf6f1' : '#140d1c';
  $('#size').value = prefs.size; $('#sizeV').textContent = prefs.size;
  for (const b of document.querySelectorAll('#segMode button')) b.setAttribute('aria-pressed', b.dataset.v === prefs.mode);
  for (const b of document.querySelectorAll('#segSkin button')) b.setAttribute('aria-pressed', b.dataset.v === prefs.skin);
}
function go(i) {
  for (const el of $('#stage').children) {
    const k = +el.dataset.i;
    el.className = 'ln' + (k === i ? ' now' : k === i + 1 ? ' next' : k < i ? ' past' : '');
    if (k !== i) for (const s of el.children) s.style.removeProperty('--p');
  }
  cur = i; if (follow) scrollToLine(i);
}
function fillLine(i) { const el = $('#stage').children[i]; if (el) for (const s of el.children) s.style.setProperty('--p', '100%'); }
function scrollToLine(i, instant) {
  const el = $('#stage').children[i]; if (!el) return; const st = $('#stage');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  st.scrollTo({ top: el.offsetTop - st.clientHeight * 0.36, behavior: instant || reduce ? 'auto' : 'smooth' });
}
let lastBanner = null;
function banner(what) {
  if (what === lastBanner) return; lastBanner = what; const b = $('#banner');
  if (what === 'wait') { b.className = 'banner cta'; b.innerHTML = '<b>Tap the line being sung right now.</b><br><span class="muted">Lyrics then scroll in time.</span> <button class="link" id="bTop">Start from the top</button>'; return; }
  b.className = 'banner'; b.innerHTML = what || '';
}
const now = () => running ? base + (performance.now() - t0) / 1000 : base;
function setTime(t) { base = t; t0 = performance.now(); }
function startAt(t) { setTime(t); running = true; ended = false; mode = 'run'; banner(''); applyPrefs(); follow = true; $('#bBack').classList.remove('show'); }
const offKey = () => 'off.' + song.key;
const offset = () => song ? store.get(offKey(), 0) : 0;

function tick() {
  if (song && song.timed && mode === 'run') {
    let t = now();
    if (t > song.dur && !ended) { ended = true; running = false; base = song.dur; banner('Song finished · tap <b>Next song</b> to listen again'); log('ended'); }
    t = Math.min(t, song.dur);
    let i = -1; for (let k = 0; k < song.lines.length; k++) { if (song.lines[k].t <= t + offset()) i = k; else break; }
    const tt = t + offset();
    if (i !== cur) go(i);
    const l = song.lines[i], el = $('#stage').children[i];
    if (l && el) {
      const f = Math.min(1, Math.max(0, (tt - l.t) / (l.end - l.t))), n = l.u.length;
      [...el.children].forEach((s, k) => s.style.setProperty('--p', Math.min(1, Math.max(0, f * n - k)) * 100 + '%'));
    }
    const nx = song.lines[i + 1];
    if (!ended) { if (nx && (i < 0 || tt > l.end) && nx.t - tt > 2.5) banner((i < 0 ? 'Intro' : 'Instrumental') + ' · next line in <b>' + Math.ceil(nx.t - tt) + 's</b>'); else banner(''); }
    $('#tNow').textContent = fmt(t); if (!seeking) $('#seek').value = song.dur ? t / song.dur * 1000 : 0;
  }
  if (!follow && performance.now() > followT) { follow = true; $('#bBack').classList.remove('show'); if (cur >= 0) scrollToLine(cur); }
  requestAnimationFrame(tick);
}
let toastT; function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800); }

/* ---------- sync controls ---------- */
// Offset is stored per song and added to the clock when finding lines; nudge changes it.
function nudge(d) {
  if (!song || !song.timed) return;
  const v = Math.round((offset() + d) * 10) / 10; store.set(offKey(), v);
  toast('Lyrics ' + (v > 0 ? '+' : '') + v.toFixed(1) + ' s'); $('#offV').textContent = v.toFixed(1) + ' s'; log('offset', v);
}
$('#bBehind').onclick = () => nudge(0.5);
$('#bAhead').onclick = () => nudge(-0.5);
function syncToLine(i) {
  const l = song.lines[i]; if (!l) return;
  if (!song.timed) { go(i); fillLine(i); return; }
  startAt(l.t - offset() + 0.25); go(i); toast('Synced to line ' + (i + 1)); log('sync to line', i, l.t);
}
$('#bTap').onclick = () => {
  if (!song) return;
  if (!song.timed) { if (cur < song.lines.length - 1) { go(cur + 1); fillLine(cur); } return; }
  if (mode !== 'run') { syncToLine(0); return; }
  syncToLine(cur + 1);
};
$('#banner').addEventListener('click', e => { if (e.target.id === 'bTop') { startAt(0); go(-1); scrollToLine(0); } });

// tap a line = "this one is being sung now"; press-and-hold a syllable = fix its reading
let holdT = null, held = false;
$('#stage').addEventListener('pointerdown', e => {
  const u = e.target.closest('.u'); held = false; if (!u || u.classList.contains('x')) return;
  holdT = setTimeout(() => { held = true; openReading(u); }, 450);
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => $('#stage').addEventListener(ev, () => clearTimeout(holdT)));
$('#stage').addEventListener('click', e => {
  if (held) { held = false; return; }
  const ln = e.target.closest('.ln'); if (!ln || !song) return;
  syncToLine(+ln.dataset.i);
});
$('#stage').addEventListener('contextmenu', e => e.preventDefault());
function openReading(u) {
  clearTimeout(holdT);
  const i = +u.parentElement.dataset.i, j = +u.dataset.j, unit = song.lines[i].u[j];
  const a = readings(unit.h);
  if (a.length < 2) { toast(unit.h + ' has one reading: ' + unit.p); return; }
  $('#popH').textContent = unit.h;
  $('#popC').innerHTML = a.map(p => '<button aria-pressed="' + (p === unit.p) + '">' + esc(p) + '</button>').join('');
  const pop = $('#pop'), r = u.getBoundingClientRect(); pop.classList.add('show');
  pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.left)) + 'px';
  pop.style.top = Math.min(innerHeight - pop.offsetHeight - 8, r.bottom + 8) + 'px';
  $('#popC').onclick = ev => {
    const b = ev.target.closest('button'); if (!b) return;
    unit.p = b.textContent; unit.fix = true;
    const ov = store.get('ov.' + song.key, {}); ov[i + ':' + j] = unit.p; store.set('ov.' + song.key, ov);
    u.querySelector('b').textContent = unit.p; u.classList.add('fix'); pop.classList.remove('show');
    toast('Saved ' + unit.h + ' → ' + unit.p); log('override', song.key, i, j, unit.p);
  };
}
document.addEventListener('pointerdown', e => { if (!e.target.closest('#pop')) $('#pop').classList.remove('show'); });

// seek + manual scroll
const seek = $('#seek');
seek.oninput = () => { if (!song) return; seeking = true; startAt(seek.value / 1000 * song.dur); $('#tNow').textContent = fmt(now()); };
seek.onchange = () => { seeking = false; };
const pauseFollow = () => { if (!song || mode !== 'run') return; follow = false; followT = performance.now() + 5000; $('#bBack').classList.add('show'); };
$('#stage').addEventListener('wheel', pauseFollow, { passive: true });
$('#stage').addEventListener('touchmove', pauseFollow, { passive: true });
$('#bBack').onclick = () => { follow = true; followT = 0; $('#bBack').classList.remove('show'); scrollToLine(cur); };

/* ---------- sheets ---------- */
function open(id) { closeAll(); $('#veil').classList.add('show'); $(id).classList.add('show'); }
function closeAll() { $('#veil').classList.remove('show'); for (const s of document.querySelectorAll('.sheet')) s.classList.remove('show'); }
$('#veil').onclick = closeAll;
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeAll(); $('#pop').classList.remove('show'); } });
const openSettings = () => { $('#offRow').hidden = !(song && song.timed); $('#offV').textContent = offset().toFixed(1) + ' s'; open('#shSet'); };
$('#bSet1').onclick = openSettings; $('#bSet2').onclick = openSettings;
$('#segMode').onclick = e => { const b = e.target.closest('button'); if (!b) return; prefs.mode = b.dataset.v; store.set('mode', prefs.mode); applyPrefs(); if (cur >= 0) scrollToLine(cur, true); };
$('#segSkin').onclick = e => { const b = e.target.closest('button'); if (!b) return; prefs.skin = b.dataset.v; store.set('skin', prefs.skin); applyPrefs(); };
$('#size').oninput = e => { prefs.size = +e.target.value; store.set('size', prefs.size); applyPrefs(); };
$('#size').onchange = () => { if (cur >= 0) scrollToLine(cur, true); };
$('#bReset').onclick = () => { if (!song) return; store.set(offKey(), 0); $('#offV').textContent = '0.0 s'; toast('Offset reset'); };
$('#bFav').onclick = () => {
  if (!song) return; let f = store.get('fav', []); const on = !f.some(x => x.key === song.key);
  f = on ? [{ key: song.key, title: song.title, artist: song.artist }, ...f] : f.filter(x => x.key !== song.key);
  store.set('fav', f); $('#bFav').classList.toggle('on', on); toast(on ? 'Saved to favourites' : 'Removed from favourites'); renderLists();
};
$('#bSong').onclick = () => {
  if (!song) return;
  const alts = song.alts && song.alts.length > 1 ? song.alts : null;
  $('#verList').innerHTML = alts ? alts.map(r => resultRow(r, keyOf(r) === song.key ? 'Playing' : null)).join('') : '<p class="msg">No other versions found. Use search on the main screen to try a different spelling.</p>';
  open('#shVer');
};
$('#verList').onclick = e => { const b = e.target.closest('.res'); if (!b) return; const r = song.alts.find(x => String(x.id) === b.dataset.id); closeAll(); if (r) openRecord(recFromLrclib(r), song.alts); };
const howUrl = APP_URL + '?title=[T]&artist=[A]';
$('#tplUrl').textContent = howUrl;
$('#bCopyUrl').onclick = async () => { try { await navigator.clipboard.writeText(howUrl); toast('Copied'); } catch (e) { toast('Copy failed: select the text instead'); } };
$('#bHowListen').onclick = () => open('#shHow'); $('#bHowListen2').onclick = () => open('#shHow');
$('#bPaste').onclick = () => open('#shPaste');
$('#bSample').onclick = () => { $('#paste').value = '[00:03.00]你好世界\n[00:07.00]我想和你一起看日落\n[00:11.50]长大以后还会记得\n[00:16.00]这首歌的快乐'; };
$('#bUse').onclick = () => {
  const txt = $('#paste').value.trim(); if (!txt) { toast('Paste some lyrics first'); return; }
  const first = txt.split('\n').map(l => l.replace(/\[[^\]]*\]/g, '').trim()).find(Boolean) || 'My lyrics';
  const key = 'p' + [...txt].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
  closeAll(); openRecord({ key, title: first.slice(0, 16), artist: 'Pasted', lrc: txt, dur: 0 });
};

/* ---------- browse events ---------- */
$('#fSearch').onsubmit = e => { e.preventDefault(); $('#q').blur(); doSearch($('#q').value); };
$('#results').onclick = e => { const b = e.target.closest('.res'); if (!b) return; const r = lastResults.find(x => String(x.id) === b.dataset.id); if (r) openRecord(recFromLrclib(r), lastResults.filter(x => x.trackName === r.trackName || x.artistName === r.artistName)); };
$('#lists').onclick = e => { const b = e.target.closest('.res'); if (!b) return; const rec = store.get('song.' + b.dataset.key, null); if (rec) openRecord(rec); else toast('Not cached: search for it again'); };
$('#bHome').onclick = () => show('browse');
$('#nowbar').onclick = () => show('sing');

/* ---------- arriving from the Shortcut: ?title=&artist= ---------- */
async function fromShortcut() {
  const p = new URLSearchParams(location.search);
  const title = (p.get('title') || '').trim(), artist = (p.get('artist') || '').trim(), q = (p.get('q') || '').trim();
  if (!title && !q) return false;
  history.replaceState(null, '', location.pathname);
  log('from shortcut', title, artist, q);
  $('#q').value = q || [title, artist].filter(Boolean).join(' ');
  $('#results').innerHTML = '<p class="msg">Finding lyrics for “' + esc(title || q) + '”…</p>';
  try {
    const list = q ? await searchQ(q) : await findByMeta(title, artist);
    if (!list.length) { renderResults([], title || q); return true; }
    renderResults(list, title || q);
    openRecord(recFromLrclib(list[0]), list);
    toast('Found ' + list[0].trackName);
  } catch (e) { log('shortcut lookup failed', e); $('#results').innerHTML = '<p class="msg">Couldn’t reach the lyrics server. Check your connection, then search below.</p>'; }
  return true;
}

/* ---------- boot ---------- */
applyPrefs(); renderLists(); show('browse'); requestAnimationFrame(tick);
fromShortcut();
if (!PP()) toast('Pinyin engine failed to load');
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(e => log('sw failed', e));
log('ready');
}
