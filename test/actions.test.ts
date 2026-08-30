/**
 * The action layer: appearing, disappearing, and what survives the difference.
 *
 * This is the half of the plugin that had no tests, and all three of the lifecycle bugs it shipped
 * lived here — which is not a coincidence. `src/countdown.ts` and `src/timer.ts` are pure and were
 * exercised hard; the code that owns the timers, the intervals and the debounced write to disk was
 * exercised only by using the plugin.
 *
 * It turns out to be testable without a Stream Deck. `@elgato/streamdeck` imports cleanly without
 * connecting to anything — `streamDeck.connect()` is a separate call the plugin entry point makes —
 * so an action can be driven with a stand-in control that records what was asked of it. The events
 * are cast loosely on the way in: what is under test is the behaviour, and building complete SDK
 * event objects would be transcription rather than coverage.
 *
 * **The subject is {@link CountdownAction} itself, not one of its two subclasses**, for two reasons.
 * All three lifecycle bugs were in the base — the subclasses contribute only which events drive them
 * and how they are drawn — and the subclasses carry an `@action` decorator, which Node's type
 * stripping cannot transform: it erases types and leaves decorators standing, so importing
 * `dial-countdown.ts` here is a syntax error rather than a test. A minimal subclass declared below
 * reaches the same code by the same route.
 *
 * **Every test here must tear its instance down.** The render loop is a `setInterval`, and one left
 * running holds the event loop open and hangs the suite.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DialAction, KeyAction } from "@elgato/streamdeck";

import { CountdownAction, type Instance } from "../src/actions/countdown-action.ts";
import type { Gesture } from "../src/gestures.ts";
import { normaliseSettings, type DialCountdownSettings } from "../src/settings.ts";

type Dial = DialAction<DialCountdownSettings>;

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Everything the stand-in control was asked to do, in order. */
type Calls = {
	setSettings: Record<string, unknown>[];
	setFeedback: unknown[];
	setFeedbackLayout: string[];
	showAlert: number;
};

/**
 * A dial that records rather than draws.
 *
 * Every method answers with a resolved promise, because the code under test attaches a `.catch` to
 * each one and a rejection would be reported as a log line rather than a failure — a stand-in that
 * rejected would make tests pass quietly.
 */
function fakeDial(id: string): { action: Record<string, unknown>; calls: Calls } {
	const calls: Calls = { setSettings: [], setFeedback: [], setFeedbackLayout: [], showAlert: 0 };

	const action = {
		id,
		isDial: () => true,
		isKey: () => false,
		setSettings: (settings: Record<string, unknown>) => {
			calls.setSettings.push(settings);
			return Promise.resolve();
		},
		setFeedback: (payload: unknown) => {
			calls.setFeedback.push(payload);
			return Promise.resolve();
		},
		setFeedbackLayout: (layout: string) => {
			calls.setFeedbackLayout.push(layout);
			return Promise.resolve();
		},
		showAlert: () => {
			calls.showAlert += 1;
			return Promise.resolve();
		}
	};

	return { action, calls };
}

/**
 * The smallest thing {@link CountdownAction} can be made concrete as.
 *
 * `draw` really does call `setFeedback`, so the tests that count frames are counting the same calls
 * the dial would make. `gesture` is the one addition: `perform` is protected, and driving it from a
 * subclass is how a test reaches the debounced save without going through a subclass's own event
 * handlers, which are not what is under test here.
 */
class TestAction extends CountdownAction<Dial> {
	protected readonly controller = "Encoder" as const;

	protected owns(action: Dial | KeyAction<DialCountdownSettings>): action is Dial {
		return action.isDial();
	}

	protected extras(): Record<string, never> {
		return {};
	}

	protected draw(instance: Instance<Dial>, force: boolean): void {
		void force;
		void instance.action.setFeedback({ value: instance.countdown.toast });
	}

	/** Runs a resolved gesture against a live instance, as a subclass's event handler would. */
	gesture(id: string, gesture: Gesture): void {
		const instance = this.instanceFor(id);
		if (instance === undefined) {
			throw new Error(`no instance for ${id}`);
		}
		this.perform(instance, gesture);
	}
}

/** The action under test, with its event handlers reachable without building real SDK events. */
type Driver = {
	onWillAppear(ev: unknown): void;
	onWillDisappear(ev: unknown): void;
	gesture(id: string, gesture: Gesture): void;
};

function driver(): Driver {
	// No cast needed: methods are compared bivariantly, so a handler declared for a real SDK event
	// satisfies one declared for `unknown`.
	return new TestAction();
}

