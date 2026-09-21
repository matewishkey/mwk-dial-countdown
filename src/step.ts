/**
 * How much time one click of the dial is worth.
 *
 * A free turn is a second a click; a turn made with the dial pushed in is a minute. No mode is
 * stored anywhere — `pressed` arrives on each rotation event, so the step lasts exactly as long as
 * the finger does.
 *
 * There is no hours step. Long durations are presets, typed in the property inspector.
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
