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

- **Sound on completion.** The SDK has no audio API, so this means shelling out to a per-OS player (`afplay` on macOS, something bundled on Windows), which is also where the volume control has to come from.
- **Custom countdown ring.** Currently uses Elgato's built-in `$B1` layout. A custom ring needs a `pixmap` layout item, and since plugins run with `--no-addons` there is no canvas library available — so it depends on whether `pixmap` accepts an SVG data URI. Unconfirmed.
- **Marketplace assets.** Icons are functional placeholders, not designed. `Nodejs.Debug` is still `enabled` in the manifest and should come out before release.
