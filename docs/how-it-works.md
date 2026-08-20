# How the dial, the gestures and the presets work

A few things in this plugin are worth explaining properly, because each does more than it looks like it does: **turning the dial**, **the three press gestures**, **the key**, **why the screen redraws when nothing has changed**, and **presets**.

## The dial's step is chosen, not guessed

A dial reports *ticks* — one click of rotation. The obvious thing to do is map one tick to a fixed amount of time, and that is exactly what makes most timer plugins annoying: pick a step small enough to trim thirty seconds off a countdown and setting a two-hour one takes a minute of winding. Pick a step big enough for two hours and you can no longer nudge.

The answer here is not a cleverer guess. It is to stop guessing.

| Gesture | Step |
| --- | --- |
| — | **1 second** a click |
| **Press the dial** | **1 minute** a click, and press again for seconds |
| **Hold the dial** | **1 hour** a click |

**Turning never changes the step.** However far you turn, however fast, however long you keep going, a click is worth exactly what the last press said it was worth.

### Three designs that tried to infer it

This is the fourth, and the first three are worth recording because they failed in different ways and the pattern only shows up across all of them.

**Momentum** counted ticks in any direction, escalating as you turned and dropping back after a third of a second of stillness. Winding *back and forth over* a value counted towards escalating exactly as much as winding *away* from it, so there was no way to click out thirty seconds one second at a time.

**Velocity** changed up when the wrist moved briskly. That reads better on paper than it works in the hand: the same gesture did different things depending on how quickly you happened to make it, so the step you got was never the step you predicted.

**Distance travelled** — you step in the largest unit you have already moved — was predictable in principle, and genuinely better. But it still changed the step underneath the hand that was using it, and it still had to be explained.

All three were attempts to work out which step you wanted from how you were turning. The dial already had a press and a hold going spare, because preset cycling belongs on the touchscreen where your hand already is. So the step gets **said** instead of inferred: three values, two gestures, and a turn that does the same thing every single time.

### No time-out, and therefore a label

A step you set stays set until you set another one. Nothing expires it — not a pause, not loading a preset, not a reset, not the timer running out. That is the whole point, because a mode that expires is a mode you have to keep re-checking.

It is also what makes such a mode easy to forget, so any step other than the default says so on screen for as long as it is set: `step · 1m` on the bottom line. The default stays silent — a permanent `1s` on every timer whose dial has never been pressed would be noise.

That bottom line has three claimants, in order of how long they matter for: the acknowledgement of what you just did, then the finish time on a running clock, then the step.

### Coming back from an hour

A press from an hour a click lands on **seconds**, not minutes. Coming down from a coarse step you almost always want the finest one — and a press that landed on minutes would leave no single gesture that gets you back to seconds at all.

### Turning while the dial is held

Nothing special: it is a rotation at the current step. It does cancel the press, so letting go afterwards does not also change the step — a turn and a press are two different instructions, and one gesture should not quietly be both.

### What a rotation actually changes

**The clock in front of you. Never the preset behind it.**

Turning a stopped countdown used to write the new length straight back into the preset list, on the reasoning that the dial is the preset editor. In practice that made the presets unusable: winding a 20 minute timer up to 23 for one call silently redefined "20 minutes" as 23, and cycling away saved it there. A preset is a setting, and settings are changed where settings are changed — in the property inspector.

So turning is now the same thing whether the timer is running or stopped: it moves the clock, and the configuration is untouched. While the two disagree, the label says so — `from 20m` — and the next press of the dial closes the gap.

## The three gestures

Tapping the touchscreen, or pressing a key, does one of three things depending on how you do it.

| Gesture | Does | Why that one |
| --- | --- | --- |
| **One tap** | Pause / resume | The thing you do most, so it gets the plainest gesture. |
| **Two taps** | Reset the clock to full, stopped | Getting back to the top is common enough to deserve a gesture of its own. |
| **Hold** | Put the clock right if it is not, otherwise load the next preset | Choosing what to time is not the same as beginning it. |

### Why neither the reset nor the hold starts anything

This one was got wrong first time round. The double tap originally reset *and* started, on the reasoning that "a reset that then waits to be started is two gestures pretending to be one".

That reasoning is backwards. Putting a clock back to the top and setting it running are two separate decisions, and a gesture that makes both takes the second one away from you: there is then no way to reset without immediately committing to a fresh run. Starting is what the single tap is for, and it is right there.

### Why a single tap waits a moment

The hardware reports taps. It never reports that two taps were a pair — that has to be worked out, and the only way to work it out is to hold the first one back for as long as a second could still arrive. So a single tap acts **250 ms** after your finger lifts.

