# Changelog

What changed, for whoever installs the plugin. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is explained in
[docs/releasing.md](docs/releasing.md).

Entries under **Unreleased** have landed on `main` but are not in any `.streamDeckPlugin` yet — for
this project that generally means they do not change the packaged plugin at all.

## [Unreleased]

### Internal

Nothing that changes what the plugin does.

- **`docs/how-it-works.md` says how to add a demo step**, and its count of the pass was two steps
  behind. A step that reuses the previous step's preset length inherits that step's clock rather
  than starting a fresh one — `applySettings` reloads only when the *selected* length changed — so
  its first gesture lands on a timer already in motion and reads as the opposite of what it meant.
  It cost a debugging pass while the auto-reset step was being written.

- **`README.md` catches up with the release procedure** — `npm run release:page` was missing from
  the packaging section and `tools/release-page.mjs` from the file table, so the README and
  `docs/releasing.md` described two different releases. The `check-version` example is written
  `v<version>` now rather than naming a release it will fall behind.

- **`docs/releasing.md` says that a pushed tag is not a release.** They are two acts on two systems
  with nothing linking them, and a tag without a release is invisible to both tools — no error
  anywhere, because nothing is wrong from either one's point of view. v3.2.0 went to Marketplace off
  the release page while `gh release create` had never run, so the version in front of Elgato briefly
  had no artefact of record. The doc now carries the three-way `sha256sum` check that settles it, and
  `README.md` says it in a line — where a hygiene sweep also caught the previous commit having added
  the `pack` warning back beside the one already there, with two pointers to `docs/releasing.md` a
  paragraph apart.

## [3.2.0] — 2026-08-31

### Added

- **A title.** Name a timer `Tea` and the line under the clock says so, on the dial and on the key
  alike, instead of the preset's length. Leave it empty and the length comes back, exactly as before.

  It is the plugin's own field, in the property inspector — Stream Deck's Title box stays switched
  off, because neither control can use it. A key draws its whole face as one image and the
  application composites a native title straight over the clock; a dial's touchscreen layouts are the
  plugin's own files with no `title` item and no room for one. This was reported as *the title is
  disabled and I cannot update it*, and it was: `UserTitleEnabled` has been false since 3.1.0. The
  field is now somewhere it can actually work.

  A named timer still reports the drift. `Tea · from 20m` on the dial once the clock has been wound
  off its preset — the name replacing the length must not take the warning with it.

- **Clear itself when finished**, after a wait you set. A finished timer otherwise sits reading
  `done` until somebody presses it, which is right for a timer you are watching and wrong for one on
  a page you left. Switched on, it goes back to a full, stopped clock — repeat tally included — on
  its own.

  It waits for the **whole** job: a repeating timer's earlier laps restart themselves and never reach
  it, so nothing is cleared mid-job. It is silent, since the words under the clock name the gesture
  you just made and nobody made this one. Any press, turn or reset in the meantime calls it off. And
  a timer that ran out while its page was elsewhere is timed from the moment the page came back —
  otherwise it would clear itself on the one frame where seeing `done` is the point.

### Changed

- **_Show the title_ is now _Show the label_.** It never named a title: what it switches is the line
  under the clock, which is where the title now goes. Settings written by an older build are carried
  across, so an install that had the line switched off does not come back with it switched on.

### Internal

Nothing here changes what the plugin does, and none of it goes to Marketplace —
`tools/release-page.mjs` leaves this heading out of the notes it writes for the listing, and keeps it
in the ones for the GitHub release.

- **The label rule lives in one file.** `src/label.ts` holds what the line says; the dial and the key
  each take the part that fits the room they have. It was two copies in two actions, and they had
  already drifted apart once over how a finished repeating timer reads.

