/* ChàngAlong (唱 Along) — PWA. Lyrics from LRCLIB, pinyin from pinyin-pro (bundled), song ID from iOS Shazam via a Shortcut. */
{
'use strict';
const VERSION = '0.5.2';
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
let lastResults = [], paused = false;
const prefs = { mode: store.get('mode', 'm-both') === 'm-py' ? 'm-py' : 'm-both', size: store.get('size2', 38), script: store.get('script', 'simp'), skin: store.get('skin', 'dark') };

/* ---------- LRC + pinyin ---------- */
// Returns lines with optional per-character times (ct) from enhanced LRC word tags: [00:12.00]<00:12.00>你<00:12.40>好<00:13.00>
const ts = (m, sec) => +m * 60 + parseFloat(String(sec).replace(':', '.'));
function parseLRC(txt) {
  const out = []; let any = false;
  for (const raw of String(txt).split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (!tags.length && /^\s*\[[a-z]+:/i.test(raw)) continue;
    const body = raw.replace(/\[[^\]]*\]/g, '');
    let text = '', ct = null, wend = null;
    const segs = [...body.matchAll(/<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>([^<]*)/g)];
    if (segs.length) {
      ct = []; const lead = body.slice(0, segs[0].index);
      for (const ch of lead) { text += ch; ct.push(null); }
      segs.forEach((m, k) => {
        const t1 = ts(m[1], m[2]), nx = segs[k + 1], t2 = nx ? ts(nx[1], nx[2]) : null;
        const chars = [...m[3]], n = chars.filter(c => !/\s/.test(c)).length || 1; let j = 0;
        for (const ch of chars) {
          text += ch;
          if (/\s/.test(ch)) { ct.push(null); continue; }
          const span = t2 != null ? (t2 - t1) : 0.35 * n;
          ct.push([t1 + span * j / n, t1 + span * (j + 1) / n]); j++;
        }
        if (!nx) wend = t2;
      });
      if (!ct.some(Boolean)) ct = null;
    } else text = body;
    const trimmedStart = text.length - text.trimStart().length;
    if (ct) ct = ct.slice([...text.slice(0, trimmedStart)].length, [...text.slice(0, trimmedStart)].length + [...text.trim()].length);
    text = text.trim();
    if (tags.length) { any = true; for (const m of tags) out.push({ t: ts(m[1], m[2]), text, ct }); }
    else if (text) out.push({ t: null, text, ct: null });
  }
  if (any) return { timed: true, lines: out.filter(l => l.t != null).sort((a, b) => a.t - b.t).filter(l => l.text) };
  return { timed: false, lines: out.filter(l => l.text) };
}
function toUnits(text, ct) {
  const P = PP(); let arr = null;
  if (P) { try { arr = P.pinyin(text, { type: 'array', toneType: 'symbol', toneSandhi: true, nonZh: 'removed' }); } catch (e) { log('pinyin failed', e); } }
  const units = []; let k = 0, buf = '', bt = null, idx = 0;
  const flush = () => { if (buf.trim()) units.push({ h: buf.trim(), p: buf.trim(), zh: false, tm: bt }); buf = ''; bt = null; };
  for (const ch of text) {
    const tm = ct ? ct[idx] : null; idx++;
    if (isZh(ch)) { flush(); units.push({ h: ch, p: arr && arr[k] ? arr[k] : '?', zh: true, tm }); k++; }
    else if (/[\s，。、！？,.!?；;：:“”"「」『』（）()…~～\-—]/.test(ch)) flush();
    else { buf += ch; if (tm) bt = bt ? [bt[0], tm[1]] : tm; }
  }
  flush(); return units;
}
// Fixes for readings pinyin-pro gets wrong in lyrics; users can still override any syllable.
try { window.pinyinPro && window.pinyinPro.customPinyin && window.pinyinPro.customPinyin({ '系上': 'jì shàng', '背着': 'bēi zhe', '只为': 'zhǐ wèi', '只为你': 'zhǐ wèi nǐ', '只有': 'zhǐ yǒu', '一只': 'yì zhī', '为你': 'wèi nǐ', '为了': 'wèi le', '为谁': 'wèi shéi' }); } catch (e) {}
const simp = t => (prefs.script === 'simp' && window.toSimplified) ? window.toSimplified(t).replace(/著(?![名作称述录书者])/g, '着') : String(t ?? '');
function pyText(t) {
  const P = PP(); t = String(t ?? ''); if (!P || ![...t].some(isZh)) return '';
  try { return P.pinyin(t, { toneType: 'symbol', toneSandhi: true, nonZh: 'consecutive' }).replace(/\s+/g, ' ').trim(); } catch (e) { return ''; }
}
const tpRow = t => { const p = pyText(simp(t)); return p ? '<div class="tp">' + esc(p) + '</div>' : ''; };
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


/* ---------- scrolling text for header lines that don't fit ---------- */
// html must already be escaped. A line wider than its box glides to the end and back, pausing at each end.
function setLine(el, html) { el.classList.add('mqw'); el.innerHTML = '<span class="mq">' + html + '</span>'; fitLine(el); }
function fitLine(el) {
  const inner = el.firstElementChild; if (!inner || !el.clientWidth) return;
  el.classList.remove('marq');
  const over = inner.scrollWidth - el.clientWidth;
  if (over > 4) {
    el.style.setProperty('--mq', -(over + 8) + 'px');
    el.style.setProperty('--mqd', (3 + over / 25).toFixed(1) + 's');
    el.classList.add('marq');
  }
}
const refitAll = () => document.querySelectorAll('.mqw').forEach(fitLine);
addEventListener('resize', refitAll);

/* ---------- views ---------- */
function show(view) {
  $('#browse').hidden = view !== 'browse'; $('#sing').hidden = view !== 'sing';
  $('#nowbar').hidden = !(view === 'browse' && song);
  if (song) setLine($('#nowT'), esc(simp(song.title) + (song.artist ? ' · ' + simp(song.artist) : '')));
  requestAnimationFrame(refitAll);
  if (view === 'sing' && cur >= 0) requestAnimationFrame(() => scrollToLine(cur, true));
}
function resultRow(r, extra) {
  const synced = !!r.syncedLyrics;
  return '<button class="res" data-id="' + esc(r.id) + '"><span class="art">' + esc(simp((r.trackName || '?').trim().charAt(0))) + '</span><span class="rm"><div class="t">' + esc(simp(r.trackName)) + '</div>' + tpRow(r.trackName) + '<div class="a">' + esc(simp(r.artistName)) + (r.albumName ? ' · ' + esc(r.albumName) : '') + (r.duration ? ' · ' + fmt(r.duration) : '') + '</div></span><span class="badge">' + (extra || (synced ? (/<\d+:\d+/.test(r.syncedLyrics) ? 'Word synced' : 'Synced') : 'Lyrics only')) + '</span></button>';
}
function renderResults(list, q) {
  lastResults = list;
  $('#results').innerHTML = list.length ? '<div class="sec">Results for “' + esc(q) + '”</div>' + list.slice(0, 25).map(r => resultRow(r)).join('')
    : '<p class="msg">No lyrics found for “' + esc(q) + '”. Try the Chinese title, or the singer’s name only.</p>';
}
function renderLists() {
  const fav = store.get('fav', []), hist = store.get('hist', []);
  const row = s => '<button class="res" data-key="' + esc(s.key) + '"><span class="art">' + esc(simp((s.title || '?').charAt(0))) + '</span><span class="rm"><div class="t">' + esc(simp(s.title)) + '</div>' + tpRow(s.title) + '<div class="a">' + esc(simp(s.artist || '')) + '</div></span>' + (fav.some(f => f.key === s.key) ? '<span class="badge">★</span>' : '') + '</button>';
  $('#lists').innerHTML = (fav.length ? '<div class="sec">Favourites</div>' + fav.map(row).join('') : '')
    + (hist.length ? '<div class="sec">Recent</div>' + hist.slice(0, 15).map(row).join('') : '');
}
async function doSearch(q) {
  q = q.trim(); if (!q) return;
  $('#results').innerHTML = '<p class="msg">Searching…</p>';
  try { renderResults(await searchQ(q), q); }
  catch (e) { log('search error', e); $('#results').innerHTML = '<p class="msg">Couldn’t reach the lyrics server. Check your connection and try again.</p>'; }
}


/* ---------- duet voices: 男 / 女 / 合 markers ---------- */
const VOICES = { m: { tag: '男', label: 'Him' }, f: { tag: '女', label: 'Her' }, b: { tag: '合', label: 'Both' } };
const CREDIT = /^(作词|作曲|编曲|词|曲|制作人?|监制|演唱|原唱|混音|和声|录音|母带|出品|发行|吉他|贝斯|鼓|弦乐|配唱|统筹|OP|SP|ISRC|Lyrics?|Lyricist|Composer|Arranger|Producer|Written by|Music by)\s*[:：]/i;
const voiceOf = w => {
  w = w.trim().toLowerCase();
  if (/^(合|合唱|男女|齐|一起|both|all|duet|d|together|m\s*[&+/]\s*f|f\s*[&+/]\s*m)$/.test(w)) return 'b';
  if (/^(男|男声|男生|m|male|man|him|he)$/.test(w)) return 'm';
  if (/^(女|女声|女生|f|female|woman|her|she)$/.test(w)) return 'f';
  return null;
};
// Bare markers with no colon ("男 明年…", "女记得…") only count when the song uses them on several lines.
const BARE = /^\s*(男女|合唱|男|女|合)(?![人孩生子儿士朋性友声适作理照影法])\s*/;
function bareMarkers(lines) {
  const c = { m: 0, f: 0, b: 0 };
  for (const l of lines) { const m = l.text.match(BARE); if (m) c[voiceOf(m[1])]++; }
  return (c.m && c.f) || c.m + c.f + c.b >= 3;
}
function splitVoice(text, names, bare) {
  if (bare) { const m = text.match(BARE); if (m && m[0].length < text.length) return { v: voiceOf(m[1]), text: text.slice(m[0].length) }; }
  // "(男) ..."  "【女】..."  "男：..."  "合 : ..."  "周杰伦：..."
  let m = text.match(/^\s*[(（\[【]\s*([^)）\]】]{1,8})\s*[)）\]】]\s*[:：]?\s*/);
  if (m && voiceOf(m[1])) return { v: voiceOf(m[1]), text: text.slice(m[0].length) };
  m = text.match(/^\s*([^:：\s]{1,10}(?:\s[^:：\s]{1,10})?)\s*[:：]\s*/);
  if (m) {
    const v = voiceOf(m[1]); if (v) return { v, text: text.slice(m[0].length) };
    if (m[0].length < text.length && !/\d/.test(m[1])) {             // a singer's name: 1st name = blue, 2nd = pink, more = green
      if (!(m[1] in names)) { const n = Object.keys(names).length; names[m[1]] = n === 0 ? 'm' : n === 1 ? 'f' : 'b'; }
      return { v: names[m[1]], name: m[1], text: text.slice(m[0].length) };
    }
  }
  return null;
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
  const parsed = parseLRC(simp(rec.lrc));
  const ov = store.get('ov.' + rec.key, {});
  song = { ...rec, timed: parsed.timed, alts: alts || null };
  const names = {}; let voice = null; const bare = bareMarkers(parsed.lines);
  song.lines = parsed.lines.map((l, i) => {
    let text = l.text, credit = false, ct = l.ct;
    if (CREDIT.test(text)) credit = true;
    else { const sv = splitVoice(text, names, bare); if (sv) { voice = sv.v; if (ct) ct = ct.slice([...text].length - [...sv.text].length); text = sv.text; } }
    const u = credit ? [] : toUnits(text, ct); u.forEach((x, j) => { const o = ov[i + ':' + j]; if (o) { x.p = o; x.fix = true; } });
    const timedWords = u.length > 0 && u.every(x => x.tm);
    return { t: l.t, text, u, credit, v: credit ? null : voice, words: timedWords };
  });
  song.wordSync = song.lines.some(l => l.words);
  song.duet = song.lines.some(l => l.v);
  song.names = Object.fromEntries(Object.entries(names).map(([n, v]) => [v, n]));
  song.lines.forEach((l, i) => { const p = song.lines[i - 1]; l.turn = !!l.v && (!p || p.v !== l.v || p.credit); });
  log('voices', song.duet ? JSON.stringify(names) || 'markers' : 'none');
  song.lines.forEach((l, i) => { const nx = song.lines[i + 1]; l.end = l.words ? Math.max(l.t + 0.3, l.u.at(-1).tm[1]) : (nx && nx.t - l.t < 8) ? nx.t - 0.15 : l.t + Math.min(5, 0.42 * l.u.length + 0.8); });
  if (song.timed && !song.dur) song.dur = song.lines.at(-1).t + 10;
  setLine($('#sT'), esc(simp(song.title) || 'Lyrics'));
  const syncTag = !song.timed ? 'Lyrics only' : song.wordSync ? 'Word synced' : 'Synced';
  setLine($('#sA'), esc(simp(song.artist || '') + (pyText(simp(song.artist)) ? ' (' + pyText(simp(song.artist)) + ')' : '') + (song.alts && song.alts.length > 1 ? ' · ' + song.alts.length + ' versions' : '')));
  setLine($('#sP'), esc(pyText(simp(song.title))) + ' <span class="tag">' + syncTag + '</span>');
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
  const tag = l => { if (!l.turn) return ''; const n = song.names && song.names[l.v]; return '<span class="vt">' + esc(VOICES[l.v].tag) + ' ' + esc(n || VOICES[l.v].label) + '</span>'; };
  $('#stage').innerHTML = song.lines.map((l, i) => l.credit ? '<div class="ln credit" data-i="' + i + '">' + esc(l.text) + '</div>' : '<div class="ln' + (l.v ? ' v-' + l.v : '') + '" data-i="' + i + '">' + tag(l) + l.u.map((u, j) =>
    '<span class="u' + (u.zh ? '' : ' x') + (u.fix ? ' fix' : '') + '" data-j="' + j + '"><b>' + esc(u.p) + '</b>' + (u.zh ? '<i>' + esc(u.h) + '</i>' : '') + '</span>').join('') + '</div>').join('');
  applyPrefs();
}
function applyPrefs() {
  const st = $('#stage'); st.classList.remove('m-py', 'm-both'); st.classList.add(prefs.mode); st.classList.toggle('wait', mode === 'wait');
  document.documentElement.style.setProperty('--fs', prefs.size + 'px');
  document.documentElement.style.colorScheme = prefs.skin;
  const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = prefs.skin === 'light' ? '#fbf6f1' : '#140d1c';
  $('#size').value = prefs.size; $('#sizeV').textContent = prefs.size;
  for (const b of document.querySelectorAll('#segMode button')) b.setAttribute('aria-pressed', b.dataset.v === prefs.mode);
  for (const b of document.querySelectorAll('#segScript button')) b.setAttribute('aria-pressed', b.dataset.v === prefs.script);
  for (const b of document.querySelectorAll('#segSkin button')) b.setAttribute('aria-pressed', b.dataset.v === prefs.skin);
}
function go(i) {
  for (const el of $('#stage').children) {
    const k = +el.dataset.i;
    const L = song.lines[k];
    el.className = 'ln' + (L.credit ? ' credit' : '') + (L.v ? ' v-' + L.v : '') + (k === i ? ' now' : k === i + 1 ? ' next' : k < i ? ' past' : '');
    if (k !== i) for (const s of el.querySelectorAll('.u')) s.style.removeProperty('--p');
  }
  cur = i; if (follow) scrollToLine(i);
}
function fillLine(i) { const el = $('#stage').children[i]; if (el) for (const s of el.querySelectorAll('.u')) s.style.setProperty('--p', '100%'); }
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
function startAt(t) { setTime(t); running = true; setPaused(false); ended = false; mode = 'run'; banner(''); applyPrefs(); follow = true; $('#bBack').classList.remove('show'); }
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
      el.querySelectorAll('.u').forEach((s, k) => {
        const tm = l.words && l.u[k].tm;   // word-timed: follow the real rhythm (held notes, fast runs)
        const p = tm ? (tt - tm[0]) / Math.max(0.05, tm[1] - tm[0]) : f * n - k;
        s.style.setProperty('--p', Math.min(1, Math.max(0, p)) * 100 + '%');
      });
    }
    const nx = song.lines[i + 1];
    if (!ended) {
      const nv = nx && nx.v, turnSoon = nv && (!l || l.v !== nv) && nx.t - tt <= 5;
      const who = nv ? '<b class="c-' + nv + '">' + esc(VOICES[nv].tag + ' ' + ((song.names && song.names[nv]) || VOICES[nv].label)) + '</b>' : '';
      if (paused) banner('Paused · tap <b>▶</b> to carry on');
      else if (nx && (i < 0 || tt > l.end) && nx.t - tt > 2.5) banner((i < 0 ? 'Intro' : 'Instrumental') + ' · ' + (who ? who + ' in ' : 'next line in ') + '<b>' + Math.ceil(nx.t - tt) + 's</b>');
      else if (turnSoon) banner(who + ' next' + (nx.t - tt > 1 ? ' · <b>' + Math.ceil(nx.t - tt) + 's</b>' : ''));
      else banner('');
    }
    $('#tNow').textContent = fmt(t); if (!seeking) $('#seek').value = song.dur ? t / song.dur * 1000 : 0;
  }
  if (!follow && performance.now() > followT) { follow = true; $('#bBack').classList.remove('show'); if (cur >= 0) scrollToLine(cur); }
  requestAnimationFrame(tick);
}
let toastT; function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800); }