The alternative is to pause immediately and undo it when the second tap lands. That is worse: the screen is redrawn four times a second, so every double tap would visibly flash a state you did not ask for.

A **hold** does not wait, because there is nothing ambiguous about it — and a hold arriving while a tap is still pending cancels that tap, since a tap followed by a hold is two gestures rather than a double tap.

### Feedback, in place of haptics

There is none to be had: `@elgato/streamdeck` exposes no haptic command, and the hardware has no motor to drive if it did. Two things stand in for it, and they are doing different jobs.

- **The ring pulses** — a hairline that appears just outside the arc for 200 ms, on every gesture and every tick of the dial. It carries no information beyond "that registered", which is exactly what makes it work in peripheral vision. You cannot read a word per tick while winding a dial; you can see the ring answer each one.
- **A line names the action** — `+10s`, `start`, `pause`, `resume`, `reset`, `preset · 20m`, `next · 20m` — for 900 ms. It is drawn where the finish time normally sits on a dial, and under the clock on a key.

The pulse is drawn as its own hairline rather than by brightening the arc, for two reasons: an event should not look like a change of state, and it has to remain visible during the end-of-timer fade, which is the one moment feedback matters most and the arc is already being dimmed.

## The key

The key action is the same countdown with the turning taken away — press, press twice, hold. Presets are edited in the property inspector, since there is nothing on a key to wind them with.

It draws its **whole face as one SVG**, digits included, rather than using `setTitle`. Stream Deck stops honouring a plugin's title the moment the user types one of their own, and a clock that silently stops being a clock because somebody labelled the button is not a clock. The title is left free for whatever you want it for.

That image is sent as a **data URI**, never as raw markup — `asDataUri`, the same wrapper the touchscreen ring uses.

This is worth stating carefully, because the obvious explanation is not proven. The key action originally sent bare `<svg>` markup and did nothing at all on hardware: no ring, no clock, and every gesture invisible because nothing it drew ever reached the screen. Sending a data URI fixed it. But Elgato's own documentation disagrees with itself on whether raw markup was ever valid — the WebSocket reference lists only a file path or "a base64 encoded string with the mime type declared", while the SDK's JSDoc for `setImage` explicitly allows "an SVG `string`". So the data URI is the form known to work, and the raw string is the form known to have failed; which of the two facts explains the other is not settled.

With no room for a glyph behind the digits, the line under the clock carries the state instead: the gesture you just made, then `paused` if it is paused, then the preset's length.

## Why the screen redraws when nothing has changed

The render loop runs at 4 Hz and drops any frame identical to the last, which is what keeps an idle timer free. That optimisation quietly assumes every frame it *does* send arrives — and there is no way to ask a Stream Deck what it is currently showing.

A countdown is static for long stretches: idle, paused, finished. So a single frame lost on the way would stay on screen until the user touched something.

That is exactly what happened. Stream Deck discards feedback sent alongside a layout switch, and `layouts/ring.json` gave its `ring` pixmap no default value — so the slot fell through to the action's `Encoder.Icon`, a red Mate Wish Key mark, and an idle dial sat there showing a red logo instead of a themed ring until it was turned.

Two changes, because either alone leaves a hole:

- The pixmap now defaults to a transparent pixel, so the action icon is never what shows through.
- Awaiting `setFeedbackLayout` before drawing was tried and **reverted** — it is the obvious-looking fix and it does nothing. The SDK's `send` resolves once the command is written to the socket, not once Stream Deck has applied it, so it guarantees nothing that ordering on a single socket did not already give.
- The current frame is re-asserted every **2 seconds** regardless, which bounds any dropped frame to 2 seconds at a cost of one message per control — comfortably inside Elgato's 10-per-second guideline.

## Presets

A preset is **just a duration**. There is no name, because a countdown's length is its own label: the screen shows `20m`, or `20m 30s` once it has been nudged off a round number.

Out of the box: **5, 20, 30 and 40 minutes**.

- **Edit them in the property inspector**, as hours, minutes and seconds. Add as many as you like; remove any but the last.
- **Hold the screen** — or **press the dial** for the next one, **hold the dial** for the previous.
- Anything from **one second to twenty-four hours**.

Each dial and each key keeps its own preset list and its own running countdown, so they never interfere.

### The dial does not edit them

It used to, and that is covered above under *What a rotation actually changes*. The short version: a preset that the dial rewrites is not a preset, it is a last-used value. Turning moves the clock; the list stays as configured.

### Why a press puts it back before it moves on

