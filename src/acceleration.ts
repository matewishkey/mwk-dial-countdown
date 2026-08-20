/**
 * Turns raw dial rotation into a step size.
 *
 * A dial reports `ticks` — one click of rotation — and a single tick's worth of time is a poor unit
 * for both jobs the dial has: trimming a countdown by a second, and winding one from five minutes to
 * twelve hours. So the step is not fixed. It sits in a **gear**, and the gear is changed by **how far
 * you have turned in one direction** — every {@link TICKS_PER_GEAR} clicks the same way is one gear up.
 *
 * Distance, not speed, and not elapsed time. Both of the other two were tried:
 *
 * - **Counting ticks regardless of direction** was the first version, and it made fine control
 *   impossible — you could not click out thirty seconds one second at a time, because winding back
 *   and forth over a value counted towards escalating just as much as winding away from it.
 * - **Measuring speed** replaced it, and read better on paper than in the hand. It meant the same
 *   gesture did different things depending on how briskly you happened to make it, so the step you
 *   got was never quite the step you predicted.
 *
 * Distance in one direction is the thing the hand already knows it is doing. Ten clicks up is a
 * deliberate journey, and by then you have said you want to travel; ten clicks of hovering around a
 * value is not, and must not escalate.
 *
 * Which is what the direction rule is for. **Turning back resets the count but keeps the gear.** The
 * two halves matter separately: keeping the gear means a correction lands in the same unit as the
 * movement it is correcting, and resetting the count means hovering — up a bit, back a bit, up a bit
 * — sits at a steady step for as long as you like instead of climbing while you aim.
 *
 * A gear only comes down when the dial is let go of, for {@link IDLE_RESET_MS}.
 */

/** Seconds per tick in each gear. */
export const STEPS_SECONDS = [1, 10, 60, 600] as const;

/**
 * Clicks in one direction that change up a gear.
 *
 * Ten is a deliberate turn rather than a nudge, and it is few enough to reach the top of the ladder
 * — thirty clicks — inside one sustained wind, which is what a twelve-hour timer needs.
 */
export const TICKS_PER_GEAR = 10;

/** No rotation for this long means the dial has been let go, and the gear drops back to the first. */
export const IDLE_RESET_MS = 2_000;

/** Step used when the dial is held down — an explicit request for minutes, not an earned one. */
export const PRESSED_STEP_SECONDS = 60;

export class Accelerator {
	/** Index into {@link STEPS_SECONDS}. */
	#gear = 0;

	/** Clicks so far in the current direction, towards the next gear. */
	#count = 0;

	/** Which way the dial is currently going: 1, -1, or 0 before it has gone anywhere. */
	#direction = 0;

	#lastAt: number | null = null;

	/** Which gear the dial is in, 0-based and index-aligned with {@link STEPS_SECONDS}. */
	get gear(): number {
		return this.#gear;
	}

	/** Current seconds-per-tick, for display or assertion. */
	get stepSeconds(): number {
		return STEPS_SECONDS[this.#gear];
	}

	/** Clicks banked towards the next gear. Reaches {@link TICKS_PER_GEAR} and changes up. */
	get count(): number {
		return this.#count;
	}

	/**
	 * Registers a rotation and returns the change in seconds it should produce.
	 *
	 * @param ticks Signed tick count from the dial.
	 * @param nowMs Timestamp of the rotation.
	 * @param pressed Whether the dial was held while turning.
	 */
	rotate(ticks: number, nowMs: number, pressed = false): number {
		const gap = this.#lastAt === null ? Infinity : nowMs - this.#lastAt;
		if (gap >= IDLE_RESET_MS) {
			this.reset();
		}
		this.#lastAt = nowMs;

		// A held dial is an explicit coarse request. It neither compounds with the gear nor counts
		// towards one: it is a different way of asking, so it leaves the ladder exactly as it found it.
		if (pressed) {
			return ticks * PRESSED_STEP_SECONDS;
		}

		const direction = Math.sign(ticks);
		if (direction === 0) {
			return 0;
		}

		// Turning back is a correction, not progress towards a coarser step. The count starts again;
		// the gear does not, so the correction moves in the same unit as what it is correcting.
		if (this.#direction !== 0 && direction !== this.#direction) {
			this.#count = 0;
		}
		this.#direction = direction;

		return direction * this.#spend(Math.abs(ticks));
	}

	/** Back to the first gear, e.g. when the dial is used for something other than turning. */
	reset(): void {
		this.#gear = 0;
		this.#count = 0;
		this.#direction = 0;
		this.#lastAt = null;
	}

	/**
	 * Converts a number of clicks into seconds, changing up as it goes.
	 *
	 * The dial batches its ticks when spun hard, so one event can carry more clicks than are left
	 * before the next gear. Those are spent across the change rather than all at the old step — the
	 * eleventh click is worth ten seconds whether it arrived on its own or in a batch of four, which
	 * is the only version of "every ten clicks" that is true at every speed.
	 */
	#spend(clicks: number): number {
		let remaining = clicks;
		let seconds = 0;

		while (remaining > 0) {
			const top = this.#gear >= STEPS_SECONDS.length - 1;
			const take = top ? remaining : Math.min(remaining, TICKS_PER_GEAR - this.#count);

			seconds += take * STEPS_SECONDS[this.#gear];
			this.#count += take;
			remaining -= take;

			if (!top && this.#count >= TICKS_PER_GEAR) {
				this.#gear += 1;
				this.#count = 0;
			}
		}

		return seconds;
	}
}
