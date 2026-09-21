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

A single tap acts a quarter of a second after your finger lifts, not the instant it does — that is the window in which a second tap would make it a reset. There is no way to have both an instant pause and a double tap, and a reset that briefly flashes "paused" first would be worse than the wait. **On a key the window is half a second**, because a physical key is slower to press twice than glass is to tap twice.

Neither the reset nor the hold starts anything. Putting a clock back to the top and setting it running are two decisions, and a gesture that makes both takes the second one away from you — there would be no way to reset without immediately committing to a fresh run.

Holding **loads** the next preset rather than running it. Choosing what to time is not the same as starting it.

And it puts things right before it moves on: if the clock is running, paused, finished, or dialled off its preset, the first hold stops it and returns it to full — only a hold with nothing left to put right moves to another preset.

Turning **never edits a preset** — running or stopped, it moves the clock in front of you and leaves the configuration alone. While the two disagree the label says so, reading `from 20m`, and holding the screen puts the clock back.

**The step is your finger.** A free turn is one second a click; a turn made with the dial pushed in is one minute a click. There is nothing to set, nothing that stays set, and nothing on screen reminding you which state you left it in. Let go and it is seconds again.

There is no hour step. Nothing you dial by hand is four hours long — that is a preset, typed in the property inspector, and the dial is for nudging what a preset loaded.

**Pressing the dial starts and pauses the clock.** A press that did not turn the dial is the start/stop control; a press that *did* turn it was a minute-step adjustment, and letting go simply ends the turn. **Holding the knob** puts the clock back on its preset, the same as holding the touchscreen — decided on release rather than by a timer, so leaning on it to wind in minutes still means nothing however long the wind takes.

## Feedback

There is no haptic feedback to be had on this hardware — the SDK exposes no such command, and there is no motor to drive if it did. Two things stand in for it, doing different jobs:

- **The ring pulses** on every gesture and every tick of the dial. It says only that *something* registered, which is the part you catch without reading — you cannot read a word per tick, but you can see the ring answer every one of them.
- **A line names the action** — `+10s`, `start`, `pause`, `resume`, `reset`, `preset · 20m`, `next · 20m` — for about a second, then gives way to the finish time on a dial, or to the preset's length on a key.

**[How the dial and the presets work →](docs/how-it-works.md)** — the dial's step model and the presets, and the four designs that came before this one.

## Features

- **Presets** — 5, 20, 30 and 40 minutes out of the box, typed as text. They carry no names of their own, so an unnamed timer is labelled by its length: the display reads `20m`, or `20m 30s` once nudged off a round number. The dial cannot overwrite them.
- **Several steps in one preset** — type `40, 10, 10` and the timer runs forty minutes, then ten, then ten, with no gap between them. The line under the clock counts them off as `×2/3`, and says `done` when the list runs out. A bare number is minutes; `90s`, `1h30m` and `10m x3` say the rest. Up to twenty steps.
- **A title**, if you want one — `Tea` on the line under the clock rather than `20m`. It is the plugin's own field, not Stream Deck's Title box; see *The key draws its own text*, below, for why.
- **Countdown ring** that empties as the timer runs, with the clock beside it. A progress bar is available instead.
- **Seven colour themes**. The middle of the ring shows the state — running, paused, done — and, on an idle clock, an optional logo instead.
- **A pause glyph** rather than a colour change, so the state is stated outright.
- **Fade near the end** — the same colour, shaded and unshaded, from a threshold you set in minutes and seconds, capped at half the current step's own length so a fresh timer never starts already fading.
- **Sound when finished**, repeatable up to sixty times, at a volume you set. Choose a bundled sound, any sound already installed on your machine, or your own file. Repeats play one after the other, never on top of one another.
- **A press silences an alert that is playing, and does nothing else** — so a high repeat count is an alarm you can actually call off. It will not start, pause or reset the clock, so you cannot quieten a sound into changing what the timer was doing; press again for the gesture you meant, or press and hold — the dial, the touchscreen or a key — to silence it and put the timer right in one go. Every step of a multi-step preset gets its own alert. Optionally drop to half volume after the third play.
- **Clear itself when finished**, after a wait you set. A finished timer otherwise sits reading `done` until somebody presses it, which is right for a timer you are watching and wrong for one on a page you left; switch this on and it goes back to a full, stopped clock on the preset's first step, on its own. It waits for the whole job, every step of it.
- **Finish time** — `ends 14:35`, more useful than a raw remaining count on a long timer.
- **Copy diagnostics**, at the bottom of the property inspector. One press puts the plugin version, the machine, the Stream Deck application version and connected device, and any recent warnings and errors on the clipboard — ready to paste into a bug report. It costs nothing until it is pressed; nothing is collected in the background and nothing leaves your machine on its own.
- **Timers survive a page or profile switch** — flip away and back and the clock is where you left it, still counting. They do not survive the plugin restarting, and one that ran out while you were away comes back silent rather than sounding an alarm for a moment that has passed.
- Anything up to **24 hours**.

