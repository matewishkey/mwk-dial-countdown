# How the dial, the gestures and the presets work

What the plugin does today. History lives in [CHANGELOG.md](../CHANGELOG.md) and in git.

## The dial's step is your finger

A free turn is **a second a click**. A turn made with the dial **pushed in** is **a minute a click**.

`pressed` arrives on the rotation event itself, so the plugin holds no mode, expires no mode, and has nothing to put on screen reminding you which one you left it in. The step lasts exactly as long as your finger does.

**There is no hour step.** Nothing dialled by hand is four hours long — that is a preset, typed in the property inspector where it takes three keystrokes rather than 240 clicks.

### What a rotation changes

**The clock in front of you, never the preset behind it.** Turning is the same whether the timer is running or stopped: it moves the clock, and the configuration is untouched. While the two disagree the label says so — `from 20m` — and holding closes the gap.

A rotation carrying `ticks: 0` is ignored and, importantly, does not consume the press it sits between.

## The gestures

| Gesture | Touchscreen | Key | Dial |
| --- | --- | --- | --- |
| **Press / tap** | pause or resume | pause or resume | pause or resume |
| **Twice** | reset to full, stopped | reset to full, stopped | — |
| **Hold** | put the clock right, else next preset | same | same |
| **Turn** | — | — | adjust the clock |

Neither the reset nor the hold **starts** anything. Putting a clock back to the top and setting it running are two decisions, and a gesture making both takes the second one away from you.

### A single tap waits; a hold does not

The hardware reports taps but never reports that two were a pair, so the first is held back for as long as a second could still arrive. A single tap therefore acts **250 ms** after your finger lifts. Acting immediately and undoing it would flash a state you did not ask for on a screen redrawn four times a second.

A hold is unambiguous and acts at once, and cancels any tap still pending.

**The key waits 500 ms, and has to.** A key has travel, and the hardware reports only the release, so the gap being measured is release-to-release with the second press's own travel inside it. At 250 ms an ordinary double press landing 320 ms apart arrives as two toggles — which start the clock and immediately pause it, so the key looks dead, and pressing again cannot recover because an even number of toggles lands back where it started. `DOUBLE_PRESS_MS` in `src/gestures.ts`; `CountdownAction.tapWindowMs` is how a control claims its own.

**The dial's hold is timed on release**, not by a timer running while the finger is down — pushing the dial in is how minutes are asked for, so anything firing mid-press would go off in the pause before the wind started. A press that turned the dial is discarded as the end of a wind before the threshold is considered. The trade: a slow, deliberate press meant as a pause reads as a hold. `dialPress` in `src/gestures.ts`.

### Feedback, in place of haptics

There is none to be had — the SDK exposes no haptic command and the hardware has no motor. Two things stand in, doing different jobs.

- **The ring pulses** — a hairline just outside the arc for 200 ms, on every gesture and every tick of the dial. It carries no information beyond "that registered", which is what makes it work in peripheral vision. On the progress-bar display the same hairline circles the state glyph, drawn by the same code.
- **A line names the action** — `+10s`, `start`, `pause`, `resume`, `reset`, `silenced`, `preset · 20m`, `next · 20m` — for 900 ms.

The pulse is its own hairline rather than a brightening of the arc, so an event does not look like a change of state and stays visible during the end-of-timer fade.

## The key

The same countdown with the turning taken away. Presets are edited in the property inspector.

It draws its **whole face as one SVG**, digits included, rather than using `setTitle`: Stream Deck stops honouring a plugin's title the moment the user types one of their own, and a clock that stops being a clock because somebody labelled the button is not a clock. `UserTitleEnabled` is false in the manifest for that reason.

That image is sent as a **data URI**, never as raw markup — `asDataUri`, the same wrapper the touchscreen ring uses. Raw `<svg>` markup is the form known to have failed on hardware; the data URI is the form known to work. Elgato's own docs disagree on whether raw markup was ever valid.

With no room for a glyph behind the digits, the line under the clock carries the state: the gesture just made, then `ringing` while an alert is sounding, then `paused`, then the stage tally, then what the timer is called.

