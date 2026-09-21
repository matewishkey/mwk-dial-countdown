/**
 * The line under the clock, on both controls.
 *
 * A dial and a key say nearly the same thing there — what this timer is, and how far through the
 * job it is — so the rule lives here once and each control takes the part that fits the room it
 * has. Nothing here imports the SDK, which is what lets it be tested: both actions carry an
 * `@action` decorator that Node's type stripping cannot transform.
 */

import type { Countdown } from "./countdown";
import { formatPresetLabel } from "./timer";

/**
 * What this timer is called: its title, or the length of the stage it is on.
 *
 * `Tea` says more about a timer you set on purpose than `20m` does, and the length is on the clock
 * above it anyway. Unnamed, it falls back to the current stage's own length, which is what this line
 * has always been — and on a preset with several stages it is the stage's length rather than the
 * whole preset's, because that is the number the clock beside it is counting down.
 */
export function nameOf(countdown: Countdown): string {
	const { title } = countdown.settings;
	return title !== "" ? title : formatPresetLabel(countdown.stageSeconds * 1000);
}

/**
 * The dial's label: the name, the drift, and the stage tally.
 *
 * The stage's length is reported *as configured*, never as the dial has since left it, and once the
 * two disagree the line says so — the clock reads 23:00, the settings still say 20m, and holding the
 * screen is what closes the gap. A named timer keeps that as `Tea · from 20m`: the name replacing
 * the length must not take the warning with it.
 */
export function dialLabel(countdown: Countdown, status: string): string {
	if (!countdown.settings.showLabel) {
		return "";
	}

	const stage = formatPresetLabel(countdown.stageSeconds * 1000);
	const name = nameOf(countdown);

	// `from 20m` on its own when the name *is* the length — saying `20m · from 20m` would be reporting
	// the drift twice and reporting it as agreement.
	const head = !countdown.drifted ? name : name === stage ? `from ${stage}` : `${name} · from ${stage}`;

	return `${head}${suffixFor(countdown, status)}`;
}

/**
 * The key's caption: one short line, and four claimants for it, in order of urgency — that it is
 * finished, which stage it is on, then what it is called. A finished multi-stage timer says
 * `done ×3/3`, since `×3/3` alone reads the same as one still on its final stage.
 */
export function keyCaption(countdown: Countdown, status: string): string {
	if (status === "elapsed") {
		return countdown.stageCount > 1 ? `done ×${countdown.stage}/${countdown.stageCount}` : "done";
	}

	// Only once it is actually under way. The dial can append the tally to its label and keep both;
	// a key has one line, so showing `×1/3` on a clock that has not been started yet would cost it
	// the one thing it says when nothing is happening — what this timer is.
	if (countdown.stageCount > 1 && status !== "idle") {
		return `×${countdown.stage}/${countdown.stageCount}`;
	}

	return countdown.settings.showLabel ? nameOf(countdown) : "";
}

/**
 * A preset with stages counts them; a finished one says so — and a finished multi-stage timer says
 * both, since `×3/3` alone cannot be told from that stage still counting down.
 *
 * The tally shows on an idle clock too (`40m · ×1/3`): it is the only thing on screen saying the
 * preset has stages at all, and the dial's label has room. The key's one line does not — see
 * {@link keyCaption}.
 */
function suffixFor(countdown: Countdown, status: string): string {
	const done = status === "elapsed" ? " · done" : "";

	if (countdown.stageCount > 1) {
		return ` · ×${countdown.stage}/${countdown.stageCount}${done}`;
	}
	return done;
}
