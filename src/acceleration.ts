/**
 * Turns raw dial rotation into a step size.
 *
 * A dial reports `ticks` — one click of rotation — and a single tick's worth of time is a poor unit
 * for both jobs the dial has: trimming a countdown by a second, and winding one from five minutes to
 * twelve hours. So the step is not fixed. It sits in a **gear**, and the gear is chosen by how
 * *fast* the dial is being turned rather than by how long it has been turning.
 *
 * That distinction is the whole design, and getting it the other way round is what made the first
 * version unusable. Counting ticks means *any* sustained turn escalates, so there was no way to
 * click out thirty seconds one second at a time — four clicks in and the dial was already moving
 * ten. Reading speed instead means a slow turn stays slow for as long as you care to keep turning,
 * and a deliberate flick of the wrist is what changes gear.
 *
 * A gear, once reached, is **held**. Textbook encoder acceleration recomputes its multiplier from
 * the current speed on every pulse, so the step collapses the instant you slow down — which is
 * exactly wrong here, because the reason to change up is to then dial *carefully* at the coarser
 * step. Reversing does not drop it either: overshooting and coming back is one gesture, and a
 * correction that landed in a different unit from the movement it was correcting would be useless.
 * Only letting go of the dial for {@link IDLE_RESET_MS} drops it back to the first gear.
 */

/** Seconds per tick in each gear. */
export const STEPS_SECONDS = [1, 10, 60, 600] as const;

/**
 * Turning at least this fast — dial clicks per second — changes up a gear.
 *
 * Twelve a second is a flick. A deliberate, watch-the-number turn runs at three to six, so the two
 * are told apart by how the hand already moves rather than by a rule anyone has to learn.
 */
export const UPSHIFT_TICKS_PER_SECOND = 12;

/**
 * The least time between two changes of gear.
 *
 * A hard spin reports many rotations a second, and without this the whole ladder would be climbed
 * inside one flick. At this dwell a sustained spin walks up a gear at a time and reaches the top in
 * roughly a third of a second: deliberate, but not slow.
 */
export const UPSHIFT_DWELL_MS = 120;

/** No rotation for this long means the dial has been let go, and the gear drops back to the first. */
export const IDLE_RESET_MS = 2_000;

/**
 * Weight given to the newest sample when smoothing the rate.
 *
 * Starting the average from zero rather than seeding it with the first sample is deliberate: it
 * takes two quick clicks in a row to change up, so a single stray fast one cannot. The bias is
 * towards staying in the fine gear, which is the one that was impossible to stay in before.
 */
const SMOOTHING = 0.5;

/** Floor on the measured gap, since two rotations can share a millisecond and divide by zero. */
const MIN_GAP_MS = 8;

/** Step used when the dial is held down — an explicit request for minutes, not an earned one. */
export const PRESSED_STEP_SECONDS = 60;

export class Accelerator {
	/** Index into {@link STEPS_SECONDS}. */
	#gear = 0;

	/** Smoothed rotation rate, in ticks per second. */
	#rate = 0;

	#lastAt: number | null = null;

	#shiftedAt: number | null = null;

	/** Which gear the dial is in, 0-based and index-aligned with {@link STEPS_SECONDS}. */
	get gear(): number {
		return this.#gear;
	}

	/** Current seconds-per-tick, for display or assertion. */
	get stepSeconds(): number {
		return STEPS_SECONDS[this.#gear];
	}

	/** The smoothed rate the gear is chosen from, in ticks per second. */
	get ticksPerSecond(): number {
		return this.#rate;
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
		} else {
			// Ticks arrive batched when the dial is spun hard, so a batch of three in the same gap is
			// three times the rate of a single one — which is what makes a flick read as a flick.
			const instant = (Math.abs(ticks) * 1000) / Math.max(gap, MIN_GAP_MS);
			this.#rate += (instant - this.#rate) * SMOOTHING;

			if (this.#shouldUpshift(nowMs)) {
				this.#gear += 1;
				this.#shiftedAt = nowMs;
			}
		}

		this.#lastAt = nowMs;

		// A held dial is an explicit coarse request and deliberately does not compound with the gear.
		return ticks * (pressed ? PRESSED_STEP_SECONDS : this.stepSeconds);
	}

	/** Back to the first gear, e.g. when the dial is used for something other than turning. */
	reset(): void {
		this.#gear = 0;
		this.#rate = 0;
		this.#lastAt = null;
		this.#shiftedAt = null;
	}

	#shouldUpshift(nowMs: number): boolean {
		if (this.#rate < UPSHIFT_TICKS_PER_SECOND || this.#gear >= STEPS_SECONDS.length - 1) {
			return false;
		}
		return this.#shiftedAt === null || nowMs - this.#shiftedAt >= UPSHIFT_DWELL_MS;
	}
}
