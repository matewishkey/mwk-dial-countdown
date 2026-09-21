import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BLINK_MS, Countdown } from "../src/countdown.ts";
import { FLASH_MS, formatDelta, TOAST_MS } from "../src/feedback.ts";
import { normaliseSettings } from "../src/settings.ts";

/** A clock the test drives by hand, so nothing here depends on how long an assertion took. */
function fixture(presets = [300, 1200], presetIndex = 0): { countdown: Countdown; advance: (ms: number) => void } {
	let now = 1_000_000;
	const settings = normaliseSettings({ presets, presetIndex });
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

	it("resets to the PRESET, not to wherever the dial left the clock", () => {
		// The case that had no test, which is why the old behaviour survived as long as it did. Reset
		// used to restore the *working* duration, so a 5m preset wound up to 8m reset to 8m from then
		// on — the configured length reachable only by holding the screen, and a value nudged to once
		// quietly promoted to the timer's real length.
		const { countdown } = fixture([300, 1200]);

		countdown.adjust(180);
		assert.equal(countdown.timer.durationMs, 480_000, "precondition: dialled from 5m up to 8m");
		assert.equal(countdown.drifted, true);

		countdown.reset();

		assert.equal(countdown.timer.durationMs, 300_000, "the preset, not the 8m the dial had left");
		assert.equal(countdown.timer.remainingMs, 300_000);
		assert.equal(countdown.drifted, false, "and nothing is left to put right");
		assert.equal(countdown.onPreset, true);
		assert.equal(countdown.toast, "reset");
	});

	it("resets a running timer that was dialled off its preset back to the preset", () => {
		// A nudge to a *running* clock moves the time left and deliberately leaves the duration — and
		// so the preset behind it — untouched, which is why this case is not `drifted`. It still has
		// to land back on the preset, by the same reset, so that both routes end in one place.
		const { countdown, advance } = fixture([300, 1200]);

		countdown.toggle();
		advance(30_000);
		countdown.adjust(600);
		assert.equal(countdown.timer.status, "running", "precondition: running");
		assert.equal(countdown.timer.remainingMs, 870_000, "precondition: nudged well off where it was");
		assert.equal(countdown.drifted, false, "nudging a running clock must not redefine its preset");

		countdown.reset();

		assert.equal(countdown.timer.durationMs, 300_000);
		assert.equal(countdown.timer.status, "idle", "and it is stopped, not carried on at a new length");
	});

	it("resets to the preset that is selected now, not the one the clock was loaded from", () => {
		// The positive control for "reset goes where the settings say": move the selection, and the
		// reset has to follow it rather than returning to a length nothing points at any more.
		const { countdown } = fixture([300, 1200], 0);

		countdown.adjust(60);
		countdown.applySettings({ presets: [300, 1200], presetIndex: 1 });
		assert.equal(countdown.stageSeconds, 1200, "precondition: the selection moved to 20m");

		countdown.reset();
		assert.equal(countdown.timer.durationMs, 1_200_000);
	});

	it("agrees with the hold about where the top of the clock is", () => {
		// These two used to disagree — reset restored the working duration and the hold restored the
		// preset — so which gesture you reached for decided what "back to the top" meant.
		const dialled = fixture([300, 1200]);
		dialled.countdown.adjust(180);
		dialled.countdown.reset();

		const held = fixture([300, 1200]);
		held.countdown.adjust(180);
		held.countdown.cyclePreset(); // not on its preset, so this restores rather than advances

		assert.equal(dialled.countdown.timer.durationMs, held.countdown.timer.durationMs);
		assert.equal(dialled.countdown.presetIndex, held.countdown.presetIndex, "and neither advanced");
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
		assert.equal(
			countdown.toast,
			"start",
			"so calling it a resume would describe a clock carrying on, which it is not"
		);
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
		assert.deepEqual(countdown.presets[0], [300], "the configured preset does not");
		assert.equal(countdown.toast, "+1s");

		countdown.reset();
		countdown.toggle();
		countdown.adjust(-1);
		assert.deepEqual(countdown.presets[0], [300], "and a running nudge leaves it alone as it always did");
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
		assert.deepEqual(countdown.persistable.presets[0], [300], "and that is what gets saved");
	});
});