describe("an action's lifecycle", () => {
	it("flushes a pending settings write when the control goes away", async () => {
		// The bug this is here for. Holding the screen loads the next preset and schedules the write
		// 400 ms out, so that spinning the dial does not go to disk on every tick. Teardown used to
		// *clear* that timer rather than run it, so a preset chosen in the last four hundred
		// milliseconds before flipping page was silently lost — the gesture had happened, the
		// acknowledgement had been drawn, and the write went in the bin on the way out.
		const dial = driver();
		const { action, calls } = fakeDial("flush-1");
		const settings = normaliseSettings({ presets: [300, 1200, 1800], presetIndex: 0 });

		dial.onWillAppear({ action, payload: { settings } });
		dial.gesture("flush-1", "next");

		assert.equal(calls.setSettings.length, 0, "the write should still be held back at this point");

		dial.onWillDisappear({ action });

		assert.equal(calls.setSettings.length, 1, "teardown must flush the pending write, not drop it");
		assert.equal(calls.setSettings[0].presetIndex, 1, "the preset chosen by the hold should be the one saved");

		// And exactly once: the debounce timer must not fire again after the flush.
		await wait(600);
		assert.equal(calls.setSettings.length, 1, "the flush and the debounce both wrote");
	});

	it("writes nothing on teardown when nothing was pending", async () => {
		// The positive control for the test above. If teardown wrote unconditionally, that test would
		// pass for the wrong reason and every page flip would touch the disk.
		const dial = driver();
		const { action, calls } = fakeDial("flush-2");
		const settings = normaliseSettings({ presets: [300, 1200] });

		dial.onWillAppear({ action, payload: { settings } });
		dial.onWillDisappear({ action });

		await wait(600);
		assert.equal(calls.setSettings.length, 0, "a teardown with no pending edit should write nothing");
	});

	it("stops drawing once the control has gone", async () => {
		const dial = driver();
		const { action, calls } = fakeDial("stop-1");

		dial.onWillAppear({ action, payload: { settings: normaliseSettings({ presets: [300] }) } });
		await wait(400);

		assert.ok(calls.setFeedback.length > 0, "the render loop should have drawn at least once");

		dial.onWillDisappear({ action });
		const drawn = calls.setFeedback.length;

		await wait(600);
		assert.equal(calls.setFeedback.length, drawn, "the render loop is still running after teardown");
	});

	it("replaces rather than leaks when a control appears twice over", async () => {
		// Stream Deck normally pairs appear with disappear. Nothing here can rely on that, and the
		// cost of being wrong is not a stale object but a 4 Hz interval drawing for ever with its
		// handle no longer reachable by anything — unstoppable for the life of the process.
		const dial = driver();
		const { action, calls } = fakeDial("twice-1");
		const settings = normaliseSettings({ presets: [300] });

		dial.onWillAppear({ action, payload: { settings } });
		dial.onWillAppear({ action, payload: { settings } });
		await wait(400);

		dial.onWillDisappear({ action });
		const drawn = calls.setFeedback.length;

		await wait(700);
		assert.equal(
			calls.setFeedback.length,
			drawn,
			"a second appearance left its predecessor's render loop running with nothing able to stop it"
		);
	});

	it("ignores events for a control it does not know about", () => {
		// Every handler looks its instance up and returns quietly when there is none. A disappearance
		// for something that never appeared arrives in practice, and must not throw.
		const dial = driver();
		const { action } = fakeDial("unknown-1");

		assert.doesNotThrow(() => dial.onWillDisappear({ action }));
	});
});

describe("the alert when a timer finishes", () => {
	/**
	 * Runs a one-second countdown to its end and reports whether the error triangle was raised.
	 *
	 * One second is the shortest a preset can be, and the wait is real: `onWillAppear` constructs its
	 * own `Countdown` on `Date.now`, so there is no clock to inject from out here. The dial's press
	 * is used to start it rather than a tap, because a tap waits out the double-tap window first.
	 */
	async function finishOnce(sound: Record<string, unknown>): Promise<number> {
		const dial = driver();
		const id = `alert-${Math.random()}`;
		const { action, calls } = fakeDial(id);
		const settings = normaliseSettings({ presets: [1], presetIndex: 0, soundEnabled: true, ...sound });

		dial.onWillAppear({ action, payload: { settings } });
		dial.gesture(id, "toggle");

		// A second for the clock, plus a render tick or two for `settle` to notice and act.
		await wait(1_500);
		dial.onWillDisappear({ action });

		return calls.showAlert;
	}

	it("stays quiet when the user chose No sound", async () => {
		// The bug, end to end. `settle()` reports that an alert is due whenever sound is *enabled*,
		// and the branch that follows knew about only one of the two ways to ask for silence — a
		// volume of zero. So a countdown set to No sound finished correctly and then flashed Stream
		// Deck's error triangle to say it had failed.
		assert.equal(await finishOnce({ soundId: "none", volume: 100 }), 0, "No sound is not a failure to play");
	});

	it("stays quiet at zero volume", async () => {
		assert.equal(await finishOnce({ soundId: "/nowhere/at/all/nothing.wav", volume: 0 }), 0);
	});

	it("still raises the alert when a sound was wanted and could not be played", async () => {
		// The positive control, and the reason the two tests above mean anything: without it they
		// would pass just as well if the alert had been removed altogether. A custom sound whose file
		// has been moved or renamed is the case this exists for — a silent alarm is indistinguishable
		// from one that has not gone off yet, which is the one thing an alarm must never be.
		assert.equal(
			await finishOnce({ soundId: "/nowhere/at/all/nothing.wav", volume: 100 }),
			1,
			"a sound that was asked for and did not play must still be reported"
		);
	});
});
