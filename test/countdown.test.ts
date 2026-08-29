import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Countdown } from "../src/countdown.ts";
import { FLASH_MS, formatDelta, TOAST_MS } from "../src/feedback.ts";
import { normaliseSettings } from "../src/settings.ts";

/** A clock the test drives by hand, so nothing here depends on how long an assertion took. */
function fixture(presets = [300, 1200], presetIndex = 0): { countdown: Countdown; advance: (ms: number) => void } {
	let now = 1_000_000;
	const settings = normaliseSettings({ presets, presetIndex, soundEnabled: true });
	return {
		countdown: new Countdown(settings, () => now),
		advance: (ms: number) => {
			now += ms;
		}
	};
}

describe("the gestures a countdown answers to", () => {
	it("pauses a running timer and resumes a paused one, saying which each time", () => {
		const { countdown, advance } = fixture();

		countdown.toggle();
		assert.equal(countdown.timer.status, "running");
		assert.equal(countdown.toast, "start", "starting from idle is a start, not a resume");

		advance(60_000);
		countdown.toggle();
		assert.equal(countdown.timer.status, "paused");
		assert.equal(countdown.toast, "pause");

		countdown.toggle();
		assert.equal(countdown.timer.status, "running");
		assert.equal(countdown.toast, "resume", "coming back from a pause is a resume, not a fresh start");
	});

	it("resets to the full duration without starting it", () => {
		const { countdown, advance } = fixture();

		countdown.toggle();
		advance(120_000);
		assert.equal(countdown.timer.remainingMs, 180_000, "precondition: two minutes gone");

		countdown.reset();
		assert.equal(countdown.timer.remainingMs, 300_000, "a reset goes back to the full duration");
		assert.equal(
			countdown.timer.status,
			"idle",
			"and it must NOT start itself — resetting and running are two decisions, and the gesture only makes the first"
		);
		assert.equal(countdown.toast, "reset");
	});

	it("resets a finished timer back to a full, stopped clock too", () => {
		const { countdown, advance } = fixture([2]);

		countdown.toggle();
		advance(2_000);
		assert.equal(countdown.timer.status, "elapsed", "precondition: it ran out");

		countdown.reset();
		assert.equal(countdown.timer.status, "idle");
		assert.equal(countdown.timer.remainingMs, 2_000);
	});

	it("calls a finished timer's restart a start, not a resume", () => {
		const { countdown, advance } = fixture([2]);

		countdown.toggle();
		advance(2_000);
		assert.equal(countdown.timer.status, "elapsed", "precondition: it ran out");

		countdown.toggle();
		assert.equal(countdown.timer.remainingMs, 2_000, "a finished timer goes back to full when started");
		assert.equal(countdown.toast, "start", "so calling it a resume would describe a clock carrying on, which it is not");
	});

	it("loads the next preset without starting it — choosing what to time is not beginning", () => {
		const { countdown } = fixture();

		assert.equal(countdown.onPreset, true, "fresh, stopped and full: nothing to put right");
		countdown.cyclePreset();
		assert.equal(countdown.presetIndex, 1);
		assert.equal(countdown.timer.durationMs, 1_200_000);
		assert.equal(countdown.timer.status, "idle", "a preset change must never leave the clock running");
		assert.equal(countdown.toast, "next · 20m", "and it names the one it landed on");
	});

	it("wraps round the end of the presets rather than stopping at it", () => {
		const { countdown } = fixture([60, 120, 180], 0);

		for (const expected of [1, 2, 0]) {
			countdown.cyclePreset();
			assert.equal(countdown.presetIndex, expected);
		}
	});

	it("stays put when there is only one preset, rather than failing to find another", () => {
		const { countdown } = fixture([600], 0);

		countdown.cyclePreset();
		assert.equal(countdown.presetIndex, 0);
		assert.equal(countdown.timer.durationMs, 600_000);
		assert.equal(countdown.toast, "next · 10m", "it still acknowledges the press, so the dial does not feel dead");
	});
});

