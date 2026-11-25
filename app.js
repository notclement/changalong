/* ChàngAlong (唱 Along) — PWA. Lyrics from LRCLIB, pinyin from pinyin-pro (bundled), song ID from iOS Shazam via a Shortcut. */
{
'use strict';
const VERSION = '1.1.5';
const API = 'https://lrclib.net/api';
const APP_URL = location.origin + location.pathname;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = s => { s = Math.max(0, s | 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const isZh = c => /[㐀-鿿豈-﫿\u{20000}-\u{3134f}]/u.test(c);
const KANA = /[぀-ヿㇰ-ㇿ]/, HANGUL = /[가-힯ᄀ-ᇿ㄰-㆏]/;
// Script of a whole song: 'zh' gets pinyin + Simplified conversion; anything else is shown as plain text.
function detectLang(t) {
  let han = 0, kana = 0, hangul = 0, letters = 0;
  for (const ch of String(t ?? '')) {
    if (isZh(ch)) han++; else if (KANA.test(ch)) kana++; else if (HANGUL.test(ch)) hangul++;
    if (/\p{L}/u.test(ch)) letters++;
  }
  if (kana >= 3 || (kana && kana * 4 >= han)) return 'ja';
  if (hangul && hangul >= han) return 'ko';
  if (han >= 8 || (han && han >= letters * 0.25)) return 'zh';
  return letters ? 'other' : 'zh';
}
const LANG_TAG = { ja: 'Japanese', ko: 'Korean', other: 'No pinyin' };
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
let lastResults = [], paused = false, yueOn = false, lastPrep = -1;
const prefs = { mode: store.get('mode', 'm-both') === 'm-py' ? 'm-py' : 'm-both', size: store.get('size2', Math.round(Math.min(60, Math.max(34, Math.min(innerWidth, 900) / 10)))), script: store.get('script', 'simp'), hl: store.get('hl', 'sweep'), skin: store.get('skin', 'dark') };

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
  if (yueOn && window.ToJyutping) { try { arr = window.ToJyutping.getJyutpingList(text).filter(([c]) => isZh(c)).map(x => x[1] || '?'); } catch (e) { log('jyutping failed', e); } }
  else if (P) { try { arr = P.pinyin(text, { type: 'array', toneType: 'symbol', toneSandhi: true, nonZh: 'removed' }); } catch (e) { log('pinyin failed', e); } }
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
// Plain-text units for lines with no Chinese (English, Korean, Malay…): one unit per word, punctuation kept.
// Japanese has no spaces, so it is split per character for a smooth highlight.
function toWords(text, ct) {
  const units = []; let idx = 0;
  for (const tok of String(text).split(/(\s+)/)) {
    const chars = [...tok];
    if (!tok.trim()) { idx += chars.length; continue; }
    const pieces = (KANA.test(tok) || isZh(chars[0])) ? chars : [tok];
    for (const pc of pieces) {
      const n = [...pc].length, a = ct ? ct[idx] : null, b = ct ? ct[idx + n - 1] : null;
      units.push({ h: pc, p: '', zh: false, tx: true, tm: a && b ? [a[0], b[1]] : null }); idx += n;
    }
  }
  return units;
}
// Fixes for readings pinyin-pro gets wrong in lyrics; users can still override any syllable.
try { window.pinyinPro && window.pinyinPro.customPinyin && window.pinyinPro.customPinyin({ '系上': 'jì shàng', '背着': 'bēi zhe', '只为': 'zhǐ wèi', '只为你': 'zhǐ wèi nǐ', '只有': 'zhǐ yǒu', '一只': 'yì zhī', '为你': 'wèi nǐ', '为了': 'wèi le', '为谁': 'wèi shéi', '卡路里': 'kǎ lù lǐ' }); } catch (e) {}
const simp = t => (prefs.script === 'simp' && window.toSimplified && detectLang(t) === 'zh') ? window.toSimplified(t).replace(/著(?![名作称述录书者])/g, '着') : String(t ?? '');
function pyText(t) {
  const P = PP(); t = String(t ?? ''); if (![...t].some(isZh) || KANA.test(t)) return '';
  if (yueOn && window.ToJyutping) { try { return window.ToJyutping.getJyutpingList(t).map(([c, j]) => j || (/\s/.test(c) ? ' ' : c)).join(' ').replace(/\s+/g, ' ').trim(); } catch (e) { return ''; } }
  if (!P) return '';
  try { return P.pinyin(t, { toneType: 'symbol', toneSandhi: true, nonZh: 'consecutive' }).replace(/\s+/g, ' ').trim(); } catch (e) { return ''; }
}
const withPy = a => { const p = pyText(simp(a)); return simp(a) + (p ? ' (' + p + ')' : ''); };
const tpRow = t => { const p = pyText(simp(t)); return p ? '<div class="tp">' + esc(p) + '</div>' : ''; };
function readings(ch) {
  if (yueOn && window.ToJyutping) { try { return (window.ToJyutping.getJyutpingCandidates(ch)[0] || [ch, []])[1]; } catch (e) { return []; } }
  const P = PP(); if (!P) return []; try { return P.pinyin(ch, { multiple: true, type: 'array', toneType: 'symbol' }); } catch (e) { return []; } }

/* ---------- LRCLIB ---------- */
async function api(path) {
  log('GET', path);
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 12000);
  try { const r = await fetch(API + path, { signal: ctl.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(to); }
}
const rank = list => list.filter(r => !r.instrumental && (r.syncedLyrics || r.plainLyrics)).sort((a, b) => (!!b.syncedLyrics - !!a.syncedLyrics));
async function searchQ(q) { return rank(await api('/search?q=' + encodeURIComponent(q))); }
const cleanT = s => String(s || '').replace(/[（(\[【].*?[）)\]】]/g, '').replace(/\s*[-–]\s*(live|remaster.*|伴奏|ktv).*$/i, '').trim();
const zhPart = s => [...String(s || '')].filter(isZh).join('');        // "你我他的故事 The Story of Us Three" → "你我他的故事"
const squash = s => simp(String(s || '')).replace(/[\s·・.,，。'’!?！？-]+/g, '').toLowerCase();
const sameSong = (r, t) => { const a = squash(r.trackName), b = squash(t); return !!a && !!b && (a.includes(b) || (b.includes(a) && a.length >= 2)); };
async function findByMeta(title, artist, onStep) {
  const tries = [];
  if (title && artist) tries.push('/search?track_name=' + encodeURIComponent(title) + '&artist_name=' + encodeURIComponent(artist));
  if (title && artist) tries.push('/search?q=' + encodeURIComponent(cleanT(title) + ' ' + cleanT(artist)));
  if (title) tries.push('/search?q=' + encodeURIComponent(cleanT(title)));
  for (const p of tries) { const r = rank(await api(p)); if (r.length) return r; }
  return findVariants(cleanT(title), cleanT(artist), onStep);
}
// Nothing under the exact name: try the Chinese part only, Traditional/Simplified spellings, then ask the AI for the Chinese title.
// Only songs whose title matches are opened; anything else comes back as .near (closest results) for the user to pick.
async function findVariants(title, artist, onStep) {
  const near = [], seen = new Set(), done = new Set();
  const tryQ = async (q, want) => {
    q = q.trim(); if (!q || done.has(q)) return null; done.add(q); log('variant search', q);
    const r = await searchQ(q), hit = r.filter(x => sameSong(x, want));
    for (const x of r) if (!seen.has(x.id)) { seen.add(x.id); near.push(x); }
    return hit.length ? hit : null;
  };
  const zt = zhPart(title) || title, za = zhPart(artist), tr = window.toTraditional || (s => s);
  onStep && onStep('Trying other spellings…');
  for (const [q, want] of [[zt + ' ' + za, zt], [zt, zt], [tr(zt) + ' ' + tr(za), zt], [tr(zt), zt], [simp(zt), zt]]) {
    const hit = await tryQ(q, want); if (hit) return hit;
  }
  // the AI: the Chinese title (if Shazam gave English/romanised), other titles the song goes by, and other singers' versions
  onStep && onStep('Asking the AI for other names and versions…');
  const vs = await aiVariants(title, artist, () => onStep && onStep('The free AI is busy, trying again in a few seconds…'));
  const wants = [zt].concat(vs.map(v => v.s));
  const okAny = r => wants.some(w => sameSong(r, w));
  for (const v of vs) for (const q of [v.s + ' ' + v.a, v.s, v.t]) {
    const hit = await tryQ(q, v.s); if (hit) { hit.ai = true; return hit; }
  }
  // by singer only: their songs, keeping one whose title matches any of the names above
  for (const a of [...new Set([za, ...vs.map(v => v.a)].filter(Boolean))].slice(0, 3)) {
    onStep && onStep('Looking through ' + a + '’s songs…');
    if (done.has(a)) continue; done.add(a);
    const r = await searchQ(a); for (const x of r) if (!seen.has(x.id)) { seen.add(x.id); near.push(x); }
    const hit = r.filter(okAny); if (hit.length) { hit.ai = true; return hit; }
  }
  if (!near.length && [...zt].length >= 4) await tryQ([...zt].slice(0, Math.ceil([...zt].length / 2)).join(''), '\u0000');   // start of the title: closest results only
  // closest first: most characters in common with any of the names
  const score = r => Math.max(...wants.map(w => { const a = new Set(squash(r.trackName)), b = [...squash(w)]; return b.length ? b.filter(c => a.has(c)).length / b.length : 0; }));
  const out = []; out.near = rank(near).map(r => [score(r), r]).filter(x => x[0] >= 0.34).sort((a, b) => b[0] - a[0]).map(x => x[1]); return out;
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
  return '<button class="res" data-id="' + esc(r.id) + '"><span class="art">' + esc(simp((r.trackName || '?').trim().charAt(0))) + '</span><span class="rm"><div class="t">' + esc(simp(r.trackName)) + '</div>' + tpRow(r.trackName) + '<div class="a">' + esc(withPy(r.artistName)) + (r.albumName ? ' · ' + esc(r.albumName) : '') + (r.duration ? ' · ' + fmt(r.duration) : '') + '</div></span><span class="badges"><span class="badge">' + (extra || (synced ? (/<\d+:\d+/.test(r.syncedLyrics) ? 'Word synced' : 'Synced') : 'Lyrics only')) + '</span>' + [versionTag(r.trackName + ' ' + (r.albumName || '')), DUET_RX.test(r.syncedLyrics || r.plainLyrics || '') ? 'Duet' : ''].filter(Boolean).map(t => '<span class="badge">' + t + '</span>').join('') + '</span></button>';
}
function renderResults(list, q) {
  if (!list.length && list.near && list.near.length) {
    lastResults = list.near;
    $('#results').innerHTML = '<p class="msg">No exact match for “' + esc(q) + '”.</p><div class="sec">Closest results</div>' + list.near.slice(0, 15).map(r => resultRow(r)).join('');
    return;
  }
  lastResults = list;
  $('#results').innerHTML = list.length ? '<div class="sec">Results for “' + esc(q) + '”</div>' + list.slice(0, 25).map(r => resultRow(r)).join('')
    : '<p class="msg">No lyrics found for “' + esc(q) + '”. Try the Chinese title, or the singer’s name only.</p>';
}
function renderLists() {
  const hist = store.get('hist', []);
  const row = s => '<button class="res" data-key="' + esc(s.key) + '"><span class="art">' + esc(simp((s.title || '?').charAt(0))) + '</span><span class="rm"><div class="t">' + esc(simp(s.title)) + '</div>' + tpRow(s.title) + '<div class="a">' + esc(withPy(store.get('zhname.' + (s.artist || ''), '') || s.artist || '')) + '</div></span>' + '</button>' +
    '<a class="spot" href="https://open.spotify.com/search/' + encodeURIComponent(simp(s.title) + ' ' + (s.artist || '')) + '" target="_blank" rel="noopener" aria-label="Find on Spotify"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>Spotify</a>';
  $('#lists').innerHTML = (hist.length ? '<div class="sec">Recent</div>' + hist.slice(0, 15).map(s => '<div class="resw">' + row(s) + '</div>').join('') : '');
}
/* ---------- local suggestions: popular KTV songs + your history, matched by pinyin initials or part of a title ---------- */
let localIdx = null;
function pyKeys(t) {
  const P = PP(); t = simp(t || ''); if (!P) return { ini: '', full: '' };
  try {
    const arr = P.pinyin(t, { toneType: 'none', type: 'array', nonZh: 'consecutive' }).map(x => x.toLowerCase().replace(/[^a-z0-9ü]/g, '').replace(/ü/g, 'v')).filter(Boolean);
    return { ini: arr.map(x => x[0]).join(''), full: arr.join('') };
  } catch (e) { return { ini: '', full: '' }; }
}
function buildLocal() {
  const seen = new Set(), out = [];
  const add = (title, artist, extra) => { const k = simp(title) + '|' + simp(artist || ''); if (seen.has(k)) return; seen.add(k); out.push({ title: simp(title), artist: simp(artist || ''), tI: [...String(title)].some(isZh) ? pyKeys(title).ini : '', ...extra }); };
  for (const h of store.get('hist', [])) add(h.title, h.artist, { key: h.key });
  for (const [t, a, y] of (window.KTV_CATALOG || [])) add(t, a, { yue: y === 'y' });
  return out;
}
function matchLocal(q) {
  localIdx ||= buildLocal();
  const raw = q.trim(), lat = raw.toLowerCase().replace(/[\s'’-]+/g, '');
  const cjk = [...raw].some(isZh), sq = simp(raw).replace(/\s+/g, '');
  const hits = [];
  for (const e of localIdx) {
    let score = 0;
    const tt = e.title.replace(/\s+/g, '');
    if (cjk) { if (tt === sq) score = 100; else if (tt.startsWith(sq)) score = 90; else if (tt.includes(sq)) score = 70; }  // part of a title
    else if (e.tI && /^[a-z0-9]+$/.test(lat)) {                                                                                   // first letters of the title's pinyin
      if (e.tI === lat) score = 100; else if (lat.length >= 2 && e.tI.startsWith(lat)) score = 85; else if (lat.length >= 3 && e.tI.includes(lat)) score = 40;
    }
    if (score) hits.push([score + (e.key ? 5 : 0) + (!cjk && [...e.title].some(isZh) ? 20 : 0) + (e.yue ? 0 : 12), e]);  // initials: Chinese songs first, Mandarin before Cantonese
  }
  return hits.sort((a, b) => b[0] - a[0]).slice(0, 8).map(x => x[1]);
}
let lastSugg = [];
const INIT_HINT = '<p class="msg">Press <b>Search</b> to find songs with these initials.</p>';
function suggRow(e, i) {
  return '<button class="res" data-sugg="' + i + '"><span class="art">' + esc(e.title.charAt(0)) + '</span><span class="rm"><div class="t">' + esc(e.title) + '</div>' + tpRow(e.title) + '<div class="a">' + esc(withPy(e.artist)) + '</div></span><span class="badges">' + (e.key ? '<span class="badge">Recent</span>' : '') + (e.ai ? '<span class="badge">AI match</span>' : '') + (e.yue ? '<span class="badge">Cantonese</span>' : '') + '</span></button>';
}
async function openFromMeta(e) {
  if (e.key) { const rec = store.get('song.' + e.key, null); if (rec) return openRecord(rec); }
  toast('Finding lyrics for ' + e.title + '…');
  try {
    const list = await findByMeta(e.title, e.artist.split(/\s+/)[0]);
    if (!list.length) { toast('No lyrics found for ' + e.title); return; }
    const rec = recFromLrclib(list[0]);
    if (e.yue && store.get('yue.' + rec.key, null) == null) store.set('yue.' + rec.key, true);
    return openRecord(rec, list);
  } catch (err) { log('suggestion lookup failed', err); toast('Couldn’t reach the lyrics server'); }
}
let searchSeq = 0;
const seekingCard = (q, line2) => '<div class="seeking"><span class="spin" aria-hidden="true"></span><div><b>Finding songs for “' + esc(q) + '”…</b><div class="muted">' + line2 + '</div></div></div>' +
  '<div class="skel"><i></i><i></i><i></i></div>';
async function searchInitials(ini, q) {
  const my = ++searchSeq, local = matchLocal(q);
  const head = () => local.length ? '<div class="sec">Suggestions</div>' + local.map(suggRow).join('') : '';
  lastSugg = local;
  $('#results').innerHTML = head() + seekingCard(q, 'Matching pinyin initials with AI. This takes a few seconds.');
  const ai = await aiInitials(ini, () => { if (my === searchSeq) { const m = $('#results .seeking .muted'); if (m) m.textContent = 'The free AI is busy, trying again in a few seconds…'; } });
  if (my !== searchSeq) return;                                   // a newer search replaced this one
  const known = new Set(local.map(e => e.title + '|' + e.artist));
  const extra = (ai || []).filter(e => !known.has(e.title + '|' + e.artist));
  lastSugg = local.concat(extra.filter(e => !e.yue), extra.filter(e => e.yue));   // Mandarin first
  if (!lastSugg.length) {
    $('#results').innerHTML = '<p class="msg">' + (ai == null ? 'Couldn’t reach the AI right now. Try again in a moment, or type the title in Chinese.' : 'No songs found for “' + esc(q) + '”. Try typing the title in Chinese.') + '</p>';
    return;
  }
  $('#results').innerHTML = '<div class="sec">Songs matching “' + esc(q) + '”</div>' + lastSugg.map(suggRow).join('') + (ai == null ? '<p class="msg">The AI didn’t answer, so only songs you’ve opened or popular ones are shown.</p>' : '');
}
async function doSearch(q) {
  searchSeq++;
  q = q.trim(); if (!q) return;
  lastSugg = matchLocal(q);
  const sugg = lastSugg.length ? '<div class="sec">Suggestions</div>' + lastSugg.map(suggRow).join('') : '';
  $('#results').innerHTML = sugg + '<p class="msg">Searching lyrics…</p>';
  // pure initials like "yyyy" mean nothing to the lyrics server: show known matches, then ask the AI for more
  const ini = q.replace(/\s+/g, '').toLowerCase();
  if (/^[a-z]{2,10}$/.test(ini)) return searchInitials(ini, q);
  try {
    let list = await searchQ(q);
    if (!list.length) {
      const my = searchSeq;
      list = await findVariants(q.replace(/\s+/g, ' '), '', m => { if (my === searchSeq) $('#results').innerHTML = sugg + '<div class="seeking"><span class="spin"></span><div><b>No exact match yet</b><div class="muted">' + esc(m) + '</div></div></div>'; });
      if (my !== searchSeq) return;
    }
    // a short run of letters is probably pinyin initials: put Chinese titles first
    if (/^[a-z]{2,8}$/i.test(q.replace(/\s+/g, ''))) list = [...list.filter(r => [...(r.trackName || '')].some(isZh)), ...list.filter(r => ![...(r.trackName || '')].some(isZh))];
    renderResults(list, q); if (sugg) $('#results').insertAdjacentHTML('afterbegin', sugg); }
  catch (e) { log('search error', e); $('#results').innerHTML = sugg + '<p class="msg">Couldn’t reach the lyrics server. Check your connection and try again.</p>'; }
}


/* ---------- duet voices: 男 / 女 / 合 markers ---------- */
const VOICES = { m: { tag: '男', label: 'Him' }, f: { tag: '女', label: 'Her' }, b: { tag: '合', label: 'Both' } };
const INTERJ = /^(啊|阿|哦|喔|噢|呀|哎|唉|嗯|嘿|哟|喲|oh|ah|ooh|woo|yeah|wo|whoa|la)$/i;
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

/* ---------- Cantonese (jyutping), loaded only when a song is switched to it ---------- */
let jpLoading = null;
function loadJyutping() {
  if (window.ToJyutping) return Promise.resolve();
  return jpLoading ||= new Promise((ok, bad) => { const sc = document.createElement('script'); sc.src = 'vendor/to-jyutping.js'; sc.onload = ok; sc.onerror = bad; document.head.appendChild(sc); });
}
const VERSION_RX = [[/伴奏|instrumental|karaoke|ktv|off ?vocal/i, 'Instrumental'], [/live|現場|现场|演唱會|演唱会|concert/i, 'Live'], [/remix|mix\b|DJ/i, 'Remix'], [/acoustic|不插電|不插电|unplugged/i, 'Acoustic'], [/cover|翻唱/i, 'Cover']];
const versionTag = t => { for (const [rx, name] of VERSION_RX) if (rx.test(t || '')) return name; return ''; };
const DUET_RX = /^(?:\[[^\]]*\])+\s*[(（【\[]?\s*(?:男|女|合|M|F)\s*[)）】\]]?\s*[:： ]/m;
const tagHtml = list => list.filter(Boolean).map(t => '<span class="tag">' + esc(t) + '</span>').join(' ');

/* ---------- load a song ---------- */
function keyOf(r) { return 'l' + r.id; }
function cacheSong(rec) { store.set('song.' + rec.key, rec); }
function rememberHistory(rec) {
  localIdx = null;
  const h = store.get('hist', []).filter(x => x.key !== rec.key);
  h.unshift({ key: rec.key, title: rec.title, artist: rec.artist }); store.set('hist', h.slice(0, 40));
  const keep = new Set(h.slice(0, 40).map(x => x.key));
  try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith('pk.song.') && !keep.has(k.slice(8))) localStorage.removeItem(k); } } catch (e) {}
}
function recFromLrclib(r) {
  return { key: keyOf(r), title: r.trackName, artist: r.artistName, album: r.albumName, dur: r.duration || 0, lrc: r.syncedLyrics || r.plainLyrics || '' };
}
function openRecord(rec, alts) {
  log('open', rec.key, rec.title, rec.artist);
  cacheSong(rec); rememberHistory(rec);
  const lang = detectLang(rec.lrc.replace(/\[[^\]]*\]|<[^>]*>/g, ''));
  yueOn = lang === 'zh' && store.get('yue.' + rec.key, false);
  if (yueOn && !window.ToJyutping) { return loadJyutping().then(() => openRecord(rec, alts)).catch(() => { toast('Cantonese readings failed to load'); store.set('yue.' + rec.key, false); openRecord(rec, alts); }); }
  const converted = lang === 'zh' ? simp(rec.lrc) : rec.lrc;
  const parsed = parseLRC(converted);
  const ov = store.get(ovKeyFor(rec.key), {});
  song = { ...rec, lang, yue: yueOn, toSimp: converted !== rec.lrc, timed: parsed.timed, alts: alts || null };
  const names = {}; let voice = null; const bare = bareMarkers(parsed.lines);
  song.lines = parsed.lines.map((l, i) => {
    let text = l.text, credit = false, ct = l.ct;
    if (CREDIT.test(text)) credit = true;
    else { const sv = splitVoice(text, names, bare); if (sv) { voice = sv.v; if (ct) ct = ct.slice([...text].length - [...sv.text].length); text = sv.text; } }
    const zhLine = lang === 'zh' && [...text].some(isZh);
    const u = credit ? [] : zhLine ? toUnits(text, ct) : toWords(text, ct); u.forEach((x, j) => { const o = ov[i + ':' + j]; if (o) { x.p = o; x.fix = true; } });
    const timedWords = u.length > 0 && u.every(x => x.tm);
    return { t: l.t, text, u, credit, v: credit ? null : voice, words: timedWords };
  });
  song.wordSync = song.lines.some(l => l.words);
  song.duet = song.lines.some(l => l.v);
  song.names = Object.fromEntries(Object.entries(names).map(([n, v]) => [v, n]));
  song.lines.forEach((l, i) => { const p = song.lines[i - 1]; l.turn = !!l.v && (!p || p.v !== l.v || p.credit); });
  log('voices', song.duet ? JSON.stringify(names) || 'markers' : 'none');
  // How fast this song is sung: from lines sung back-to-back, seconds per syllable (30th percentile = the
  // brisk lines). A line's sweep then lasts as long as its syllables need, not until the next line starts,
  // so a quick line followed by a pause no longer crawls.
  const per = song.lines.map((l, i) => { const nx = song.lines[i + 1], n = l.u.length; return (!l.credit && nx && n >= 4 && nx.t - l.t < 8) ? (nx.t - l.t) / n : null; }).filter(Boolean).sort((a, b) => a - b);
  song.rate = Math.min(0.8, Math.max(0.18, per.length ? per[Math.floor(per.length * 0.3)] : 0.42));
  song.lines.forEach((l, i) => {
    const nx = song.lines[i + 1], gap = nx ? nx.t - l.t : 6;
    // Sung straight into the next line: fill the whole gap (held notes, a long 啊… at the start).
    // Followed by a pause: sweep at the song's pace, then wait.
    const need = l.u.length * song.rate * 1.15 + 0.3;
    l.end = l.words ? Math.max(l.t + 0.3, l.u.at(-1).tm[1]) : l.t + Math.max(0.6, gap < need * 1.8 ? gap - 0.15 : Math.min(need, 7));
    // Uneven sweep: interjections (啊, 哦, oh…) and the last syllable are usually held longer.
    l.w = l.u.map((u, k) => (INTERJ.test(u.h) ? 3 : 1) * (k === l.u.length - 1 ? 1.6 : 1));
    l.cum = []; l.W = l.w.reduce((a, w, k) => (l.cum[k] = a, a + w), 0);
  });
  // Lines that start after a pause (intro, instrumental, long breath) get a 3-2-1 dot countdown.
  song.lines.forEach((l, i) => { const p = song.lines[i - 1]; l.lead = song.timed && !l.credit && (!p || p.credit ? (l.t >= 2.5) : (l.t - p.end >= 3.5)); });
  log('rate', song.rate.toFixed(2), 's/syllable');
  if (song.timed && !song.dur) song.dur = song.lines.at(-1).t + 10;
  setLine($('#sT'), esc(simp(song.title) || 'Lyrics'));
  const syncTag = !song.timed ? 'Lyrics only' : song.wordSync ? 'Word synced' : 'Synced';
  setLine($('#sA'), esc(artistLine(song.artist)));
  const tags = [lang === 'zh' ? (song.yue ? 'Cantonese' : '') : LANG_TAG[lang], syncTag, song.duet ? 'Duet' : '', versionTag(song.title + ' ' + (song.album || '')), song.toSimp ? '繁→简' : ''];
  song.tags = tags;
  $('#sG').innerHTML = tags.filter(Boolean).map(t => '<span>' + esc(t) + '</span>').join('');
  setLine($('#sP'), lang === 'zh' ? esc(pyText(simp(song.title))) : '');
  showSingerZh(song);
  $('#tEnd').textContent = song.timed ? fmt(song.dur) : '—';
  $('#seek').disabled = !song.timed;
  renderStage(); cur = -1; lastPrep = -1; ended = false; follow = true;
  // a new song always opens at its first line, clock at 0:00
  $('#toast').classList.remove('show'); $('#stage').scrollTop = 0; $('#tNow').textContent = '0:00'; $('#seek').value = 0; setPaused(false); $('#bBack').classList.remove('show');
  requestAnimationFrame(() => scrollToLine(0, true));
  if (song.timed) { mode = 'wait'; running = false; base = 0; banner('wait'); }
  else { mode = 'tap'; running = false; go(0); fillLine(0); banner(''); }
  $('#tapL').textContent = song.timed ? 'Tap' : 'Next'; $('#tapH').textContent = song.timed ? 'Tap when the next line starts' : 'Show the next line'; tapSize();
  show('sing'); renderLists();
  if (!song.lines.length) banner('This entry has no lyric lines.');
}

/* ---------- stage ---------- */
function renderStage() {
  const tag = l => { if (!l.turn) return ''; const n = song.names && song.names[l.v]; return '<span class="vt">' + esc(VOICES[l.v].tag) + ' ' + esc(n || VOICES[l.v].label) + '</span>'; };
  $('#stage').innerHTML = song.lines.map((l, i) => l.credit ? '<div class="ln credit" data-i="' + i + '">' + esc(l.text) + '</div>' : '<div class="ln' + (l.v ? ' v-' + l.v : '') + '" data-i="' + i + '">' + (l.lead ? '<span class="cd" aria-hidden="true"><i></i><i></i><i></i></span>' : '') + tag(l) + l.u.map((u, j) =>
    (u.zh ? '<span class="u' + (u.fix ? ' fix' : '') + '" data-j="' + j + '"><b>' + esc(u.p) + '</b><i>' + esc(u.h) + '</i></span>'
          : '<span class="u x' + (u.tx ? ' tx' : '') + '" data-j="' + j + '">' + (u.tx ? '' : '<b>\u00a0</b>') + '<i>' + esc(u.h) + '</i></span>')).join('') + '</div>').join('');
  applyPrefs();
}
function applyPrefs() {
  tapSize();
  const st = $('#stage'); st.classList.remove('m-py', 'm-both'); st.classList.add(prefs.mode); st.classList.toggle('wait', mode === 'wait');
  document.documentElement.style.setProperty('--fs', prefs.size + 'px');
  document.documentElement.style.colorScheme = prefs.skin;
  const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = prefs.skin === 'light' ? '#fbf6f1' : '#140d1c';
  $('#size').value = prefs.size; $('#sizeV').textContent = prefs.size; $('#size').style.setProperty('--p', (prefs.size - 24) / 36 * 100 + '%');
  for (const b of document.querySelectorAll('#segMode button')) b.setAttribute('aria-pressed', b.dataset.v === prefs.mode);
  for (const b of document.querySelectorAll('#segHl button')) b.setAttribute('aria-pressed', b.dataset.v === prefs.hl);
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
  // Current line sits in the upper part of the screen, so the next line is visible below it;
  // long (wrapping) lines go higher still so the whole line and what follows fit.
  const H = st.clientHeight, long = el.offsetHeight > H * 0.22;
  st.scrollTo({ top: el.offsetTop - Math.max(56, H * (long ? 0.12 : 0.24)), behavior: instant || reduce ? 'auto' : 'smooth' });
}
let lastBanner = null;
function banner(what) {
  if (what === lastBanner) return; lastBanner = what; const b = $('#banner');
  if (what === 'wait') what = '';
  b.className = 'banner'; b.innerHTML = what || '';
}
const now = () => running ? base + (performance.now() - t0) / 1000 : base;
function setTime(t) { base = t; t0 = performance.now(); }
function startAt(t) { setTime(t); running = true; setPaused(false); ended = false; mode = 'run'; banner(''); applyPrefs(); follow = true; $('#bBack').classList.remove('show'); }
const ovKeyFor = k => 'ov.' + k + (yueOn ? '.yue' : '');
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
        const p = prefs.hl === 'line' ? 1 : tm ? (tt - tm[0]) / Math.max(0.05, tm[1] - tm[0]) : l.W ? (f * l.W - l.cum[k]) / l.w[k] : f * n - k;
        s.style.setProperty('--p', Math.min(1, Math.max(0, p)) * 100 + '%');
      });
    }
    const nx = song.lines[i + 1];
    // countdown: from 3s before a line that follows a pause, scroll to it early and fade the dots 3 → 2 → 1
    const left = nx ? nx.t - tt : 0;
    const prepI = nx && nx.lead && left > 0 && left <= 3.2 && (i < 0 || tt > l.end) ? i + 1 : -1;
    if (prepI !== lastPrep) {
      const old = lastPrep >= 0 && $('#stage').children[lastPrep]; if (old) old.classList.remove('prep');
      lastPrep = prepI;
      if (prepI >= 0) { $('#stage').children[prepI].classList.add('prep'); if (i >= 0) $('#stage').children[i].classList.add('done'); if (follow) scrollToLine(prepI); }
    }
    if (prepI >= 0) $('#stage').children[prepI].dataset.n = Math.min(3, Math.ceil(left));
    if (!ended) {
      const nv = nx && nx.v, turnSoon = nv && (!l || l.v !== nv) && nx.t - tt <= 5;
      const who = nv ? '<b class="c-' + nv + '">' + esc(VOICES[nv].tag + ' ' + ((song.names && song.names[nv]) || VOICES[nv].label)) + '</b>' : '';
      if (paused) banner('Paused · tap <b>▶</b> to carry on');
      else if (nx && (i < 0 || tt > l.end) && nx.t - tt > 0.3) banner((i < 0 ? 'Intro' : 'Instrumental') + ' · ' + (who ? who + ' in ' : 'next line in ') + '<b>' + Math.ceil(nx.t - tt) + 's</b>');
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
    const ov = store.get(ovKeyFor(song.key), {}); ov[i + ':' + j] = unit.p; store.set(ovKeyFor(song.key), ov);
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
// Bottom sheets: swipe down to close (from the handle, or anywhere once scrolled to the top).
for (const sh of document.querySelectorAll('.sheet')) {
  let y0 = null, dy = 0, tStart = 0;
  sh.addEventListener('touchstart', e => {
    const onHandle = e.touches[0].clientY - sh.getBoundingClientRect().top < 40;
    if (sh.scrollTop > 0 && !onHandle) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0; tStart = performance.now();
  }, { passive: true });
  sh.addEventListener('touchmove', e => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0) { sh.classList.remove('drag'); sh.style.transform = ''; return; }
    e.preventDefault(); sh.classList.add('drag'); sh.style.transform = 'translateY(' + dy + 'px)';
  }, { passive: false });
  const end = () => {
    if (y0 == null) return; y0 = null;
    const fast = dy > 40 && dy / Math.max(1, performance.now() - tStart) > 0.5;
    sh.classList.remove('drag'); sh.style.transform = '';
    if (dy > 110 || fast) closeAll();
  };
  sh.addEventListener('touchend', end); sh.addEventListener('touchcancel', end);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeAll(); $('#pop').classList.remove('show'); } });
