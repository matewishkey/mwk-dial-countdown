# How the dial, the gestures and the presets work

A few things in this plugin are worth explaining properly, because each does more than it looks like it does: **turning the dial**, **the three press gestures**, **what the middle of the ring is saying**, **the key**, **why the screen redraws when nothing has changed**, and **presets**.

## The dial's step is your finger

A dial reports *ticks* — one click of rotation. The obvious thing to do is map one tick to a fixed amount of time, and that is exactly what makes most timer plugins annoying: pick a step small enough to trim thirty seconds off a countdown and setting a two-hour one takes a minute of winding. Pick a step big enough for two hours and you can no longer nudge.

| Gesture | Step |
| --- | --- |
| **Turn** | **1 second** a click |
| **Push the dial in and turn** | **1 minute** a click |

That is the whole of it. Nothing is held between turns, so there is no mode to set, no mode to expire, and no label on screen reminding you which mode you left it in. Let go and the next click is a second again.

### Four designs that tried to hold it instead

This is the fifth, and the four before it are worth recording because they failed in two distinct ways and the pattern only shows up across all of them.

The first three tried to **infer** the step from how the dial was being turned. **Momentum** counted ticks in any direction, escalating as you turned and dropping back after a third of a second of stillness — so winding *back and forth over* a value counted towards escalating exactly as much as winding *away* from it, and there was no way to click out thirty seconds one second at a time. **Velocity** changed up when the wrist moved briskly, which reads better on paper than it works in the hand: the same gesture did different things depending on how quickly you happened to make it. **Distance travelled** — you step in the largest unit you have already moved — was predictable in principle and genuinely better, but it still changed the step underneath the hand that was using it.

The fourth stopped guessing, and that was the right move. **Press the dial to swap between seconds and minutes, hold it for hours.** Predictable at last, and every turn did the same thing every time. But it bought that with a mode, and the mode had to be paid for three times over: it never expired, so the screen needed a permanent `step · 1m` on the bottom line to stop you forgetting it; three values on a two-way toggle meant a press from hours had to skip minutes and land on seconds, which needed explaining; and it spent the dial's press — the most natural control on the device — on a setting rather than on the timer.

Pushing the dial in **while** you turn costs none of that. It is unambiguous, it cannot be left switched on by accident, it needs no label because your own hand is the label, and it hands the press back to the job a press on a countdown obviously ought to do.

### There is no hour step

Deliberately. Nothing you dial by hand is four hours long — that is a preset, typed in the property inspector where it takes three keystrokes rather than 240 clicks. The dial is for nudging what a preset loaded, and it is sized for that.

### Pressing the dial starts and pauses the clock

The most-used control on a countdown ought to be the one under the hand that is already on the dial. It used to be a tap on the touchscreen — reachable, but a different surface and a quarter of a second slower, because a tap has to wait to find out whether a second one is coming. A press of the dial acts on release, immediately, because there is nothing else it could turn out to be.

A press that *did* turn the dial is a different matter: that was a minute-step adjustment, and its release ends the turn and means nothing on its own. Otherwise every pushed nudge would start the timer as you let go of it.

**There is no long press on the dial.** A push is a push however long you lean on it. That is what lets you hold it in for as long as a wind takes without a third meaning quietly accruing underneath — and it means there is no threshold to learn, no timer to beat, and nothing to get wrong.

### What a rotation actually changes

**The clock in front of you. Never the preset behind it.**

Turning a stopped countdown used to write the new length straight back into the preset list, on the reasoning that the dial is the preset editor. In practice that made the presets unusable: winding a 20 minute timer up to 23 for one call silently redefined "20 minutes" as 23, and cycling away saved it there. A preset is a setting, and settings are changed where settings are changed — in the property inspector.

So turning is now the same thing whether the timer is running or stopped: it moves the clock, and the configuration is untouched. While the two disagree, the label says so — `from 20m` — and holding the screen closes the gap.

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
- **Hold the screen** — or the key itself — for the next one. The dial's press starts and pauses the clock instead; see above.
- Anything from **one second to twenty-four hours**.

Each dial and each key keeps its own preset list and its own running countdown, so they never interfere.

### The dial does not edit them

It used to, and that is covered above under *What a rotation actually changes*. The short version: a preset that the dial rewrites is not a preset, it is a last-used value. Turning moves the clock; the list stays as configured.

### Why the hold puts it back before it moves on

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

This is the touchscreen's job, on both controls: the screen above a dial, and the key itself. The dial's own press starts and pauses the clock instead — see above.

It also gives the **one-preset** case something to do. It used to be the documented dead end — "with only one preset configured, the gesture lands back on the same one" — and now it is a reset.

### Why the label shows the preset, not the clock

