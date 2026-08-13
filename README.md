# MWK Dial Countdown

[![MIT](https://img.shields.io/badge/licence-MIT-e2342b)](LICENSE)
[![Stream Deck +](https://img.shields.io/badge/Stream%20Deck-%2B-101317)](https://www.elgato.com/stream-deck-plus)

A countdown timer for the **Stream Deck +** dials, and for ordinary keys. Tap to pause or resume, tap twice to restart, hold for the next preset — and on a dial, turn to adjust.

Two actions ship, sharing everything but the control they run on:

- **Countdown** — a dial, with the countdown ring on the touchscreen above it.
- **Countdown (Key)** — the same timer on a button, drawing its own clock inside the ring.

Every dial and every key holds its own independent timer.

> The dial action requires a Stream Deck **+** or **+ XL**. The key action runs on any Stream Deck. Both need the Stream Deck app 7.1 or newer, on macOS or Windows.

## Install

Download the latest `.streamDeckPlugin` from [Releases](https://github.com/matewishkey/mwk-dial-countdown/releases) and double-click it. Stream Deck installs it and adds **MWK Dial Countdown** to the actions list; drag **Countdown** onto a dial, or **Countdown (Key)** onto a button.

## Gestures

The same three gestures on both actions — the touchscreen on a dial, the button itself on a key:

| Gesture | Does |
| --- | --- |
| One tap | Pause / resume |
| Two taps | Restart from the top, and straight off again |
| Hold | Load the next preset — **without** starting it |

And on a dial, the encoder as well:

| Gesture | Does |
| --- | --- |
| Press dial | Next preset |
| Hold dial | Previous preset |
| Turn | Adjust — accelerates 1s → 10s → 1min → 10min a tick |
| Press + turn | A flat 1 minute a tick |

The screen owns the gestures used constantly, because pressing a dial in is a fiddly, two-handed movement next to tapping the screen directly above it; the dial owns preset cycling, which is used far less often.

A single tap acts a quarter of a second after your finger lifts, not the instant it does — that is the window in which a second tap would make it a restart. There is no way to have both an instant pause and a double tap, and a restart that briefly flashes "paused" first would be worse than the wait.

Holding **loads** the next preset rather than running it. Choosing what to time is not the same as starting it, and with one preset configured it simply stays where it is.

Turning an **idle** timer edits that preset's duration and saves it. Turning a **running** timer nudges only the time left, leaving the preset alone.

## Feedback

There is no haptic feedback to be had on this hardware — the SDK exposes no such command, and there is no motor to drive if it did. Two things stand in for it, doing different jobs:

- **The ring pulses** on every gesture and every tick of the dial. It says only that *something* registered, which is the part you catch without reading — you cannot read a word per tick, but you can see the ring answer every one of them.
- **A line names the action** — `+10s`, `pause`, `resume`, `restart`, `next · 20m` — for about a second, then gives way to the finish time on a dial, or to the preset's name on a key.

**[How the dial and the presets work →](docs/how-it-works.md)** — the acceleration logic and the preset model, explained.

## Features

- **Presets** — 5, 20, 30 and 40 minutes out of the box, edited as hours, minutes and seconds, or with the dial itself. They carry no names: a timer's length is its own label, so the display reads `20m`, or `20m 30s` once nudged off a round number.
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
npm run build      # bundle into com.matewishkey.dial-countdown.sdPlugin/bin
npm test           # 105 unit tests
npm run demo       # scripted gesture pass, prints one frame per step
npm run mock       # the same harness, driven from the keyboard
```

`tools/mock-host.mjs` impersonates the Stream Deck application. A plugin is only a Node process launched with `-port`, `-pluginUUID`, `-registerEvent` and `-info` that connects back to `ws://127.0.0.1:<port>`, so the harness plays that role: it spawns the built plugin, answers the registration handshake, sends real dial events, and draws whatever comes back on the touchscreen. That covers everything except how the screen actually looks.

The plugin process is launched with its `.sdPlugin` directory as the working directory — the SDK resolves `manifest.json` and its log directory from `process.cwd()`, and exits immediately if launched from anywhere else.

### Against real hardware

```sh
npx streamdeck dev                                  # enable developer mode, once
npx streamdeck link com.matewishkey.dial-countdown.sdPlugin
npm run watch                                       # rebuild + restart on save
```

### Packaging

```sh
npx streamdeck validate com.matewishkey.dial-countdown.sdPlugin
npx streamdeck pack com.matewishkey.dial-countdown.sdPlugin
```

## How it fits together

| File | Does |
| --- | --- |
| `src/timer.ts` | The countdown state machine. No Stream Deck imports and an injectable clock, so it is tested directly. |
| `src/settings.ts` | The settings shape, and the only place they are read. |
| `src/acceleration.ts` | Turns dial rotation into a step size. |
| `src/render.ts` | Draws the countdown ring, and the whole key face, as SVG. |
| `src/sound.ts` | Hands a sound file to the platform's own player. |
| `src/gestures.ts` | Turns raw presses into `toggle` / `restart` / `next`, double taps included. |
| `src/feedback.ts` | How long a gesture is acknowledged for, and in what words. |
| `src/countdown.ts` | Everything a countdown *is*, minus the Stream Deck — shared by both actions. |
| `src/actions/countdown-action.ts` | The half of an action that does not care which control it is on. |
| `src/actions/dial-countdown.ts` | Dial events, and the touchscreen layout. |
| `src/actions/key-countdown.ts` | Key events, and the key face. |
| `tools/mock-host.mjs` | A stand-in for the Stream Deck application. |

A few decisions worth knowing before changing things:

**Settings are never trusted.** Stream Deck keeps an action's settings across an uninstall, so every build is handed settings written by an older one. `normaliseSettings` rebuilds a known-good object from whatever arrived — unrecognised keys discarded, numbers clamped, a broken preset index repaired, legacy shapes unwrapped — and the result is written back on first appearance.

**The ring is SVG, not canvas.** Plugins run under `--no-addons` and cannot load native modules, so no canvas library is available. A `pixmap` layout item accepts a raw SVG string, which is the way through. Text is left to real `text` layout items so it uses Stream Deck's own font rendering.

**The countdown works from a deadline**, not by accumulating ticks, so a slow or skipped render frame cannot make it drift.

**There is no audio API in the SDK.** `src/sound.ts` hands a file to `afplay` on macOS, or PowerShell's WPF `MediaPlayer` on Windows — chosen over `SoundPlayer`, which cannot set volume. Nothing is hard-coded: bundled sounds come from the plugin's own folder and system sounds are enumerated from disk, so a sound that is not installed is simply absent from the list.

**A finished timer fills the ring** rather than emptying it. Drawn literally, the moment that most needs to be seen would be blank.

**The key draws its own text.** `setTitle` is the only text facility a key has, and Stream Deck stops honouring it the moment the user types a title of their own — a clock that silently stops being a clock because someone labelled the button is not a clock. So the key face is one SVG, digits included, and the title is left free for whatever the user wants it for.

**Frames are re-asserted every couple of seconds**, even when nothing has changed. Dropping unchanged frames assumes every frame sent arrives, and there is no way to ask the hardware what it is actually showing — so on a display that is static for long stretches, one lost frame would stay lost. This is not hypothetical: Stream Deck discards feedback sent alongside a layout switch, which left the ring showing the layout's fallback for an undrawn pixmap — the action's own red icon — until the dial was touched. The pixmap now defaults to nothing rather than to that icon, and the re-assert bounds any dropped frame to two seconds.

**The tests resolve imports through a hook.** `src/` is written for rollup, which fills in file extensions; Node's ESM resolver deliberately does not, so `test/ts-resolve.mjs` does that one job and nothing else.

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
