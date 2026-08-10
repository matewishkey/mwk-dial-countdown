/**
 * Turns raw dial rotation into a step size.
 *
 * A dial reports `ticks` per event and batches them when spun quickly, but a single tick's worth of
 * time is a poor unit for both jobs the dial has to do: nudging a timer by a few seconds, and
 * winding one from five minutes to two hours. So the step grows while the user keeps turning, and
 * falls back the moment they stop.
 */

/** Seconds per tick at each level of momentum. */
export const STEPS_SECONDS = [10, 60, 300] as const;

/** Momentum needed to reach each step, index-aligned with {@link STEPS_SECONDS}. */
const THRESHOLDS = [0, 4, 14] as const;

/** A gap longer than this means the user stopped turning, so momentum is dropped. */
export const IDLE_RESET_MS = 350;

/** Momentum cannot exceed this, so the top step is reached in a predictable amount of spinning. */
const MAX_MOMENTUM = 30;

/** Step used when the dial is held down — an explicit request for minutes, not a earned one. */
export const PRESSED_STEP_SECONDS = 60;

export class Accelerator {
	#momentum = 0;
	#lastAt: number | null = null;

	/** Current seconds-per-tick, for display or assertion. */
	get stepSeconds(): number {
		return stepForMomentum(this.#momentum);
	}

	get momentum(): number {
		return this.#momentum;
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
		this.#lastAt = nowMs;

		if (gap > IDLE_RESET_MS) {
			this.#momentum = 0;
		} else {
			// Ticks already arrive batched when the dial is spun hard, so counting them rather than
			// counting events lets a single fast flick build momentum as quickly as a sustained turn.
			this.#momentum = Math.min(MAX_MOMENTUM, this.#momentum + Math.abs(ticks));
		}

		// A held dial is an explicit coarse request and should not also compound with momentum.
		const step = pressed ? PRESSED_STEP_SECONDS : stepForMomentum(this.#momentum);
		return ticks * step;
	}

	/** Drops momentum, e.g. when the dial is used for something other than turning. */
	reset(): void {
		this.#momentum = 0;
		this.#lastAt = null;
	}
}

export function stepForMomentum(momentum: number): number {
	let step: number = STEPS_SECONDS[0];
	for (let i = 0; i < THRESHOLDS.length; i++) {
		if (momentum >= THRESHOLDS[i]) {
			step = STEPS_SECONDS[i];
		}
	}
	return step;
}
