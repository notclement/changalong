<p align="center"><img src="docs/banner.png" alt="ChàngAlong" width="100%"></p>

# ChàngAlong · 唱 Along

Sing Chinese songs at karaoke without reading Chinese. Lyrics show pinyin under every character and highlight in time with the music.

**[Open the app →](https://notclement.github.io/changalong/)**

| Search | Sing | Song info |
| :---: | :---: | :---: |
| <img src="docs/home.png" width="220"> | <img src="docs/sing.png" width="220"> | <img src="docs/info.png" width="220"> |

## Features

- Pinyin with tone marks under each character; Cantonese (jyutping) per song
- Lyrics in time with the music: tap the line being sung once, then it scrolls by itself
- Duet colours (Him / Her / Both) and a 3-2-1 countdown after instrumentals
- Search by title, part of a title, or pinyin initials (`nnmat` → 你那么爱她)
- Short AI summary of what a song is about, and one-tap lyric translation
- Works offline for songs you've opened

## Listen (Shazam) setup

Create an iPhone Shortcut named **ChangAlong**. Easiest: in the app tap **First time? Set up the Shortcut → Copy prompt** and paste it into an AI shortcut builder.

Manual: Recognize Music → URL Encode (Shazam Media → Title) → Text `https://notclement.github.io/changalong/?title=` + URL Encoded Text → Open URLs.

## Built with

[LRCLIB](https://lrclib.net) (lyrics) · [pinyin-pro](https://github.com/zh-lx/pinyin-pro) · [to-jyutping](https://github.com/CanCLID/to-jyutping) · [OpenCC](https://github.com/BYVoid/OpenCC) dictionaries · [Pollinations](https://pollinations.ai) / Gemini / [Puter](https://puter.com) (AI) · GitHub Pages

Free, no account. Favourites and fixes stay on your phone.

## Development

Static files, no build step: `python3 -m http.server`, then open `localhost:8000`.
On each release, bump `VERSION` in `app.js`, the `?v=` numbers in `index.html` and `CACHE` in `sw.js`.
Add songs to `vendor/catalog.js` as `['Title', 'Singer']`, or `['Title', 'Singer', 'y']` for Cantonese.
