/**
 * How much time one click of the dial is worth.
 *
 * The step is **chosen**, not earned. Press the dial and it swaps between seconds and minutes; hold
 * it and you get hours. Turning never changes it — however far you turn, however fast, however long
 * you keep going, a click is worth exactly what the last press said it was worth.
 *
 * That is the fourth design for this, and the first three all failed the same way. Momentum counted
 * ticks in any direction, so hovering over a value escalated; velocity read how briskly the wrist
 * moved, so the same gesture did different things; travelled distance was predictable in principle
 * but still meant the step changed underneath you while you were using it. Every one of them was an
 * attempt to *guess* which step you wanted from how you were turning.
 *
 * This stops guessing. The dial already had a press and a hold going spare — preset cycling lives on
 * the touchscreen, which is where the hand already is — so the step gets said out loud instead of
 * inferred. Three values, two gestures, and a turn that does the same thing every single time.
 *
 * There is no time-out. A step you set stays set until you set another one, which is the whole point:
 * a mode that expires is a mode you have to keep re-checking. `Countdown.stepLabel` puts it on the
 * screen instead, so a step other than the default is never a surprise.
 */

/** The three things a click can be worth. */
export type Step = "second" | "minute" | "hour";

export const STEP_SECONDS: Record<Step, number> = {
	second: 1,
	minute: 60,
	hour: 3600
};

/** Short names for the screen, since `1s` is what the acknowledgement already speaks in. */
export const STEP_LABELS: Record<Step, string> = {
	second: "1s",
	minute: "1m",
	hour: "1h"
};

/** What a fresh dial is set to. The finest step, because it is the one you cannot recover by turning. */
export const DEFAULT_STEP: Step = "second";

export class Selector {
	#step: Step = DEFAULT_STEP;

	get step(): Step {
		return this.#step;
	}

	get stepSeconds(): number {
		return STEP_SECONDS[this.#step];
	}

	/** Name of the current step, for the screen. */
	get label(): string {
		return STEP_LABELS[this.#step];
	}

	/**
	 * A press of the dial: seconds and minutes, back and forth.
	 *
	 * Those two are the pair used constantly, so they get the cheap gesture. Hours are reached by
	 * holding, and a press from hours lands on seconds rather than continuing round — coming back from
	 * a coarse step you almost always want the finest one, not the middle.
	 */
	toggle(): Step {
		this.#step = this.#step === "second" ? "minute" : "second";
		return this.#step;
	}

	/** A hold of the dial: straight to an hour a click, for setting something long. */
	coarsen(): Step {
		this.#step = "hour";
		return this.#step;
	}

	/** Back to the default, e.g. when the control is set up fresh. */
	reset(): void {
		this.#step = DEFAULT_STEP;
	}

	/** The change in seconds a rotation should produce. Linear, always. */
	delta(ticks: number): number {
		return ticks * this.stepSeconds;
	}
}