describe("what the dial changes, and what it leaves alone", () => {
	it("moves the clock without touching the preset behind it, stopped or running", () => {
		// The bug this guards: turning a stopped timer used to write the new length straight back into
		// the preset list, so winding a 20 minute timer up to 23 for one call silently redefined the
		// preset as 23 — and cycling away saved it there.
		const { countdown } = fixture();

		countdown.adjust(1);
		assert.equal(countdown.timer.durationMs, 301_000, "the clock in front of you does move");
		assert.equal(countdown.presets[0], 300, "the configured preset does not");
		assert.equal(countdown.toast, "+1s");

		countdown.reset();
		countdown.toggle();
		countdown.adjust(-1);
		assert.equal(countdown.presets[0], 300, "and a running nudge leaves it alone as it always did");
		assert.equal(countdown.toast, "-1s");
	});

	it("says so on the label once the clock and the preset disagree", () => {
		const { countdown } = fixture();
		assert.equal(countdown.drifted, false);

		countdown.adjust(1);
		assert.equal(countdown.drifted, true, "the gap is otherwise invisible — the settings still say 5m");
	});

	it("survives being cycled away from and back, which is what made presets unusable", () => {
		const { countdown } = fixture([300, 1200], 0);

		countdown.adjust(5);
		assert.equal(countdown.timer.durationMs, 305_000, "precondition: wound up by five clicks");

		countdown.cyclePreset(); // first press only puts it back on the preset
		countdown.cyclePreset(); // second press moves on
		countdown.cyclePreset(); // and round again to the first
		assert.equal(countdown.presetIndex, 0);
		assert.equal(countdown.timer.durationMs, 300_000, "the preset is exactly what it was configured as");
		assert.equal(countdown.persistable.presets[0], 300, "and that is what gets saved");
	});

	it("reports the change, not the raw click count", () => {
		const { countdown } = fixture();

		countdown.adjust(3, true);
		assert.equal(countdown.toast, "+3m", "three clicks at a minute each");
	});
});

describe("holding for the next preset", () => {
	it("spends its first hold putting the clock back on the preset it is already on", () => {
		const { countdown } = fixture([300, 1200], 0);

		countdown.toggle();
		countdown.adjust(5);
		assert.equal(countdown.drifted, true, "precondition: dialled off the preset");

		countdown.cyclePreset();
		assert.equal(countdown.presetIndex, 0, "the first press does not move on");
		assert.equal(countdown.timer.durationMs, 300_000, "it goes back to what the preset says");
		assert.equal(countdown.timer.status, "idle", "stopped, like every other way of loading a preset");
		assert.equal(countdown.toast, "preset · 5m", "and says which of the two things it just did");

		countdown.cyclePreset();
		assert.equal(countdown.presetIndex, 1, "the second press moves on as it always did");
		assert.equal(countdown.toast, "next · 20m");
	});

	it("stops and restores a RUNNING clock rather than throwing you onto the next preset", () => {
		// Reported from the hardware, and the rule was too narrow: this fired only when the dial had
		// wound the clock off its preset, on the reasoning that a running timer has a reset of its own
		// in the double tap. But the double tap is on a different control, and reaching for the dial
		// mid-run and landing on another preset is exactly the surprise the restore exists to prevent.
		const { countdown, advance } = fixture([300, 1200], 0);

		countdown.toggle();
		advance(10_000);
		assert.equal(countdown.drifted, false, "the duration still matches — it has not been dialled anywhere");
		assert.equal(countdown.onPreset, false, "but a running clock is not sitting on its preset either");

		countdown.cyclePreset();
		assert.equal(countdown.presetIndex, 0, "the first press does not move on");
		assert.equal(countdown.timer.status, "idle", "it stops the clock");
		assert.equal(countdown.timer.remainingMs, 300_000, "and puts it back to full");
		assert.equal(countdown.toast, "preset · 5m");

		countdown.cyclePreset();
		assert.equal(countdown.presetIndex, 1, "and the second press advances, as it always did");
	});

	it("puts a paused or finished clock right before it moves on, too", () => {
		for (const [name, wind] of [
			["paused", (c: Countdown, adv: (ms: number) => void) => (c.toggle(), adv(10_000), c.toggle())],
			["finished", (c: Countdown, adv: (ms: number) => void) => (c.toggle(), adv(300_000), void c.settle())]
		] as const) {
			const { countdown, advance } = fixture([300, 1200], 0);
			wind(countdown, advance);
			assert.notEqual(countdown.timer.status, "idle", `precondition: ${name}`);

			countdown.cyclePreset();
			assert.equal(countdown.presetIndex, 0, `${name}: the first press restores`);
			assert.equal(countdown.timer.status, "idle");
		}
	});

	it("holds the invariant `onPreset` leans on: an idle clock is always a full one", () => {
		const { countdown, advance } = fixture([300, 1200], 0);

		const idleStates: Array<() => void> = [
			() => countdown.reset(),
			() => countdown.cyclePreset(),
			() => countdown.adjust(1),
			() => countdown.applySettings({ presets: [900], presetIndex: 0 })
		];

		for (const reach of idleStates) {
			countdown.toggle();
			advance(5_000);
			reach();
			if (countdown.timer.status === "idle") {
				assert.equal(
					countdown.timer.remainingMs,
					countdown.timer.durationMs,
					"an idle clock with time already spent would make `onPreset` lie"
				);
			}
		}
	});

	it("gives the one-preset case a way back, where before there was none", () => {
		const { countdown } = fixture([600], 0);

		countdown.adjust(5);
		countdown.cyclePreset();
		assert.equal(countdown.timer.durationMs, 600_000, "with one preset the press has nowhere else to go");
		assert.equal(countdown.toast, "preset · 10m");
	});
});

