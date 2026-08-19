# How the dial, the gestures and the presets work

A few things in this plugin are worth explaining properly, because each does more than it looks like it does: **turning the dial**, **the three press gestures**, **the key**, **why the screen redraws when nothing has changed**, and **presets**.

## The dial changes gear

A dial reports *ticks* — one click of rotation. The obvious thing to do is map one tick to a fixed amount of time, and that is exactly what makes most timer plugins annoying: pick a step small enough to trim thirty seconds off a countdown and setting a two-hour one takes a minute of winding. Pick a step big enough for two hours and you can no longer nudge.

So the step is not fixed. It sits in a **gear**:

| Gear | Step per tick | Feels like |
| --- | --- | --- |
| 1 | **1 second** | Trimming. One click, one second. |
| 2 | **10 seconds** | Adjusting. A short turn moves half a minute. |
| 3 | **1 minute** | Setting. A wrist-turn covers ten minutes. |
| 4 | **10 minutes** | Winding. One sustained gesture reaches twelve hours. |

The gear is chosen by **how fast you turn**, and once reached it is **held**. Both halves of that were wrong first time round, and the two mistakes compounded.

### Speed, not distance

The first version counted ticks. Four clicks inside a third of a second of each other and it changed up; fourteen and it changed up again. That reads well on paper and is unusable in the hand, because *any* sustained turn escalates — there was no way to click out thirty seconds one second at a time. You would get four seconds in and find the dial moving ten a click.

Now the accelerator measures the **rate**: ticks per second, smoothed across the last few rotations. Turn at a deliberate three to six clicks a second and it stays on seconds for as long as you care to keep turning. Cross **12 clicks a second** — a flick of the wrist, not a turn — and it changes up.

Two details make that behave:

- **Ticks, not events.** A dial batches its ticks when spun hard, so one event can carry three or four. A batch of three in a given gap is three times the rate of a single one, which is what makes a flick read as a flick.
- **It takes two quick clicks, not one.** The smoothed rate starts from zero, so a single fast click only carries half its weight. One stray fast click cannot change gear; two in a row can. The bias is deliberately towards staying in the fine gear, which is the one that was impossible to stay in before.

A change of gear also has a **120 ms dwell** on it, so the whole ladder cannot be climbed inside one flick. A sustained hard spin walks up a gear at a time and reaches the top in about a third of a second.

### Why the gear is held

Textbook rotary-encoder acceleration recomputes its multiplier from the current speed on every pulse, so the step collapses the moment you slow down. That is precisely backwards here. The reason to change up is to *then dial carefully at the coarser step* — you flick to get into minutes, and then you want to place the value a minute at a time. A step that falls back to seconds exactly when you slow down to aim is a step that only exists while you do not need it.

So the gear only comes down when you **let go of the dial for two seconds**. In particular:

- **Slowing down does not drop it.** Crawl along at three clicks a second in fourth gear and you get ten minutes a click, all day.
- **Reversing does not drop it either.** Overshooting and coming back is one continuous gesture, and a correction that landed in a different unit from the movement it was correcting would be useless. Direction is not part of the calculation at all.

### Holding the dial

Holding the dial down while turning is a **flat one minute per tick**, regardless of gear. It is an explicit request for a coarse step, and deliberately does not compound with the gear — otherwise the one gesture meant to be predictable would be the least predictable one.

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
| **Hold** | Put the clock back on its preset, or load the next one | Choosing what to time is not the same as beginning it. |

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

The press of the dial pays for it. **Once the clock has drifted from its preset, the first press puts it back; only the next one moves on.**

| State | Press the dial | Press it again |
| --- | --- | --- |
| Sitting on its preset | Next preset | The one after that |
| Dialled off its preset | Back to the preset, stopped | Next preset |

The restore comes first because it is wanted far more often: putting the clock back where it belongs is a thing you do constantly, and moving to a different preset is a thing you do occasionally. Nothing is lost either way — the press that would have advanced still advances, one press later — and the word on screen says which of the two it just did, `preset · 20m` against `next · 30m`.

The same applies to **holding** the dial for the previous preset, and to **holding the screen**. A gesture that skipped the restore would be a way round it, and then the rule would be something to remember rather than something that just holds.

It also gives the **one-preset** case something to do. It used to be the documented dead end — "with only one preset configured, the gesture lands back on the same one" — and now it is the way back from a dialled clock.

### Why the label shows the preset, not the clock

The label tracks the *preset's* length rather than the live duration, so you can always see where this timer started: begin a 20-minute countdown, add five minutes to it mid-flight, and the label still reads `20m`.

Once the two genuinely disagree it says so, reading `from 20m`. That matters more than it used to, because the disagreement is now permanent until you close it — an idle clock showing `23:00` under a label reading `20m`, with the settings agreeing with the label and not the clock, would otherwise just look broken.

## Try it without hardware

`npm run mock` drives the whole thing from the keyboard with no Stream Deck attached, and `npm run demo` plays a scripted pass. It prints a labelled ASCII frame per step; the gears show up across five of them:

| Step | Clock goes from | to |
| --- | --- | --- |
| one click → +1s | `20:00` | `20:01` |
| 8 slow clicks → +8s, still fine control however long it goes on | `20:01` | `20:09` |
| a hard spin → minutes a tick | `20:09` | `27:42` |
| keep winding → ten minutes a tick, half a day in one gesture | `27:42` | `8:27:42` |
| slow right down → the coarse gear is **held**, at ten minutes a click | `8:27:42` | `9:07:42` |

Through every one of those the preset list underneath reads `5m [20m] 30m 40m`, unchanged, and the label reads `from 20m`. The next two steps press the dial twice: once to land back on `20:00`, and once more to move on to `30m`.

It also walks the gesture vocabulary and asserts the parts a person would otherwise have to check by eye — that a hold really does leave the clock stopped, that the pulse appears and then clears, and that the key's caption falls back from the gesture to the state:

```
▸ every gesture pulses the ring
   pulse right after the tick: yes, half a second later: no
   ✓ pulses, then clears

▸ press dial once → BACK to the preset it was dialled off
   label while drifted: "from 20m", clock after one press: 20:00
   ✓ restored, and the preset was never overwritten

▸ …and starting a spent auto-repeat again is a FRESH run
   label on restart: "2s", one lap later: "2s · ×1/2"
   ✓ counter reset, and it repeats again

▸ key: one press → pauses
   caption right after: "pause", once the toast expires: "paused"
   ✓ gesture then state
```

The gearbox itself is `src/acceleration.ts` — a pure module that is handed the timestamp of each rotation rather than reading a clock, so every rate and threshold above is asserted in `test/acceleration.test.ts` rather than described and hoped for. The gesture checks quoted above come from `tools/mock-host.mjs`, which drives the built plugin end to end.