/* ---------- pause ---------- */
function setPaused(p) {
  paused = p; const b = $('#bPause'); if (!b) return;
  b.classList.toggle('on', p); b.setAttribute('aria-label', p ? 'Carry on' : 'Pause');
  b.innerHTML = p ? '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>';
}
$('#bPause').onclick = () => {
  if (!song || !song.timed || mode !== 'run' || ended) return;
  if (!paused) { base = now(); running = false; setPaused(true); lastBanner = null; log('paused at', base.toFixed(1)); }
  else { t0 = performance.now(); running = true; setPaused(false); lastBanner = null; log('resumed at', base.toFixed(1)); }
};

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
$('#segScript').onclick = e => { const b = e.target.closest('button'); if (!b || b.dataset.v === prefs.script) return; prefs.script = b.dataset.v; store.set('script', prefs.script); applyPrefs(); renderLists(); if (song) { const keep = { t: now(), mode, cur }; const rec = store.get('song.' + song.key, null); if (rec) { openRecord(rec, song.alts); if (keep.mode === 'run') { startAt(keep.t); } } } };
$('#size').oninput = e => { prefs.size = +e.target.value; store.set('size2', prefs.size); applyPrefs(); };
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
const howUrl = APP_URL + '?title=';
const aiPrompt = 'Create a shortcut named "ChangAlong" that does this:\n'
  + '1. Use the Recognize Music (Shazam) action to identify the song playing around me.\n'
  + '2. If no song is recognised, show the alert "No song found. Try again closer to the speaker." and stop.\n'
  + '3. Get the Title of the Shazam Media and URL-encode it.\n'
  + '4. Get the Artist of the same Shazam Media and URL-encode it.\n'
  + '5. Build this URL, inserting the encoded values: ' + APP_URL + '?title=[encoded title]&artist=[encoded artist]\n'
  + '6. Open that URL in Safari.';
$('#tplUrl').textContent = howUrl;
$('#aiPrompt').textContent = aiPrompt;
$('#bCopyPrompt').onclick = async () => { try { await navigator.clipboard.writeText(aiPrompt); toast('Prompt copied'); } catch (e) { toast('Copy failed: select the text instead'); } };
$('#bHowListen').onclick = () => open('#shHow'); $('#bHowListen2').onclick = () => open('#shHow');
$('#bPaste').onclick = () => open('#shPaste');
$('#bInfo').onclick = () => open('#shInfo');
$('#sP').addEventListener('click', e => { if (e.target.closest('.tag')) { e.stopPropagation(); open('#shInfo'); } });
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
$('.stage-wrap').addEventListener('scroll', e => { e.currentTarget.scrollTop = 0; });
applyPrefs(); renderLists(); show('browse'); requestAnimationFrame(tick);
fromShortcut();
if (!PP()) toast('Pinyin engine failed to load');
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(e => log('sw failed', e));
log('ready');
}