## Naming a timer

A preset carries no name, so the line under the clock is its length — `20m`. A **title** replaces it: type `Tea` and that is what the line says on both controls. Leave it empty and the length comes back.

**It is the plugin's field, not Stream Deck's.** On a key, Stream Deck composites the user's title over whatever the plugin drew, so a native title would land on top of the clock. On a dial there is no `title` item in either layout. Owning the field is what puts one name in one place on both.

The rule lives in `src/label.ts`, once, and each control takes the part that fits:

| | Dial | Key |
| --- | --- | --- |
| Unnamed | `20m` | `20m` |
| Named | `Tea` | `Tea` |
| Dialled off the preset | `Tea · from 20m` | `Tea` |
| Several steps | `Tea · ×2/3` | `×2/3`, once running |
| Finished | `Tea · ×3/3 · done` | `done ×3/3` |
| Alert sounding | a bell in the middle of the ring | `ringing` |

The drift note is the one thing a key cannot say: `from 20m` needs both halves and a key has one line.

**A long title is clipped on a key** at about sixteen characters. The caption shrinks to fit and has a floor of about 11px, below which a caption is not read. Thirty-two characters is what is *stored*. The dial's label ellipsises in the layout itself.

The switch that hides the line is **Show the label**; `normaliseSettings` reads the older `showTitle` key.

## The alarm

The timer hands a sound file to the operating system's own player when a step runs out — `afplay` on macOS, PowerShell's WPF `MediaPlayer` on Windows. **Play it *n* times** repeats it, up to sixty.

**A play begins when the previous one has ended.** Both platforms' players run for as long as the sound does, so process exit is the signal and nothing has to parse a WAV, MP3 or AIFF header. A fixed offset cannot work: the gap depends on a file the user chose, and `chime.wav` alone is 2.00 s. `REPEAT_GAP_MS` is the silence *between* plays.

### A press silences whatever is playing

**A press of the control stops the sound and does nothing else.** It will not start, pause or reset the clock, so you cannot quieten an alert into changing what the timer was doing. Press again for the gesture you actually wanted.

**A hold is the exception** — the knob, the touchscreen or a key. It silences the alert *and* puts the clock back to the top of its preset, because it is the gesture that means *put this right*. Turning the dial is likewise not swallowed: it silences and still adjusts.

**Every step of a multi-step preset gets its own alert, and every one can be silenced.** On `40m, 10m, 10m, 10m` the end of the forty is the moment you must not miss, and the ten after it is already counting by the time you hear it.

An alert **outlives the moment it announces**. What ends one is the plays running out, a press, a newer alert taking its place, or the control leaving the screen — never the clock merely running, which is true one frame after every step boundary.

The trade: with the default single chime, a press inside those two seconds is spent on silencing and the clock does not move. Press again.

### Quieter after the third play

One checkbox. The first three plays sound at the volume you set, everything after at half of it — half of *your* volume, not a fixed level, so a quiet alarm does not get louder as it goes on. `FADE_AFTER_PLAYS` and `FADED_VOLUME` in `src/sound.ts`.

### Test is a toggle

Clicking *Test* while a preview is playing stops it, and closing the property inspector stops it too — a preview is reachable only through the panel, so one left running would have nothing to stop it. The button's word comes from the plugin, because a run also ends on its own and only the plugin knows when.

## Clearing itself when it is finished

A finished timer sits reading `done` until somebody presses it. **Clear itself when finished** waits a set time and then puts the countdown back where it started — full clock, stopped, first step. Exactly the double tap, by construction.

- **It waits for the whole job**, every step of it. Clearing between steps would end a job still running.
- **It is silent.** The words under the clock name a gesture, and nobody made this one.
- **It is called off the moment anybody touches the timer** — anything moving the countdown off `elapsed` drops the pending reset.
- **It waits while an alert is still sounding**, or the auto-reset would silence the alarm and wipe the screen clean of it. The delay starts once the sound stops.

The delay is measured from the finish, except for a timer that ran out while its page was elsewhere: that is dated from **the moment the page came back**, since dating it back would clear the clock on the one frame where `done` is the point.

