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
 * This is the touchscreen's figure, and only the touchscreen's. Glass has no travel, so the window
 * can be shorter than the key's and a single tap acts almost at once.
 *
 * **250 has never been measured against a hand**, and it is the same number that turned out to be too
 * short on the key — see {@link DOUBLE_PRESS_MS}, which was raised to 500 after an ordinary double
 * press landed 320 ms apart. Driven against the built plugin, two taps **300 ms** apart arrive here as
 * two separate toggles: start, then pause, with the clock back exactly where it began. That is the
 * same failure the key had, and it fails the same way — worst on a finished timer, which is the one
 * you most want to start again. Whether a real finger on glass is quick enough to stay inside 250 is
 * the open question; nothing in this repo can answer it.
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
 * **This no longer has to outlast the double-press windows, and it never actually did.** The claim
 * used to be that a hold settles a press still waiting on a partner, so a window outlasting the hold
 * would resolve that press as a toggle and then fire the hold as well. The reasoning was sound and
 * the inequality was backwards: a pending press starts at the *previous* release and the hold starts
 * at the *next* press, so the pending one always expired first however the two constants were set,
 * and the cancel in the hold's callback was dead code. Press, then press-and-hold, measured against
 * the built bundle, answered `["start", "preset · 5m"]`.
 *
 * {@link TapResolver.hold} fixes it at the source — a press cannot resolve while a finger is down —
 * which leaves both constants free to be tuned on feel alone. {@link DOUBLE_PRESS_MS} was the one
 * most likely to move, and it can now move in either direction without breaking a gesture.
 */
export const LONG_PRESS_MS = 600;

export class TapResolver {
	#handle: NodeJS.Timeout | null = null;

	/**
	 * Set when {@link TapResolver.hold} stopped the clock on a press that was still waiting for a
	 * partner. The press is every bit as pending as it was — it simply is not counting down, because
	 * a finger is on the control and whatever that finger does next will settle it.
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
	 * **A new press has begun, so a press still waiting on a partner stops counting down.**
	 *
	 * Only a control that reports its presses as a down and an up can call this, which on this plugin
	 * means the key: the touchscreen reports a completed tap and nothing else, so there is no moment
	 * at which a finger is known to be resting on it.
	 *
	 * It exists because the window and the hold were racing, and the window always won. A pending
	 * press starts at the *previous* release, so it expires `DOUBLE_PRESS_MS` after that; the hold
	 * belongs to the *next* press and cannot fire until `LONG_PRESS_MS` after it began, which is
	 * necessarily later. So `taps.cancel()` in the hold's own callback could never cancel anything,
	 * and a press followed by a held press arrived as **toggle, then next** — the clock started *and*
	 * the preset moved. That is precisely the outcome the comment on `LONG_PRESS_MS` claimed the
	 * ordering prevented; the ordering guaranteed it.
	 *
	 * Freezing settles it without touching either constant, and removes the ordering requirement
	 * altogether: nothing can resolve while a finger is down, so the hold is always free to win.
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