const openSettings = () => { $('#sungRow').hidden = !(song && song.lang === 'zh'); for (const b of document.querySelectorAll('#segSung button')) b.setAttribute('aria-pressed', (b.dataset.v === 'yue') === !!(song && song.yue)); $('#offRow').hidden = !(song && song.timed); $('#offV').textContent = offset().toFixed(1) + ' s'; open('#shSet'); };
$('#bSet1').onclick = openSettings; $('#bSet2').onclick = openSettings;
$('#segMode').onclick = e => { const b = e.target.closest('button'); if (!b) return; prefs.mode = b.dataset.v; store.set('mode', prefs.mode); applyPrefs(); if (cur >= 0) scrollToLine(cur, true); };
$('#segSkin').onclick = e => { const b = e.target.closest('button'); if (!b) return; prefs.skin = b.dataset.v; store.set('skin', prefs.skin); applyPrefs(); };
function reopenKeep() {
  if (!song) return; const keep = { t: now(), mode, alts: song.alts }; const rec = store.get('song.' + song.key, null); if (!rec) return;
  const resume = () => { if (keep.mode === 'run' && song && song.key === rec.key && mode !== 'run') startAt(keep.t); };
  const r = openRecord(rec, keep.alts);
  if (r && r.then) r.then(resume); else resume();
}
$('#appVer').textContent = 'v' + VERSION;
$('#segHl').onclick = e => { const b = e.target.closest('button'); if (!b) return; prefs.hl = b.dataset.v; store.set('hl', prefs.hl); applyPrefs(); };
$('#segScript').onclick = e => { const b = e.target.closest('button'); if (!b || b.dataset.v === prefs.script) return; prefs.script = b.dataset.v; store.set('script', prefs.script); applyPrefs(); renderLists(); reopenKeep(); };
$('#segSung').onclick = e => { const b = e.target.closest('button'); if (!b || !song) return; const on = b.dataset.v === 'yue'; if (on === !!song.yue) return; store.set('yue.' + song.key, on); closeAll(); toast(on ? 'Cantonese readings (jyutping)' : 'Mandarin readings (pinyin)'); reopenKeep(); };
$('#size').oninput = e => { prefs.size = +e.target.value; store.set('size2', prefs.size); applyPrefs(); };
$('#size').onchange = () => { if (cur >= 0) scrollToLine(cur, true); };
const sizeStep = d => { const r = $('#size'); r.value = Math.min(60, Math.max(24, +r.value + d)); r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); };
$('#bSzDn').onclick = () => sizeStep(-2); $('#bSzUp').onclick = () => sizeStep(2);
$('#gemKey').value = store.get('gemkey', '');
function gemStatus(ok, msg) { const el = $('#gemStat'); el.className = 'gemstat ' + (ok === true ? 'ok' : ok === false ? 'bad' : ''); el.textContent = msg; }
if (store.get('gemkey', '')) gemStatus(true, '✓ Key saved and verified');
$('#gemKey').oninput = () => gemStatus(null, '');
$('#bGemSave').onclick = async () => {
  const v = $('#gemKey').value.trim(), b = $('#bGemSave');
  if (!v) { store.set('gemkey', ''); gemStatus(null, ''); toast('Gemini key removed'); return; }
  b.disabled = true; b.textContent = 'Checking…'; gemStatus(null, 'Checking the key with Google…');
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=' + encodeURIComponent(v), { signal: ctl.signal });
    if (r.ok) { store.set('gemkey', v); gemStatus(true, '✓ Key works, saved on this phone'); }
    else { const j = await r.json().catch(() => ({})); log('gemini verify', r.status, JSON.stringify(j).slice(0, 120)); gemStatus(false, r.status === 429 ? '✗ Key is valid but over its limit right now, try later' : '✗ Google didn’t accept this key, check you copied all of it'); if (r.status === 429) store.set('gemkey', v); }
  } catch (e) { gemStatus(false, '✗ Couldn’t reach Google to check, try again when online'); }
  finally { clearTimeout(to); b.disabled = false; b.textContent = 'Verify & save'; }
};
$('#bReset').onclick = () => { if (!song) return; store.set(offKey(), 0); $('#offV').textContent = '0.0 s'; toast('Offset reset'); };
/* ---------- song info: about (Wikipedia), translate lyrics, search meaning, other versions ---------- */
// Short AI write-up of the song's meaning (Pollinations: free, no key; anonymous use is rate-limited).
// Grounded on the song's own lyrics so it doesn't invent a story.
function aboutPrompt(s) {
  const lyr = s.lines.filter(l => !l.credit).map(l => l.text).join(' / ').slice(0, 450);
  return 'In 3 or 4 short sentences of simple English, explain what the song "' + simp(s.title) + '" by ' + (s.artist || 'unknown') +
    ' is about and the feeling it expresses, for a karaoke singer who cannot read Chinese. Base it on these lyrics. No quotes from the lyrics, no markdown, no intro phrase. Lyrics: ' + lyr;
}
async function aiAbout(s, onWait) {
  const lyr = s.lines.filter(l => !l.credit).map(l => l.text).join(' / ').slice(0, 450);
  const prompt = aboutPrompt(s);
  return aiText(prompt, onWait, t => t.length > 40 && t.length < 2000);
}
// Free AI text (Pollinations, no key). Anonymous use allows ~1 request per 15s, so on failure wait and try once more.
// Free AI, three providers, tried in order:
//  1. Pollinations: no key, no account (anonymous limit ~1 request / 15 s)
//  2. Google Gemini: only if you've added your own free key in Settings (kept on this phone)
//  3. Puter: no key; asks you to sign in to a free Puter account, so it only runs when you tap "Try with Puter"
async function pollinations(prompt, base) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 25000);
  try { log('ai pollinations', base); const r = await fetch(base + encodeURIComponent(prompt) + '?model=openai', { signal: ctl.signal }); const t = (await r.text()).trim(); return r.ok && !/^\s*[{<]/.test(t) ? t : (log('ai bad reply', r.status, t.slice(0, 80)), null); }
  catch (e) { log('ai failed', base, e.name); return null; } finally { clearTimeout(to); }
}
async function gemini(prompt) {
  const key = store.get('gemkey', ''); if (!key) return null;
  for (const model of ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash']) {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 25000);
    try {
      log('ai gemini', model);
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key),
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }), signal: ctl.signal });
      const j = await r.json();
      const t = j && j.candidates && j.candidates[0] && j.candidates[0].content && (j.candidates[0].content.parts || []).map(x => x.text || '').join('').trim();
      if (r.ok && t) return t;
      log('ai gemini error', r.status, JSON.stringify(j).slice(0, 120));
      if (r.status === 400 || r.status === 403) return null;          // bad key: no point trying other models
    } catch (e) { log('ai gemini failed', e.name); } finally { clearTimeout(to); }
  }
  return null;
}
let puterLoading = null;
async function puterAI(prompt) {
  try {
    await (puterLoading ||= new Promise((ok, bad) => { const sc = document.createElement('script'); sc.src = 'https://js.puter.com/v2/'; sc.onload = ok; sc.onerror = bad; document.head.appendChild(sc); }));
    log('ai puter');
    const r = await window.puter.ai.chat(prompt);
    const c = typeof r === 'string' ? r : r && r.message && r.message.content;
    const t = (Array.isArray(c) ? c.map(x => x.text || '').join('') : String(c || r || '')).trim();
    return t || null;
  } catch (e) { log('ai puter failed', e && (e.message || e)); return null; }
}
async function aiText(prompt, onWait, ok) {
  const good = t => t && ok(t) ? t : null;
  let t = good(await pollinations(prompt, 'https://text.pollinations.ai/')) || good(await pollinations(prompt, 'https://gen.pollinations.ai/text/')) || good(await gemini(prompt));
  if (t) return t;
  if (onWait) onWait();
  await new Promise(r => setTimeout(r, 16000));                    // Pollinations' free limit: wait and try once more
  return good(await pollinations(prompt, 'https://text.pollinations.ai/'));
}
// Tap button: big round button while not yet in sync (or for untimed lyrics), small once the song is following along.
function tapSize() { const b = $('#bTap'); if (b) b.classList.toggle('tb', !song || !song.timed || mode !== 'run'); }
// Singer line: Chinese name + pinyin. Shazam often gives an English/romanised name ("Vae Xu"); the AI looks up the Chinese one (许嵩).
function artistLine(a) { const z = simp(a || ''), py = pyText(z); return z + (py ? ' (' + py + ')' : ''); }
async function showSingerZh(s) {
  const a = (s.artist || '').trim();
  if (!a || s.lang !== 'zh' || [...a].some(isZh)) return;
  const ck = 'zhname.' + a; let zh = store.get(ck, null);
  if (zh == null) {
    const t = await aiText('What is the Chinese name of the singer or band "' + a + '"' + (s.title ? ', who sings "' + simp(s.title) + '"' : '') +
      '? Reply with only the name in Simplified Chinese. If you are not sure, reply UNKNOWN.', null, x => !!x.trim());
    const n = (t || '').trim().split('\n')[0].replace(/^["“]|["”。.]$/g, '').trim();
    zh = /^[\u3400-\u9fff·・&、\s]{2,16}$/.test(n) ? simp(n) : '';
    store.set(ck, zh); log('singer name', a, '→', zh || 'unknown');
  }
  if (!zh || song !== s) return;
  s.artistZh = zh;
  setLine($('#sA'), esc(artistLine(zh)));
}
// Shazam name (often English or romanised) → the song's Chinese title and singer.
async function aiVariants(title, artist, onWait) {
  const ck = 'aivar.' + title + '|' + artist, cached = store.get(ck, null); if (cached) return cached;
  const prompt = 'Song: "' + title + '"' + (artist ? ' by "' + artist + '"' : '') + '. List the names this song is known by, to find its lyrics: ' +
    'first its original Chinese title and singer, then any other titles it goes by and well-known versions by other singers (covers, duets, the original if this is a cover). ' +
    'Up to 5 lines, each: Simplified Chinese title|Traditional Chinese title|Singer in Chinese. Not remixes or DJ versions. If you don\'t know this song, reply UNKNOWN. No other text.';
  const t = await aiText(prompt, onWait, x => /UNKNOWN/i.test(x) || /\|/.test(x));
  const res = [];
  if (t && !/^\s*UNKNOWN/i.test(t)) for (const l of t.split('\n')) {
    const p = l.split('|').map(x => x.replace(/^[\s"“”\d.、-]+|[\s"“”]+$/g, ''));
    if (p.length >= 2 && [...p[0]].some(isZh) && !res.some(r => r.s === simp(p[0]) && r.a === (p[2] || ''))) res.push({ s: simp(p[0]), t: p[1] || p[0], a: p[2] || '' });
  }
  log('ai variants', title, artist, res);
  if (res.length) store.set(ck, res.slice(0, 5));
  return res.slice(0, 5);
}
// Pinyin initials → song titles. The AI suggests; every title is checked against the initials here, so wrong guesses never show.
async function aiInitials(q, onWait) {
  const ck = 'aiini.' + q, cached = store.get(ck, null); if (cached) return cached;
  const prompt = 'List up to 10 well-known Chinese songs (Mandarin or Cantonese) whose title, written in Chinese characters, has pinyin initials exactly "' + q +
    '" (one letter per character, ' + q.length + ' characters). Reply with one song per line as: Title|Singer|Mandarin or Cantonese. Use Simplified Chinese. No numbering, no other text.';
  const t = await aiText(prompt, onWait, x => x.includes('|'));
  if (t == null) return null;
  const out = [], seen = new Set();
  for (const line of t.split(/\n+/)) {
    const [title, artist, lang] = line.replace(/^[\s\d.、)*-]+/, '').split('|').map(x => (x || '').trim());
    if (!title || ![...title].some(isZh)) continue;
    const ini = pyKeys(title).ini, k = simp(title) + '|' + simp(artist);
    if (seen.has(k) || !(ini === q || (q.length >= 3 && ini.startsWith(q)))) continue;
    seen.add(k); out.push({ title: simp(title), artist: simp(artist || ''), yue: /cantonese|粤/i.test(lang || ''), ai: true, exact: ini === q });
  }
  out.sort((a, b) => b.exact - a.exact);
  log('ai initials', q, out.length, 'verified of', t.split(/\n+/).length);
  store.set(ck, out);
  return out;
}
async function loadAbout(s) {
  const key = 'about3.' + s.key, cached = store.get(key, null), box = $('#about');
  const show = t => {
    box.innerHTML = t ? t.split(/\n+/).slice(0, 3).map(x => '<p>' + esc(x) + '</p>').join('') + '<p class="src">Written by AI from the lyrics, so it may not be exact.</p>'
                      : '<p class="muted">No write-up available for this song right now.</p><div class="two"><button class="btn ghost" id="bPuter">Try with Puter</button><button class="btn ghost" id="bGemKey">Add Gemini key</button></div><p class="note">Puter is free but asks you to sign in once. A Gemini key is free from Google and makes this faster.</p>';
    const bp = $('#bPuter'); if (bp) bp.onclick = async () => {
      box.innerHTML = '<p class="muted">Asking Puter… (a sign-in window may open)</p>';
      const t2 = await puterAI(aboutPrompt(s));
      if (t2 && t2.length > 40) { store.set(key, t2); if (song && song.key === s.key) show(t2); }
      else box.innerHTML = '<p class="muted">Puter didn’t answer. Try again later.</p>';
    };
    const bg = $('#bGemKey'); if (bg) bg.onclick = () => { openSettings(); setTimeout(() => $('#gemKey').focus(), 300); };
  };
  if (cached) return show(cached);
  box.innerHTML = '<p class="muted">Writing a short summary…</p>';
  const t = await aiAbout(s, () => { if (song && song.key === s.key) box.innerHTML = '<p class="muted">The free AI is busy, trying again in a few seconds…</p>'; });
  if (t) store.set(key, t);
  if (song && song.key === s.key) show(t);
}
function openSongInfo() {
  if (!song) return;
  $('#iT').textContent = simp(song.title) || 'Lyrics';
  $('#iP').textContent = song.lang === 'zh' ? pyText(simp(song.title)) : '';
  $('#iA').textContent = artistLine(song.artistZh || song.artist) + (song.artistZh ? ' · ' + song.artist : '');
  $('#iTags').innerHTML = tagHtml(song.tags || []);
  const lyr = song.lines.filter(l => !l.credit).map(l => l.text).join('\n').slice(0, 4500);
  $('#aTrans').href = 'https://translate.google.com/?sl=auto&tl=en&op=translate&text=' + encodeURIComponent(lyr);
  const alts = song.alts && song.alts.length > 1 ? song.alts : null;
  $('#verList').innerHTML = alts ? alts.map(r => resultRow(r, keyOf(r) === song.key ? 'Playing' : null)).join('') : '<p class="msg">No other versions found. Use search on the main screen to try a different spelling.</p>';
  open('#shVer'); $('#shVer').scrollTop = 0;
  loadAbout(song);
}
$('#bSong').onclick = openSongInfo;
$('#bInfoSong').onclick = openSongInfo;
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
$('#bInfo').onclick = () => open('#shInfo');
$('#sG').addEventListener('click', e => { e.stopPropagation(); open('#shInfo'); });
$('#iTags').addEventListener('click', e => { if (e.target.closest('.tag')) open('#shInfo'); });

