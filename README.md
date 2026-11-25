# ChàngAlong (唱 Along)

Sing Chinese songs at karaoke without reading characters. Shows lyrics in Hanyu Pinyin with tone marks, highlighted in time with the music.

**Live app:** https://notclement.github.io/changalong/

## How it works

1. **Listen** runs an iOS Shortcut that uses the iPhone's built-in Shazam (Recognize Music), then opens this page with `?title=…&artist=…`.
2. The page looks up synced lyrics on [LRCLIB](https://lrclib.net) (free, no key).
3. Traditional characters are converted to Simplified (OpenCC dictionaries; switch off in Settings).
4. [pinyin-pro](https://github.com/zh-lx/pinyin-pro) converts them to pinyin on the device, with polyphone handling and 一/不 tone sandhi.
5. Tap the line being sung to start the clock; nudge with **Behind / Ahead** (saved per song).

Everything runs in the browser. No account, no backend, no audio leaves the phone except what Shazam itself uses.

## Shortcut setup (once)

Easiest: in the app, tap **First time? Set up the Shortcut → Copy prompt**, and paste it into an AI shortcut builder. The prompt:

```
Create a shortcut named "ChangAlong" that does this:
1. Use the Recognize Music (Shazam) action to identify the song playing around me.
2. If no song is recognised, show the alert "No song found. Try again closer to the speaker." and stop.
3. Get the Title of the Shazam Media and URL-encode it.
4. Get the Artist of the same Shazam Media and URL-encode it.
5. Build this URL, inserting the encoded values: https://notclement.github.io/changalong/?title=[encoded title]&artist=[encoded artist]
6. Open that URL in Safari.
```

By hand: Recognize Music → URL Encode (Shazam Media → Title) → Text `https://notclement.github.io/changalong/?title=` + URL Encoded Text → Open URLs.

## Languages

Chinese songs get pinyin under every character; English words inside them are shown as they are.
Songs in other languages (English, Japanese, Korean, Malay…) are shown as plain text with the same timing and highlight, tagged *No pinyin*, *Japanese* or *Korean*.
Japanese is detected from kana, so its kanji never get Chinese pinyin or Simplified conversion.

**Cantonese songs:** Settings → *This song is sung in* → Cantonese shows jyutping (e.g. nei5 hou2) instead of pinyin, remembered per song. Uses [to-jyutping](https://github.com/CanCLID/to-jyutping) (BSD-2-Clause), loaded only when needed.

## Tags

Grey tags by the title and in search results: **Word synced / Synced / Lyrics only** (timing), **Duet**, **Live / Remix / Acoustic / Instrumental / Cover** (version), **繁→简** (converted from Traditional), **Cantonese**, **No pinyin / Japanese / Korean**. Tap a tag in the lyric screen for explanations.

## Search

Type a title, part of a title (你那么) or the first letters of its pinyin (nnmat → 你那么爱她).
Suggestions come instantly from your recent songs, favourites and a built-in list of ~330 popular KTV songs (`vendor/catalog.js`; Cantopop entries switch to jyutping automatically). Lyrics always come from LRCLIB.

## Controls

| Action | How |
| --- | --- |
| Sync | Tap the line being sung, or "Tap as the next line starts" |
| Lyrics behind / ahead | Behind (+0.5 s) / Ahead (−0.5 s), remembered per song |
| Fix a wrong reading (多音字) | Press and hold the syllable, pick the reading |
| Song info | ⓘ button or tap the title: a short AI write-up of what the song is about (free [Pollinations](https://pollinations.ai) API, no key, based on the lyrics; Wikipedia if the AI is unavailable), and Translate the lyrics |
| Display | Settings: 汉字 + pinyin (pinyin under each character) or Pinyin only, Simplified or as written, text size, dark/light |
| Duets | Lines marked 男 / 女 / 合, with or without a colon (or singer names) are coloured: Him blue, Her pink, Both green, with a heads-up before each change |
| Pause | Pause button, bottom right |
| Countdown | Three dots fade 3-2-1 before any line that follows a pause (intro, instrumental); the line scrolls into place early |
| Highlight | Settings: Sweep across words (default) or Whole line |
| Sync tag | Grey tag by the title: Word synced (highlight follows each word's timing), Synced (per line), Lyrics only (tap to advance) |
| No timestamps | Plain lyrics switch to tap-to-advance |

## Development

Static files only: `index.html`, `app.css`, `app.js`, `sw.js`, `manifest.webmanifest`.
`vendor/to-jyutping.js` is to-jyutping 3.1.1 compiled from source into one browser file.
`vendor/t2s.js` is a Traditional→Simplified converter built from OpenCC's TSCharacters/TSPhrases (Apache-2.0).
`vendor/pinyin-pro.js` is pinyin-pro 3.29.5 (MIT), compiled from source and bundled as a single browser file.
Bump `CACHE` in `sw.js` and `VERSION` in `app.js` on every release so phones pick up the new files.

Run locally: `python3 -m http.server 8765`, then open http://localhost:8765.