describe("the lap counter", () => {
	function repeating(repeatCount: number): { countdown: Countdown; advance: (ms: number) => void } {
		let now = 1_000_000;
		const countdown = new Countdown(
			normaliseSettings({ presets: [2], presetIndex: 0, repeat: true, repeatCount, soundEnabled: false }),
			() => now
		);
		return { countdown, advance: (ms: number) => void (now += ms) };
	}

	/** Runs a repeating timer until it stops of its own accord. */
	function exhaust({ countdown, advance }: ReturnType<typeof repeating>): void {
		countdown.toggle();
		for (let i = 0; i < 20 && countdown.timer.status !== "elapsed"; i++) {
			advance(2_000);
			countdown.settle();
		}
	}

	it("counts a total, not a number of repeats", () => {
		// The off-by-one this closes: `repeatCount` was compared against repeats *made*, so the third
		// repeat of a count of three still passed the test and the timer ran a fourth time.
		let now = 1_000_000;
		const countdown = new Countdown(
			normaliseSettings({ presets: [2], presetIndex: 0, repeat: true, repeatCount: 3, soundEnabled: true }),
			() => now
		);

		// The alert sounds once per elapse, so counting it counts the runs.
		countdown.toggle();
		let runs = 0;
		for (let i = 0; i < 20; i++) {
			now += 2_000;
			if (countdown.settle()) {
				runs += 1;
			}
		}

		assert.equal(runs, 3, "a count of three is three runs in total, not four");
		assert.equal(countdown.finished, true);
	});

	it("reads from one, so the first lap is ×1/3 and not ×0/3", () => {
		const fixtureState = repeating(3);
		const { countdown, advance } = fixtureState;

		countdown.toggle();
		assert.equal(countdown.lap, 1, "the first run is the first lap the moment it starts");
		assert.equal(countdown.laps, 3);

		advance(2_000);
		countdown.settle();
		assert.equal(countdown.lap, 2);

		advance(2_000);
		countdown.settle();
		assert.equal(countdown.lap, 3);
	});

	it("never counts past the total it was given", () => {
		const fixtureState = repeating(2);
		exhaust(fixtureState);

		assert.equal(fixtureState.countdown.lap, 2, "×2/2, not ×3/2");
		assert.equal(fixtureState.countdown.laps, 2);
	});

	it("says nothing at all when repeat is switched off", () => {
		const { countdown } = fixture([2]);

		assert.equal(countdown.laps, 0, "no total means no counter on screen");
		assert.equal(countdown.lap, 0);
	});

	it("has a state for being finished, distinct from being on its last lap", () => {
		// The bug this closes: `×2/2` was shown both while the last lap was still counting down and
		// for ever afterwards, so there was no way to tell a finished job from one still going.
		const fixtureState = repeating(2);
		const { countdown, advance } = fixtureState;

		countdown.toggle();
		advance(2_000);
		countdown.settle();
		assert.equal(countdown.lap, 2, "on the last lap");
		assert.equal(countdown.finished, false, "but not finished — it is still running");

		advance(2_000);
		countdown.settle();
		assert.equal(countdown.lap, 2, "still ×2/2");
		assert.equal(countdown.finished, true, "and now it is over, which the screen can finally say");
	});

	it("starts a restarted timer's repeats over, rather than finding the budget already spent", () => {
		// The bug this guards: the count was left where the finished run put it, so starting an expired
		// auto-repeating timer again gave a run that never repeated once, under a display reading ×2/2.
		const fixtureState = repeating(2);
		const { countdown, advance } = fixtureState;

		exhaust(fixtureState);
		assert.equal(countdown.finished, true, "precondition: the repeats ran out");

		countdown.toggle();
		assert.equal(countdown.lap, 1, "starting it again is a fresh run, and a fresh run is on lap one");
		assert.equal(countdown.finished, false);

		advance(2_000);
		countdown.settle();
		assert.equal(countdown.lap, 2, "so it repeats again, which it could not before");
		assert.equal(countdown.timer.status, "running");
	});

	it("goes back to lap one on a reset", () => {
		const fixtureState = repeating(2);
		exhaust(fixtureState);
		assert.equal(fixtureState.countdown.finished, true, "precondition");

		fixtureState.countdown.reset();
		assert.equal(fixtureState.countdown.lap, 1);
		assert.equal(fixtureState.countdown.finished, false);
	});

	it("goes back to lap one when a preset is loaded", () => {
		const fixtureState = repeating(2);
		exhaust(fixtureState);

		fixtureState.countdown.cyclePreset();
		assert.equal(fixtureState.countdown.lap, 1);
	});

	it("goes back to lap one when the dial moves an expired clock off zero", () => {
		const fixtureState = repeating(2);
		exhaust(fixtureState);

		fixtureState.countdown.adjust(1);
		assert.equal(fixtureState.countdown.timer.status, "idle", "adjusting a finished clock puts it back to full");
		assert.equal(fixtureState.countdown.lap, 1, "which ends that run, count and all");
	});

	it("goes back to lap one when the inspector changes the duration", () => {
		const fixtureState = repeating(2);
		exhaust(fixtureState);

		fixtureState.countdown.applySettings({ presets: [900], presetIndex: 0, repeat: true, repeatCount: 2 });
		assert.equal(fixtureState.countdown.lap, 1);
	});

	it("goes back to lap one when the inspector changes the repeat rules themselves", () => {
		// The bug this closes: raising the count from 2 to 5 after the timer had finished left the
		// two laps it had already run counted against the new rule — `×2/5` on a dead clock.
		const fixtureState = repeating(2);
		exhaust(fixtureState);

		fixtureState.countdown.applySettings({ presets: [2], presetIndex: 0, repeat: true, repeatCount: 5 });
		assert.equal(fixtureState.countdown.laps, 5);
		assert.equal(fixtureState.countdown.lap, 1, "a new rule counts from the start of itself");
	});

	it("goes back to lap one when repeat is switched off and on again", () => {
		const fixtureState = repeating(2);
		exhaust(fixtureState);

		fixtureState.countdown.applySettings({ presets: [2], presetIndex: 0, repeat: false, repeatCount: 2 });
		assert.equal(fixtureState.countdown.laps, 0);

		fixtureState.countdown.applySettings({ presets: [2], presetIndex: 0, repeat: true, repeatCount: 2 });
		assert.equal(fixtureState.countdown.lap, 1);
	});
});

