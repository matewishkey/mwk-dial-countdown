# MWK Dial Timer

[![MIT](https://img.shields.io/badge/licence-MIT-e2342b)](LICENSE)
[![Stream Deck +](https://img.shields.io/badge/Stream%20Deck-%2B-101317)](https://www.elgato.com/stream-deck-plus)

A countdown timer for the **Stream Deck +** dials. Tap the touchscreen to start or pause, hold it to reset, press the dial to change preset, turn it to adjust.

Each of the four dials holds its own independent timer.

> Requires a Stream Deck **+** — the dials and touchscreen are specific to that device — and the Stream Deck app 7.1 or newer, on macOS or Windows.

## Install

Download the latest `.streamDeckPlugin` from [Releases](https://github.com/matewishkey/mwk-dial-timer/releases) and double-click it. Stream Deck installs it and adds **Dial Timer** to the actions list; drag **Timer** onto a dial.

## Gestures

| Gesture | Does |
| --- | --- |
| Tap touchscreen | Start / pause |
| Hold touchscreen | Reset to full |
| Press dial | Next preset |
| Hold dial | Previous preset |
| Turn | Adjust — accelerates from 1s to 10s to 1min a tick |
| Press + turn | A flat 1 minute a tick |

The screen owns start/pause and reset because pressing a dial in is a fiddly, two-handed movement next to tapping the screen directly above it; the dial owns preset cycling, which is used far less often.

Turning an **idle** timer edits that preset's duration and saves it. Turning a **running** timer nudges only the time left, leaving the preset alone.

## Features

- **Presets** — 5, 20, 30 and 40 minutes out of the box, edited as hours, minutes and seconds. They carry no names: a timer's length is its own label, so the display reads `20m`, or `20m 30s` once nudged off a round number.
- **Countdown ring** that empties as the timer runs, with the clock beside it. A progress bar is available instead.
- **Seven colour themes**, and an optional logo in the middle of the ring.
- **A pause glyph** rather than a colour change, so the state is stated outright.
- **Fade near the end** — the same colour, shaded and unshaded, from a threshold you set in seconds.
- **Sound when finished**, repeatable up to ten times, at a volume you set. Choose a bundled sound, any sound already installed on your machine, or your own file.
- **Auto-repeat**, counting laps on screen.
- **Finish time** — `ends 14:35`, more useful than a raw remaining count on a long timer.
- Anything up to **24 hours**.

## Developing

Stream Deck runs on macOS and Windows only, so the plugin cannot be *run* on Linux — but it can be built and driven headlessly there.

```sh
npm install
npm run build      # bundle into com.matewishkey.dial-timer.sdPlugin/bin
npm test           # 64 unit tests
npm run demo       # scripted gesture pass, prints one frame per step
npm run mock       # the same harness, driven from the keyboard
```

`tools/mock-host.mjs` impersonates the Stream Deck application. A plugin is only a Node process launched with `-port`, `-pluginUUID`, `-registerEvent` and `-info` that connects back to `ws://127.0.0.1:<port>`, so the harness plays that role: it spawns the built plugin, answers the registration handshake, sends real dial events, and draws whatever comes back on the touchscreen. That covers everything except how the screen actually looks.

The plugin process is launched with its `.sdPlugin` directory as the working directory — the SDK resolves `manifest.json` and its log directory from `process.cwd()`, and exits immediately if launched from anywhere else.

### Against real hardware

```sh
npx streamdeck dev                                  # enable developer mode, once
npx streamdeck link com.matewishkey.dial-timer.sdPlugin
npm run watch                                       # rebuild + restart on save
```

### Packaging

```sh
npx streamdeck validate com.matewishkey.dial-timer.sdPlugin
npx streamdeck pack com.matewishkey.dial-timer.sdPlugin
```

## How it fits together

| File | Does |
| --- | --- |
| `src/timer.ts` | The countdown state machine. No Stream Deck imports and an injectable clock, so it is tested directly. |
| `src/settings.ts` | The settings shape, and the only place they are read. |
| `src/acceleration.ts` | Turns dial rotation into a step size. |
| `src/render.ts` | Draws the countdown ring as SVG. |
| `src/sound.ts` | Hands a sound file to the platform's own player. |
| `src/actions/dial-timer.ts` | Maps dial events onto the state machine and renders. |
| `tools/mock-host.mjs` | A stand-in for the Stream Deck application. |

A few decisions worth knowing before changing things:

**Settings are never trusted.** Stream Deck keeps an action's settings across an uninstall, so every build is handed settings written by an older one. `normaliseSettings` rebuilds a known-good object from whatever arrived — unrecognised keys discarded, numbers clamped, a broken preset index repaired, legacy shapes unwrapped — and the result is written back on first appearance.

**The ring is SVG, not canvas.** Plugins run under `--no-addons` and cannot load native modules, so no canvas library is available. A `pixmap` layout item accepts a raw SVG string, which is the way through. Text is left to real `text` layout items so it uses Stream Deck's own font rendering.

**The countdown works from a deadline**, not by accumulating ticks, so a slow or skipped render frame cannot make it drift.

**There is no audio API in the SDK.** `src/sound.ts` hands a file to `afplay` on macOS, or PowerShell's WPF `MediaPlayer` on Windows — chosen over `SoundPlayer`, which cannot set volume. Nothing is hard-coded: bundled sounds come from the plugin's own folder and system sounds are enumerated from disk, so a sound that is not installed is simply absent from the list.

**A finished timer fills the ring** rather than emptying it. Drawn literally, the moment that most needs to be seen would be blank.

## About Mate Wish Key

This plugin comes out of **[Mate Wish Key](https://matewishkey.com/)** — a show built on one question:

> What can someone who has never written code build in a few hours?

Someone brings a problem out of their business, points an AI agent at it on their own computer, live, and we talk while it works. Unedited, start to finish.

This plugin was built the same way. Every episode's code is public, and so is this.

- 📺 **YouTube** — [@matewishkey](https://www.youtube.com/@matewishkey)
- 🟣 **Twitch** — [twitch.tv/matewishkey](https://www.twitch.tv/matewishkey)
- 🌐 **Site** — [matewishkey.com](https://matewishkey.com/) · [RSS](https://matewishkey.com/rss.xml)
- ✉️ **Contact** — contact@matewishkey.com

## Contributing

Issues and pull requests are welcome. Please run `npm test` and `npx streamdeck validate` before opening one.

If you fork this into your own plugin, change the UUID in `manifest.json` and replace the brand assets — see [NOTICE.md](NOTICE.md).

## Licence

[MIT](LICENSE) — free to use, modify and distribute.

The Mate Wish Key name, logo and brand colours are trademarks and are **not** covered by the MIT licence; `ui/sdpi-components.js` is Elgato's property inspector library, vendored for offline use under its own licence. Both are spelled out in [NOTICE.md](NOTICE.md).
