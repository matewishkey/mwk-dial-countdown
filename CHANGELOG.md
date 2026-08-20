# Changelog

What changed, for whoever installs the plugin. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is explained in
[docs/releasing.md](docs/releasing.md).

Entries under **Unreleased** have landed on `main` but are not in any `.streamDeckPlugin` yet — for
this project that generally means they do not change the packaged plugin at all.

## [Unreleased]

Nothing yet.

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

[Unreleased]: https://github.com/matewishkey/mwk-dial-countdown/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v1.3.0
[1.2.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v1.2.0
[1.1.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v1.1.0
[1.0.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v1.0.0
[0.11.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v0.11.0
[0.10.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v0.10.0