describe("elapsing", () => {
	it("asks for the alert exactly once, however many frames go by", () => {
		const { countdown, advance } = fixture([2]);

		countdown.toggle();
		advance(2_000);

		assert.equal(countdown.settle(), true, "the first frame past the deadline sounds the alert");
		assert.equal(countdown.settle(), false, "and no later frame sounds it again");
		assert.equal(countdown.settle(), false);
	});

	it("starts the next lap without a gap, and stops once the limit is reached", () => {
		let now = 1_000_000;
		const countdown = new Countdown(
			normaliseSettings({ presets: [2], presetIndex: 0, repeat: true, repeatCount: 2, soundEnabled: false }),
			() => now
		);

		countdown.toggle();

		now += 2_000;
		countdown.settle();
		assert.equal(countdown.lap, 2, "the second lap starts as soon as the first ends");
		assert.equal(countdown.timer.status, "running", "it should carry straight on, with no gap");
		assert.equal(countdown.timer.remainingMs, 2_000, "and it starts full, not where the last one ended");

		now += 2_000;
		countdown.settle();
		assert.equal(countdown.timer.status, "elapsed", "the second elapse is the last — a count of two is two runs");
		assert.equal(countdown.finished, true);
	});

	it("does not ask for an alert that is switched off", () => {
		let now = 1_000_000;
		const countdown = new Countdown(normaliseSettings({ presets: [2], soundEnabled: false }), () => now);

		countdown.toggle();
		now += 2_000;
		assert.equal(countdown.settle(), false);
	});
});

