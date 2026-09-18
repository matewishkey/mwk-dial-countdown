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
import type { Countdown } from "../src/countdown.ts";
import type { Gesture } from "../src/gestures.ts";
import { normaliseSettings, type DialCountdownSettings } from "../src/settings.ts";
import { formatDuration } from "../src/timer.ts";

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
		this.perform(this.#live(id), gesture);
	}

	/**
	 * Sends a raw press through the instance's own resolver, as a key's `keyUp` handler does.
	 *
	 * Distinct from {@link TestAction.gesture}, which runs an *already resolved* gesture. What is
	 * under test here is the resolving — whether the control's own window was the one applied.
	 */
	press(id: string): void {
		this.#live(id).taps.press(false);
	}

	/** The countdown a control is currently showing, so a test can ask it what it thinks. */
	countdownFor(id: string): Countdown {
		return this.#live(id).countdown;
	}

	#live(id: string): Instance<Dial> {
		const instance = this.instanceFor(id);
		if (instance === undefined) {
			throw new Error(`no instance for ${id}`);
		}
		return instance;
	}
}

/** The action under test, with its event handlers reachable without building real SDK events. */
type Driver = {
	onWillAppear(ev: unknown): void;
	onWillDisappear(ev: unknown): void;
	onDidReceiveSettings(ev: unknown): void;
	gesture(id: string, gesture: Gesture): void;
	press(id: string): void;
	countdownFor(id: string): Countdown;
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

	it("rewrites settings left by an older build, dropping the keys it no longer has", () => {
		// The upgrade path, which had no test: every other case here hands in an already-normalised
		// object, so `deepEqual` holds and this branch never runs. Without it, a key from a build two
		// designs ago sits in the user's profile for ever — the dial's old mode-based step model left
		// three, and the plugin has no other way to be rid of them.
		const dial = driver();
		const { action, calls } = fakeDial("upgrade-1");

		dial.onWillAppear({
			action,
			payload: {
				settings: {
					presets: [300, 1200, 1800, 2400],
					presetIndex: 1,
					showTitle: false, // since renamed to showLabel
					soundEnabled: false, // since removed
					stepMode: "minutes", // from the mode-based dial, three designs ago
					momentum: true,
					volume: 42
				}
			}
		});
		dial.onWillDisappear({ action });

		assert.equal(calls.setSettings.length, 1, "settings in an old shape must be rewritten, not left");
		const written = calls.setSettings[0];

		for (const dead of ["showTitle", "soundEnabled", "stepMode", "momentum"]) {
			assert.equal(dead in written, false, `\`${dead}\` should not survive the upgrade`);
		}

		// ...and the half that matters more: what the user actually chose has to come through it.
		assert.equal(written.showLabel, false, "a label switched off under the old name stays off");
		assert.equal(written.presetIndex, 1, "their selected preset survives");
		assert.equal(written.volume, 42, "and so does their volume");
	});

	it("leaves settings alone when they are already in the current shape", () => {
		// The positive control: without this, the test above would pass on an action that wrote its
		// settings back on every single appearance, which is a disk write per page flip.
		const dial = driver();
		const { action, calls } = fakeDial("upgrade-2");

		dial.onWillAppear({ action, payload: { settings: normaliseSettings({ presets: [300, 1200] }) } });
		dial.onWillDisappear({ action });

		assert.equal(calls.setSettings.length, 0, "nothing to migrate, so nothing to write");
	});

	it("does not let the inspector's stale preset undo a gesture it cannot have seen", async () => {
		// The window: a gesture that changes the preset is written to disk 400ms later, and Stream Deck
		// forwards that write to the inspector, which is how the inspector catches up. Inside those
		// 400ms it is authoritative and out of date at once — so its `presetIndex` came back over the
		// top of the gesture, and the debounced write then put the old index on disk as well.
		const dial = driver();
		const id = "pi-race-1";
		const { action, calls } = fakeDial(id);
		const settings = normaliseSettings({ presets: [300, 1200], presetIndex: 0 });

		dial.onWillAppear({ action, payload: { settings } });
		// Torn down in a `finally`: the render loop is a `setInterval`, so an assertion that throws
		// before the teardown line leaks it and HANGS the suite rather than failing it. Which it did —
		// this test was written without one, and a deliberately broken build hung instead of going red.
		try {
			dial.gesture(id, "next"); // a hold: advance to the 20m preset, and schedule the write
			assert.equal(dial.countdownFor(id).presetIndex, 1, "precondition: the gesture landed");

			// A checkbox ticked in the inspector, inside the window, carrying its stale idea of the preset.
			dial.onDidReceiveSettings({ action, payload: { settings: { ...settings, warnEnabled: true } } });

			const countdown = dial.countdownFor(id);
			assert.equal(countdown.presetIndex, 1, "the gesture must survive an inspector write that predates it");
			assert.equal(countdown.settings.warnEnabled, true, "and the edit the user actually made must land");

			// ...and the disk agrees, rather than the debounce later writing the stale index back.
			await wait(600);
			const written = calls.setSettings.at(-1);
			assert.equal(written?.presetIndex, 1, "the write must carry the gesture, not the inspector's copy");
		} finally {
			dial.onWillDisappear({ action });
		}
	});

	it("takes the inspector's preset when there is no gesture outstanding", async () => {
		// The positive control. Without it the guard above could simply be ignoring `presetIndex` for
		// ever, which would make the inspector's own preset picker dead.
		const dial = driver();
		const id = "pi-race-2";
		const { action } = fakeDial(id);
		const settings = normaliseSettings({ presets: [300, 1200], presetIndex: 0 });

		dial.onWillAppear({ action, payload: { settings } });
		try {
			await wait(600); // nothing pending

			dial.onDidReceiveSettings({ action, payload: { settings: { ...settings, presetIndex: 1 } } });
			assert.equal(dial.countdownFor(id).presetIndex, 1, "an inspector edit with nothing racing it applies");
		} finally {
			dial.onWillDisappear({ action });
		}
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

describe("a control that leaves the screen and comes back", () => {
	/** Appears a control, returns the recorder, and leaves teardown to the caller. */
	function show(dial: Driver, id: string, settings: Record<string, unknown>) {
		const { action, calls } = fakeDial(id);
		dial.onWillAppear({ action, payload: { settings: normaliseSettings(settings) } });
		return { action, calls };
	}

	it("keeps a running countdown running, and keeps counting while it is away", async () => {
		// A timer used to be destroyed the moment you flipped to another page. Flipping pages is a
		// thing Stream Deck users do constantly, and losing the count because of it is the single
		// worst thing a timer can do.
		const dial = driver();
		const { action } = show(dial, "revive-1", { presets: [3600] });

		dial.gesture("revive-1", "toggle");
		dial.onWillDisappear({ action });

		await wait(700);

		dial.onWillAppear({ action, payload: { settings: normaliseSettings({ presets: [3600] }) } });
		const back = dial.countdownFor("revive-1");
		dial.onWillDisappear({ action });

		assert.equal(back.timer.status, "running", "the countdown came back stopped");

		// The clock works from an absolute deadline, not from ticks it was there to count, so the time
		// spent off screen is time spent counting down.
		const spent = 3_600_000 - back.timer.remainingMs;
		assert.ok(spent >= 600, `only ${spent}ms was counted while the control was away`);
	});

	it("keeps a paused countdown paused, with the same time left", async () => {
		const dial = driver();
		const { action } = show(dial, "revive-2", { presets: [3600] });

		dial.gesture("revive-2", "toggle");
		await wait(300);
		dial.gesture("revive-2", "toggle");

		const paused = dial.countdownFor("revive-2").timer.remainingMs;
		dial.onWillDisappear({ action });

		await wait(600);

		dial.onWillAppear({ action, payload: { settings: normaliseSettings({ presets: [3600] }) } });
		const back = dial.countdownFor("revive-2");
		dial.onWillDisappear({ action });

		assert.equal(back.timer.status, "paused");
		assert.equal(back.timer.remainingMs, paused, "a paused clock must not lose time while off screen");
	});

	it("gives a control it has never seen a fresh countdown", () => {
		// The positive control for the three above: if revive handed *any* control the last countdown
		// it stored, they would all pass while the feature was plainly broken.
		const dial = driver();
		const { action } = show(dial, "revive-3", { presets: [3600] });
		dial.gesture("revive-3", "toggle");
		dial.onWillDisappear({ action });

		const { action: other } = show(dial, "revive-4", { presets: [3600] });
		const fresh = dial.countdownFor("revive-4");
		dial.onWillDisappear({ action: other });

		assert.equal(fresh.timer.status, "idle", "a different control inherited someone else's clock");
	});

	it("takes settings edited while it was away, without restarting a clock that still fits", () => {
		const dial = driver();
		const { action } = show(dial, "revive-5", { presets: [3600], volume: 100 });

		dial.gesture("revive-5", "toggle");
		dial.onWillDisappear({ action });

		// A change to something unrelated must not reload the clock — the same rule that stops the
		// volume slider resetting a running timer.
		dial.onWillAppear({ action, payload: { settings: normaliseSettings({ presets: [3600], volume: 40 }) } });
		const back = dial.countdownFor("revive-5");
		dial.onWillDisappear({ action });

		assert.equal(back.timer.status, "running", "an unrelated edit stopped the clock");
		assert.equal(back.settings.volume, 40, "the edit made while it was away was not picked up");
	});

	it("does not sound the alarm for a timer that ran out while nobody was looking", async () => {
		// The alert says "the moment has arrived". By the time the control is back on screen the
		// moment has been and gone, and sounding it now would be old news at full volume — possibly
		// hours of it. The screen still says `done`, which is the part that is still true.
		const dial = driver();
		const { action, calls } = show(dial, "revive-7", { presets: [1], soundId: "/nowhere/nothing.wav", volume: 100 });

		dial.gesture("revive-7", "toggle");
		dial.onWillDisappear({ action });

		// It runs out here, off screen and unwatched.
		await wait(1_400);

		dial.onWillAppear({ action, payload: { settings: normaliseSettings({ presets: [1] }) } });
		const back = dial.countdownFor("revive-7");
		await wait(500);
		dial.onWillDisappear({ action });

		assert.equal(back.timer.status, "elapsed", "it should still know it finished");
		assert.equal(calls.showAlert, 0, "a timer that finished unwatched announced itself on return");
	});

	it("still sounds the alarm for one that runs out while you are watching", async () => {
		// The positive control. The test above would pass just as well if coming back off a page
		// switch had broken the alert altogether.
		const dial = driver();
		const { action, calls } = show(dial, "revive-8", { presets: [1], soundId: "/nowhere/nothing.wav", volume: 100 });

		dial.onWillDisappear({ action });
		dial.onWillAppear({
			action,
			payload: { settings: normaliseSettings({ presets: [1], soundId: "/nowhere/nothing.wav", volume: 100 }) }
		});

		dial.gesture("revive-8", "toggle");
		await wait(1_500);
		dial.onWillDisappear({ action });

		assert.equal(calls.showAlert, 1, "a timer that ran out in plain sight must still report a failed alert");
	});

	it("reloads the clock when the preset itself was rewritten while it was away", () => {
		const dial = driver();
		const { action } = show(dial, "revive-6", { presets: [3600] });

		dial.gesture("revive-6", "toggle");
		dial.onWillDisappear({ action });

		dial.onWillAppear({ action, payload: { settings: normaliseSettings({ presets: [60] }) } });
		const back = dial.countdownFor("revive-6");
		dial.onWillDisappear({ action });

		assert.equal(back.timer.durationMs, 60_000, "the clock kept counting a length that no longer exists");
		assert.equal(back.timer.status, "idle");
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
		const settings = normaliseSettings({ presets: [1], presetIndex: 0, ...sound });

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

/**
 * Two controls that differ only in how long they wait for a second press.
 *
 * Deliberately far apart, and both far shorter than either real window, so the suite spends
 * milliseconds rather than seconds proving which one was applied.
 */
const NARROW_WINDOW_MS = 30;
const WIDE_WINDOW_MS = 250;

class NarrowWindowAction extends TestAction {
	protected override readonly tapWindowMs = NARROW_WINDOW_MS;
}

class WideWindowAction extends TestAction {
	protected override readonly tapWindowMs = WIDE_WINDOW_MS;
}

/** As {@link driver}, for the two controls above. Same reason for the loose typing. */
const narrowDriver = (): Driver => new NarrowWindowAction();
const wideDriver = (): Driver => new WideWindowAction();

describe("the window a control waits for a second press", () => {
	/** Two presses that gap apart, then long enough for anything still pending to have fired. */
	async function doublePress(action: Driver, id: string, gapMs: number): Promise<Countdown> {
		const { action: control } = fakeDial(id);
		action.onWillAppear({ action: control, payload: { settings: normaliseSettings({ presets: [300] }) } });

		action.press(id);
		await wait(gapMs);
		action.press(id);
		await wait(WIDE_WINDOW_MS + 100);

		const countdown = action.countdownFor(id);
		action.onWillDisappear({ action: control });
		return countdown;
	}

	// The bug, in the smallest form that still has it. The key was built with the touchscreen's
	// window, so a double-press slower than glass fell outside it and arrived as two separate
	// toggles: start, then pause. The clock does not move, and pressing again cannot help, because an
	// even number of toggles always lands back where it started.
	const GAP_MS = 80;

	it("reads a press pair as two toggles when the gap falls outside it", async () => {
		const countdown = await doublePress(narrowDriver(), "narrow-1", GAP_MS);

		// Start, then pause, on a clock that had not begun to run: it ends up *paused at full*. The
		// clock reads exactly what it read before, so nothing on screen says the presses landed — and
		// the state is one the user never asked for and cannot press their way out of.
		assert.equal(countdown.timer.status, "paused", "two toggles on a full clock leave it paused, not reset");
		// It did run, for exactly as long as the gap between the two presses — which is far less than
		// the second the display is drawn in. So the clock reads what it read before: nothing visible
		// happened, which is the whole complaint.
		assert.equal(
			formatDuration(countdown.timer.remainingMs),
			formatDuration(countdown.timer.durationMs),
			"and the clock still reads what it read before, so nothing on screen says the presses landed"
		);
	});

	it("reads the same pair as one reset when the control waits long enough", async () => {
		const countdown = await doublePress(wideDriver(), "wide-1", GAP_MS);

		assert.equal(countdown.timer.status, "idle", "a reset leaves the clock stopped and full");
		assert.equal(countdown.toast, "reset", "and it must have got there by resetting, not by two toggles");
	});
});
