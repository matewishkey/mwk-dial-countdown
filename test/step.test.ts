import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deltaFor, STEP_SECONDS, stepFor } from "../src/step.ts";

describe("the step is your finger, not a mode", () => {
	it("is a second a click when the dial is turned freely", () => {
		assert.equal(stepFor(false), "second");
		assert.equal(deltaFor(1, false), 1);
	});

	it("is a minute a click while the dial is pushed in", () => {
		assert.equal(stepFor(true), "minute");
		assert.equal(deltaFor(1, true), 60);
	});

	it("holds nothing between turns, so nothing can be left switched on", () => {
		// The whole point of the redesign. Four earlier versions each carried the step as state —
		// three inferred it from how the dial was being turned, the fourth let you set it and then
		// had to keep a label on screen reminding you which one you had left it on. There is no
		// object here to hold a step, so there is no step to forget.
		assert.equal(deltaFor(1, false), 1, "after a pushed turn");
		assert.equal(deltaFor(1, true), 60);
		assert.equal(deltaFor(1, false), 1, "and it is a second again the moment the finger lifts");
	});

	it("scales linearly with the clicks in a batch", () => {
		assert.equal(deltaFor(4, true), 4 * 60, "a batch of four is four clicks' worth, never more");
		assert.equal(deltaFor(1, true) * 4, deltaFor(4, true), "batched or not, the same");
	});

	it("keeps the sign of the rotation", () => {
		assert.equal(deltaFor(-3, false), -3);
		assert.equal(deltaFor(-2, true), -2 * 60);
	});

	it("offers seconds and minutes, and nothing coarser", () => {
		// Hours went deliberately: nothing you dial by hand is four hours long. That is a preset,
		// typed in the property inspector, and the dial is for nudging what a preset loaded.
		assert.deepEqual(Object.keys(STEP_SECONDS), ["second", "minute"]);
		assert.deepEqual(Object.values(STEP_SECONDS), [1, 60]);
	});
});
