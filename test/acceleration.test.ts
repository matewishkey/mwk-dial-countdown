import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Accelerator, IDLE_RESET_MS, PRESSED_STEP_SECONDS, STEPS_SECONDS, TICKS_PER_GEAR } from "../src/acceleration.ts";

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
	it("starts at one second per tick, so a single click is the finest nudge there is", () => {
		const accelerator = new Accelerator();
		assert.equal(accelerator.rotate(1, 0), 1);
		assert.equal(accelerator.rotate(-1, 10_000), -1, "a rotation after a long pause is fine again");
	});

	it("stays at one second for the first ten clicks, however fast or slow they come", () => {
		for (const gapMs of [10, 100, 900]) {
			const accelerator = new Accelerator();
			const { seconds } = turn(accelerator, TICKS_PER_GEAR, { gapMs });

			assert.equal(seconds, TICKS_PER_GEAR, `ten clicks ${gapMs}ms apart should be ten seconds`);
			assert.equal(accelerator.stepSeconds, 10, "and the tenth is what changes up, so the eleventh is coarser");
		}
	});

	it("changes up a gear every ten clicks in the same direction", () => {
		const accelerator = new Accelerator();
		let now = 0;

		for (const [gear, step] of STEPS_SECONDS.entries()) {
			assert.equal(accelerator.stepSeconds, step, `gear ${gear + 1} should be ${step}s a click`);
			({ now } = turn(accelerator, TICKS_PER_GEAR, { from: now }));
		}

		assert.equal(accelerator.stepSeconds, STEPS_SECONDS.at(-1), "and it tops out rather than running away");
	});

	it("counts distance, not time — a slow deliberate turn escalates exactly like a fast one", () => {
		const slow = new Accelerator();
		const fast = new Accelerator();
		turn(slow, 25, { gapMs: 900 });
		turn(fast, 25, { gapMs: 5 });

		assert.equal(slow.gear, fast.gear, "the same journey must cost the same, whatever pace it is made at");
		assert.equal(slow.count, fast.count);
	});

	it("turns back at the same step it was going forward at", () => {
		// The correction has to land in the unit the movement was in. Changing step mid-correction is
		// what made the earlier speed-based version unpredictable.
		const accelerator = new Accelerator();
		const { now } = turn(accelerator, TICKS_PER_GEAR * 2);
		assert.equal(accelerator.stepSeconds, 60, "precondition: two gears up");

		assert.equal(accelerator.rotate(-1, now + 100), -60, "back one click is one click of the same step");
	});

	it("starts the count again on the way back, so hovering never runs away", () => {
		// Nine up, nine back, nine up... indefinitely. Distance travelled is large; distance in one
		// direction never reaches ten, so the step must not move.
		const accelerator = new Accelerator();
		let now = 0;

		for (let pass = 0; pass < 12; pass++) {
			({ now } = turn(accelerator, TICKS_PER_GEAR - 1, { from: now, direction: pass % 2 === 0 ? 1 : -1 }));
			assert.equal(accelerator.stepSeconds, 1, `pass ${pass}: hovering must stay on the fine step`);
		}
	});

	it("needs a fresh ten the other way to change up again", () => {
		const accelerator = new Accelerator();
		let { now } = turn(accelerator, TICKS_PER_GEAR - 1);
		assert.equal(accelerator.count, TICKS_PER_GEAR - 1, "precondition: one short of changing up");

		({ now } = turn(accelerator, 1, { from: now, direction: -1 }));
		assert.equal(accelerator.count, 1, "the reversal throws away what was banked; this click is the new first");
		assert.equal(accelerator.stepSeconds, 1);

		({ now } = turn(accelerator, TICKS_PER_GEAR - 2, { from: now, direction: -1 }));
		assert.equal(accelerator.stepSeconds, 1, "nine the other way is still short");

		turn(accelerator, 1, { from: now, direction: -1 });
		assert.equal(accelerator.stepSeconds, 10, "the tenth in that direction is what does it");
	});

	it("keeps the gear through a reversal, only starting the count over", () => {
		const accelerator = new Accelerator();
		const { now } = turn(accelerator, TICKS_PER_GEAR * 2);
		assert.equal(accelerator.gear, 2, "precondition");

		turn(accelerator, 3, { from: now, direction: -1 });
		assert.equal(accelerator.gear, 2, "the gear is a property of the journey, not of the direction");
		assert.equal(accelerator.count, 3);
	});

	it("spends a batch of clicks across a change of gear rather than all at the old step", () => {
		// A dial spun hard batches its ticks, so an event can carry more clicks than are left before
		// the next gear. The eleventh click is worth ten seconds however it arrived.
		const batched = new Accelerator();
		const single = new Accelerator();

		const inOneGo = batched.rotate(12, 100);
		let separately = 0;
		for (let i = 0; i < 12; i++) {
			separately += single.rotate(1, 100 + i * 10);
		}

		assert.equal(inOneGo, separately, "twelve clicks is twelve clicks, batched or not");
		assert.equal(inOneGo, TICKS_PER_GEAR * 1 + 2 * 10, "ten at a second, then two at ten");
		assert.equal(batched.gear, single.gear);
		assert.equal(batched.count, single.count);
	});

	it("carries a very large batch up through more than one gear", () => {
		const accelerator = new Accelerator();
		const seconds = accelerator.rotate(25, 100);

		assert.equal(seconds, 10 * 1 + 10 * 10 + 5 * 60, "ten seconds, then a hundred, then five minutes");
		assert.equal(accelerator.gear, 2);
		assert.equal(accelerator.count, 5);
	});

	it("drops back to the fine step only once the dial has been let go", () => {
		const accelerator = new Accelerator();
		const { now } = turn(accelerator, TICKS_PER_GEAR * 2);
		assert.equal(accelerator.stepSeconds, 60, "precondition: two gears up");

		assert.equal(accelerator.rotate(1, now + IDLE_RESET_MS - 1), 60, "a pause short of the time-out is the same turn");
		assert.equal(accelerator.rotate(1, now + IDLE_RESET_MS * 5), 1, "and letting go puts it back to one second");
	});

	it("treats a held dial as a flat minute, and lets it neither earn nor spend a gear", () => {
		const accelerator = new Accelerator();
		const { now } = turn(accelerator, TICKS_PER_GEAR - 1);
		const banked = accelerator.count;

		assert.equal(accelerator.rotate(4, now + 100, true), 4 * PRESSED_STEP_SECONDS);
		assert.equal(accelerator.rotate(-2, now + 200, true), -2 * PRESSED_STEP_SECONDS);
		assert.equal(accelerator.count, banked, "a held turn is a different way of asking, and leaves the ladder alone");
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
		assert.equal(accelerator.count, 4, "and it does not disturb the count on its way through");
	});

	it("goes back to first gear when explicitly reset", () => {
		const accelerator = new Accelerator();
		const { now } = turn(accelerator, TICKS_PER_GEAR * 2);
		assert.ok(accelerator.gear > 0, "precondition");

		accelerator.reset();
		assert.equal(accelerator.gear, 0);
		assert.equal(accelerator.count, 0);
		assert.equal(accelerator.rotate(1, now + 20), 1, "after a reset the next turn is fine again");
	});
});
