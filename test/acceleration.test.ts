import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Accelerator, IDLE_RESET_MS, PRESSED_STEP_SECONDS, stepForMomentum, STEPS_SECONDS } from "../src/acceleration.ts";

describe("Accelerator", () => {
	it("starts at the fine step so a single tick is a small nudge", () => {
		const accelerator = new Accelerator();
		assert.equal(accelerator.rotate(1, 0), 10);
		assert.equal(accelerator.rotate(-1, 10_000), -10, "a rotation after a long pause is fine again");
	});

	it("climbs to a minute per tick once the dial keeps turning", () => {
		const accelerator = new Accelerator();
		let now = 0;
		let last = 0;
		for (let i = 0; i < 6; i++) {
			now += 100;
			last = accelerator.rotate(1, now);
		}
		assert.equal(last, 60, "sustained turning should reach the minute step");
	});

	it("reaches the coarsest step when wound hard, so hours are practical", () => {
		const accelerator = new Accelerator();
		let now = 0;
		let last = 0;
		for (let i = 0; i < 10; i++) {
			now += 60;
			last = accelerator.rotate(3, now);
		}
		assert.equal(accelerator.stepSeconds, 300, "a hard spin should reach five minutes per tick");
		assert.equal(last, 3 * 300, "and the delta is that step applied to every tick in the batch");
	});

	it("falls back to the fine step as soon as the user stops", () => {
		const accelerator = new Accelerator();
		let now = 0;
		for (let i = 0; i < 8; i++) {
			now += 100;
			accelerator.rotate(2, now);
		}
		assert.ok(accelerator.stepSeconds > 10, "precondition: momentum was built");

		now += IDLE_RESET_MS + 1;
		assert.equal(accelerator.rotate(1, now), 10, "a pause must drop straight back to fine control");
	});

	it("treats a held dial as a flat minute, never compounding with momentum", () => {
		const accelerator = new Accelerator();
		let now = 0;
		for (let i = 0; i < 12; i++) {
			now += 50;
			accelerator.rotate(3, now);
		}
		now += 50;
		assert.equal(accelerator.rotate(1, now, true), PRESSED_STEP_SECONDS);
		assert.equal(accelerator.rotate(-2, now + 50, true), -2 * PRESSED_STEP_SECONDS);
	});

	it("keeps the sign of the rotation", () => {
		const accelerator = new Accelerator();
		assert.equal(accelerator.rotate(-3, 0), -30);
	});

	it("drops momentum when explicitly reset", () => {
		const accelerator = new Accelerator();
		let now = 0;
		for (let i = 0; i < 8; i++) {
			now += 80;
			accelerator.rotate(2, now);
		}
		accelerator.reset();
		assert.equal(accelerator.momentum, 0);
		assert.equal(accelerator.rotate(1, now + 80), 10, "after a reset the next turn is fine again");
	});
});

describe("stepForMomentum", () => {
	it("is monotonic across the tiers", () => {
		let previous = 0;
		for (let momentum = 0; momentum <= 40; momentum++) {
			const step = stepForMomentum(momentum);
			assert.ok(step >= previous, `step went backwards at momentum ${momentum}`);
			assert.ok(STEPS_SECONDS.includes(step as (typeof STEPS_SECONDS)[number]), `unexpected step ${step}`);
			previous = step;
		}
	});
});
