/**
 * The line under the clock, on both controls.
 *
 * A dial and a key say nearly the same thing there — what this timer is, and how far through the
 * job it is — but they had said it in two places, in two functions that had already drifted apart
 * once over how a finished repeating timer reads. The title made that worse: "a name if there is
 * one, the preset's length if there is not" is a rule neither control gets to have its own version
 * of, or a name typed on a dial would mean something different from the same name typed on a key.
 *
 * So the rule lives here, once, and each control takes the part of it that fits the room it has.
 * Nothing here imports the SDK, which is what lets it be tested at all: both actions carry an
 * `@action` decorator that Node's type stripping cannot transform, so no test can import them.
 */

import type { Countdown } from "./countdown";
import { formatPresetLabel } from "./timer";

/**
 * What this timer is called: its title, or the length of the preset behind it.
 *
 * `Tea` says more about a timer you set on purpose than `20m` does, and the length is on the clock
 * above it anyway. Unnamed, it falls back to the preset's own length, which is what this line has
 * always been.
 */
export function nameOf(countdown: Countdown): string {
	const { title } = countdown.settings;
	return title !== "" ? title : formatPresetLabel(countdown.presetSeconds * 1000);
}

/**
 * The dial's label: the name, the drift, and the lap tally.
 *
 * The preset's length is reported *as configured*, never as the dial has since left it, and once the
 * two disagree the line says so — the clock reads 23:00, the settings still say 20m, and holding the
 * screen is what closes the gap. A named timer keeps that as `Tea · from 20m`: the name replacing
 * the length must not take the warning with it.
 */
export function dialLabel(countdown: Countdown, status: string): string {
	if (!countdown.settings.showLabel) {
		return "";
	}

	const preset = formatPresetLabel(countdown.presetSeconds * 1000);
	const name = nameOf(countdown);

	// `from 20m` on its own when the name *is* the length — saying `20m · from 20m` would be reporting
	// the drift twice and reporting it as agreement.
	const head = !countdown.drifted ? name : name === preset ? `from ${preset}` : `${name} · from ${preset}`;

	return `${head}${suffixFor(countdown, status)}`;
}

/**
 * The key's caption: one short line, and four claimants for it.
 *
 * In order of urgency — that it is finished, then which lap it is on, then what it is called. The
 * drift note is the one thing the dial says that a key cannot: it needs both halves, and there is
 * only room for one.
 *
 * A finished repeating timer says `done ×3/3` — the fact first, the tally after it. Saying only
 * `×3/3`, as it used to, left a finished job looking exactly like one still on its final lap.
 */
export function keyCaption(countdown: Countdown, status: string): string {
	if (status === "elapsed") {
		return countdown.laps > 0 ? `done ×${countdown.lap}/${countdown.laps}` : "done";
	}

	// Only once it is actually under way. The dial can append the tally to its label and keep both;
	// a key has one line, so showing `×1/3` on a clock that has not been started yet would cost it
	// the one thing it says when nothing is happening — what this timer is.
	if (countdown.laps > 0 && status !== "idle") {
		return `×${countdown.lap}/${countdown.laps}`;
	}

	return countdown.settings.showLabel ? nameOf(countdown) : "";
}

/**
 * A repeating timer counts its laps; a finished one says so — **and a finished repeating timer says
 * both.**
 *
 * That last case is the one that was missing. The lap count used to win outright whenever it was
 * non-zero, so a timer that had run its last repeat and stopped for good showed `×3/3`, which is
 * character-for-character what it showed while that last repeat was still counting down. There was
 * no way to tell a job that was finished from one that had one lap left to go.
 *
 * The tally is shown on an idle clock too — `20m · ×1/3` before it is started. It is the only thing
 * on screen that says repeat is switched on at all, and the dial's label has room to append it
 * without displacing the name. The key's one-line caption does not, so it waits until the timer is
 * running; see {@link keyCaption}.
 */
function suffixFor(countdown: Countdown, status: string): string {
	const done = status === "elapsed" ? " · done" : "";

	if (countdown.laps > 0) {
		return ` · ×${countdown.lap}/${countdown.laps}${done}`;
	}
	return done;
}
