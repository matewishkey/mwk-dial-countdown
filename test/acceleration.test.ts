import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Accelerator, IDLE_RESET_MS, PRESSED_STEP_SECONDS, STEPS_SECONDS } from "../src/acceleration.ts";

/** Turns the dial one click at a time, and hands back the total change and the time reached. */
function turn(
	accelerator: Accelerator,
	clicks: number,
	{ from = 0, gapMs = 100, direction = 1 }: { from?: number; gapMs?: number; direction?: number } = {}
): { now: number; seconds: number } {
	let now = from;
	let seconds = 0;
	for (let i = 0; i < clicks; i++) {
		now += gapMs;
		seconds += accelerator.rotate(direction, now);
	}
	return { now, seconds };
}

describe("Accelerator", () => {
	it("starts at one second per click, so a single click is the finest nudge there is", () => {
		const accelerator = new Accelerator();
		assert.equal(accelerator.rotate(1, 0), 1);
		assert.equal(accelerator.rotate(-1, 10_000), -1, "a rotation after a long pause is fine again");
	});

	it("steps in the largest unit already travelled — which is the whole rule", () => {
		for (const [gear, step] of STEPS_SECONDS.entries()) {
			const accelerator = new Accelerator();
			let now = 0;

			// Travel exactly as far as this gear's own step, one click at a time from a standing start.
			while (accelerator.travelled < step) {
				now += 100;
				accelerator.rotate(1, now);
			}

			assert.equal(accelerator.stepSeconds, step, `having moved ${step}s, the step should be ${step}s a click`);
			assert.equal(accelerator.gear, gear);
		}
	});

	it("takes ten clicks to reach ten seconds, then five to a minute, then nine to ten minutes", () => {
		// The ladder gets easier the further up it you are, because by then you have said plainly that
		// you want to travel: 24 clicks from a second a click to twelve hours, in one wind.
		const accelerator = new Accelerator();
		const clicks: number[] = [];
		let now = 0;
		let gear = 0;
		let since = 0;

		while (accelerator.gear < STEPS_SECONDS.length - 1) {
			now += 100;
			since += 1;
			accelerator.rotate(1, now);
			if (accelerator.gear > gear) {
				clicks.push(since);
				gear = accelerator.gear;
				since = 0;
			}
		}

		assert.deepEqual(clicks, [10, 5, 9]);
	});

	it("stays at one second until ten seconds have gone by, however fast the clicks come", () => {
		for (const gapMs of [10, 100, 900]) {
			const accelerator = new Accelerator();
			const { seconds } = turn(accelerator, 9, { gapMs });

			assert.equal(seconds, 9, `nine clicks ${gapMs}ms apart should be nine seconds`);
			assert.equal(accelerator.stepSeconds, 1, "nine seconds travelled is short of ten");
		}
	});

	it("changes up on the click that crosses the mark, not the one after", () => {
		const accelerator = new Accelerator();
		const { now } = turn(accelerator, 9);
		assert.equal(accelerator.stepSeconds, 1, "precondition: nine seconds travelled");

		assert.equal(accelerator.rotate(1, now + 100), 1, "the tenth click is still a second — it is what gets you there");
		assert.equal(accelerator.stepSeconds, 10, "and the eleventh will be ten");
	});

	it("counts distance, not time — a slow deliberate turn escalates exactly like a fast one", () => {
		const slow = new Accelerator();
		const fast = new Accelerator();
		turn(slow, 25, { gapMs: 900 });
		turn(fast, 25, { gapMs: 5 });

		assert.equal(slow.gear, fast.gear, "the same journey must cost the same, whatever pace it is made at");
		assert.equal(slow.travelled, fast.travelled);
	});

	it("turns back at the same step it was going forward at", () => {
		// The correction has to land in the unit the movement was in. Changing step mid-correction is
		// what made the earlier speed-based version unpredictable.
		const accelerator = new Accelerator();
		const { now } = turn(accelerator, 15);
		assert.equal(accelerator.stepSeconds, 60, "precondition: a minute travelled, so a minute a click");

		assert.equal(accelerator.rotate(-1, now + 100), -60, "back one click is one click of the same step");
	});

	it("starts the distance again on the way back, so hovering never runs away", () => {
		// Nine up, nine back, nine up... indefinitely. Distance travelled overall is large; distance in
		// one direction never reaches ten seconds, so the step must not move.
		const accelerator = new Accelerator();
		let now = 0;

		for (let pass = 0; pass < 12; pass++) {
			({ now } = turn(accelerator, 9, { from: now, direction: pass % 2 === 0 ? 1 : -1 }));
			assert.equal(accelerator.stepSeconds, 1, `pass ${pass}: hovering must stay on the fine step`);
		}
	});

	it("needs the distance covered afresh the other way to change up again", () => {
		const accelerator = new Accelerator();
		let { now } = turn(accelerator, 9);
		assert.equal(accelerator.travelled, 9, "precondition: one second short of changing up");

		({ now } = turn(accelerator, 1, { from: now, direction: -1 }));
		assert.equal(accelerator.travelled, 1, "the reversal throws the distance away; this click is the new first");
		assert.equal(accelerator.stepSeconds, 1);

		({ now } = turn(accelerator, 8, { from: now, direction: -1 }));
		assert.equal(accelerator.stepSeconds, 1, "nine the other way is still short");

		turn(accelerator, 1, { from: now, direction: -1 });
		assert.equal(accelerator.stepSeconds, 10, "the tenth in that direction is what does it");
	});

	it("keeps the gear through a reversal, only starting the distance over", () => {
		const accelerator = new Accelerator();
		const { now } = turn(accelerator, 15);
		assert.equal(accelerator.gear, 2, "precondition: a minute a click");

		turn(accelerator, 3, { from: now, direction: -1 });
		assert.equal(accelerator.gear, 2, "the gear is a property of the journey, not of the direction");
		assert.equal(accelerator.travelled, 180, "but the distance is measured afresh — three minutes back");
	});

	it("spends a batch of clicks across a change of gear rather than all at the old step", () => {
		// A dial spun hard batches its ticks, so an event can carry more clicks than are left before
		// the next gear. The click that crosses ten seconds is worth ten however it arrived.
		const batched = new Accelerator();
		const single = new Accelerator();

		const inOneGo = batched.rotate(12, 100);
		let separately = 0;
		for (let i = 0; i < 12; i++) {
			separately += single.rotate(1, 100 + i * 10);
		}

		assert.equal(inOneGo, separately, "twelve clicks is twelve clicks, batched or not");
		assert.equal(inOneGo, 10 * 1 + 2 * 10, "ten at a second, then two at ten");
		assert.equal(batched.gear, single.gear);
		assert.equal(batched.travelled, single.travelled);
	});

	it("carries a very large batch up through more than one gear", () => {
		const accelerator = new Accelerator();
		const seconds = accelerator.rotate(25, 100);

		// 10 clicks travel 10s, 5 more travel 50s, 9 more travel 540s, and the last one is in top gear.
		assert.equal(seconds, 10 * 1 + 5 * 10 + 9 * 60 + 1 * 600, "the whole ladder, inside one batch");
		assert.equal(accelerator.gear, STEPS_SECONDS.length - 1, "three changes of gear, all in one event");
		assert.equal(accelerator.travelled, 1_200);
	});

	it("drops back to the fine step only once the dial has been let go", () => {
		const accelerator = new Accelerator();
		const { now } = turn(accelerator, 15);
		assert.equal(accelerator.stepSeconds, 60, "precondition: a minute a click");

		assert.equal(accelerator.rotate(1, now + IDLE_RESET_MS - 1), 60, "a pause short of the time-out is the same turn");
		assert.equal(accelerator.rotate(1, now + IDLE_RESET_MS * 5), 1, "and letting go puts it back to one second");
	});

	it("treats a held dial as a flat minute, and lets it neither earn nor spend a gear", () => {
		const accelerator = new Accelerator();
		const { now } = turn(accelerator, 9);
		const banked = accelerator.travelled;

		assert.equal(accelerator.rotate(4, now + 100, true), 4 * PRESSED_STEP_SECONDS);
		assert.equal(accelerator.rotate(-2, now + 200, true), -2 * PRESSED_STEP_SECONDS);
		assert.equal(accelerator.travelled, banked, "a held turn is a different way of asking; it leaves the ladder alone");
		assert.equal(accelerator.stepSeconds, 1);
	});

	it("keeps the sign of the rotation", () => {
		const accelerator = new Accelerator();
		assert.equal(accelerator.rotate(-3, 0), -3);
	});

	it("ignores a rotation of no clicks", () => {
		const accelerator = new Accelerator();
		turn(accelerator, 4);
		assert.equal(accelerator.rotate(0, 1_000), 0);
		assert.equal(accelerator.travelled, 4, "and it does not disturb the distance on its way through");
	});

	it("goes back to first gear when explicitly reset", () => {
		const accelerator = new Accelerator();
		const { now } = turn(accelerator, 15);
		assert.ok(accelerator.gear > 0, "precondition");

		accelerator.reset();
		assert.equal(accelerator.gear, 0);
		assert.equal(accelerator.travelled, 0);
		assert.equal(accelerator.rotate(1, now + 20), 1, "after a reset the next turn is fine again");
	});
});
