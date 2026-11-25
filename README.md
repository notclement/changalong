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

## Set up Listen (once)

Listen uses the iPhone's built-in Shazam through a Shortcut.

1. Open the app in Safari and tap **First time? Set up the Shortcut → Copy prompt** (or copy it below).
2. Open the **Shortcuts** app and create a new shortcut with its AI builder, then paste the prompt.
3. Check the shortcut is named exactly **ChangAlong**.
4. Optional: Settings → Accessibility → Touch → **Back Tap** → Double Tap → ChangAlong.

```text
Create a shortcut named "ChangAlong" that does this:
1. Use the Recognize Music (Shazam) action to identify the song playing around me.
2. If no song is recognised, show the alert "No song found. Try again closer to the speaker." and stop.
3. Get the Title of the Shazam Media and URL-encode it.
4. Get the Artist of the same Shazam Media and URL-encode it.
5. Build this URL, inserting the encoded values: https://notclement.github.io/changalong/?title=[encoded title]&artist=[encoded artist]
6. Open that URL in Safari.
```

No AI builder? Add these actions by hand: Recognize Music → URL Encode (Shazam Media → Title) → Text `https://notclement.github.io/changalong/?title=` + URL Encoded Text → Open URLs.

## How to use

1. Tap **Listen** (or double-tap the back of the phone). Shazam finds the song and the lyrics open.
2. Tap the line being sung right now. The lyrics then scroll in time.
3. Lyrics late or early? Tap **Behind** / **Ahead**, or tap the current line again.
4. No Shazam? Search by title or pinyin initials instead.

## Built with

[LRCLIB](https://lrclib.net) (lyrics) · [pinyin-pro](https://github.com/zh-lx/pinyin-pro) · [to-jyutping](https://github.com/CanCLID/to-jyutping) · [OpenCC](https://github.com/BYVoid/OpenCC) dictionaries · [Pollinations](https://pollinations.ai) / Gemini / [Puter](https://puter.com) (AI) · GitHub Pages

Free, no account. Your fixes and recent songs stay on your phone.

## Development

Static files, no build step: `python3 -m http.server`, then open `localhost:8000`.
On each release, bump `VERSION` in `app.js`, the `?v=` numbers in `index.html` and `CACHE` in `sw.js`.
Add songs to `vendor/catalog.js` as `['Title', 'Singer']`, or `['Title', 'Singer', 'y']` for Cantonese.

## Notes

Tested on iPhone 17 Pro Max only. Found a problem or have an idea? [Open an issue](https://github.com/notclement/changalong/issues).

Made by [Clement](https://www.linkedin.com/in/clementsg).

## Changelog

**1.1.5**
- Line being sung is white, turning orange as it's sung; all other lines grey

**1.1.4**
- Tags back in the header as a small row under the singer

**1.1.3**
- Tap button is a big round button bottom-right until you're in sync, then shrinks out of the way
- Singer shown in Chinese when Shazam gives an English name (Vae Xu → 许嵩)
- Tags moved from the header to Song info
- Not-yet-sung part of the current line is dimmer
- Spotify button on recent songs

**1.1.2**
- Listen reuses the open ChàngAlong tab instead of piling up new Safari tabs (where Safari allows it)

**1.1.1**
- Built-in song list grown to ~1,700 songs (more classics, Cantopop and recent hits), singers checked

**1.1.0**
- Lyrics not found? Retries with the Chinese-only title, Traditional/Simplified spellings, AI-suggested titles and other singers' versions, then shows closest results
- Version number and author in Settings
- Bigger mic button and text-size slider; tap the small/big A to step the size
- Header and dock alignment fixes; no double-tap zoom
- Settings ordered by use, Highlight first
- Removed: favourites, tap-to-start prompt
- Gemini key is checked before saving
- Mandarin songs listed before Cantonese
- Built-in song list checked for correct singers, ~1,300 songs

**1.0.0**
- Backup AIs (Gemini with your own key, Puter) for song summaries and initials search
- Built-in list of ~1,260 popular KTV songs
- Removed paste lyrics

**0.9**
- Song info: AI write-up of what the song is about, plus translate
- Search any Chinese song by pinyin initials (e.g. `nnmat`), with AI help
- Current line sits higher on screen; songs open at the first line
- Swipe down to close sheets

**0.8**
- Search by pinyin initials and part of a title
- Smarter line timing; 3-2-1 dots before lines after a pause; "next line in Ns"
- Offline support restored

**0.7**
- Cantonese mode with jyutping
- Layout for all phones, landscape and tablets

**0.6**
- English and other languages shown as plain text

**0.5**
- Word-level timing, sync tags (Word synced / Synced / Lyrics only) and a tag guide
- Long titles scroll so you can read them

**0.4**
- Duets colour-coded: him blue, her pink, both green
- Pause button

**0.3**
- Pinyin for song titles and singers
- Traditional converted to Simplified; larger characters

**0.2**
- Pinyin under every character
- Shortcut setup with a copyable AI prompt

**0.1**
- First release: Listen via Shazam Shortcut, lyrics from LRCLIB, pinyin, line sync