## Flipping to another page does not lose the timer

`Timer` works from an **absolute deadline** rather than accumulating ticks, so a countdown keeps good time with nothing running. Only the drawing stops. The countdown is set aside when the control leaves the screen and handed back when it returns, still counting; a **paused** one comes back paused with exactly the time it had.

Two things it deliberately does not do:

- **It is held in memory, so it does not survive the plugin restarting.** Writing it to disk would mean deciding what a timer that "finished" while Stream Deck was closed should do.
- **A timer that ran out while you were away comes back silent**, because the moment it would announce has been and gone. The screen still says `done`. For the same reason a multi-step timer does not pick up steps it never ran.

Settings edited while the control was away are picked up on the way back, by the usual rule: the clock reloads only if the **selected preset's length** changed.

## Why the screen redraws when nothing has changed

The render loop runs at 4 Hz and drops any frame identical to the last, which is what keeps an idle timer free. That assumes every frame sent arrives, and there is no way to ask a Stream Deck what it is showing — so on a countdown that is static for long stretches, one lost frame would stay lost until the user touched something.

- The current frame is **re-asserted every 2 seconds**, which bounds a dropped frame to 2 seconds at one message per control, comfortably inside Elgato's 10-per-second guideline.
- Stream Deck discards feedback sent alongside a layout switch, so both layouts default their pixmap to a transparent pixel rather than falling through to the action's icon.
- Awaiting `setFeedbackLayout` before drawing does **nothing**: the SDK's `send` resolves once the command is written to the socket, not once Stream Deck has applied it.

## Presets

A preset is **a list of durations** — most of them a list of one. There is no name: the screen shows `20m`, or `20m 30s` once nudged off a round number.

Out of the box: **5, 20, 30 and 40 minutes**, one step each.

- **Edit them in the property inspector**, as text — `20m`, or `40, 10, 10`. Add as many as you like; remove any but the last.
- **Load one from the panel** by clicking the dot beside it. The hold only moves forward, so the fourth of four would otherwise be three holds away.
- **Hold the screen, the key or the dial** for the next one.
- Anything from **one second to twenty-four hours**, up to **twenty steps** in one preset.

Each dial and each key keeps its own preset list and its own countdown.

### A preset with several steps

`40, 10, 10` is forty minutes, then ten, then ten. Each step runs its own length and the next starts the moment the last ends, with no gap. The line under the clock counts them off as `×2/3` and says `done` when the list runs out.

A step list is the only vocabulary for repetition: `6m` six times is six steps. Settings written when a `repeat` switch existed are translated on the way in — `repeat: true, repeatCount: 3` on a 20 minute preset becomes three steps of twenty minutes — and written straight back, so nothing downstream sees the old shape.

### Typing a preset

One text field per preset, with a grey line under it saying what was read.

| Typed | Read as |
| --- | --- |
| `20` | 20m |
| `40, 10, 10` | 40m · 10m · 10m |
| `90s` | 1m 30s |
| `1h30m` | 1h 30m |
| `10m x3` | 10m · 10m · 10m |

A bare number is minutes. A row that does not parse saves nothing at all and keeps both the text and the reason — half a row saved would be a preset nobody typed. Rows commit on `change`, not per keystroke, since `4` on its way to `40` is a valid preset.

### A reset goes to the preset, not to the clock

The double tap restores the **configured** length, not wherever the dial left it. A preset a reset cannot return you to is not a preset. The dialled duration is deliberately not recoverable — the clock is the scratch value and the preset is the record.

### The hold puts it back before it moves on

If the clock is not sitting stopped and full on the first step of its preset, the hold puts it there; only a hold with nothing left to put right moves on. Hold once, hold again. Running, paused, finished, part-way through the steps and dialled-off all count as something to put right, and the word says which it did: `preset · 20m` against `next · 30m`.

### The label shows the preset, not the clock

`from 20m` appears while the working duration and the configuration disagree, and only about the duration — a timer merely running has not been dialled anywhere.

## What the middle of the ring is saying

