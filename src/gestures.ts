/**
 * Turns raw presses into the three things a countdown can be asked to do.
 *
 * The hardware reports taps, never double taps, so a tap is held back for as long as a second one
 * could still arrive and only becomes a toggle once that window closes. The cost is that pause lags
 * by the width of the window; the alternative, acting at once and undoing it, makes every double tap
 * flash a state the user did not ask for.
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
 * How long a second tap has to arrive for the pair to count as one double tap, on the touchscreen.
 *
 * Glass has no travel, so this can be shorter than the key's. Not measured against a real hand:
 * driven against the built plugin, two taps 300 ms apart arrive as two separate toggles rather than
 * one double tap, so a finger slower than 250 ms is misread. See {@link DOUBLE_PRESS_MS}.
 */
export const DOUBLE_TAP_MS = 250;

/**
 * The same window for a key, which needs a wider one.
 *
 * A key has travel and the hardware reports only the release, so the gap being measured is
 * release-to-release with the second press's own travel inside it. At 250 ms an ordinary double
 * press landing 320 ms apart was read as two toggles, which start the clock and immediately pause
 * it — the key looks dead, and pressing again cannot recover because an even number of toggles
 * lands back where it started.
 *
 * 500 is a starting value, not a measured one. It is free to move in either direction; it no longer
 * has to stay under {@link LONG_PRESS_MS}.
 */
export const DOUBLE_PRESS_MS = 500;

/**
 * How long a press must be held to count as a long one, where the hardware does not decide for
 * itself. The touchscreen reports `hold` on the event; a key and the dial do not.
 *
 * It does not have to outlast the double-press windows, because {@link TapResolver.hold} stops a
 * pending press from resolving while a finger is down.
 */
export const LONG_PRESS_MS = 600;

/**
 * What a completed press of the dial's own button meant, from how long it was held.
 *
 * **Measured on release, never by a timer running while the finger is down.** Pushing the dial in is
 * how minutes are asked for, so anything firing mid-press would go off in the pause before the wind
 * started. A press that turned the dial never reaches here — the action returns first.
 *
 * It lives here rather than in the action because `dial-countdown.ts` carries an `@action`
 * decorator, and keeping the rule out here means it is one pure function rather than a branch
 * buried in an event handler.
 */
export function dialPress(heldMs: number): Gesture {
	return heldMs >= LONG_PRESS_MS ? "next" : "toggle";
}

export class TapResolver {
	#handle: NodeJS.Timeout | null = null;

	/**
	 * Set when {@link TapResolver.hold} stopped the clock on a press still waiting for a partner.
	 * The press is as pending as it was; it simply is not counting down while a finger is on the
	 * control.
	 */
	#frozen = false;

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
		return this.#handle !== null || this.#frozen;
	}

	/**
	 * A new press has begun, so a press still waiting on a partner stops counting down.
	 *
	 * Only a control reporting separate down and up events can call this — on this plugin, the key.
	 * It exists because a pending press starts at the *previous* release and so always expires
	 * before a hold on the *next* press can fire; without freezing, a press followed by a held press
	 * arrives as toggle **and** next. Nothing can resolve while a finger is down.
	 */
	hold(): void {
		if (this.#handle !== null) {
			clearTimeout(this.#handle);
			this.#handle = null;
			this.#frozen = true;
		}
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

		if (this.pending) {
			this.cancel();
			this.#emit("reset");
			return;
		}

		this.#handle = setTimeout(() => {
			this.#handle = null;
			this.#emit("toggle");
		}, this.#windowMs);
	}

	/** Drops a tap still waiting on its partner, frozen or not, without emitting anything. */
	cancel(): void {
		if (this.#handle !== null) {
			clearTimeout(this.#handle);
			this.#handle = null;
		}
		this.#frozen = false;
	}
}
