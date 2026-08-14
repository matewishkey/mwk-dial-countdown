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
		const { countdown, advance } = fixture();

		countdown.toggle();
		advance(10_000);

		countdown.cyclePreset(1);
		assert.equal(countdown.presetIndex, 1);
		assert.equal(countdown.timer.durationMs, 1_200_000);
		assert.equal(countdown.timer.status, "idle", "a preset change must never leave the clock running");
		assert.equal(countdown.toast, "next · 20m", "and it names the one it landed on");
	});

	it("wraps round the presets in both directions", () => {
		const { countdown } = fixture([60, 120, 180], 0);

		countdown.cyclePreset(-1);
		assert.equal(countdown.presetIndex, 2, "stepping back from the first lands on the last");

		countdown.cyclePreset(1);
		assert.equal(countdown.presetIndex, 0);
	});

	it("stays put when there is only one preset, rather than failing to find another", () => {
		const { countdown } = fixture([600], 0);

		countdown.cyclePreset(1);
		assert.equal(countdown.presetIndex, 0);
		assert.equal(countdown.timer.durationMs, 600_000);
		assert.equal(countdown.toast, "next · 10m", "it still acknowledges the press, so the dial does not feel dead");
	});
});

describe("what the dial writes back", () => {
	it("edits the preset while stopped, and says by how much", () => {
		const { countdown } = fixture();

		assert.equal(countdown.adjust(1, false), true, "a stopped timer's adjustment is a preset edit worth saving");
		assert.equal(countdown.presets[0], 301);
		assert.equal(countdown.toast, "+1s");
	});

	it("nudges only the clock while running, leaving the preset alone", () => {
		const { countdown } = fixture();

		countdown.toggle();
		assert.equal(countdown.adjust(-1, false), false, "a running timer's nudge is not a preset edit");
		assert.equal(countdown.presets[0], 300, "the preset must survive being nudged mid-flight");
		assert.equal(countdown.toast, "-1s");
	});

	it("reports the accelerated step, not the raw tick count", () => {
		const { countdown } = fixture();

		// A held dial is a flat minute a tick, which is the one step that needs no winding up to reach.
		countdown.adjust(3, true);
		assert.equal(countdown.toast, "+3m");
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

		for (const lap of [1, 2]) {
			now += 2_000;
			countdown.settle();
			assert.equal(countdown.cycles, lap);
			assert.equal(countdown.timer.status, "running", `lap ${lap} should carry straight on`);
			assert.equal(countdown.timer.remainingMs, 2_000, "and it starts full, not where the last one ended");
		}

		now += 2_000;
		countdown.settle();
		assert.equal(countdown.timer.status, "elapsed", "the third elapse is the last — a bounded repeat must stop");
		assert.equal(countdown.cycles, 2);
	});

	it("does not ask for an alert that is switched off", () => {
		let now = 1_000_000;
		const countdown = new Countdown(normaliseSettings({ presets: [2], soundEnabled: false }), () => now);

		countdown.toggle();
		now += 2_000;
		assert.equal(countdown.settle(), false);
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

	it("hands back presets and index alongside the rest, so the dial's edits are saved", () => {
		const { countdown } = fixture();

		countdown.adjust(5, false);
		countdown.cyclePreset(1);

		const saved = countdown.persistable;
		assert.equal(saved.presets[0], 305);
		assert.equal(saved.presetIndex, 1);
		assert.equal(saved.volume, 100, "and the untouched settings come along unchanged");
	});
});
