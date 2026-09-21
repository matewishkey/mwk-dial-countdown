/**
 * The line under the clock — the rule both controls share, and the two ways they narrow it.
 *
 * Tested here rather than through the actions because it is a pure function of a countdown, so it
 * needs no control, no clock and no event loop. That it *had* to live here — the actions were
 * unimportable until the test loader started compiling properly — is now only history.
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

	it("is the CURRENT stage's length on a preset with several", () => {
		// The number the clock beside it is counting down, not the preset's total. On a 40/10/10 an
		// unnamed label reading `1h` would be naming something nothing on screen is measuring.
		const { countdown, advance } = fixture({ presets: [[2400, 600, 600]] });

		assert.equal(nameOf(countdown), "40m");

		countdown.toggle();
		advance(2_400_000);
		countdown.settle();
		assert.equal(nameOf(countdown), "10m", "the second stage is ten minutes, and says so");
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

	it("appends the stage tally, and says `done` at the end of the job", () => {
		const { countdown } = fixture({ title: "Tea", presets: [[1200, 600, 600]] });

		assert.equal(dialLabel(countdown, "idle"), "Tea · ×1/3", "the tally is the only sign there are stages at all");
		assert.equal(dialLabel(countdown, "elapsed"), "Tea · ×1/3 · done");
	});

	it("says `done` on a finished timer with only one stage", () => {
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

	it("keeps the name while the clock runs, when there is only one stage", () => {
		assert.equal(keyCaption(fixture({ title: "Tea" }).countdown, "running"), "Tea");
	});

	it("leaves the drift to the dial, which has the room for both halves", () => {
		const { countdown } = fixture({ title: "Tea" });
		countdown.adjust(180);

		assert.equal(keyCaption(countdown, "idle"), "Tea", "one line, and the clock above already shows the length");
	});

	it("says a sounding alert before anything else, on the step it finished as well as the last", () => {
		// The key cannot show the dial's bell — its clock is drawn where the glyph would go — so the
		// one line says the word instead. `40m, 10m, 10m`: the forty ends, the first ten is already
		// running, and `×2/3` is true but is not what the press in your hand is about to do.
		const { countdown } = fixture({ title: "Tea", presets: [[1200, 600, 600]] });
		countdown.ringing = true;

		assert.equal(keyCaption(countdown, "running"), "ringing", "mid-job, over the stage tally");
		assert.equal(keyCaption(countdown, "elapsed"), "ringing", "and at the end, over done");
	});

	it("gives the line straight back when the sound stops", () => {
		// The positive control: a caption stuck on `ringing` would pass the test above just as well.
		const { countdown } = fixture({ title: "Tea", presets: [[1200, 600, 600]] });
		countdown.ringing = true;
		countdown.ringing = false;

		assert.equal(keyCaption(countdown, "running"), "×1/3");
		assert.equal(keyCaption(countdown, "elapsed"), "done ×1/3");
	});

	it("gives the stage tally the line once the timer is under way", () => {
		const { countdown } = fixture({ title: "Tea", presets: [[1200, 600, 600]] });

		assert.equal(keyCaption(countdown, "idle"), "Tea", "before it starts, the name is the more useful thing");
		assert.equal(keyCaption(countdown, "running"), "×1/3");
	});

	it("says both when a job with stages has finished", () => {
		const { countdown } = fixture({ presets: [[1200, 600, 600]] });
		assert.equal(keyCaption(countdown, "elapsed"), "done ×1/3");
	});

	it("says `done` on a finished timer with only one stage", () => {
		assert.equal(keyCaption(fixture({ title: "Tea" }).countdown, "elapsed"), "done");
	});

	it("is empty when the label line is switched off, but still reports a finish", () => {
		const { countdown } = fixture({ title: "Tea", showLabel: false });

		assert.equal(keyCaption(countdown, "idle"), "");
		assert.equal(keyCaption(countdown, "elapsed"), "done", "switching off the name does not switch off the news");
	});
});
