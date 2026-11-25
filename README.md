# ChàngAlong (唱 Along)

Sing Chinese songs at karaoke without reading characters. Shows lyrics in Hanyu Pinyin with tone marks, highlighted in time with the music.

**Live app:** https://notclement.github.io/changalong/

## How it works

1. **Listen** runs an iOS Shortcut that uses the iPhone's built-in Shazam (Recognize Music), then opens this page with `?title=…&artist=…`.
2. The page looks up synced lyrics on [LRCLIB](https://lrclib.net) (free, no key).
3. [pinyin-pro](https://github.com/zh-lx/pinyin-pro) converts them to pinyin on the device, with polyphone handling and 一/不 tone sandhi.
4. Tap the line being sung to start the clock; nudge with **Behind / Ahead** (saved per song).

Everything runs in the browser. No account, no backend, no audio leaves the phone except what Shazam itself uses.

## Shortcut setup (once)

In the Shortcuts app, create a shortcut named exactly **ChangAlong**:

1. Recognize Music
2. Get Details of Shazam Media → Title → URL Encode → Set Variable `T`
3. Get Details of Shazam Media → Artist → URL Encode → Set Variable `A`
4. Text: `https://notclement.github.io/changalong/?title=[T]&artist=[A]`
5. Open URLs

Optional: Settings → Accessibility → Touch → Back Tap → Double Tap → ChangAlong.

## Controls

| Action | How |
| --- | --- |
| Sync | Tap the line being sung, or "Tap as the next line starts" |
| Lyrics behind / ahead | Behind (+0.5 s) / Ahead (−0.5 s), remembered per song |
| Fix a wrong reading (多音字) | Press and hold the syllable, pick the reading |
| Other versions (live, remaster) | Tap the song title |
| Display | Settings: Pinyin / Both / 汉字, text size, dark/light |
| No timestamps | Plain lyrics switch to tap-to-advance |

## Development

Static files only: `index.html`, `app.css`, `app.js`, `sw.js`, `manifest.webmanifest`.
`vendor/pinyin-pro.js` is pinyin-pro 3.29.5 (MIT), compiled from source and bundled as a single browser file.
Bump `CACHE` in `sw.js` and `VERSION` in `app.js` on every release so phones pick up the new files.

Run locally: `python3 -m http.server 8765`, then open http://localhost:8765.
