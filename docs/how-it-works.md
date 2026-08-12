# How the dial and the presets work

Two things in this plugin are worth explaining properly, because both do more than they look like they do: **turning the dial**, and **presets**.

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

## Presets

A preset is **just a duration**. There is no name, because a countdown's length is its own label: the screen shows `20m`, or `20m 30s` once it has been nudged off a round number.

Out of the box: **5, 20, 30 and 40 minutes**.

- **Press the dial** for the next preset, **hold it** for the previous one.
- **Edit them in the property inspector**, as hours, minutes and seconds. Add as many as you like; remove any but the last.
- **Or edit them with the dial** — turn a stopped countdown and the preset moves with it. That is usually faster than opening the inspector.
- Anything from **one second to twenty-four hours**.

Each of the four (or six) dials keeps its own preset list and its own running countdown, so they never interfere.

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

The implementation is `src/acceleration.ts`, and it is a pure module with an injectable clock, so all of the above is asserted in `test/acceleration.test.ts` rather than described and hoped for.