One glyph per state: the brand mark when idle, then play, pause, or done. The mark appears only when there is nothing else to report.

**A sounding alert takes the middle from all of them, and shows a bell.** It is the one glyph that overrides the clock's own state, because at a step boundary the two disagree: on `40m, 10m, 10m` the forty runs out, its alarm starts, and the first ten begins counting in the same breath — so the state is *running*, which is true and no use. The bell lasts exactly as long as the sound does. A key has no room for it and says `ringing` on its one line instead.

**The ring empties and the bar fills**, and they are named for it: a countdown ring shows what is left, a progress bar shows how far through you are. Switching display inverts what the indicator means; everything else is identical between them.

Both layouts are the plugin's own files (`layouts/ring.json`, `layouts/bar.json`), so every feedback key the plugin sends is one it defined — a built-in layout's keys are published nowhere, and a key that does not match fails silently.

## Try it without hardware

`npm run mock` drives the whole thing from the keyboard with no Stream Deck attached, and `npm run demo` plays a scripted pass of 35 checks. It prints a labelled ASCII frame per step; the dial's step shows up across three of them:

| Step | What it shows |
| --- | --- |
| 87 clicks at three different speeds | still `+1s` — turning cannot change the step |
| push the dial in and turn | `+1m` |
| let go and turn again | `+1s` — nothing was left switched on |

Through every one of those the preset list underneath reads `5m [20m] 30m 40m`, unchanged, and the label reads `from 20m`. Two later steps hold the screen twice: once to land back on `20:00`, and once more to move on to `30m`.

It also walks the gesture vocabulary and asserts the parts a person would otherwise have to check by eye — that a hold really does leave the clock stopped, that the pulse appears and then clears, that a finished multi-step timer says so, and that the two layouts agree:

```
▸ press the dial → starts the clock

   was 21:49, press said "start", 1.2s later 21:48
   ✓ the dial starts it

▸ a PUSHED turn's release does nothing — otherwise every minute-nudge would start the clock

   was 21:47, after push-turn-release 23:47, said "+2m"
   ✓ read as a turn, not as a press

▸ …and STOPS at the limit, saying `done`, rather than looping for ever or going quiet

   clock 2s apart: 0:00 then 0:00; label reads "2s · ×2/2 · done"
   ✓ and it says so — a finished job no longer looks like its own last step
   ✓ the ring shows the done glyph, not the brand mark

▸ the ring's middle shows the STATE, and the brand mark only on an idle clock

   idle: "logo", running: "play", paused: "pause"
   ✓ one glyph per state, and the mark only where there is nothing to report

▸ the progress-bar layout takes the theme, and carries the same state glyph

   layout "layouts/bar.json", bar idle #7C4DFF (glyph "logo") → running #00E5FF (glyph "play")
   ✓ the bar is coloured, and follows both the theme and the state
```

### Adding a step to the demo

**Set only what the step needs.** `applySettings` *merges* into one shared settings object, so a key
set in one step is set for every step after it. Adding `soundId: "none"` to a step about the dial
silenced the alarm assertion four steps later, which then reported a silent failure that belonged to
neither — the failing step was correct and the cause was out of sight above it.

**Give it a duration the step before it did not use.** `applySettings` reloads the clock only when the
*selected preset's length* changed — deliberately, so that nudging an unrelated setting cannot reset a
running timer — which means a step that reuses the previous step's preset inherits its clock, running
and part-spent, rather than starting a fresh one. The symptom is a step that looks like it never
pressed anything: the first gesture lands on a clock already in motion and reads as the opposite of
what it meant. It cost a debugging pass on the auto-reset step, which reused a 2s preset and so paused
the previous step's timer instead of starting its own.

Assert something, rather than only printing a frame. A step that prints is a step somebody has to
read; a step that ends in `✓` or `✗` is one the release gate can fail on, and
`npm run release` keeps the whole log either way.

The step is `src/step.ts` — two pure functions with no state and no clock, so everything above is asserted in `test/step.test.ts` rather than described and hoped for. The gesture checks quoted above come from `tools/mock-host.mjs`, which drives the built plugin end to end.
