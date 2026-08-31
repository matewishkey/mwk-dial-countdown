/**
 * The line under the clock — the rule both controls share, and the two ways they narrow it.
 *
 * It is worth testing here rather than through the actions because the actions cannot be imported
 * at all: both carry an `@action` decorator, which Node's type stripping leaves standing. That is
 * why this rule was moved out of them in the first place.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Countdown } from "../src/countdown.ts";
import { dialLabel, keyCaption, nameOf } from "../src/label.ts";
import { normaliseSettings } from "../src/settings.ts";

/** A countdown on a hand-driven clock, so nothing here depends on how long an assertion took. */
function fixture(overrides: Record<string, unknown> = {}): {
	countdown: Countdown;
	advance: (ms: number) => void;
} {
	let now = 1_000_000;
	const settings = normaliseSettings({ presets: [1200], presetIndex: 0, soundId: "none", ...overrides });
	return {
		countdown: new Countdown(settings, () => now),
		advance: (ms: number) => {
			now += ms;
		}
	};
}

describe("what a timer is called", () => {
	it("is its preset's length when nothing has been typed", () => {
		assert.equal(nameOf(fixture().countdown), "20m");
	});

	it("is the title when there is one", () => {
		assert.equal(nameOf(fixture({ title: "Tea" }).countdown), "Tea");
	});

	it("follows the preset, not the clock, once the dial has moved it", () => {
		const { countdown } = fixture();
		countdown.adjust(180);
		assert.equal(nameOf(countdown), "20m", "the name is the preset as configured, not as it was left");
	});
});

describe("the dial's label", () => {
	it("names the timer", () => {
		assert.equal(dialLabel(fixture().countdown, "idle"), "20m");
		assert.equal(dialLabel(fixture({ title: "Tea" }).countdown, "idle"), "Tea");
	});

	it("reports the drift beside the name, so naming a timer does not hide it", () => {
		const { countdown } = fixture({ title: "Tea" });
		countdown.adjust(180);

		assert.equal(dialLabel(countdown, "idle"), "Tea · from 20m");
	});

	it("says the drift once when the name is the length", () => {
		const { countdown } = fixture();
		countdown.adjust(180);

		assert.equal(dialLabel(countdown, "idle"), "from 20m", "not `20m · from 20m`, which reads as agreement");
	});

	it("appends the lap tally, and says `done` at the end of the job", () => {
		const { countdown } = fixture({ title: "Tea", repeat: true, repeatCount: 3 });

		assert.equal(dialLabel(countdown, "idle"), "Tea · ×1/3", "the tally is the only sign repeat is on at all");
		assert.equal(dialLabel(countdown, "elapsed"), "Tea · ×1/3 · done");
	});

	it("says `done` on a finished timer that was not repeating", () => {
		assert.equal(dialLabel(fixture({ title: "Tea" }).countdown, "elapsed"), "Tea · done");
	});

	it("is empty when the label line is switched off", () => {
		assert.equal(dialLabel(fixture({ title: "Tea", showLabel: false }).countdown, "idle"), "");
	});
});

describe("the key's caption", () => {
	it("names the timer when there is nothing to report", () => {
		assert.equal(keyCaption(fixture().countdown, "idle"), "20m");
		assert.equal(keyCaption(fixture({ title: "Tea" }).countdown, "idle"), "Tea");
	});

	it("keeps the name while the clock runs, when nothing is repeating", () => {
		assert.equal(keyCaption(fixture({ title: "Tea" }).countdown, "running"), "Tea");
	});

	it("leaves the drift to the dial, which has the room for both halves", () => {
		const { countdown } = fixture({ title: "Tea" });
		countdown.adjust(180);

		assert.equal(keyCaption(countdown, "idle"), "Tea", "one line, and the clock above already shows the length");
	});

	it("gives the lap tally the line once the timer is under way", () => {
		const { countdown } = fixture({ title: "Tea", repeat: true, repeatCount: 3 });

		assert.equal(keyCaption(countdown, "idle"), "Tea", "before it starts, the name is the more useful thing");
		assert.equal(keyCaption(countdown, "running"), "×1/3");
	});

	it("says both when a repeating job has finished", () => {
		const { countdown } = fixture({ repeat: true, repeatCount: 3 });
		assert.equal(keyCaption(countdown, "elapsed"), "done ×1/3");
	});

	it("says `done` on a finished timer that was not repeating", () => {
		assert.equal(keyCaption(fixture({ title: "Tea" }).countdown, "elapsed"), "done");
	});

	it("is empty when the label line is switched off, but still reports a finish", () => {
		const { countdown } = fixture({ title: "Tea", showLabel: false });

		assert.equal(keyCaption(countdown, "idle"), "");
		assert.equal(keyCaption(countdown, "elapsed"), "done", "switching off the name does not switch off the news");
	});
});
