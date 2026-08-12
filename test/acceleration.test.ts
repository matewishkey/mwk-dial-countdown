import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Accelerator, IDLE_RESET_MS, PRESSED_STEP_SECONDS, stepForMomentum, STEPS_SECONDS } from "../src/acceleration.ts";

describe("Accelerator", () => {
	it("starts at one second per tick, so a single click is the finest nudge there is", () => {
		const accelerator = new Accelerator();
		assert.equal(accelerator.rotate(1, 0), 1);
		assert.equal(accelerator.rotate(-1, 10_000), -1, "a rotation after a long pause is fine again");
	});

	it("climbs to ten seconds per tick once the dial keeps turning", () => {
		const accelerator = new Accelerator();
		let now = 0;
		let last = 0;
		for (let i = 0; i < 6; i++) {
			now += 100;
			last = accelerator.rotate(1, now);
		}
		assert.equal(last, 10, "sustained turning should reach the ten second step");
	});

	it("reaches a minute per tick when wound hard", () => {
		const accelerator = new Accelerator();
		let now = 0;
		let last = 0;
		for (let i = 0; i < 6; i++) {
			now += 60;
			last = accelerator.rotate(3, now);
		}
		assert.equal(accelerator.stepSeconds, 60, "a hard spin should reach a minute per tick");
		assert.equal(last, 3 * 60, "and the delta is that step applied to every tick in the batch");
	});

	it("reaches ten minutes per tick when wound harder still, so long timers stay practical", () => {
		const accelerator = new Accelerator();
		let now = 0;
		for (let i = 0; i < 20; i++) {
			now += 50;
			accelerator.rotate(3, now);
		}
		assert.equal(accelerator.stepSeconds, 600, "sustained hard winding should reach ten minutes a tick");
	});

	it("climbs through every step in order and skips none", () => {
		const accelerator = new Accelerator();
		const seen = [];
		let now = 0;
		for (let i = 0; i < 40; i++) {
			now += 50;
			accelerator.rotate(1, now);
			if (seen.at(-1) !== accelerator.stepSeconds) {
				seen.push(accelerator.stepSeconds);
			}
		}
		assert.deepEqual(seen, [...STEPS_SECONDS], "every tier should be passed through on the way up");
	});

	it("falls back to the fine step as soon as the user stops", () => {
		const accelerator = new Accelerator();
		let now = 0;
		for (let i = 0; i < 8; i++) {
			now += 100;
			accelerator.rotate(2, now);
		}
		assert.ok(accelerator.stepSeconds > 1, "precondition: momentum was built");

		now += IDLE_RESET_MS + 1;
		assert.equal(accelerator.rotate(1, now), 1, "a pause must drop straight back to fine control");
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
		assert.equal(accelerator.rotate(-3, 0), -3);
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
		assert.equal(accelerator.rotate(1, now + 80), 1, "after a reset the next turn is fine again");
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
