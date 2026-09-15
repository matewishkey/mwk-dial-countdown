/**
 * Turns raw presses into the three things a countdown can be asked to do.
 *
 * The hardware reports taps, never double taps, so the difference has to be decided here: a tap is
 * held back for as long as a second one could still arrive, and only becomes a toggle once that
 * window has closed without one. The cost is that pause lags by the width of the window. The
 * alternative — acting at once and undoing it when the second tap lands — makes every double tap
 * flash a state the user did not ask for, on a screen that is redrawn four times a second and would
 * show it.
 */

/**
 * What a press meant.
 *
 * - `toggle` — pause a running timer, resume a stopped one.
 * - `reset` — back to a full clock, stopped.
 * - `next` — the next preset, loaded but deliberately not started.
 */
export type Gesture = "toggle" | "reset" | "next";

/**
 * How long a second tap has to arrive for the pair to count as one double tap.
 *
 * This is the touchscreen's figure, and only the touchscreen's. Two taps on glass land a long way
 * inside it, so the window can stay short and a single tap acts almost at once.
 */
export const DOUBLE_TAP_MS = 250;

/**
 * The same window for a key, which needs a wider one.
 *
 * A key is not glass. It has travel, a click, and a finger that has to come all the way back up
 * before it can go down again, and the hardware only reports the release — so the gap being measured
 * is release-to-release, with the second press's own travel inside it. Driven against the built
 * plugin, two presses 320 ms apart — an ordinary, deliberate double-press — fell outside the
 * touchscreen's 250 ms and were read as two separate toggles instead, which start the clock and then
 * immediately pause it again.
 *
 * What makes that worth a constant of its own rather than a wider shared one is how it fails. The
 * clock does not move, so the key looks dead rather than misread; and pressing it again cannot
 * recover, because an even number of toggles always lands back where it started. The obvious
 * response to a button that seems not to have worked is the one response that guarantees it stays
 * that way.
 *
 * The cost is that a single press is held back for half a second before it acts, which is the price
 * of having a double-press gesture on a control this slow.
 *
 * **500 is a starting value, not a measured one, and it cannot be raised freely** — see
 * {@link LONG_PRESS_MS}, which it has to stay under.
 */
export const DOUBLE_PRESS_MS = 500;

/**
 * How long a press must be held to count as a long one rather than a tap. Only used where the
 * hardware does not decide for itself — the touchscreen reports `hold` on the event, a key does not.
 *
 * **It has to stay longer than every double-press window, and on the key the margin is now 100 ms.**
 * A hold is what settles a press still waiting to see whether it had a partner; a window that
 * outlasted the hold would resolve that press as a toggle first and then fire the hold as well, so
 * one gesture would arrive as two. `test/gestures.test.ts` asserts the ordering for both controls.
 *
 * This matters because {@link DOUBLE_PRESS_MS} is the number most likely to be changed next: it was
 * chosen against a mock host and wants confirming on real hardware, and the direction it would move
 * is up. Past 600 it stops being a tuning change and becomes a redesign of the key's gestures.
 */
export const LONG_PRESS_MS = 600;

export class TapResolver {
	#handle: NodeJS.Timeout | null = null;

	readonly #emit: (gesture: Gesture) => void;

	readonly #windowMs: number;

	/**
	 * @param emit Called with the gesture a press turned out to be, possibly a window later.
	 * @param windowMs How long to wait for a second tap.
	 */
	constructor(emit: (gesture: Gesture) => void, windowMs: number = DOUBLE_TAP_MS) {
		this.#emit = emit;
		this.#windowMs = windowMs;
	}

	/** True while a tap is being held back, waiting to see whether a second one follows. */
	get pending(): boolean {
		return this.#handle !== null;
	}

	/**
	 * Records a completed press.
	 *
	 * @param held Whether it was a long press. Long presses are unambiguous, so they resolve at once
	 * and cancel anything still waiting — a tap followed by a hold is two gestures, not a double tap.
	 */
	press(held: boolean): void {
		if (held) {
			this.cancel();
			this.#emit("next");
			return;
		}

		if (this.#handle !== null) {
			this.cancel();
			this.#emit("reset");
			return;
		}

		this.#handle = setTimeout(() => {
			this.#handle = null;
			this.#emit("toggle");
		}, this.#windowMs);
	}

	/** Drops a tap still waiting on its partner, without emitting anything. */
	cancel(): void {
		if (this.#handle !== null) {
			clearTimeout(this.#handle);
			this.#handle = null;
		}
	}
}
