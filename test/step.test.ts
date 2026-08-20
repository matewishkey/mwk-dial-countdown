import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_STEP, Selector, STEP_LABELS, STEP_SECONDS } from "../src/step.ts";

describe("Selector", () => {
	it("starts on the finest step, which is the one you cannot recover by turning", () => {
		const selector = new Selector();

		assert.equal(selector.step, DEFAULT_STEP);
		assert.equal(selector.stepSeconds, 1);
		assert.equal(selector.delta(1), 1);
	});

	it("swaps between seconds and minutes on a press", () => {
		const selector = new Selector();

		assert.equal(selector.toggle(), "minute");
		assert.equal(selector.delta(1), 60);

		assert.equal(selector.toggle(), "second");
		assert.equal(selector.delta(1), 1);
	});

	it("goes to an hour on a hold", () => {
		const selector = new Selector();

		assert.equal(selector.coarsen(), "hour");
		assert.equal(selector.delta(1), 3600);
	});

	it("comes back from an hour to seconds, not to minutes", () => {
		// Coming down from a coarse step you almost always want the finest one, not the middle — and
		// a press that landed on minutes would leave no single gesture that gets you back to seconds.
		const selector = new Selector();
		selector.coarsen();

		assert.equal(selector.toggle(), "second");
	});

	it("holds its step no matter how much turning happens", () => {
		// The whole design. Three earlier versions each tried to infer the step from how the dial was
		// being turned — momentum, then velocity, then distance travelled — and each in its own way
		// changed the step underneath the hand that was using it.
		const selector = new Selector();
		selector.toggle();

		let moved = 0;
		for (let i = 0; i < 500; i++) {
			moved += selector.delta(i % 9 === 0 ? -4 : 1);
		}

		assert.equal(selector.step, "minute", "five hundred clicks, and it is where it was put");
		assert.equal(selector.delta(1), 60);
		assert.equal(moved, 60 * (444 - 4 * 56), "and every click was worth exactly the same");
	});

	it("scales linearly with the clicks in a batch", () => {
		const selector = new Selector();
		selector.toggle();

		assert.equal(selector.delta(4), 4 * 60, "a batch of four is four clicks' worth, never more");
		assert.equal(selector.delta(1) * 4, selector.delta(4), "batched or not, the same");
	});

	it("keeps the sign of the rotation", () => {
		const selector = new Selector();

		assert.equal(selector.delta(-3), -3);
		selector.coarsen();
		assert.equal(selector.delta(-2), -2 * 3600);
	});

	it("names every step it can be in", () => {
		const selector = new Selector();

		for (const step of Object.keys(STEP_SECONDS) as Array<keyof typeof STEP_SECONDS>) {
			assert.equal(typeof STEP_LABELS[step], "string", `${step} has no label`);
			assert.ok(STEP_LABELS[step].length > 0);
		}
		assert.equal(selector.label, STEP_LABELS[DEFAULT_STEP]);
	});
});
