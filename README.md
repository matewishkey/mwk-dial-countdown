# Dial Timer

A countdown timer for the Stream Deck + dials. Tap the touchscreen to cycle presets, press the dial to start or pause, hold it to reset, turn it to adjust.

Each of the four dials holds its own independent timer.

## Gestures

| Gesture | Does |
| --- | --- |
| Tap touchscreen | Next preset |
| Hold-tap touchscreen | Previous preset |
| Press dial (short) | Start / pause |
| Press dial (hold ~0.6s) | Reset to full |
| Turn | ±10 seconds |
| Press + turn | ±60 seconds |

Turning an idle timer edits that preset's duration and persists it. Turning a running timer nudges only the time left, leaving the preset alone.

## Presets

Ship as 5, 20, 30 and 40 minutes, and carry no names — a timer's length is its own label, so the touchscreen title is derived from the duration (`20m`, or `20m 30s` once it has been nudged off a round number). Durations are edited in minutes in the property inspector.

## Developing

Stream Deck itself runs on macOS and Windows only, so the plugin cannot be *run* on Linux — but it can be built and driven headlessly there.

```sh
npm install
npm run build      # bundle into com.mergodon.dial-timer.sdPlugin/bin
npm test           # countdown state machine
npm run demo       # scripted gesture pass, prints one frame per step
npm run mock       # same harness, driven from the keyboard
```

`tools/mock-host.mjs` impersonates the Stream Deck application. A plugin is only a Node process launched with `-port`, `-pluginUUID`, `-registerEvent` and `-info` that connects back to `ws://127.0.0.1:<port>`, so the harness plays that role: it spawns the built plugin, answers the registration handshake, sends real dial events, and draws whatever comes back on the touchscreen. That covers everything except how the screen actually looks.

Note the plugin process is launched with its `.sdPlugin` directory as the working directory — the SDK resolves `manifest.json` and its log directory from `process.cwd()`, and will exit immediately if launched from anywhere else.

### On a Mac, against real hardware

```sh
npx streamdeck dev                              # enable developer mode, once
npx streamdeck link com.mergodon.dial-timer.sdPlugin
npm run watch                                   # rebuild + restart on save
```

### Packaging

```sh
npx streamdeck validate com.mergodon.dial-timer.sdPlugin
npx streamdeck pack com.mergodon.dial-timer.sdPlugin
```

## Layout

- `src/timer.ts` — the countdown state machine. No Stream Deck imports and an injectable clock, so it is tested directly.
- `src/actions/dial-timer.ts` — maps dial events onto that state machine and renders to the touchscreen.
- `com.mergodon.dial-timer.sdPlugin/` — the plugin bundle: manifest, icons, property inspector.
- `tools/mock-host.mjs` — the fake Stream Deck host.

`sdpi-components.js` is vendored into `ui/` rather than loaded from a CDN (as Elgato's template does) so the property inspector works offline and the shipped plugin carries no third-party runtime dependency.

## Not done yet

- **Sound has never run on a real machine.** The playback code is written for both platforms but this is a Linux box, so neither `afplay` nor the PowerShell path has actually executed. Everything else here is verified; this is not.
- **Auto-repeat, interval/break cycles, and a count-up stopwatch** — the features comparable plugins have and this one does not.
- **Showing the finish time** ("ends at 14:35"), which nothing on the Marketplace appears to do and which beats a raw remaining count for long timers.
- **Marketplace assets.** Icons are functional placeholders, not designed. `Nodejs.Debug` is still `enabled` in the manifest and should come out before release.

## Acceleration

Turning accelerates: 10 seconds per tick for a nudge, a minute once the dial is being wound, five minutes when it is wound hard. Momentum is built from tick count rather than event count, so a single fast flick escalates as readily as a sustained turn, and any pause longer than `IDLE_RESET_MS` drops straight back to fine control. Holding the dial is a flat minute a tick and deliberately does not compound with momentum.

## Sound

The SDK has no audio API, so `src/sound.ts` hands a file to the platform's own player: `afplay -v <0-1>` on macOS, and PowerShell's WPF `MediaPlayer` on Windows (chosen over `SoundPlayer`, which cannot set volume). Nothing is hard-coded — bundled sounds come from the plugin's own `sounds/` folder and system sounds are enumerated from disk, so a sound that is not installed is simply absent from the list rather than a path that fails when it matters.

## The ring

`src/render.ts` builds the countdown ring as an SVG string, which a `pixmap` layout item accepts directly. That matters because plugins run under `--no-addons` and cannot load native modules, so no canvas library is available. Text is left to real `text` layout items so it uses Stream Deck's own font rendering.

A finished timer draws a *full* ring in the elapsed colour rather than an empty one — left to the arithmetic it would draw nothing at the exact moment the user most needs to see something.