describe("the step the dial turns at", () => {
	it("is a second a click on a free turn, and says so", () => {
		const { countdown } = fixture();

		countdown.adjust(1);
		assert.equal(countdown.toast, "+1s");
	});

	it("is a minute a click while the dial is pushed in", () => {
		const { countdown } = fixture();

		countdown.adjust(3, true);
		assert.equal(countdown.toast, "+3m", "three clicks at a minute each");
	});

	it("goes back to seconds the moment the finger lifts, with nothing to un-set", () => {
		// The whole redesign in one test. The step used to be a mode you set and then had to
		// remember — it survived a preset change, a reset and a run, and needed a label on screen
		// for exactly that reason. There is no mode left to survive anything.
		const { countdown } = fixture();

		countdown.adjust(1, true);
		assert.equal(countdown.toast, "+1m");

		countdown.adjust(1);
		assert.equal(countdown.toast, "+1s", "the very next free turn is a second again");
	});

	it("never changes on its own, however far or fast or long the dial is turned", () => {
		const { countdown, advance } = fixture([24 * 60 * 60]);

		for (let i = 0; i < 200; i++) {
			countdown.adjust(i % 7 === 0 ? -3 : 1);
			advance(i % 5);
		}
		assert.equal(countdown.toast, "+1s", "still a second a click after two hundred of them");
	});

	it("holds no step across a preset change, a reset or a run", () => {
		const { countdown } = fixture([300, 1200], 0);

		countdown.adjust(1, true);
		countdown.cyclePreset();
		countdown.reset();
		countdown.toggle();

		countdown.adjust(1);
		assert.equal(countdown.toast, "+1s", "nothing carried a minute step over");
	});
});

describe("acknowledgement", () => {
	it("shows the word for its time and then stops", () => {
		const { countdown, advance } = fixture();

		countdown.toggle();
		assert.equal(countdown.toast, "start");

		advance(TOAST_MS - 1);
		assert.equal(countdown.toast, "start", "it must last long enough to be read");

		advance(1);
		assert.equal(countdown.toast, "", "and then get out of the way");
	});

	it("pulses the ring only for the moment after the gesture", () => {
		const { countdown, advance } = fixture();

		countdown.toggle();
		assert.equal(countdown.flashing, true);

		advance(FLASH_MS);
		assert.equal(countdown.flashing, false, "a pulse that outlasts its window is a glow, not a pulse");
		assert.equal(countdown.toast, "start", "though the word it came with is still there");
	});

	it("says nothing at all until something has been done", () => {
		const { countdown } = fixture();

		assert.equal(countdown.toast, "");
		assert.equal(countdown.flashing, false);
	});
});

