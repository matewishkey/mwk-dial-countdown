import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DOUBLE_TAP_MS, type Gesture, LONG_PRESS_MS, TapResolver } from "../src/gestures.ts";

/** The window is shortened so the suite does not spend a quarter of a second per assertion. */
const WINDOW = 20;

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Collects what the resolver emitted, and waits long enough for a pending tap to have resolved. */
function collector(): { seen: Gesture[]; resolver: TapResolver; settle: () => Promise<Gesture[]> } {
	const seen: Gesture[] = [];
	const resolver = new TapResolver((gesture) => seen.push(gesture), WINDOW);
	return {
		seen,
		resolver,
		settle: async () => {
			await wait(WINDOW * 3);
			return seen;
		}
	};
}

describe("TapResolver", () => {
	it("turns a lone tap into a toggle, once its window has closed", async () => {
		const { resolver, seen, settle } = collector();

		resolver.press(false);
		assert.deepEqual(seen, [], "a single tap must not act before a second one could arrive");

		assert.deepEqual(await settle(), ["toggle"]);
	});

	it("turns two taps inside the window into one restart, and not a toggle as well", async () => {
		const { resolver, settle } = collector();

		resolver.press(false);
		resolver.press(false);

		assert.deepEqual(await settle(), ["restart"], "the first tap's toggle must be cancelled, not merely joined");
	});

	it("treats two taps either side of the window as two separate toggles", async () => {
		const { resolver, settle } = collector();

		resolver.press(false);
		await wait(WINDOW * 2);
		resolver.press(false);

		assert.deepEqual(await settle(), ["toggle", "toggle"]);
	});

	it("resolves a held press immediately — there is nothing ambiguous about it", async () => {
		const { resolver, seen, settle } = collector();

		resolver.press(true);
		assert.deepEqual(seen, ["next"], "a hold must not wait on a window it can never be part of");

		assert.deepEqual(await settle(), ["next"]);
	});

	it("lets a hold swallow a tap that was still waiting, rather than firing both", async () => {
		const { resolver, settle } = collector();

		resolver.press(false);
		resolver.press(true);

		assert.deepEqual(await settle(), ["next"], "a tap then a hold is one gesture, not a double tap plus a hold");
	});

	it("drops a pending tap when cancelled, e.g. because the action left the screen", async () => {
		const { resolver, settle } = collector();

		resolver.press(false);
		assert.equal(resolver.pending, true);
		resolver.cancel();
		assert.equal(resolver.pending, false);

		assert.deepEqual(await settle(), []);
	});

	it("keeps the thresholds far enough apart to be told apart by a human hand", () => {
		assert.ok(DOUBLE_TAP_MS < LONG_PRESS_MS, "a double tap that outlasts a long press could never be made");
		assert.ok(DOUBLE_TAP_MS >= 150, `${DOUBLE_TAP_MS}ms is too tight a window for two deliberate taps`);
		assert.ok(DOUBLE_TAP_MS <= 400, `${DOUBLE_TAP_MS}ms of lag on every single tap is too much to pay`);
	});
});