Because the dial no longer writes back, a countdown wound from 20 minutes to 23 has nothing that returns it to 20 — the property inspector still says 20, the clock says 23, and there is no gesture that closes the gap. That gap is the direct cost of the change above, so the change has to pay for it.

Holding the screen pays for it. **If the clock is not sitting stopped and full on its preset, the first hold puts it there. Only a hold with nothing left to put right moves on.**

| The clock is… | Hold the screen | Hold it again |
| --- | --- | --- |
| Stopped and full on its preset | Next preset | The one after that |
| Running | Stopped, back to full | Next preset |
| Paused, or finished | Stopped, back to full | Next preset |
| Dialled off its preset | Back to the preset, stopped | Next preset |

The restore comes first because it is wanted far more often: putting the clock back where it belongs is a thing you do constantly, and moving to a different preset is a thing you do occasionally. Nothing is lost either way — the press that would have advanced still advances, one press later — and the word on screen says which of the two it just did, `preset · 20m` against `next · 30m`.

**This rule was too narrow at first**, and the correction is worth recording. It originally fired only on the last row of that table: the dial had wound the clock off its preset, and nothing else counted. The reasoning was that a *running* timer already has a reset of its own, the double tap, so spending the gesture on one would be redundant.

In the hand that was wrong. Being thrown onto the next preset because you reached for the control mid-run is precisely the surprise the restore exists to prevent, and a running clock is not sitting on its preset either, whatever its duration says.

This is the touchscreen's job, on both controls: the screen above a dial, and the key itself. The dial's own press and hold set the step instead — see above.

It also gives the **one-preset** case something to do. It used to be the documented dead end — "with only one preset configured, the gesture lands back on the same one" — and now it is a reset.

### Why the label shows the preset, not the clock

The label tracks the *preset's* length rather than the live duration, so you can always see where this timer started: begin a 20-minute countdown, add five minutes to it mid-flight, and the label still reads `20m`.

Once the two genuinely disagree it says so, reading `from 20m`. That matters more than it used to, because the disagreement is now permanent until you close it — an idle clock showing `23:00` under a label reading `20m`, with the settings agreeing with the label and not the clock, would otherwise just look broken.

It says so for that reason and no other. A timer that is merely *running* has not been dialled anywhere, so it gets no marker, even though a press of the dial would still put it back to full. Those are two different questions — "has this been moved?" and "is there anything to put right?" — and only the first belongs on the label.

## Try it without hardware

`npm run mock` drives the whole thing from the keyboard with no Stream Deck attached, and `npm run demo` plays a scripted pass. It prints a labelled ASCII frame per step; the dial's step shows up across five of them:

| Step | What it shows |
| --- | --- |
| 87 clicks at three different speeds | still `+1s` — turning cannot change the step |
| press the dial | `step · 1m`, and the next click is `+1m` |
| 2.5 seconds untouched | still reads `step · 1m` — nothing expires it |
| hold the dial | `step · 1h`, and the next click is `+1h` |
| press again | `+1s` — back to the finest step, not the middle one |

Through every one of those the preset list underneath reads `5m [20m] 30m 40m`, unchanged, and the label reads `from 20m`. The next two steps press the dial twice: once to land back on `20:00`, and once more to move on to `30m`.

It also walks the gesture vocabulary and asserts the parts a person would otherwise have to check by eye — that a hold really does leave the clock stopped, that the pulse appears and then clears, and that the key's caption falls back from the gesture to the state:

```
▸ every gesture pulses the ring
   pulse right after the tick: yes, half a second later: no
   ✓ pulses, then clears

▸ turn as much as you like, however fast → still a second a click
   after 87 clicks at three different speeds, the step is 1s
   ✓ unchanged, as chosen

▸ …and it STAYS — no time-out, and the screen says so while it is set
   2.5s untouched, the screen reads "step · 1m"; the next click was +1m
   ✓ still set, and still saying so

▸ press again → back to seconds, not to minutes
   one press after an hour a click, and the next click was +1s
   ✓ straight back to the finest step

▸ …and starting a spent auto-repeat again is a FRESH run
   label on restart: "2s", one lap later: "2s · ×1/2"
   ✓ counter reset, and it repeats again

▸ key: one press → pauses
   caption right after: "pause", once the toast expires: "paused"
   ✓ gesture then state
```

The step selector itself is `src/step.ts` — a pure module with no clock in it at all, so everything above is asserted in `test/step.test.ts` rather than described and hoped for. The gesture checks quoted above come from `tools/mock-host.mjs`, which drives the built plugin end to end.