describe("the end-of-timer fade", () => {
	function fading(presetSeconds: number, warnSeconds: number): ReturnType<typeof fixture> {
		let now = 1_000_000;
		const countdown = new Countdown(
			normaliseSettings({ presets: [presetSeconds], presetIndex: 0, warnEnabled: true, warnSeconds }),
			() => now
		);
		return { countdown, advance: (ms: number) => void (now += ms) };
	}

	it("stays off entirely when the fade is switched off", () => {
		const { countdown, advance } = fixture([20]);
		countdown.toggle();
		advance(19_000);
		assert.equal(countdown.dimmed, false);
	});

	it("stays off on a stopped timer, however little is left on it", () => {
		const { countdown, advance } = fading(20, 20);
		countdown.toggle();
		advance(19_000);
		countdown.toggle();
		assert.equal(countdown.timer.status, "paused", "precondition");
		assert.equal(countdown.dimmed, false, "a paused clock is not counting down towards anything");
	});

	it("caps the window at half the preset, so a fresh timer never starts already fading", () => {
		// The bug this guards: a five minute warning on a five minute timer blinked from the off,
		// which made adjusting the clock look like it had triggered the warning.
		const { countdown, advance } = fading(300, 300);
		countdown.toggle();
		assert.equal(countdown.dimmed, false, "it must not fade the instant it starts");

		advance(151_000);
		assert.equal(
			[countdown.dimmed, (advance(500), countdown.dimmed)].includes(true),
			true,
			"but past the halfway cap it does fade"
		);
	});

	it("alternates rather than sitting dim, so it reads as a blink", () => {
		const { countdown, advance } = fading(60, 30);
		countdown.toggle();
		advance(40_000);

		const seen = new Set<boolean>();
		for (let i = 0; i < 8; i++) {
			seen.add(countdown.dimmed);
			advance(250);
		}
		assert.deepEqual([...seen].sort(), [false, true], "both halves of the blink must occur");
	});
});

describe("formatDelta", () => {
	it("signs the step and names it in the units a person would say", () => {
		assert.equal(formatDelta(1), "+1s");
		assert.equal(formatDelta(-10), "-10s");
		assert.equal(formatDelta(60), "+1m");
		assert.equal(formatDelta(600), "+10m");
		assert.equal(formatDelta(-1800), "-30m");
		assert.equal(formatDelta(3600), "+1h");
		assert.equal(formatDelta(90), "+1m 30s");
	});
});

describe("settings arriving from the inspector", () => {
	it("reloads the clock when the chosen duration changed", () => {
		const { countdown } = fixture();

		assert.equal(countdown.applySettings({ presets: [900], presetIndex: 0 }), true);
		assert.equal(countdown.timer.durationMs, 900_000);
	});

	it("leaves a running timer alone when something unrelated changed", () => {
		const { countdown, advance } = fixture();

		countdown.toggle();
		advance(30_000);

		assert.equal(countdown.applySettings({ presets: [300, 1200], presetIndex: 0, volume: 40 }), false);
		assert.equal(countdown.timer.status, "running", "a volume change must not reset the timer");
		assert.equal(countdown.timer.remainingMs, 270_000);
	});

	it("leaves a dialled clock alone when something unrelated changed", () => {
		// The trap the dial's new hands-off behaviour opens: the clock can now sit off its preset
		// indefinitely, so a reload keyed on "settings disagree with the clock" would fire on every
		// touch of the volume slider and silently undo the adjustment.
		const { countdown } = fixture();

		countdown.toggle();
		countdown.adjust(5);
		const dialled = countdown.timer.durationMs;
		assert.equal(countdown.drifted, true, "precondition: dialled off the preset");

		assert.equal(countdown.applySettings({ presets: [300, 1200], presetIndex: 0, volume: 40 }), false);
		assert.equal(countdown.timer.durationMs, dialled, "the volume slider must not reload the clock");
		assert.equal(countdown.drifted, true, "and it is still off its preset, as the user left it");
	});

	it("does reload when the selected preset's own length changed under it", () => {
		const { countdown } = fixture();

		countdown.adjust(5);
		assert.equal(countdown.applySettings({ presets: [900, 1200], presetIndex: 0 }), true);
		assert.equal(countdown.timer.durationMs, 900_000, "editing the preset is exactly when a reload is right");
		assert.equal(countdown.drifted, false);
	});

	it("hands back the selected preset alongside the rest, so cycling is remembered", () => {
		const { countdown } = fixture();

		countdown.adjust(5);
		countdown.cyclePreset(); // puts the dialled clock back on its preset
		countdown.cyclePreset(); // and then moves on

		const saved = countdown.persistable;
		assert.equal(saved.presetIndex, 1);
		assert.equal(saved.presets[0], 300, "and the dial's turning is nowhere in it, by design");
		assert.equal(saved.volume, 100, "while the untouched settings come along unchanged");
	});
});
