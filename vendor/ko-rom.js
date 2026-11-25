/*! Korean → romanisation (Revised Romanization, spelled as it is sung: liaison, nasalisation, ㄹ assimilation,
    ㅎ aspiration, palatalisation). Small, no dictionary: good for singing along, not a full pronunciation engine. */
(function () {
  var INI = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
  var VOW = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
  // final consonant: [sound, initial it becomes before a vowel (liaison), final left behind]
  var FIN = [['', -1, 0], ['k', 0, 0], ['k', 1, 0], ['k', 9, 1], ['n', 2, 0], ['n', 12, 4], ['n', 2, 0], ['t', 3, 0], ['l', 5, 0],
    ['k', 0, 8], ['m', 6, 8], ['l', 7, 8], ['l', 9, 8], ['l', 16, 8], ['p', 17, 8], ['l', 5, 0], ['m', 6, 0], ['p', 7, 0], ['p', 9, 17],
    ['t', 9, 0], ['t', 10, 0], ['ng', -1, 21], ['t', 12, 0], ['t', 14, 0], ['k', 15, 0], ['t', 16, 0], ['p', 17, 0], ['t', 11, 0]];
  function syl(c) { var n = c.charCodeAt(0) - 0xAC00; return n >= 0 && n < 11172 ? { L: Math.floor(n / 588), V: Math.floor(n % 588 / 28), T: n % 28 } : null; }
  function romWord(chars) {
    var s = chars.map(syl), i, a, b;
    for (i = 0; i < s.length - 1; i++) {
      a = s[i]; b = s[i + 1]; if (!a || !b || !a.T) continue;
      var snd = FIN[a.T][0];
      if (b.L === 11 && a.T !== 21) {                                   // liaison: 읽어 il-geo, 같이 ga-chi
        b.L = FIN[a.T][1]; a.T = FIN[a.T][2];
        if (b.V === 20 && b.L === 3) b.L = 12; else if (b.V === 20 && b.L === 16) b.L = 14;
        continue;
      }
      if ((a.T === 27 || a.T === 6 || a.T === 15) && (b.L === 0 || b.L === 3 || b.L === 12)) {   // 좋다 jo-ta
        b.L = { 0: 15, 3: 16, 12: 14 }[b.L]; a.T = a.T === 27 ? 0 : a.T === 6 ? 4 : 8; continue;
      }
      if (b.L === 18 && (snd === 'k' || snd === 't' || snd === 'p')) {  // 축하 chu-ka
        b.L = snd === 'k' ? 15 : snd === 'p' ? 17 : (a.T === 22 ? 14 : 16); a.T = FIN[a.T][2] === a.T ? 0 : FIN[a.T][2]; continue;
      }
      if (b.L === 5 && (snd === 'k' || snd === 't' || snd === 'p' || snd === 'm' || snd === 'ng')) b.L = 2;   // 국립 gung-nip, 음력 eum-nyeok
      if (b.L === 2 || b.L === 6) {                                    // nasalisation: 합니다 ham-ni-da
        if (snd === 'k') a.c = 'ng'; else if (snd === 't') a.c = 'n'; else if (snd === 'p') a.c = 'm';
      }
      if (snd === 'n' && b.L === 5) { a.c = 'l'; b.i = 'l'; }          // 신라 sil-la
      else if (snd === 'l' && (b.L === 2 || b.L === 5)) b.i = 'l';      // 몰라 mol-la, 설날 seol-lal
    }
    return s.map(function (x, k) {
      if (!x) return chars[k];
      return (x.i || INI[x.L]) + VOW[x.V] + (x.c != null ? x.c : FIN[x.T][0]);
    }).join('');
  }
  // Romanise a word or phrase; non-Hangul characters pass through unchanged.
  window.romanizeKo = function (text) {
    var out = '', run = [];
    Array.from(String(text)).forEach(function (ch) { if (syl(ch)) run.push(ch); else { if (run.length) out += romWord(run), run = []; out += ch; } });
    if (run.length) out += romWord(run);
    return out;
  };
})();