- **`manifest.json`'s formatting was restored** after `streamdeck pack` rewrote it while packaging
  3.1.0 — whitespace only, and the packaged manifest parses to the same JSON either way. Recorded
  rather than skipped because `manifest.json` is a file that ships, so a byte comparison against the
  3.1.0 package would show it. Whether an entry like this belongs here at all is
  [an open question](https://github.com/matewishkey/mwk-dial-countdown/issues/14) —
  `docs/releasing.md` currently says two incompatible things about repo-only work, and *Internal* is
  half an answer to it.

- **A release page per version** — `node tools/release-page.mjs` runs every gate, keeps the whole of
  each one's output, packages the notes to paste into the two places that want them, and puts the
  lot on the shared drive. See `docs/releasing.md`.

## [3.1.0] — 2026-08-30

### Added

- **Pick a preset in the property inspector**, by clicking the dot beside it. Holding the screen or
  the key still cycles forward one at a time, which meant the fourth of four presets was three holds
  away with no way back. The panel already showed which one was loaded; now it can be told.

- **Tests for the two parts of the plugin that had none** — sound resolution, and the action
  lifecycle that owns the timers, the redraw loops and the write to disk. Four of the fixes listed
  below were found there, and every one is now held by a test that fails without it.

### Changed

- **A countdown now survives switching page or profile.** It used to be destroyed the moment the
  control left the screen, so flipping to another page for a few seconds lost the count — which for a
  timer is the worst thing that can happen. Running timers come back running, having kept counting
  while they were away; paused ones come back paused with the time they had.

  Two limits, both deliberate. It is held in memory, so **restarting Stream Deck or the plugin still
  starts you afresh** — the alternative means deciding what a timer that "finished" while the
  application was closed should do, and there is no good answer. And a timer that **ran out while you
  were away comes back silent**: the alarm says *the moment has arrived*, and by then it has been and
  gone. The screen still shows it finished.

- **The *Play a sound when done* checkbox is gone.** Choosing **No sound** in the picker is now the
  only way to turn the alert off, because it always was one of two ways to say the same thing — and
  the state where the two disagreed is exactly the bug listed below. If you had the sound switched
  off, it stays off; the setting is carried over for you.

- **The progress-bar display now acknowledges the dial too.** Every gesture and every click of the
  dial pulses a hairline around the state glyph, exactly as it does around the ring. On that display
  it previously did nothing at all, leaving the word on the bottom line as the only acknowledgement —
  which is the half you have to stop and read, and no use at all while winding.

- **Settings belonging to a switch that is off are now greyed out** — the sound picker, volume and
  *Test* button when the sound is off, the fade threshold when the fade is off, the repeat count when
  repeat is off. *Test* in particular would audition a sound the timer itself would never play.

- **The fade threshold can be set beyond an hour**, as the plugin always allowed; the panel stopped
  at 59 minutes.

- **A released build now logs at `info` rather than `trace`.** Trace logging is a development tool;
  leaving it on meant every install wrote a line for every frame of a redraw loop that runs four
  times a second, for as long as the plugin was on screen. `npm run watch` still logs at `trace`.

### Fixed

- **A timer set to *No sound* flashed an error on every finish.** With the alert switched on and the
  sound set to *No sound*, the plugin treated its own silence as a failure to play, so every
  completed countdown raised Stream Deck's alert triangle — on a timer that had done exactly what it
  was told. Silence you asked for is no longer reported as something going wrong. A sound that was
  genuinely wanted and could not be played still is.

- **A preset chosen just before switching page was forgotten.** Holding to load the next preset
  schedules the write a fraction of a second later, so that winding the dial does not write to disk
  on every click. Flipping to another page or profile inside that window threw the write away instead
  of finishing it, and coming back showed the old preset.

- **The touchscreen could be left drawing a countdown that no longer existed.** If Stream Deck ever
  announced the same control twice without announcing its removal in between, the first countdown's
  redraw loop carried on for the life of the plugin with nothing able to stop it.

- **An unrecognised colour theme could blank the ring** instead of falling back to the default one.
  Only reachable from settings written by another build, but the ring drew as nothing at all when it
  happened, rather than drawing in the default colours.

- **The property inspector could corrupt its own defaults**, so a later action added on a fresh
  button started from presets nobody had chosen.

- **Typing a preset could lose the cursor.** The plugin writes settings of its own — loading a preset
  on the hardware saves the new selection — and every such write redrew the preset rows, pulling the
  caret out of whatever was being typed.

## [3.0.1] — 2026-08-30

### Fixed

- **The dial action's tooltip still described the dial that 3.0.0 removed** — "press it to swap between
  one-second and one-minute steps, or hold it for one hour". That text is what Stream Deck shows beside
  the action in its list, so it was the one place a user could still be told to use gestures that no
  longer exist. It now describes the dial as it is: press to start or pause, turn for seconds, push in
  and turn for minutes.

  Nothing else changed. 3.0.0 was tagged but not submitted to Marketplace, so this is the build to ship.

## [3.0.0] — 2026-08-30

### Changed

- **The dial's step is no longer a mode you set — it is whether you are pushing the dial in.**
  Turn for one second a click; push the dial in and turn for one minute a click. Let go and the next
  click is a second again.

  **What you have to relearn:** pressing the dial no longer swaps the step, holding it no longer
  gives you an hour a click, and there is no `step · 1m` on the bottom line any more because there is
  no longer a mode that could be left switched on. Nothing carries over between turns, so there is
  nothing to check before you start turning.

- **Pressing the dial now starts and pauses the clock.** The job you do most often on a countdown is
  now under the hand that is already on the dial, and it acts the instant you let go — the
  touchscreen's single tap has to wait a quarter of a second first, in case a second tap is coming.
  Tapping the screen still works exactly as it did.

  A press that turned the dial is a minute-step adjustment and nothing else; letting go afterwards
  does not start the timer. **There is no long press on the dial at all** — a push is a push however
  long you lean on it, which is what makes holding it in for a long wind safe.

- **"Repeat at most N times" now means N runs in total, and it used to mean N runs *after* the
  first.** A timer set to repeat 3 times ran four times. It now runs three.

- **The middle of the ring shows the state.** A running clock shows a play triangle, a paused one two
  bars, a finished one a filled square — and only an idle clock shows the Mate Wish Key mark, if you
  have left it switched on. Previously the mark was drawn on three states out of four and silently
  swapped for a pause glyph on the fourth, so it looked as though the logo came and went at random,
  and running, idle and finished were told apart only by colour. The setting is now labelled *Logo on
  an idle clock*.

- **The plugin's icon** — the one Stream Deck shows in its preferences — is now the countdown ring
  with the mark inside it, rather than the mark alone. Elgato's guideline asks that it "accurately
  portray what your plugin does", and a monogram portrays the organisation instead. It is drawn by
  the plugin's own `renderRing`, so the icon cannot drift from the thing it depicts.

### Fixed

- **A finished repeating timer said nothing to say it had finished.** It sat on `×3/3` for ever,
  which is character-for-character what it showed while its last lap was still counting down. It now
  reads `20m · ×3/3 · done` on a dial and `done ×3/3` on a key, and the ring shows the done glyph.

- **The progress-bar layout never took the colour theme.** It used Stream Deck's built-in `$B1`
  layout, whose item keys are published nowhere, so the fill colour was being sent to a slot that may
  never have existed — and a feedback key that does not match fails silently. The plugin now ships
  its own `layouts/bar.json`, so every key it sends is a key it defined. The bar view also carries the
  same state glyph the ring does, drawn from the same code.

- **Changing the repeat settings on a finished timer left the old tally counted against the new
  rule** — raising the limit from 3 to 5 after it had stopped showed `×3/5` on a dead clock. A new
  rule now counts from the start of itself.

- **The lap counter appeared a run late.** It read `×0/3` for the whole of the first run and only
  reached `×1/3` once that run had ended. It now reads from one.

- **Every icon was very slightly the wrong shape.** The brand mark is wider than it is tall, and the
  tool that rasterised the icons stretched it to fill a square instead of fitting it — about 18% too
  tall, on the dial's icon in the Stream Deck application and on both static key faces. Rasterising
  is now done by headless Chromium, which respects the artwork's proportions. Nothing was redrawn;
  the shapes are simply no longer distorted.

### Internal

- **The property inspector's inline JavaScript has tests now** (27 of them). It is a plain page
  Stream Deck loads, so it cannot import from `src/` and carries its own copy of the settings shape —
  a copy nothing checked. `test/inspector.test.ts` drives the real page in headless Chromium over the
  DevTools protocol, and the first thing it asserts is that the page's `DEFAULTS` still match
  `src/settings.ts`. Closes #6.
- The TypeScript target moved from Node 20 to Node 24, which is the runtime the manifest declares.
  Closes #7.
- Icons are rasterised by headless Chromium rather than ImageMagick, which is not installed on the
  build machine — `npm run icons` now works without it.

## [2.0.1] — 2026-08-20

### Fixed

- The property inspector's help text contradicted itself about the dial. One paragraph still said
  "the next press of the dial puts it back", from before the dial's press was given over to setting
  the step; the paragraph directly beneath it described the current behaviour. Putting the clock back
  on its preset is the touchscreen hold.

## [2.0.0] — 2026-08-20

### Changed

- **The plugin's identifier has changed**, from `com.matewishkey.dial-countdown` to
  `com.matewishkey.dial-countdown-v2`, along with both action identifiers under it.

  **If you had an earlier version installed, its buttons will not carry over.** Stream Deck resolves a
  configured button to an action by identifier, so it now sees an action that no longer exists. Remove
  the old plugin from Stream Deck's preferences, install this one, and place the actions again. Your
  presets and appearance settings belong to the old buttons and do not migrate.

  This is not a change anybody wanted. Deleting a Marketplace listing in order to re-upload it from
  scratch leaves the old identifier permanently reserved, and the dashboard then refuses it — so the
  only way back onto Marketplace was a new one. Nothing else about the plugin changed.

## [1.5.1] — 2026-08-20

### Fixed

- The plugin no longer ships with the Node debugger switched on. `manifest.json` carried
  `Nodejs.Debug: "enabled"` from the project scaffold, which per Elgato's own manifest schema runs
  the plugin under `--inspect` whenever the Stream Deck application is in debug mode. It had been
  there since the first commit.

## [1.5.0] — 2026-08-20

### Changed

- **You set the dial's step; turning never changes it.** A click is one second. **Press the dial** to
  swap between one-second and one-minute clicks, or **hold it** for one hour a click. However far you
  turn, however fast, however long you keep going, a click is worth exactly what the last press said.

  This replaces the automatic ladder, which is the fourth design for this and the first that does not
  try to infer the step from how you are turning. Momentum escalated when you hovered over a value;
  velocity did different things depending on how briskly your wrist moved; distance travelled was
  predictable but still changed the step underneath the hand using it.
- **A step you set stays set.** Nothing expires it — not a pause, not loading a preset, not a reset.
  Because that also makes it easy to forget, any step other than the default now says so on the
  bottom line for as long as it is set, as `step · 1m`.
- **The dial's press and hold now set the step**, so preset cycling is the touchscreen's job alone —
  tap and hold the screen above the dial, or the key itself. Pressing a dial in is a fiddly,
  two-handed movement next to tapping the screen your hand is already at.
- A press from one hour a click lands on **seconds**, not minutes: coming down from a coarse step you
  almost always want the finest one, and landing on minutes would leave no single gesture back to
  seconds.
- **Press-and-turn no longer means a flat minute.** It is an ordinary rotation at the step you have
  set. It cancels the press, so letting go afterwards does not also change the step.

### Removed

- **Selecting the previous preset.** It lived on the dial's hold, which now sets the hour step.
  Holding the screen still cycles forward through the presets.

## [1.4.0] — 2026-08-20

### Changed

- **A press of the dial now puts a running clock right, instead of jumping to the next preset.** The
  rule is: if the clock is not sitting stopped and full on its preset, the first press puts it there,
  and only a press with nothing left to put right moves on. Running, paused, finished and dialled off
  its preset all count.

  It used to fire only on the last of those, on the reasoning that a running timer already has a reset
  of its own in the double tap. That was wrong twice over: the double tap is on the touchscreen and
  the press is on the dial, so reaching for one does not put the other under your finger — and being
  thrown onto another preset because you touched the dial mid-run is exactly the surprise the restore
  exists to prevent.

  Holding the dial for the previous preset, and holding the touchscreen, behave the same way.

The `from 20m` label is unchanged and still means only that the dial has wound the clock off its
preset. A timer that is merely running has not been moved anywhere, so it gets no marker — even
though a press would still put it back to full.

## [1.3.0] — 2026-08-20

### Changed

- **The dial steps in the largest unit you have already travelled.** Move ten seconds and you move in
  tens of seconds; move a minute and you move in minutes; move ten minutes and you move in ten-minute
  steps. The thresholds are not a separate table — they *are* the steps, so the whole behaviour is one
  sentence rather than something to memorise. Ten clicks to the first change, five to the next, nine
  to the last: twenty-four clicks from a second a click to twelve hours in reach, and the ladder gets
  easier to climb the further up it you are.

  This replaces the flat "every ten clicks" of 1.2.0, which changed up at the same rate whether you
  were moving in seconds or in ten-minute blocks.
- **The step shown on screen now lasts exactly as long as the gear it reports.** `+10s` is not a note
  about the click you just made — it states what the *next* click will do, so it stays up for as long
  as that is true and disappears at the instant the dial goes back to seconds. It used to fade after
  0.9 seconds while the gear ran on for another 1.1, which invited the reasonable and wrong conclusion
  that the dial had already reset. Every other acknowledgement — `pause`, `reset`, `next · 20m` —
  keeps its ordinary moment, because those really are notes about something that has finished.

Turning back still keeps the gear and starts the distance over, so hovering never runs away, and
letting go of the dial for two seconds still drops it back to seconds.

## [1.2.0] — 2026-08-20

### Changed

- **The dial changes gear on distance, not speed.** Every **ten clicks in the same direction** is one
  gear up: 1 second, then 10, then a minute, then ten. The same turn now does the same thing however
  briskly you make it — where before the step depended on how fast your wrist happened to move, which
  meant it was never quite the step you predicted.
- **Turning back keeps the step but starts the ten over.** A correction moves in the same unit as the
  movement it is correcting, and hovering — nine clicks up, nine back, over and over — never reaches
  ten in one direction, so it never escalates. The ladder is only ever climbed on purpose. Letting go
  of the dial for two seconds still drops it back to seconds.
- A batch of clicks from a hard spin is spent *across* a change of gear rather than all at the old
  step, so the eleventh click is worth ten seconds however it arrived.
- The icons are now generated from `assets/mwk-mark.svg`, the brand's own artwork file, rather than
  from path data copied into the build script. The artwork is unchanged — the generated files are
  identical, verified at 0 differing pixels — but they can no longer drift from the source.

### Added

- `docs/releasing.md` and this changelog, so version numbers stop being decided case by case.
- `npm run version:check`, which asserts `package.json`, `manifest.json` and the git tag agree. The
  manifest version once sat at `0.1.0.0` through nine releases with nothing looking at it.
- A test holding the mark drawn inside the ring to the artwork file, path for path.

## [1.1.0] — 2026-08-19

Renamed for Marketplace, and the dial's state handling rebuilt.

### Changed

- **Renamed to Dial Countdown**, from *MWK Dial Countdown*, in both the plugin name and the actions
  list category. Elgato's guidelines ask that a plugin name not repeat the organisation, which is
  already shown on Marketplace. The UUID is deliberately unchanged, so existing buttons keep working.
- **Every icon the Stream Deck application draws is white** — `#FFFFFF`, monochromatic, transparent
  background — as the guidelines require: the category icon, both action list icons, and the encoder
  canvas icon. Key faces on the hardware keep the brand red.
- **Turning the dial no longer edits your presets.** It used to write the new length straight into the
  preset list, so winding a 20 minute timer up to 23 for one call silently redefined that preset as
  23 minutes. Turning now moves only the clock in front of you, exactly as it always did for a
  *running* timer. While the clock and its preset disagree, the label says `from 20m`.
- **The dial changes gear on how fast you turn, not how long.** It used to count clicks, so any
  sustained turn escalated and there was no way to click out thirty seconds a second at a time. A
  deliberate turn now stays on seconds indefinitely; a flick changes up a gear (1s → 10s → 1min →
  10min). The gear is then *held* — through slowing down and through reversing — until you let go of
  the dial for two seconds.

### Added

- **A press of the dial puts the clock back on its preset before it moves on.** Once the clock has
  been dialled off, the first press restores it (`preset · 20m`) and the next advances
  (`next · 30m`). The same for holding the dial for the previous preset, and for holding the screen.
  This also gives the one-preset case something to do, where before it was a dead end.

### Fixed

- **Auto-repeat could not run twice.** Starting an expired repeating timer left the lap count where
  the finished run put it, so its budget read as already spent — the restarted run never repeated
  once, under a display still reading `×2/2`.
- **A failed alarm is now reported.** The sound player's result was discarded, so a timer asked to
  make a noise could finish in silence when the file had been moved or the platform had no player.
  Silence is indistinguishable from "not finished yet", which is the one thing an alarm must not be.
  It now raises Stream Deck's own alert.
- **Changing an unrelated setting no longer resets a dialled clock.** With the clock able to sit off
  its preset, touching the volume slider would have pulled it back to the preset's length.

## [1.0.0] — 2026-08-14

First stable release.

## [0.11.0] — 2026-08-14

### Fixed

- **Keys did nothing at all.** The key action sent bare `<svg>` markup, which Stream Deck discards, so
  no ring, no clock, and every gesture invisible. It sends a data URI now.
- **The double tap stopped starting the timer.** Resetting the clock and setting it running are two
  decisions, and a gesture making both leaves no way to reset without committing to a fresh run.

## [0.10.0] — 2026-08-13

### Added

- Three screen gestures — tap to pause or resume, twice to reset, hold for the next preset — and a
  **Countdown (Key)** action running the same timer on an ordinary button.

### Fixed

- The manifest version had sat at `0.1.0.0` since the first release, so the Stream Deck application
  reported the same version whichever build was installed. It now tracks the release tag.

[Unreleased]: https://github.com/matewishkey/mwk-dial-countdown/compare/v3.1.0...HEAD
[3.1.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v3.1.0
[3.0.1]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v3.0.1
[3.0.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v3.0.0
[2.0.1]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v2.0.1
[2.0.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v2.0.0
[1.5.1]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v1.5.1
[1.5.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v1.5.0
[1.4.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v1.4.0
[1.3.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v1.3.0
[1.2.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v1.2.0
[1.1.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v1.1.0
[1.0.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v1.0.0
[0.11.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v0.11.0
[0.10.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v0.10.0
