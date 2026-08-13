# How the dial, the gestures and the presets work

Three things in this plugin are worth explaining properly, because each does more than it looks like it does: **turning the dial**, **the three press gestures**, and **presets**.

## The dial accelerates

A dial reports *ticks* — one click of rotation. The obvious thing to do is map one tick to a fixed amount of time, and that is exactly what makes most timer plugins annoying: pick a step small enough to trim thirty seconds off a countdown and setting a two-hour one takes a minute of winding. Pick a step big enough for two hours and you can no longer nudge.

So the step is not fixed. It grows while you keep turning, and drops back the moment you stop.

| Momentum | Step per tick | Feels like |
| --- | --- | --- |
| 0–3 | **1 second** | Trimming. One click, one second. |
| 4–13 | **10 seconds** | Adjusting. A short turn moves half a minute. |
| 14–27 | **1 minute** | Setting. A wrist-turn covers ten minutes. |
| 28+ | **10 minutes** | Winding. One sustained gesture reaches twelve hours. |

### Momentum

Momentum is a counter that goes up as you turn and resets when you stop.

- **It counts ticks, not events.** A dial batches its ticks when spun hard — one event can carry three or four. Counting ticks means a single fast flick escalates as readily as a long steady turn, which is how it feels in the hand.
- **A pause of more than 350 ms resets it to zero.** Stop turning for a third of a second and the next click is one second again. You never have to *undo* acceleration; you just pause.
- **It is capped**, so the top step arrives after a predictable amount of winding rather than running away.

### Holding the dial

Holding the dial down while turning is a **flat one minute per tick**, regardless of momentum. It is an explicit request for a coarse step, and deliberately does not compound with acceleration — otherwise the one gesture meant to be predictable would be the least predictable one.

### What a rotation actually changes

This depends on whether the countdown is running.

- **Stopped** — turning edits the preset's own duration, and saves it. The dial is the preset editor.
- **Running** — turning nudges only the time left. The preset is untouched, so the next time you load it you get the length you set, not the length you improvised.

## The three gestures

Tapping the touchscreen, or pressing a key, does one of three things depending on how you do it.

| Gesture | Does | Why that one |
| --- | --- | --- |
| **One tap** | Pause / resume | The thing you do most, so it gets the plainest gesture. |
| **Two taps** | Restart from the top, running | Restarting is common enough to deserve a gesture, and it is always "back to full *and go*" — a reset that then waits to be started is two gestures pretending to be one. |
| **Hold** | Load the next preset, stopped | Choosing what to time is not the same as beginning it. |

### Why a single tap waits a moment

The hardware reports taps. It never reports that two taps were a pair — that has to be worked out, and the only way to work it out is to hold the first one back for as long as a second could still arrive. So a single tap acts **250 ms** after your finger lifts.

The alternative is to pause immediately and undo it when the second tap lands. That is worse: the screen is redrawn four times a second, so every double tap would visibly flash a state you did not ask for.

A **hold** does not wait, because there is nothing ambiguous about it — and a hold arriving while a tap is still pending cancels that tap, since a tap followed by a hold is two gestures rather than a double tap.

### Feedback, in place of haptics

There is none to be had: `@elgato/streamdeck` exposes no haptic command, and the hardware has no motor to drive if it did. Two things stand in for it, and they are doing different jobs.

- **The ring pulses** — a hairline that appears just outside the arc for 200 ms, on every gesture and every tick of the dial. It carries no information beyond "that registered", which is exactly what makes it work in peripheral vision. You cannot read a word per tick while winding a dial; you can see the ring answer each one.
- **A line names the action** — `+10s`, `pause`, `resume`, `restart`, `next · 20m` — for 900 ms. It is drawn where the finish time normally sits on a dial, and under the clock on a key.

The pulse is drawn as its own hairline rather than by brightening the arc, for two reasons: an event should not look like a change of state, and it has to remain visible during the end-of-timer fade, which is the one moment feedback matters most and the arc is already being dimmed.

## The key

The key action is the same countdown with the turning taken away — press, press twice, hold. Presets are edited in the property inspector, since there is nothing on a key to wind them with.

It draws its **whole face as one SVG**, digits included, rather than using `setTitle`. Stream Deck stops honouring a plugin's title the moment the user types one of their own, and a clock that silently stops being a clock because somebody labelled the button is not a clock. The title is left free for whatever you want it for.

With no room for a glyph behind the digits, the line under the clock carries the state instead: the gesture you just made, then `paused` if it is paused, then the preset's name.

## Presets

A preset is **just a duration**. There is no name, because a countdown's length is its own label: the screen shows `20m`, or `20m 30s` once it has been nudged off a round number.

Out of the box: **5, 20, 30 and 40 minutes**.

- **Hold the screen** — or **press the dial** for the next preset, **hold the dial** for the previous one.
- **Edit them in the property inspector**, as hours, minutes and seconds. Add as many as you like; remove any but the last.
- **Or edit them with the dial** — turn a stopped countdown and the preset moves with it. That is usually faster than opening the inspector.
- Anything from **one second to twenty-four hours**.

Each dial and each key keeps its own preset list and its own running countdown, so they never interfere.

With only one preset configured, the "next preset" gesture lands back on the same one. It still acknowledges the press, so the control does not feel dead.

### Why the label shows the preset, not the clock

The label tracks the *preset's* length rather than the live duration. So if you start a 20-minute countdown and add five minutes to it mid-flight, the label still reads `20m` — you can always see where it started. Adjusting a stopped countdown does change the preset, and then the label follows, because at that point you are editing it.

## Try it without hardware

`npm run mock` drives the whole thing from the keyboard with no Stream Deck attached, and `npm run demo` plays a scripted pass that shows the acceleration ladder, among other things:

```
▸ one click → +1s                        20m  → 20m 1s
▸ 8 slow clicks → +8s, still fine        20m 1s → 20m 9s
▸ a hard spin → minutes a tick           20m 9s → 24m 45s
▸ keep winding → ten minutes a tick      24m 45s → 3h 41m 21s
```

It also walks the gesture vocabulary and asserts the parts a person would otherwise have to check by eye — that a hold really does leave the clock stopped, that the pulse appears and then clears, and that the key's caption falls back from the gesture to the state:

```
▸ every gesture pulses the ring
   pulse right after the tick: yes, half a second later: no
   ✓ pulses, then clears

▸ hold the screen → next preset, LOADED BUT NOT STARTED
   clock 1.5s apart: 10:00 then 10:00
   ✓ stopped

▸ key: one press → pauses
   caption right after: "pause", once the toast expires: "paused"
   ✓ gesture then state
```

The implementation is `src/acceleration.ts`, and it is a pure module with an injectable clock, so all of the above is asserted in `test/acceleration.test.ts` rather than described and hoped for.
