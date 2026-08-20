/**
 * Turns raw dial rotation into a step size.
 *
 * A dial reports `ticks` — one click of rotation — and a single tick's worth of time is a poor unit
 * for both jobs the dial has: trimming a countdown by a second, and winding one from five minutes to
 * twelve hours. So the step is not fixed. It sits in a **gear**, and the rule for changing gear is
 * one line:
 *
 * > **You step in the largest unit you have already travelled.**
 *
 * Move ten seconds and you are moving in tens of seconds. Move a minute and you are moving in
 * minutes. Move ten minutes and you are moving in ten-minute steps. The thresholds are not a
 * separate table to look up — they *are* {@link STEPS_SECONDS}, which is what makes the behaviour
 * describable in a sentence rather than memorised from one.
 *
 * In clicks, from a standing start, that is 10 to reach ten seconds a click, 5 more to reach a
 * minute, and 9 more to reach ten minutes: 24 clicks from a second to twelve hours, and the ladder
 * gets easier to climb the further up it you are — which is right, because by then you have said
 * plainly that you want to travel.
 *
 * This is distance, not speed and not elapsed time. Both of the others were tried:
 *
 * - **Counting ticks in any direction** made fine control impossible: winding back and forth *over* a
 *   value counted towards escalating as much as winding away from it.
 * - **Measuring speed** meant the same gesture did different things depending on how briskly it
 *   happened to be made, so the step you got was never quite the step you predicted — and predicting
 *   it is the whole job.
 */

/**
 * Seconds per click in each gear — and, from the second gear on, the distance that unlocks it.
 *
 * The double duty is the design. `10` means both "ten seconds a click" and "unlocked once you have
 * moved ten seconds", so the two can never drift apart into a rule with exceptions.
 */
export const STEPS_SECONDS = [1, 10, 60, 600] as const;

/**
 * No rotation for this long means the dial has been let go of, and the gear drops back to the first.
 *
 * The acknowledgement on screen is shown for exactly this long, so the step you last took stays
 * readable for precisely as long as it is still the step you would get. When it goes, the gear has
 * gone with it — see `Countdown.adjust`.
 */
export const IDLE_RESET_MS = 2_000;

/** Step used when the dial is held down — an explicit request for minutes, not an earned one. */
export const PRESSED_STEP_SECONDS = 60;

export class Accelerator {
	/** Index into {@link STEPS_SECONDS}. */
	#gear = 0;

	/** Seconds moved in the current direction, which is what unlocks the next gear. */
	#travelled = 0;

	/** Which way the dial is currently going: 1, -1, or 0 before it has gone anywhere. */
	#direction = 0;

	#lastAt: number | null = null;

	/** Which gear the dial is in, 0-based and index-aligned with {@link STEPS_SECONDS}. */
	get gear(): number {
		return this.#gear;
	}

	/** Current seconds-per-click, for display or assertion. */
	get stepSeconds(): number {
		return STEPS_SECONDS[this.#gear];
	}

	/** Seconds travelled in the current direction, towards the next gear. */
	get travelled(): number {
		return this.#travelled;
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

		// Turning back is a correction, not progress towards a coarser step. The distance starts again;
		// the gear does not, so the correction moves in the same unit as what it is correcting.
		if (this.#direction !== 0 && direction !== this.#direction) {
			this.#travelled = 0;
		}
		this.#direction = direction;

		return direction * this.#spend(Math.abs(ticks));
	}

	/** Back to the first gear, e.g. when the dial is used for something other than turning. */
	reset(): void {
		this.#gear = 0;
		this.#travelled = 0;
		this.#direction = 0;
		this.#lastAt = null;
	}

	/**
	 * Converts a number of clicks into seconds, changing up as it goes.
	 *
	 * The dial batches its ticks when spun hard, so one event can carry more clicks than are left
	 * before the next gear. Those are spent *across* the change rather than all at the old step — the
	 * click that takes you past ten seconds is worth ten seconds whether it arrived on its own or in a
	 * batch of four, which is the only reading of the rule that holds at every speed.
	 */
	#spend(clicks: number): number {
		let remaining = clicks;
		let seconds = 0;

		while (remaining > 0) {
			const step = STEPS_SECONDS[this.#gear];
			const next = STEPS_SECONDS[this.#gear + 1] as number | undefined;

			// In top gear there is nothing left to reach, so the rest of the batch goes at this step.
			// Otherwise take only as far as the next gear, and let the loop come round at the new one.
			const take = next === undefined ? remaining : Math.min(remaining, Math.ceil((next - this.#travelled) / step));

			seconds += take * step;
			this.#travelled += take * step;
			remaining -= take;

			if (next !== undefined && this.#travelled >= next) {
				this.#gear += 1;
			}
		}

		return seconds;
	}
}