/* ---------- browse events ---------- */
const syncClear = () => { $('#bClear').hidden = !$('#q').value; };
$('#q').addEventListener('input', () => {
  syncClear(); searchSeq++; const q = $('#q').value.trim();
  if (!q) { $('#results').innerHTML = ''; return; }
  lastSugg = matchLocal(q);
  $('#results').innerHTML = lastSugg.length ? '<div class="sec">Suggestions</div>' + lastSugg.map(suggRow).join('') : (/^[a-z]{2,8}$/i.test(q.replace(/\s+/g, '')) ? INIT_HINT : '');
});
$('#bClear').onclick = () => { $('#q').value = ''; syncClear(); $('#results').innerHTML = ''; lastResults = []; $('#q').focus(); };
$('#fSearch').onsubmit = e => { e.preventDefault(); $('#q').blur(); doSearch($('#q').value); };
$('#results').onclick = e => { const b = e.target.closest('.res'); if (!b) return; if (b.dataset.sugg != null) { openFromMeta(lastSugg[+b.dataset.sugg]); return; } const r = lastResults.find(x => String(x.id) === b.dataset.id); if (r) openRecord(recFromLrclib(r), lastResults.filter(x => x.trackName === r.trackName || x.artistName === r.artistName)); };
$('#lists').onclick = e => { const b = e.target.closest('.res'); if (!b) return; const rec = store.get('song.' + b.dataset.key, null); if (rec) openRecord(rec); else toast('Not cached: search for it again'); };
$('#bHome').onclick = () => show('browse');
$('#nowbar').onclick = () => show('sing');

