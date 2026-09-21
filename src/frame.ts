/**
 * What each control puts on its screen, as a value rather than as a side effect.
 *
 * **This exists so the visible half of the plugin can be tested at all.** Both actions carry an
 * `@action` decorator, and for a long time Node's type stripping made both of them unimportable —
 * so everything about what the user actually *sees* lived inside their `draw` methods, where
 * nothing could reach it. The loader compiles properly now and they can be driven directly
 * (`test/actions-live.test.ts`), but the split is worth keeping: a frame is a value, and comparing
 * values beats driving an event loop to find out what got drawn. The scripted demo covers some of it, but only what
 * a Linux box can provoke, and a Linux box cannot make a sound: `playSound` finds no player, so no
 * alert ever rings and nothing downstream of one is exercised. A bell that never reached the screen
 * shipped through a green suite and a green demo because of exactly that gap.
 *
 * So the rule is: the action decides *when* to draw and how to send it; this decides *what* it
 * says. Everything here is pure — same countdown in, same frame out — and `test/frame.test.ts`
 * drives it directly.
 */

import type { FeedbackPayload } from "@elgato/streamdeck";

import type { Countdown } from "./countdown";
import { dialLabel, keyCaption } from "./label";
import { asDataUri, renderGlyph, renderKey, renderRing, ringColour, themeFor } from "./render";
import { formatClockTime, formatDuration } from "./timer";

/**
 * Font sizes for the big clock. `1:10:10` at the layout's default 30px overruns its 96px box, so the
 * size steps down with the length of the string rather than being fixed.
 */
const VALUE_FONT_SIZES: Record<number, number> = { 4: 32, 5: 30, 6: 25, 7: 22, 8: 20 };
const VALUE_FONT_MIN = 18;

/**
 * The two layout files. Both are the plugin's own — a built-in layout's keys are published nowhere,
 * and a feedback key that does not match one fails silently.
 */
export const BAR_LAYOUT = "layouts/bar.json";
export const RING_LAYOUT = "layouts/ring.json";

/** Shrinks the clock as it gets longer, so `1:10:10` fits the same box as `5:00`. */
export function valueFontSize(value: string): number {
	return VALUE_FONT_SIZES[value.length] ?? VALUE_FONT_MIN;
}

/**
 * The wall-clock time this timer will finish at — the end of the whole job, stages included. Only
 * shown while running; on a stopped timer it would be a prediction that goes stale.
 *
 * `nowMs` is passed in rather than read here, so a test can say what time it is.
 */
export function finishText(countdown: Countdown, remainingMs: number, status: string, nowMs: number): string {
	if (!countdown.settings.showFinishTime || status !== "running") {
		return "";
	}
	const aheadMs = remainingMs + countdown.remainingStagesSeconds * 1000;
	return `ends ${formatClockTime(nowMs + aheadMs)}`;
}

/** Everything the touchscreen shows, for whichever of the two layouts is loaded. */
export function dialFeedback(countdown: Countdown, layout: string, nowMs: number): FeedbackPayload {
	const { settings, timer } = countdown;
	const status = timer.status;
	const remainingMs = timer.remainingMs;

	const value = formatDuration(remainingMs);
	const dimmed = countdown.dimmed;
	const flash = countdown.flashing;
	const toast = countdown.toast;
	const ringing = countdown.ringing;
	const label = dialLabel(countdown, status);

	// One spare line, two claimants. What you just did wins for a second; after that, the finish
	// time, which is the useful thing on a running clock. The dial's step used to have a claim here
	// too, back when it was a mode that could be left switched on — it is your finger now, so there
	// is nothing left to remind you of.
	const footer = toast || finishText(countdown, remainingMs, status, nowMs);

	const palette = themeFor(settings.theme);
	const remainingFraction = remainingMs / Math.max(1, timer.durationMs);
	const colour = ringColour({ remainingFraction, status, dimmed, palette });

	// The same four facts either way — the state glyph, the clock, the progress, the two lines of
	// text — laid out differently. Keeping them one expression apart is what stops the two views
	// drifting into disagreeing about what the timer is doing.
	if (layout === BAR_LAYOUT) {
		return {
			glyph: asDataUri(
				renderGlyph({ remainingFraction, status, dimmed, ringing, palette, logo: settings.showLogo, size: 52 })
			),
			value: { value, font: { size: valueFontSize(value) } },
			indicator: {
				value: Math.round((1 - remainingFraction) * 100),
				bar_fill_c: colour,
				bar_bg_c: palette.track
			},
			label,
			finish: footer
		};
	}

	return {
		ring: asDataUri(
			renderRing({ remainingFraction, status, dimmed, flash, ringing, palette, logo: settings.showLogo })
		),
		// The clock is sent as a full item definition so its size can shrink for `1:10:10`.
		value: { value, font: { size: valueFontSize(value) } },
		label,
		finish: footer
	};
}

/** The whole key face as one SVG, clock included. Wrapped in a data URI by the caller. */
export function keyFace(countdown: Countdown): string {
	const { settings, timer } = countdown;
	const status = timer.status;
	const remainingMs = timer.remainingMs;
	const toast = countdown.toast;

	// One line, four jobs, in order of urgency: what you just did, that something is sounding, the
	// fact that it is paused, then — when there is nothing to report — what this timer is. The
	// sounding alert outranks the pause for the same reason the dial's bell outranks its state
	// glyph: it is the thing a press is about to act on.
	const caption = toast || (status === "paused" && !countdown.ringing ? "paused" : keyCaption(countdown, status));

	return renderKey({
		remainingFraction: remainingMs / Math.max(1, timer.durationMs),
		status,
		dimmed: countdown.dimmed,
		flash: countdown.flashing,
		palette: themeFor(settings.theme),
		value: formatDuration(remainingMs),
		caption,
		accent: toast !== "" || status === "paused" || countdown.ringing
	});
}
