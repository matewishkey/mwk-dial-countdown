# Dial Countdown

[![MIT](https://img.shields.io/badge/licence-MIT-e2342b)](LICENSE)
[![Stream Deck +](https://img.shields.io/badge/Stream%20Deck-%2B-101317)](https://www.elgato.com/stream-deck-plus)

A countdown timer for **Stream Deck** dials, and for ordinary keys. Press the dial to start or pause, turn it to adjust by seconds, or push it in and turn to adjust by minutes. On the screen and on a key: tap to pause or resume, tap twice to reset it to the preset, hold for the next preset.

Two actions ship, sharing everything but the control they run on:

- **Countdown** — a dial, with the countdown ring on the touchscreen above it.
- **Countdown (Key)** — the same timer on a button, drawing its own clock inside the ring.

Every dial and every key holds its own independent timer.

> The dial action requires a Stream Deck **+** or **+ XL**. The key action runs on any Stream Deck. Both need the Stream Deck app 7.1 or newer, on macOS or Windows.

## Install

Download the latest `.streamDeckPlugin` from [Releases](https://github.com/matewishkey/mwk-dial-countdown/releases) and double-click it. Stream Deck installs it and adds **Dial Countdown** to the actions list; drag **Countdown** onto a dial, or **Countdown (Key)** onto a button.

**Upgrading from a version before 2.0.0?** The plugin's identifier changed, so Stream Deck treats this as a different plugin: your existing buttons stop resolving and do not carry over. Remove the old one from Stream Deck's preferences first, then install this and place the actions again. [Why](CHANGELOG.md#200--2026-08-20).

## Gestures

The same three gestures on both actions — the touchscreen on a dial, the button itself on a key:

| Gesture | Does |
| --- | --- |
| One tap | Pause / resume |
| Two taps | Reset the clock to full — stopped, not started |
| Hold | Put the clock right if it is not, otherwise load the next preset — **without** starting it |

And on a dial, the encoder as well:

| Gesture | Does |
| --- | --- |
| Turn | ±1 second a click |
| Push the dial in and turn | ±1 minute a click |
| Press the dial | Start / pause |

The dial owns the two things you do constantly — nudge the clock, and start or stop it — because your hand is already on it. The screen owns the rest: resetting, and choosing which preset you are timing.

A single tap acts a quarter of a second after your finger lifts, not the instant it does — that is the window in which a second tap would make it a reset. There is no way to have both an instant pause and a double tap, and a reset that briefly flashes "paused" first would be worse than the wait.

Neither the reset nor the hold starts anything. Putting a clock back to the top and setting it running are two decisions, and a gesture that makes both takes the second one away from you — there would be no way to reset without immediately committing to a fresh run.

Holding **loads** the next preset rather than running it. Choosing what to time is not the same as starting it.

And it puts things right before it moves on: if the clock is running, paused, finished, or dialled off its preset, the first hold stops it and returns it to full — only a hold with nothing left to put right moves to another preset.

Turning **never edits a preset** — running or stopped, it moves the clock in front of you and leaves the configuration alone. While the two disagree the label says so, reading `from 20m`, and holding the screen puts the clock back.

**The step is your finger.** A free turn is one second a click; a turn made with the dial pushed in is one minute a click. There is nothing to set, nothing that stays set, and nothing on screen reminding you which state you left it in. Let go and it is seconds again.

There is no hour step. Nothing you dial by hand is four hours long — that is a preset, typed in the property inspector, and the dial is for nudging what a preset loaded.

**Pressing the dial starts and pauses the clock.** A press that did not turn the dial is the start/stop control; a press that *did* turn it was a minute-step adjustment, and letting go simply ends the turn. There is no long press on the dial at all, which is what lets you lean on it for as long as a wind takes without a third meaning quietly accruing.

## Feedback

There is no haptic feedback to be had on this hardware — the SDK exposes no such command, and there is no motor to drive if it did. Two things stand in for it, doing different jobs:

- **The ring pulses** on every gesture and every tick of the dial. It says only that *something* registered, which is the part you catch without reading — you cannot read a word per tick, but you can see the ring answer every one of them.
- **A line names the action** — `+10s`, `start`, `pause`, `resume`, `reset`, `preset · 20m`, `next · 20m` — for about a second, then gives way to the finish time on a dial, or to the preset's length on a key.

**[How the dial and the presets work →](docs/how-it-works.md)** — the step model and the presets, and the four designs that came before this one.

## Features

- **Presets** — 5, 20, 30 and 40 minutes out of the box, edited as hours, minutes and seconds. They carry no names of their own, so an unnamed timer is labelled by its length: the display reads `20m`, or `20m 30s` once nudged off a round number. The dial cannot overwrite them.
- **A title**, if you want one — `Tea` on the line under the clock rather than `20m`. It is the plugin's own field, not Stream Deck's Title box; see *The key draws its own text*, below, for why.
- **Countdown ring** that empties as the timer runs, with the clock beside it. A progress bar is available instead.
- **Seven colour themes**. The middle of the ring shows the state — running, paused, done — and, on an idle clock, an optional logo instead.
- **A pause glyph** rather than a colour change, so the state is stated outright.
- **Fade near the end** — the same colour, shaded and unshaded, from a threshold you set in minutes and seconds, capped at half the preset's own length so a fresh timer never starts already fading.
- **Sound when finished**, repeatable up to ten times, at a volume you set. Choose a bundled sound, any sound already installed on your machine, or your own file.
- **Auto-repeat**, counting laps on screen — `×2/3` while it runs, `done ×3/3` once it is over. The limit is a total number of runs, and it is a limit because nothing here should still be going tomorrow.
- **Clear itself when finished**, after a wait you set. A finished timer otherwise sits reading `done` until somebody presses it, which is right for a timer you are watching and wrong for one on a page you left; switch this on and it goes back to a full, stopped clock — repeat tally included — on its own. It waits for the whole job, repeats and all.
- **Finish time** — `ends 14:35`, more useful than a raw remaining count on a long timer.
- **Timers survive a page or profile switch** — flip away and back and the clock is where you left it, still counting. They do not survive the plugin restarting, and one that ran out while you were away comes back silent rather than sounding an alarm for a moment that has passed.
- Anything up to **24 hours**.

## Developing

Stream Deck runs on macOS and Windows only, so the plugin cannot be *run* on Linux — but it can be built and driven headlessly there.

```sh
npm install
npm run build      # bundle into com.matewishkey.dial-countdown-v2.sdPlugin/bin
npm test           # 305 tests — 41 of them drive the property inspector in a browser
npm run check      # everything CI runs: typecheck, lint, format, tests, versions
npm run demo       # scripted gesture pass, prints one frame per step
npm run mock       # the same harness, driven from the keyboard
```

`npm run check` is the one to run before pushing; [CI](.github/workflows/ci.yml) runs the same checks on
every push — plus a build and a `streamdeck validate`, which `check` deliberately leaves out because
they are slower and only matter before a release. Chromium is installed there, so the browser suite is
never quietly skipped.

Two of those deserve a note. **`npm run typecheck` uses `tsconfig.test.json`, not `tsconfig.json`** —
the latter covers `src/` only, because that is what rollup bundles, and for a long time it meant the
tests were stripped of their types without anything checking them. **Prettier does not touch
Markdown**: it rewrites `*emphasis*` as `_emphasis_` and re-pads every table, which is churn in a repo
where the prose is written rather than generated.

`tools/mock-host.mjs` impersonates the Stream Deck application. A plugin is only a Node process launched with `-port`, `-pluginUUID`, `-registerEvent` and `-info` that connects back to `ws://127.0.0.1:<port>`, so the harness plays that role: it spawns the built plugin, answers the registration handshake, sends real dial events, and draws whatever comes back on the touchscreen. That covers everything except how the screen actually looks.

The plugin process is launched with its `.sdPlugin` directory as the working directory — the SDK resolves `manifest.json` and its log directory from `process.cwd()`, and exits immediately if launched from anywhere else.

### Against real hardware

```sh
npx streamdeck dev                                  # enable developer mode, once
npx streamdeck link com.matewishkey.dial-countdown-v2.sdPlugin
npm run watch                                       # rebuild + restart on save
```

### Packaging and releasing

```sh
npm run release          # check, build, pack, validate, demo, tag, push, publish, verify, page
```

One command, in one order, every time — because commands typed by hand end up in a different order
each time. It runs `npm run check`, the version check against the tag, the build, `streamdeck pack`
(paired with `prettier`, since pack rewrites the manifest on its way past and that is how v3.1.0 was
tagged on a red build), `streamdeck validate` and the demo pass against the built plugin — then
**tags, pushes, creates the GitHub release, and downloads the published asset back to check it is
this same build.**

That last part is one step rather than two on purpose. **A pushed tag is not a release**: they are
separate acts on separate systems with nothing linking them, a tag with no release looks identical to
every other tag, and v3.2.0 reached Marketplace with none behind it. Doing both together closes the
gap by construction rather than by remembering.

It is **idempotent** — a plan computed from the current state, where each act happens only if it has
not happened — so running it again does nothing, and a half-finished publish is fixed by running the
same command. It **refuses rather than forces**: a dirty tree, a tag already naming a different
commit, or a published release carrying a different build each stop it with the reason. The one thing
left by hand is the Marketplace submission, which has no API; the page it writes carries the notes to
paste.

**[docs/releasing.md](docs/releasing.md)** is the whole policy, and the one rule it turns on is this: *the version number describes the `.streamDeckPlugin` file and nothing else*. Repo-only work — tests, docs, tooling — lands in [CHANGELOG.md](CHANGELOG.md) under *Unreleased* and rides the next real release, because the number is what the Stream Deck application shows the user and every Marketplace version is a human review.

The version lives in three places in three formats — `1.1.0`, `1.1.0.0`, `v1.1.0` — and they have drifted before: the manifest sat at `0.1.0.0` through nine releases, so the application reported the same version whichever build was installed, which is the one question it is asked. `npm run version:check` is what now stops that.

## How it fits together

| File | Does |
| --- | --- |
| `src/timer.ts` | The countdown state machine. No Stream Deck imports and an injectable clock, so it is tested directly. |
| `src/settings.ts` | The settings shape, and the only place they are read. |
| `src/step.ts` | How much time one click is worth. A second, or a minute while the dial is pushed in. |
| `src/render.ts` | Draws the countdown ring, and the whole key face, as SVG. |
| `src/sound.ts` | Hands a sound file to the platform's own player. |
| `src/gestures.ts` | Turns raw presses into `toggle` / `reset` / `next`, double taps included. |
| `src/feedback.ts` | How long a gesture is acknowledged for, and in what words. |
| `src/label.ts` | The line under the clock — the rule both controls share, and how each narrows it. |
| `src/countdown.ts` | Everything a countdown *is*, minus the Stream Deck — shared by both actions. |
| `src/actions/countdown-action.ts` | The half of an action that does not care which control it is on. |
| `src/actions/dial-countdown.ts` | Dial events, and the touchscreen layout. |
| `src/actions/key-countdown.ts` | Key events, and the key face. |
| `src/plugin.ts` | Registers both actions and connects. |
| `…sdPlugin/layouts/` | `ring.json` and `bar.json` — the two touchscreen layouts, both the plugin's own. |
| `tools/mock-host.mjs` | A stand-in for the Stream Deck application. |
| `test/inspector-harness.mjs` | Drives the property inspector in a real browser, so its inline JavaScript can be tested. |
| `tools/make-icons.mjs` | Draws every icon from `assets/mwk-mark.svg` — white for the app, red for the hardware. The plugin's own icon is the countdown ring, drawn by `renderRing`. Rasterises with headless Chromium; see [docs/releasing.md](docs/releasing.md). |
| `tools/check-version.mjs` | Holds `package.json`, `manifest.json` and the git tag to the same version. |
| `tools/release.mjs` | The release, in one command and one order: check, build, pack, validate, demo, tag, push, publish, verify. Writes the page. |
| `tools/publish-plan.mjs` | What publishing still has to do, and what it must refuse — pure, so every refusal is tested without publishing anything. |
| `tools/release-notes.mjs` | Turns a changelog entry into the two shapes a release needs — whole for GitHub, and cut to 1500 characters for Marketplace without cutting a word. |
| `tools/package-id.mjs` | A reproducible id for a packaged plugin. `pack` stamps the packing time into every entry, so the file's own hash is not reproducible; this hashes the contents instead. |
| `tsconfig.test.json` | The typecheck config: `src/`, `test/` **and** `tools/`. `tsconfig.json` is rollup's, and covers only what it bundles. |
| `eslint.config.mjs` | Type-aware lint rules. Formatting is left entirely to Prettier, so the two cannot disagree. |
| `assets/mwk-mark.svg` | The brand's own mark, as supplied. The one source the artwork is generated from. |

A few decisions worth knowing before changing things:

**Settings are never trusted.** Stream Deck keeps an action's settings across an uninstall, so every build is handed settings written by an older one. `normaliseSettings` rebuilds a known-good object from whatever arrived — unrecognised keys discarded, numbers clamped, a broken preset index repaired, legacy shapes unwrapped — and the result is written back on first appearance.

**The ring is SVG, not canvas.** Plugins run under `--no-addons` and cannot load native modules, so no canvas library is available. A `pixmap` layout item accepts a raw SVG string, which is the way through. Text is left to real `text` layout items so it uses Stream Deck's own font rendering.

**The countdown works from a deadline**, not by accumulating ticks, so a slow or skipped render frame cannot make it drift.

**There is no audio API in the SDK.** `src/sound.ts` hands a file to `afplay` on macOS, or PowerShell's WPF `MediaPlayer` on Windows — chosen over `SoundPlayer`, which cannot set volume. Nothing is hard-coded: bundled sounds come from the plugin's own folder and system sounds are enumerated from disk, so a sound that is not installed is simply absent from the list.

**A finished timer fills the ring** rather than emptying it. Drawn literally, the moment that most needs to be seen would be blank.

**The key draws its own text, and so the title is the plugin's own field.** `setTitle` is the only text facility a key has, and Stream Deck stops honouring it the moment the user types a title of their own — a clock that silently stops being a clock because someone labelled the button is not a clock. So the key face is one SVG, digits included, and `UserTitleEnabled` is false in the manifest.

That leaves the title to the property inspector, which turns out to be the better place for it anyway. The dial could not have used the native field either: neither touchscreen layout has a `title` item, so a title typed into Stream Deck had nowhere to land on a dial and could only land *on top of* the clock on a key. Owning the field is what lets the same name appear in the same place on both, and it is why the switch that used to be called *Show the title* is now *Show the label* — it never named a title, it switched the line the title now goes on. `normaliseSettings` carries the old key across.

**Send `setImage` a data URI, not raw SVG markup** — and be careful what you conclude from that. Elgato's two sources disagree: the WebSocket reference says the field takes a file path or "a base64 encoded string with the mime type declared", while the SDK's own JSDoc for `setImage` says a path, base64, "or an SVG `string`". The key action shipped raw markup and did nothing on hardware; it works sending the same SVG through `asDataUri`, which is the form the touchscreen ring has always used. What is *not* established is that raw markup was the cause — only that the data URI works. Do not "simplify" it back.

**Frames are re-asserted every couple of seconds**, even when nothing has changed. Dropping unchanged frames assumes every frame sent arrives, and there is no way to ask the hardware what it is actually showing — so on a display that is static for long stretches, one lost frame would stay lost. This is not hypothetical: Stream Deck discards feedback sent alongside a layout switch, which left the ring showing the layout's fallback for an undrawn pixmap — the action's own red icon — until the dial was touched. The pixmap now defaults to a transparent pixel rather than to that icon, and the re-assert bounds any dropped frame to two seconds.

**Awaiting `setFeedbackLayout` fixes nothing.** It is the obvious-looking cure for feedback lost to a layout switch, and it was tried and reverted. The SDK's `send` resolves once the command is written to the socket, not once Stream Deck has applied it, so awaiting it guarantees nothing that ordering on a single socket did not already give. The re-assert above is what actually bounds the problem.

**The mark is read, not transcribed.** `assets/mwk-mark.svg` is the brand's own artwork file. `tools/make-icons.mjs` parses its paths, viewBox and stroke weight rather than carrying a copy, so the icons cannot drift from it. `src/render.ts` is the one place that still needs a literal — it is bundled into the plugin and has no filesystem to read at runtime — so `test/mark.test.ts` asserts that the mark it actually draws is path-for-path the artwork file. A comment promising two files match is a promise nothing checks; that test is the check.

**Icons shown inside the Stream Deck application must be white.** The category icon and both action list icons are a monochromatic `#FFFFFF` stroke on a transparent background, with no colour and no solid backing — Elgato's guidelines require it, and a Marketplace submission was rejected on exactly this. `Encoder.Icon` is white too, which is a judgement call rather than a quoted rule — the guidelines word the colour requirement as "action list icons" and this is not one, but the manifest reference calls it the image "displayed in the Stream Deck application in the circular canvas that represents the dial". White cannot fail that reading; red might. A key's `States[].Image` is the face of the button on the deck itself and keeps the brand red. `tools/make-icons.mjs` is what draws both, so the rule lives in one place rather than in six hand-edited files.

**The property inspector cannot import from `src/`.** It is a plain HTML page loaded by Stream Deck, not part of the rollup bundle, so anything it needs it carries as inline JavaScript — the preset clamps, `MAX_PRESET_SECONDS`, and its own `toParts`. That duplication is forced, and the trap is subtle: `src/settings.ts` once carried `toParts`/`fromParts` too, with tests over them, and *nothing in the plugin called either*. The tested copy was not the running copy, which reads like coverage and is worse than none. Those are gone. If you add a helper the inspector needs, either it goes inline and stays untested, or it goes in `src/` and something in `src/` had better call it.

**A tool that a test imports must carry JSDoc types, and be in `tsconfig.test.json`.** `tools/` is in
that config's `include` and both released-notes modules are annotated, and neither is decoration.
Without them every value crossing a tool import is `any` — and `any` does not fail a typecheck, it
*disables* the type-aware lint rules wherever it lands. `test/release-notes.test.ts` was passing
`any` through a dozen assertions with the linter silent about all of it, which is a more expensive
version of the trap two paragraphs down: it does not merely lack checking, it reads as checked.
`checkJs` stays false — the tools are inferred from, not checked.

**The tests resolve imports through a hook.** `src/` is written for rollup, which fills in file extensions; Node's ESM resolver deliberately does not, so `test/ts-resolve.mjs` does that one job and nothing else.

**A test cannot import either action subclass.** `DialCountdown` and `KeyCountdown` carry an `@action` decorator, and Node's type stripping does exactly what it says — it erases types and leaves decorators standing, so importing `src/actions/dial-countdown.ts` from a test is a `SyntaxError` rather than a test. `test/actions.test.ts` therefore drives `CountdownAction`, the abstract base, through a minimal subclass it declares itself. That reaches everything the two share — the instance map, teardown, the debounced save, suspend and revive, the alert — and reaches none of their own event handlers, which is a real gap and is why `npm run demo` matters. The SDK itself imports fine: `streamDeck.connect()` is a separate call the entry point makes, so nothing connects to anything just by importing it.

**`src/sound.ts` finds its sounds relative to `process.cwd()`**, which is the `.sdPlugin` directory when Stream Deck launches the plugin — the same assumption the SDK makes for `manifest.json` and its log directory, not an extra one. The consequence is only felt in tests: `test/sound.test.ts` has to `chdir` there *before* the module is loaded, which is why it uses a dynamic import rather than a plain one that would be hoisted above the `chdir`.

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

Issues and pull requests are welcome. Please run **`npm run check`** before opening one — it is typecheck, lint, formatting, the tests and the version check in one, and it is exactly what CI gates on, so anything it passes will not come back red.

If you fork this into your own plugin, change the UUID in `manifest.json` and replace the brand assets — see [NOTICE.md](NOTICE.md).

## Licence

[MIT](LICENSE) — free to use, modify and distribute.

The Mate Wish Key name, logo and brand colours are trademarks and are **not** covered by the MIT licence; `ui/sdpi-components.js` is Elgato's property inspector library, vendored for offline use under its own licence. Both are spelled out in [NOTICE.md](NOTICE.md).