## Developing

Stream Deck runs on macOS and Windows only, so the plugin cannot be *run* on Linux — but it can be built and driven headlessly there.

```sh
npm install
npm run build      # bundle into com.matewishkey.dial-countdown-v2.sdPlugin/bin
npm test           # 400 tests — 53 of them drive the property inspector in a browser
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
| `src/diagnostics.ts` | Gathers the report behind *Copy diagnostics* — this plugin's log and Stream Deck's own, filtered to warnings and errors. Asks the process where its log is rather than deriving it. |
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

Constraints that are not obvious from the code, and that a tidy-up would otherwise undo.

**Settings are never trusted.** Stream Deck keeps an action's settings across an uninstall, so every build is handed settings written by an older one. `normaliseSettings` rebuilds a known-good object from whatever arrived and the result is written back on first appearance.

**The ring is SVG, not canvas.** Plugins run under `--no-addons` and cannot load native modules. A `pixmap` layout item accepts a raw SVG string; text is left to real `text` items so it uses Stream Deck's own font rendering.

**The countdown works from a deadline**, not by accumulating ticks, so a slow or skipped frame cannot make it drift.

**`setImage` takes a data URI, not raw SVG markup.** The key action shipped raw markup and drew nothing on hardware. Elgato's two sources disagree on whether raw markup is valid, so the data URI is the form known to work — do not "simplify" it back.

**`UserTitleEnabled` is false, and the title is the plugin's own field.** Stream Deck stops honouring `setTitle` once the user types a title, and would composite theirs over the key face. Neither dial layout has a `title` item.

**Frames are re-asserted every two seconds.** Dropping unchanged frames assumes every frame sent arrives, and nothing can ask the hardware what it is showing. Awaiting `setFeedbackLayout` does not help: `send` resolves when the command reaches the socket, not when Stream Deck applies it.

**A finished timer fills the ring** rather than emptying it, so the moment that most needs to be seen is not blank.

**No audio API exists in the SDK.** `src/sound.ts` hands a file to `afplay` or PowerShell's WPF `MediaPlayer` — chosen over `SoundPlayer`, which cannot set volume. It finds bundled sounds relative to `process.cwd()`, which is the `.sdPlugin` directory at runtime; `test/sound.test.ts` must therefore `chdir` there *before* importing it, hence its dynamic import.

**The mark is read, not transcribed.** `tools/make-icons.mjs` parses `assets/mwk-mark.svg`. `src/render.ts` holds the one unavoidable literal — it is bundled and has no filesystem — and `test/mark.test.ts` asserts the two match path-for-path.

**Icons shown inside the Stream Deck application must be white** — monochromatic `#FFFFFF`, transparent background. A Marketplace submission was rejected on this. A key's `States[].Image` is the button face and keeps the brand red.

**The property inspector cannot import from `src/`.** It is a plain page, not part of the bundle, so it carries its own copy of the clamps and constants. `test/inspector.test.ts` asserts the copies agree; if you add a helper it needs, either it goes inline or something in `src/` must actually call it.

**A test cannot import either action subclass.** `@action` decorators survive Node's type stripping, so importing them is a `SyntaxError`. `test/actions.test.ts` drives the abstract `CountdownAction` through its own minimal subclass, which is why `npm run demo` matters — the subclasses' event handlers are only exercised there.

**A tool that a test imports must carry JSDoc types and be in `tsconfig.test.json`.** Without them every value crossing the import is `any`, which does not fail a typecheck — it *disables* the type-aware lint rules wherever it lands.

**Tests resolve imports through `test/ts-resolve.mjs`.** `src/` is written for rollup, which fills in file extensions; Node's ESM resolver does not.

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