/* ---------- arriving from the Shortcut: ?title=&artist= ---------- */
// The Shortcut opens a new Safari tab each time. If this tab came from the Shortcut and a ChàngAlong tab is waiting
// (Listen was pressed there moments ago), hand the song to that tab and close this one. Safari lets a page close
// a tab only if it has no back history, so if closing doesn't work this tab just carries on as before.
async function fromShortcut() {
  const p = new URLSearchParams(location.search);
  const title = (p.get('title') || '').trim(), artist = (p.get('artist') || '').trim(), q = (p.get('q') || '').trim();
  if (!title && !q) return false;
  history.replaceState(null, '', location.pathname);
  const waiting = Date.now() - store.get('listenAt', 0) < 180000;
  if (waiting && history.length <= 1) {
    store.set('listenAt', 0); store.set('pending', { title, artist, q, at: Date.now() });
    log('handing song to the waiting tab, closing this one');
    window.close();
    await new Promise(r => setTimeout(r, 600));
    store.set('pending', null);                                     // still here: closing wasn't allowed
  }
  return loadShortcutSong(title, artist, q);
}
function takePending() {
  const pd = store.get('pending', null); if (!pd || Date.now() - pd.at > 300000) return;
  store.set('pending', null); log('song handed over from the Shortcut tab', pd.title);
  show('browse'); loadShortcutSong(pd.title, pd.artist, pd.q);
}
addEventListener('visibilitychange', () => { if (!document.hidden) takePending(); });
addEventListener('pageshow', takePending); addEventListener('focus', takePending);
addEventListener('storage', e => { if (e.key && e.key.endsWith('pending') && !document.hidden) takePending(); });
for (const id of ['#bListen', '#bListen2']) $(id).addEventListener('click', () => store.set('listenAt', Date.now()));
async function loadShortcutSong(title, artist, q) {
  log('from shortcut', title, artist, q);
  $('#q').value = q || [title, artist].filter(Boolean).join(' '); syncClear();
  $('#results').innerHTML = '<p class="msg">Finding lyrics for “' + esc(title || q) + '”…</p>';
  try {
    const step = m => { $('#results').innerHTML = '<div class="seeking"><span class="spin"></span><div><b>Looking for “' + esc(title || q) + '”</b><div class="muted">' + esc(m) + '</div></div></div>'; };
    let list = q ? await searchQ(q) : await findByMeta(title, artist, step);
    if (q && !list.length) list = await findVariants(q, '', step);
    if (!list.length) { renderResults(list, title || q); return true; }
    renderResults(list, title || q);
    openRecord(recFromLrclib(list[0]), list);
    toast((list.ai ? 'Closest match: ' : 'Found ') + list[0].trackName);
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
