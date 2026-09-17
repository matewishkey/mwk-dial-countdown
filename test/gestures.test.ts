import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DOUBLE_PRESS_MS, DOUBLE_TAP_MS, type Gesture, LONG_PRESS_MS, TapResolver } from "../src/gestures.ts";

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

	it("turns two taps inside the window into one reset, and not a toggle as well", async () => {
		const { resolver, settle } = collector();

		resolver.press(false);
		resolver.press(false);

		assert.deepEqual(await settle(), ["reset"], "the first tap's toggle must be cancelled, not merely joined");
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

describe("the key's own window", () => {
	// The bug: the key used the touchscreen's 250 ms. A key is slower to press twice than glass is to
	// tap twice, so an ordinary double-press fell outside it and was read as two separate presses —
	// start, then pause — leaving a clock that had not moved and a key that looked dead.
	const HUMAN_DOUBLE_PRESS_MS = 320;

	it("is wide enough for a double-press that the touchscreen's window would miss", () => {
		assert.ok(
			HUMAN_DOUBLE_PRESS_MS > DOUBLE_TAP_MS,
			"the premise: this gap is outside the touchscreen's window, which is why the key needed its own"
		);
		assert.ok(
			DOUBLE_PRESS_MS > HUMAN_DOUBLE_PRESS_MS,
			`a double-press ${HUMAN_DOUBLE_PRESS_MS} ms apart must land inside the key's window`
		);
	});

	it("holds a pending press while a finger is down, so a hold can still win", async () => {
		// This replaces an assertion that `LONG_PRESS_MS > DOUBLE_PRESS_MS`, whose stated reason — that
		// a pending press must not out-live the hold meant to cancel it — was the opposite of what that
		// inequality achieves. A pending press starts at the PREVIOUS release and the hold starts at the
		// NEXT press, so the pending one always expired first, whatever the constants were, and press
		// then press-and-hold arrived as two gestures. Freezing settles it without either constant.
		const seen: Gesture[] = [];
		const resolver = new TapResolver((gesture) => seen.push(gesture), 60);

		resolver.press(false); // a press lands, and waits to see if it had a partner
		await wait(20);
		resolver.hold(); // a second press begins before the window closed
		await wait(150); // well past the window it would have expired in

		assert.deepEqual(seen, [], "nothing may resolve while a finger is still on the control");
		assert.equal(resolver.pending, true, "the press is still pending — it is simply not counting down");

		resolver.cancel(); // what the long press does when it fires
		assert.deepEqual(seen, [], "and the hold drops it rather than letting it land afterwards");
	});

	it("still pairs two presses when the second one is a quick release", async () => {
		// The other half: freezing must not cost the double press. The second press arrives as a hold
		// followed by a release, and the release has to find the frozen one and pair with it.
		const seen: Gesture[] = [];
		const resolver = new TapResolver((gesture) => seen.push(gesture), 60);

		resolver.press(false);
		await wait(20);
		resolver.hold();
		resolver.press(false);
		await wait(150);

		assert.deepEqual(seen, ["reset"], "two presses are still one reset, not a toggle apiece");
	});

	it("leaves a lone press alone — a press that begins with nothing pending freezes nothing", async () => {
		const seen: Gesture[] = [];
		const resolver = new TapResolver((gesture) => seen.push(gesture), 60);

		resolver.hold(); // the finger lands; there is nothing waiting
		resolver.press(false);
		await wait(150);

		assert.deepEqual(seen, ["toggle"], "one press is still one toggle");
	});

	it("pairs two presses a real finger's width apart, and does not toggle as well", async () => {
		const seen: Gesture[] = [];
		const resolver = new TapResolver((gesture) => seen.push(gesture), DOUBLE_PRESS_MS);

		resolver.press(false);
		await wait(HUMAN_DOUBLE_PRESS_MS);
		resolver.press(false);

		// Past the window, so a toggle left pending by a missed pair would have fired by now.
		await wait(DOUBLE_PRESS_MS + 100);
		assert.deepEqual(seen, ["reset"], "two presses at a human cadence are one reset, not two toggles");
	});
});
