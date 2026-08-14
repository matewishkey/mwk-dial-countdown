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

/** How long a second tap has to arrive for the pair to count as one double tap. */
export const DOUBLE_TAP_MS = 250;

/**
 * How long a press must be held to count as a long one rather than a tap. Only used where the
 * hardware does not decide for itself — the touchscreen reports `hold` on the event, a key does not.
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