The label tracks the *preset's* length rather than the live duration, so you can always see where this timer started: begin a 20-minute countdown, add five minutes to it mid-flight, and the label still reads `20m`.

Once the two genuinely disagree it says so, reading `from 20m`. That matters more than it used to, because the disagreement is now permanent until you close it — an idle clock showing `23:00` under a label reading `20m`, with the settings agreeing with the label and not the clock, would otherwise just look broken.

It says so for that reason and no other. A timer that is merely *running* has not been dialled anywhere, so it gets no marker, even though holding the screen would still put it back to full. Those are two different questions — "has this been moved?" and "is there anything to put right?" — and only the first belongs on the label.

## What the middle of the ring is saying

The ring has one slot in the middle of it, and it used to hold two different things on a rota nobody had been told about: the Mate Wish Key mark normally, silently swapped for a pause glyph while the timer was paused. From outside that reads as a logo which comes and goes at random — and it left the other three states with no glyph at all, so a running clock and a finished one differed by a colour you had to have learnt.

The rule now is one sentence. **An idle clock shows the mark; every other state shows itself.**

| State | Middle of the ring |
| --- | --- |
| Idle — full, stopped, nothing to report | The brand mark, if you have left it switched on |
| Running | A play triangle |
| Paused | Two bars |
| Finished | A filled square |

Idle is the empty state: nothing running, nothing to resume, nothing finished. It is the one moment there is genuinely nothing to say, and therefore the only moment the mark is not in the way of something more useful.

A square rather than a tick for *finished*, because the ring behind it is already full and already in the elapsed colour — the glyph only has to say "stopped", which is what the same shape says on every transport control ever made. A tick would claim the timer had *succeeded*, and a countdown is in no position to judge that.

**The progress-bar layout shows exactly the same glyph**, drawn from the same function with the ring left off. That is not a coincidence to be maintained by hand: `renderGlyph` and the ring's own middle are one code path, so the two views cannot come to disagree about what a paused timer looks like.

### Why the bar was never coloured

The progress-bar view used to be Stream Deck's own built-in `$B1` layout. A built-in layout's item keys are published nowhere, so the plugin was sending `bar_fill_c` hopefully to a slot it *believed* was called `indicator` — and when a feedback key does not match, nothing happens and nothing is reported. The bar stayed grey whichever theme you picked.

Both layouts are the plugin's own files now (`layouts/ring.json`, `layouts/bar.json`), so every key the plugin sends is a key it defined, and the colour lands where it is aimed.

## Try it without hardware

`npm run mock` drives the whole thing from the keyboard with no Stream Deck attached, and `npm run demo` plays a scripted pass of about thirty checks. It prints a labelled ASCII frame per step; the dial's step shows up across three of them:

| Step | What it shows |
| --- | --- |
| 87 clicks at three different speeds | still `+1s` — turning cannot change the step |
| push the dial in and turn | `+1m` |
| let go and turn again | `+1s` — nothing was left switched on |

Through every one of those the preset list underneath reads `5m [20m] 30m 40m`, unchanged, and the label reads `from 20m`. Two later steps hold the screen twice: once to land back on `20:00`, and once more to move on to `30m`.

It also walks the gesture vocabulary and asserts the parts a person would otherwise have to check by eye — that a hold really does leave the clock stopped, that the pulse appears and then clears, that a finished repeating timer says so, and that the two layouts agree:

```
▸ press the dial → starts the clock

   was 21:49, press said "start", 1.2s later 21:48
   ✓ the dial starts it

▸ a PUSHED turn's release does nothing — otherwise every minute-nudge would start the clock

   was 21:47, after push-turn-release 23:49, said "+2m"
   ✓ read as a turn, not as a press

▸ …and STOPS at the limit, saying `done`, rather than looping for ever or going quiet

   clock 2s apart: 0:00 then 0:00; label reads "2s · ×2/2 · done"
   ✓ and it says so — a finished job no longer looks like its own last lap
   ✓ the ring shows the done glyph, not the brand mark

▸ the ring's middle shows the STATE, and the brand mark only on an idle clock

   idle: "logo", running: "play", paused: "pause"
   ✓ one glyph per state, and the mark only where there is nothing to report

▸ the progress-bar layout takes the theme, and carries the same state glyph

   layout "layouts/bar.json", bar idle #7C4DFF (glyph "logo") → running #00E5FF (glyph "play")
   ✓ the bar is coloured, and follows both the theme and the state
```

The step is `src/step.ts` — two pure functions with no state and no clock, so everything above is asserted in `test/step.test.ts` rather than described and hoped for. The gesture checks quoted above come from `tools/mock-host.mjs`, which drives the built plugin end to end.
