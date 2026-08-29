/**
 * How much time one click of the dial is worth.
 *
 * **The step is not a mode.** A free turn is one second a click; a turn made while the dial is
 * pushed in is one minute a click. There is nothing to set, nothing that stays set, and nothing to
 * put on the screen reminding you which state you left it in — your own finger is the state, and it
 * tells you by feel.
 *
 * That is the fifth design for this, and the first four are worth recording because they all failed
 * the same way. Momentum counted ticks in any direction, so hovering over a value escalated;
 * velocity read how briskly the wrist moved, so the same gesture did different things; travelled
 * distance was predictable in principle but still changed the step underneath you mid-turn; and the
 * fourth — press to swap between seconds and minutes, hold for hours — stopped guessing but bought
 * that with a mode that never expired, a label on screen to say which mode you were in, and a
 * three-way toggle you had to press twice to get back through.
 *
 * Holding the dial in while you turn is the whole of it. It is unambiguous, it cannot be left on by
 * accident, and it frees the dial's press for what a press on a countdown obviously ought to do:
 * start and stop the clock.
 *
 * Hours are gone deliberately. Nothing you dial by hand is four hours long — that is a preset, typed
 * in the property inspector, and the dial is for nudging what a preset loaded.
 */

/** The two things a click can be worth. */
export type Step = "second" | "minute";

export const STEP_SECONDS: Record<Step, number> = {
	second: 1,
	minute: 60
};

/** What a click is worth, given whether the dial is pushed in while turning. */
export function stepFor(pressed: boolean): Step {
	return pressed ? "minute" : "second";
}

/** The change in seconds a rotation should produce. Linear, always. */
export function deltaFor(ticks: number, pressed: boolean): number {
	return ticks * STEP_SECONDS[stepFor(pressed)];
}
