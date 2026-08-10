import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_PRESETS, formatDuration, formatPresetLabel, MAX_DURATION_MS, MIN_DURATION_MS, Timer } from "../src/timer.ts";

/** Builds a timer on a clock we control, so no test has to wait for real seconds to pass. */
function at(startMs = 0, durationSeconds = 300) {
	let now = startMs;
	const timer = new Timer(durationSeconds * 1000, () => now);
	return {
		timer,
		advance(seconds: number) {
			now += seconds * 1000;
		}
	};
}

describe("Timer", () => {
	it("starts idle at its full duration", () => {
		const { timer } = at(0, 300);
		assert.equal(timer.status, "idle");
		assert.equal(timer.remainingMs, 300_000);
		assert.equal(timer.progress, 0);
	});

	it("counts down from the deadline rather than accumulating ticks", () => {
		const { timer, advance } = at(0, 300);
		timer.start();
		advance(120);
		assert.equal(timer.remainingMs, 180_000);
		// A long gap with no ticks at all must not cause drift.
		advance(60);
		assert.equal(timer.remainingMs, 120_000);
	});

	it("holds the remaining time across a pause", () => {
		const { timer, advance } = at(0, 300);
		timer.start();
		advance(100);
		timer.pause();
		assert.equal(timer.status, "paused");
		advance(500);
		assert.equal(timer.remainingMs, 200_000, "a paused timer must ignore the passage of time");
	});

	it("resumes from where it was paused", () => {
		const { timer, advance } = at(0, 300);
		timer.start();
		advance(100);
		timer.pause();
		advance(1000);
		timer.start();
		advance(50);
		assert.equal(timer.remainingMs, 150_000);
	});

	it("settles to elapsed once the deadline passes", () => {
		const { timer, advance } = at(0, 60);
		timer.start();
		advance(61);
		assert.equal(timer.status, "elapsed");
		assert.equal(timer.remainingMs, 0);
		assert.equal(timer.progress, 1);
	});

	it("restarts from full when started after elapsing", () => {
		const { timer, advance } = at(0, 60);
		timer.start();
		advance(61);
		timer.start();
		assert.equal(timer.status, "running");
		assert.equal(timer.remainingMs, 60_000);
	});

	it("toggles between running and paused", () => {
		const { timer } = at(0, 300);
		timer.toggle();
		assert.equal(timer.status, "running");
		timer.toggle();
		assert.equal(timer.status, "paused");
		timer.toggle();
		assert.equal(timer.status, "running");
	});

	it("resets a running timer back to a full, idle clock", () => {
		const { timer, advance } = at(0, 300);
		timer.start();
		advance(200);
		timer.reset();
		assert.equal(timer.status, "idle");
		assert.equal(timer.remainingMs, 300_000);
	});

	it("edits the duration when adjusted while idle", () => {
		const { timer } = at(0, 300);
		timer.adjust(60_000);
		assert.equal(timer.durationMs, 360_000);
		assert.equal(timer.remainingMs, 360_000, "an idle adjustment moves the clock with the duration");
	});

	it("nudges only the remaining time when adjusted while running", () => {
		const { timer, advance } = at(0, 300);
		timer.start();
		advance(100);
		timer.adjust(30_000);
		assert.equal(timer.status, "running", "adjusting must not stop a running timer");
		assert.equal(timer.remainingMs, 230_000);
	});

	it("keeps progress meaningful when a running timer is extended beyond its duration", () => {
		const { timer, advance } = at(0, 60);
		timer.start();
		advance(10);
		timer.adjust(120_000);
		assert.ok(timer.progress >= 0 && timer.progress <= 1, `progress out of range: ${timer.progress}`);
	});

	it("clamps adjustments to a sane range", () => {
		const { timer } = at(0, 300);
		timer.adjust(-999_999_999);
		assert.equal(timer.durationMs, MIN_DURATION_MS);
		timer.adjust(999_999_999_999);
		assert.equal(timer.durationMs, MAX_DURATION_MS);
	});

	it("stops and reloads when the duration is replaced by a preset change", () => {
		const { timer, advance } = at(0, 300);
		timer.start();
		advance(100);
		timer.setDuration(60_000);
		assert.equal(timer.status, "idle");
		assert.equal(timer.remainingMs, 60_000);
	});
});

describe("presets", () => {
	it("ships 5, 20, 30 and 40 minutes", () => {
		assert.deepEqual(DEFAULT_PRESETS, [300, 1200, 1800, 2400]);
		assert.deepEqual(DEFAULT_PRESETS.map((seconds) => formatPresetLabel(seconds * 1000)), ["5m", "20m", "30m", "40m"]);
	});
});

describe("formatPresetLabel", () => {
	it("names a round preset by its minutes", () => {
		assert.equal(formatPresetLabel(300_000), "5m");
		assert.equal(formatPresetLabel(2_400_000), "40m");
	});

	it("keeps the seconds once a preset is nudged off a round number", () => {
		assert.equal(formatPresetLabel(330_000), "5m 30s");
		assert.equal(formatPresetLabel(45_000), "45s");
	});

	it("adds hours when there are any", () => {
		assert.equal(formatPresetLabel(3_600_000), "1h");
		assert.equal(formatPresetLabel(5_400_000), "1h 30m");
	});

	it("never renders as empty", () => {
		assert.equal(formatPresetLabel(0), "0s");
	});
});

describe("formatDuration", () => {
	it("renders minutes and seconds", () => {
		assert.equal(formatDuration(0), "0:00");
		assert.equal(formatDuration(9_000), "0:09");
		assert.equal(formatDuration(300_000), "5:00");
		assert.equal(formatDuration(90_000), "1:30");
	});

	it("adds an hours field once past an hour", () => {
		assert.equal(formatDuration(3_600_000), "1:00:00");
		assert.equal(formatDuration(3_725_000), "1:02:05");
	});

	it("rounds up so the display never sits on zero while time remains", () => {
		assert.equal(formatDuration(1), "0:01");
		assert.equal(formatDuration(-500), "0:00");
	});
});