describe("holding for the next preset", () => {
	it("spends its first hold putting the clock back on the preset it is already on", () => {
		const { countdown } = fixture([300, 1200], 0);

		countdown.toggle();
		countdown.adjust(5);
		// Not `drifted` — a nudge to a started clock leaves the duration alone. It is `onPreset` that
		// decides whether a hold restores or advances, and a clock that has been started is not on it.
		assert.equal(countdown.onPreset, false, "precondition: started, so there is something to put right");

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

describe("the stage counter", () => {
	/** A preset of `count` two-second stages — the sequence, driven by hand. */
	function staged(count: number): { countdown: Countdown; advance: (ms: number) => void } {
		let now = 1_000_000;
		const countdown = new Countdown(
			normaliseSettings({ presets: [Array.from({ length: count }, () => 2)], presetIndex: 0, soundId: "none" }),
			() => now
		);
		return { countdown, advance: (ms: number) => void (now += ms) };
	}

	/** Runs a sequence until it stops of its own accord. */
	function exhaust({ countdown, advance }: ReturnType<typeof staged>): void {
		countdown.toggle();
		for (let i = 0; i < 40 && countdown.timer.status !== "elapsed"; i++) {
			advance(2_000);
			countdown.settle();
		}
	}

	/**
	 * What the *finish time* is built from, and it had nothing testing it at all.
	 *
	 * `ends 15:40` is drawn from the clock on screen plus this, and the docs record it having been
	 * wrong for exactly the case this covers: before stages existed the two were the same number, and
	 * when they stopped being the same the line quietly went on reporting the end of the *current
	 * step* as the end of the job. A 40/10/10 said it would be done in forty minutes and then ran for
	 * another twenty. A fixed bug with no test on it is a bug waiting to come back.
	 */
	describe("how much is left after the current stage", () => {
		it("sums the stages still to come, and not the one on the clock", () => {
			let now = 1_000_000;
			const countdown = new Countdown(
				normaliseSettings({ presets: [[2400, 600, 600]], presetIndex: 0, soundId: "none" }),
				() => now
			);

			// On the first stage: the forty minutes in hand is the clock's business, the twenty after
			// it is this.
			assert.equal(countdown.remainingStagesSeconds, 1200, "10m + 10m are still to come");

			countdown.toggle();
			now += 2_400_000;
			countdown.settle();
			assert.equal(countdown.stage, 2, "precondition: on the second stage");
			assert.equal(countdown.remainingStagesSeconds, 600, "one ten-minute stage left after this one");

			now += 600_000;
			countdown.settle();
			assert.equal(countdown.stage, 3);
			assert.equal(countdown.remainingStagesSeconds, 0, "the last stage has nothing after it");
		});

		it("is zero for a plain one-stage preset, which is what kept the old sum looking right", () => {
			const { countdown } = fixture([300]);
			assert.equal(countdown.remainingStagesSeconds, 0);
		});

		it("does not count the stages already run", () => {
			// The sum is forward-looking. Counting the whole preset would put `ends` further away with
			// every stage that completed, which is the opposite of what a countdown does.
			const state = staged(4);
			state.countdown.toggle();
			state.advance(2_000);
			state.countdown.settle();

			assert.equal(state.countdown.stage, 2);
			assert.equal(state.countdown.remainingStagesSeconds, 4, "two stages of two seconds ahead, not four");
		});
	});

	it("runs each stage for its own length, in order", () => {
		// The whole feature in one test: forty, then ten, then ten — three different lengths, taken in
		// the order they were typed rather than one length taken three times.
		let now = 1_000_000;
		const countdown = new Countdown(
			normaliseSettings({ presets: [[40, 10, 10]], presetIndex: 0, soundId: "none" }),
			() => now
		);

		countdown.toggle();
		assert.equal(countdown.timer.durationMs, 40_000, "the first stage is forty");

		now += 40_000;
		assert.equal(countdown.settle(), true);
		assert.equal(countdown.stage, 2);
		assert.equal(countdown.timer.durationMs, 10_000, "and the second is ten, not another forty");

		now += 10_000;
		countdown.settle();
		assert.equal(countdown.stage, 3);
		assert.equal(countdown.timer.durationMs, 10_000);

		now += 10_000;
		countdown.settle();
		assert.equal(countdown.finished, true, "three stages, three runs, then it stops");
	});

	it("does not restart the tally when an unrelated setting changes mid-run", () => {
		// The inspector writes on every edit, so a volume slider must not take a sequence back to its
		// first stage. This is the guard the repeat count needed and did not have: raising it mid-run
		// put the tally back to zero, and a count of four produced six runs labelled `×1/4`.
		const base = { presets: [[2, 2, 2]], presetIndex: 0, soundId: "none", volume: 100 };
		let now = 1_000_000;
		const countdown = new Countdown(normaliseSettings(base), () => now);

		countdown.toggle();
		now += 2_000;
		countdown.settle();
		assert.equal(countdown.stage, 2, "precondition: one stage done, on the second");

		countdown.applySettings({ ...base, volume: 40 });
		assert.equal(countdown.stage, 2, "the stage already reached is still the stage it is on");
		assert.equal(countdown.timer.status, "running", "and it did not stop");
	});

	it("does go back to the first stage when the stages themselves are edited", () => {
		// The positive control for the gate above, and the rule in its own right: the run it was
		// part-way through belonged to a preset that no longer exists, so `×2/3` counted against a list
		// that now has two entries would be a number about nothing.
		const base = { presets: [[2, 2, 2]], presetIndex: 0, soundId: "none" };
		let now = 1_000_000;
		const countdown = new Countdown(normaliseSettings(base), () => now);

		countdown.toggle();
		now += 2_000;
		countdown.settle();
		assert.equal(countdown.stage, 2, "precondition");

		assert.equal(countdown.applySettings({ ...base, presets: [[5, 5]] }), true, "it reports the reload");
		assert.equal(countdown.stage, 1);
		assert.equal(countdown.stageCount, 2);
		assert.equal(countdown.timer.durationMs, 5_000);
	});

	it("stops at the end of the list, having run every stage exactly once", () => {
		// The off-by-one the list closes. The repeat count was a total compared against a tally of runs
		// *made*, so the third repeat of a count of three still passed the test and a fourth run
		// followed. A position in a list cannot be off by one against itself.
		const fixtureState = staged(3);

		fixtureState.countdown.toggle();
		let runs = 0;
		for (let i = 0; i < 20; i++) {
			fixtureState.advance(2_000);
			if (fixtureState.countdown.settle()) {
				runs += 1;
			}
		}

		assert.equal(runs, 3, "three stages is three runs, not four");
		assert.equal(fixtureState.countdown.finished, true);
	});

	it("reads from one, so the first stage is ×1/3 and not ×0/3", () => {
		const { countdown, advance } = staged(3);

		countdown.toggle();
		assert.equal(countdown.stage, 1, "the first stage is the first stage the moment it starts");
		assert.equal(countdown.stageCount, 3);

		advance(2_000);
		countdown.settle();
		assert.equal(countdown.stage, 2);

		advance(2_000);
		countdown.settle();
		assert.equal(countdown.stage, 3);
	});

	it("never counts past the end of the list", () => {
		const fixtureState = staged(2);
		exhaust(fixtureState);

		assert.equal(fixtureState.countdown.stage, 2, "×2/2, not ×3/2");
		assert.equal(fixtureState.countdown.stageCount, 2);
	});

	it("counts one stage for a plain preset, which is what hides the tally", () => {
		const { countdown } = fixture([2]);

		assert.equal(countdown.stageCount, 1, "a count of one is what the label reads as nothing to show");
		assert.equal(countdown.stage, 1);
	});

	it("has a state for being finished, distinct from being on its last stage", () => {
		// The bug this closes: `×2/2` was shown both while the last stage was still counting down and
		// for ever afterwards, so there was no way to tell a finished job from one still going.
		const { countdown, advance } = staged(2);

		countdown.toggle();
		advance(2_000);
		countdown.settle();
		assert.equal(countdown.stage, 2, "on the last stage");
		assert.equal(countdown.finished, false, "but not finished — it is still running");

		advance(2_000);
		countdown.settle();
		assert.equal(countdown.stage, 2, "still ×2/2");
		assert.equal(countdown.finished, true, "and now it is over, which the screen can finally say");
	});

	it("starts a restarted sequence over, rather than finding it already spent", () => {
		// The bug this guards: the tally was left where the finished run put it, so starting an expired
		// repeating timer gave a run that never repeated once, under a display reading ×2/2.
		const fixtureState = staged(2);
		const { countdown, advance } = fixtureState;

		exhaust(fixtureState);
		assert.equal(countdown.finished, true, "precondition: the stages ran out");

		countdown.toggle();
		assert.equal(countdown.stage, 1, "starting it again starts the sequence, not its last stage");
		assert.equal(countdown.finished, false);

		advance(2_000);
		countdown.settle();
		assert.equal(countdown.stage, 2, "so it moves on again, which it could not before");
		assert.equal(countdown.timer.status, "running");
	});

	it("puts a finished sequence back on its FIRST stage, at that stage's length", () => {
		// Not merely back to zero on whichever stage it stopped on. A 40/10/10 that finished on a ten
		// minute stage and were restarted there would run ten minutes and call it the whole job.
		let now = 1_000_000;
		const countdown = new Countdown(
			normaliseSettings({ presets: [[40, 10, 10]], presetIndex: 0, soundId: "none" }),
			() => now
		);

		countdown.toggle();
		for (let i = 0; i < 10 && countdown.timer.status !== "elapsed"; i++) {
			now += 40_000;
			countdown.settle();
		}
		assert.equal(countdown.finished, true, "precondition");

		countdown.toggle();
		assert.equal(countdown.stage, 1);
		assert.equal(countdown.timer.durationMs, 40_000, "the first stage's length, not the last one's");
	});

	it("goes back to the first stage on a reset", () => {
		const fixtureState = staged(2);
		exhaust(fixtureState);
		assert.equal(fixtureState.countdown.finished, true, "precondition");

		fixtureState.countdown.reset();
		assert.equal(fixtureState.countdown.stage, 1);
		assert.equal(fixtureState.countdown.finished, false);
	});

	it("goes back to the first stage when a preset is loaded", () => {
		const fixtureState = staged(2);
		exhaust(fixtureState);

		fixtureState.countdown.cyclePreset();
		assert.equal(fixtureState.countdown.stage, 1);
	});

	it("goes back to the first stage when the dial moves an expired clock off zero", () => {
		const fixtureState = staged(2);
		exhaust(fixtureState);

		fixtureState.countdown.adjust(1);
		assert.equal(fixtureState.countdown.timer.status, "idle", "adjusting a finished clock puts it back to full");
		assert.equal(fixtureState.countdown.stage, 1, "which ends that run, tally and all");
	});

	it("is not sitting on its preset while it is part-way through the stages", () => {
		// What decides whether a hold puts the clock right or advances to the next preset. A sequence
		// paused on its second stage has something to put right, even though that stage's duration
		// matches the settings perfectly.
		const { countdown, advance } = staged(3);

		countdown.toggle();
		advance(2_000);
		countdown.settle();
		countdown.toggle();
		assert.equal(countdown.timer.status, "paused", "precondition: stopped on stage two");
		assert.equal(countdown.drifted, false, "and not dialled anywhere — the duration is the stage's own");

		assert.equal(countdown.onPreset, false, "so a hold puts it right rather than moving on");
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

	it("starts the next stage without a gap, and stops once the list runs out", () => {
		let now = 1_000_000;
		const countdown = new Countdown(
			normaliseSettings({ presets: [[2, 2]], presetIndex: 0, soundId: "none" }),
			() => now
		);

		countdown.toggle();

		now += 2_000;
		countdown.settle();
		assert.equal(countdown.stage, 2, "the second stage starts as soon as the first ends");
		assert.equal(countdown.timer.status, "running", "it should carry straight on, with no gap");
		assert.equal(countdown.timer.remainingMs, 2_000, "and it starts full, not where the last one ended");

		now += 2_000;
		countdown.settle();
		assert.equal(countdown.timer.status, "elapsed", "the second elapse is the last — two stages is two runs");
		assert.equal(countdown.finished, true);
	});

	it("reports an elapse once, and does not decide what it sounds like", () => {
		// `settle()` used to answer "should this make a noise", which meant it had to know about the
		// sound settings — and it knew about only half of them. It now answers the question it is
		// actually in a position to answer: has the timer just run out. Which sound that produces, and
		// whether a failure to play it is worth reporting, belongs to whoever can see the filesystem.
		let now = 1_000_000;
		const countdown = new Countdown(normaliseSettings({ presets: [2], soundId: "none" }), () => now);

		countdown.toggle();
		now += 2_000;

		assert.equal(countdown.settle(), true, "the timer ran out, whatever the sound settings say");
		assert.equal(countdown.settle(), false, "and it only ran out once");
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
		// **Started deliberately on the DIM half of the blink**, not on a round second.
		//
		// `dimmed` ends in `Math.floor(now / BLINK_MS) % 2 === 1`, and BLINK_MS divides 1000 — so on a
		// clock starting at a whole second and advanced by whole seconds, that expression is `false` at
		// every instant a test could sample. Three of the tests below assert `dimmed === false`, which
		// made them true by arithmetic rather than by the guards they were written for: deleting the
		// half-duration cap on line 181 of `src/countdown.ts` — a bug that actually shipped once — left
		// all four of them green. Offset by half a blink, a `false` can only come from a guard.
		let now = 1_000_000 + BLINK_MS;
		const countdown = new Countdown(
			normaliseSettings({ presets: [presetSeconds], presetIndex: 0, warnEnabled: true, warnSeconds }),
			() => now
		);
		return { countdown, advance: (ms: number) => void (now += ms) };
	}

	it("stays off entirely when the fade is switched off", () => {
		// Built like `fading`, but with the fade off — and then wound to a moment that is inside the
		// window AND on the dim half of the blink, so `warnEnabled` is the only thing left that can
		// keep it off. It used to run on the shared fixture's whole-second clock, well outside any
		// window, so it passed with its own guard deleted and with the fade left switched on.
		let now = 1_000_000 + BLINK_MS;
		const countdown = new Countdown(
			normaliseSettings({ presets: [20], presetIndex: 0, warnEnabled: false, warnSeconds: 20 }),
			() => now
		);

		countdown.toggle();
		now += 19_000;

		assert.equal(countdown.dimmed, false, "the fade is off, so nothing else about the clock matters");
	});

	it("stays off on a stopped timer, however little is left on it", () => {
		const { countdown, advance } = fading(20, 20);
		countdown.toggle();
		advance(19_000);
		countdown.toggle();
		assert.equal(countdown.timer.status, "paused", "precondition");
		assert.equal(countdown.dimmed, false, "a paused clock is not counting down towards anything");
	});

	it("caps the window at half the step, so a fresh timer never starts already fading", () => {
		// The bug this guards: a five minute warning on a five minute timer blinked from the off,
		// which made adjusting the clock look like it had triggered the warning.
		const { countdown, advance } = fading(300, 300);
		countdown.toggle();
		assert.equal(countdown.dimmed, false, "it must not fade the instant it starts");

		// Read across two frames, because the fade blinks: landing on the dim half is not guaranteed
		// on any single one. Read into locals rather than testing an array of two inline expressions —
		// `assert.equal(countdown.dimmed, false)` above carries an assertion signature, so TypeScript
		// has `countdown.dimmed` narrowed to `false` from here on and could not check the old form.
		advance(151_000);
		const onFirstFrame = countdown.dimmed;
		advance(500);
		const onNextFrame = countdown.dimmed;

		assert.ok(onFirstFrame || onNextFrame, "but past the halfway cap it does fade");
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

		// Dialled while STOPPED, which is the case that genuinely moves the duration off the preset and
		// therefore the case this trap is about. Nudging a running clock no longer touches the duration
		// at all, so it could not trip a reload keyed on the two disagreeing.
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
		assert.deepEqual(saved.presets[0], [300], "and the dial's turning is nowhere in it, by design");
		assert.equal(saved.volume, 100, "while the untouched settings come along unchanged");
	});
});

describe("the auto-reset", () => {
	/** A ten-second timer that clears itself a minute after the whole job ends. */
	function clearing(overrides: Record<string, unknown> = {}): {
		countdown: Countdown;
		advance: (ms: number) => void;
	} {
		let now = 1_000_000;
		const countdown = new Countdown(
			normaliseSettings({
				presets: [10],
				presetIndex: 0,
				soundId: "none",
				autoResetEnabled: true,
				autoResetSeconds: 60,
				...overrides
			}),
			() => now
		);
		return { countdown, advance: (ms: number) => void (now += ms) };
	}

	/** Runs the timer out and settles it, which is the state the auto-reset waits in. */
	function finish({ countdown, advance }: ReturnType<typeof clearing>): void {
		countdown.toggle();
		advance(10_000);
		countdown.settle();
	}

	it("leaves a freshly finished timer alone, so `done` is actually seen", () => {
		const state = clearing();
		finish(state);

		state.advance(59_000);
		state.countdown.settle();

		assert.equal(state.countdown.timer.status, "elapsed", "a minute has not passed yet");
	});

	/**
	 * The two features are in direct opposition, and without this the wrong one wins.
	 *
	 * A long alert is for the finish you must not miss; the auto-reset is for tidying a finish
	 * nobody came back to. With both on, the second clears the clock out from under the first — the
	 * alarm stops, the screen goes back to a full timer, and there is no trace it ever fired. Which
	 * is precisely the failure a long alert was asked for to prevent.
	 */
	it("does not tidy away a timer that is still ringing", () => {
		const state = clearing();
		finish(state);
		state.countdown.ringing = true;

		state.advance(600_000);
		state.countdown.settle();

		assert.equal(state.countdown.timer.status, "elapsed", "ten minutes on, and it is still ringing");
	});

	it("tidies it away as soon as the ringing stops", () => {
		// The positive control for the test above: without it, that one would pass just as well if
		// the auto-reset had been broken outright.
		const state = clearing();
		finish(state);
		state.countdown.ringing = true;

		state.advance(600_000);
		state.countdown.settle();
		state.countdown.ringing = false;
		state.countdown.settle();

		assert.equal(state.countdown.timer.status, "idle", "the wait was long over; only the alarm was holding it");
	});

	it("puts the clock back to full and stopped once the wait is up", () => {
		const state = clearing();
		finish(state);

		state.advance(60_000);
		state.countdown.settle();

		assert.equal(state.countdown.timer.status, "idle");
		assert.equal(state.countdown.timer.remainingMs, 10_000, "a full clock, not the one that ran out");
		assert.equal(state.countdown.onPreset, true, "which is the state it started in");
	});

	it("does nothing at all when it is switched off", () => {
		// The positive control for every test above: the clock is driven exactly as far, and stays.
		const state = clearing({ autoResetEnabled: false });
		finish(state);

		state.advance(60 * 60_000);
		state.countdown.settle();

		assert.equal(state.countdown.timer.status, "elapsed", "a finished timer waits for a finger by default");
	});

	it("says nothing when it fires — nobody made this gesture", () => {
		const state = clearing();
		finish(state);

		state.advance(60_000);
		state.countdown.settle();

		assert.equal(state.countdown.toast, "", "the words under the clock name what you just did");
	});

	it("waits for the whole job, not for one lap of it", () => {
		// The case the setting is worded for. A repeating timer's earlier laps restart themselves, and
		// clearing the clock on one of them would end a job that was still running.
		const state = clearing({ repeat: true, repeatCount: 3 });
		state.countdown.toggle();

		// Three ten-second laps, a second at a time — well past the sixty the reset is waiting for, and
		// through two elapses it must not act on.
		for (let second = 1; second <= 30; second++) {
			state.advance(1_000);
			state.countdown.settle();
			assert.notEqual(state.countdown.timer.status, "idle", `cleared itself ${second}s in, mid-job`);
		}
		assert.equal(state.countdown.finished, true, "precondition: all three laps have run");

		state.advance(60_000);
		state.countdown.settle();
		assert.equal(state.countdown.timer.status, "idle", "and now that the job is over, it clears");
	});

	it("takes the lap tally back to the start with it", () => {
		const state = clearing({ presets: [[10, 10]] });

		state.countdown.toggle();
		for (let i = 0; i < 4 && !state.countdown.finished; i++) {
			state.advance(10_000);
			state.countdown.settle();
		}
		assert.equal(state.countdown.stage, 2, "precondition: the stages ran out");

		state.advance(60_000);
		state.countdown.settle();

		assert.equal(state.countdown.timer.status, "idle");
		assert.equal(state.countdown.stage, 1, "×2/2 on a clock put back to the start is not a stage it is on");
	});

	it("is called off the moment somebody restarts the timer by hand", () => {
		const state = clearing();
		finish(state);

		state.advance(30_000);
		state.countdown.toggle();
		assert.equal(state.countdown.timer.status, "running", "precondition: a fresh run, started by hand");

		// Past the old deadline, but well inside the new run.
		state.advance(5_000);
		state.countdown.settle();

		assert.equal(state.countdown.timer.status, "running", "a pending reset must not reach into the next run");
	});

	it("measures its wait from the moment a page comes back, not from a finish nobody watched", () => {
		// A countdown set aside for an off-screen control keeps time with nothing running, so it comes
		// back already elapsed and `resume` is the first thing that sees it. Dating the finish back to
		// when it actually happened would clear the clock on the first frame — the one frame where
		// seeing `done` is the whole point.
		const state = clearing();
		state.countdown.toggle();
		state.advance(10_000 + 60 * 60_000);
		state.countdown.resume();

		state.countdown.settle();
		assert.equal(state.countdown.timer.status, "elapsed", "an hour late, and it still shows what happened");

		state.advance(60_000);
		state.countdown.settle();
		assert.equal(state.countdown.timer.status, "idle", "and clears itself a minute after being looked at");
	});
});
