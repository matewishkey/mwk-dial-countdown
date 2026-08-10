/**
 * Draws the countdown ring.
 *
 * A `pixmap` layout item accepts a raw SVG string, so the ring is generated per frame as markup —
 * no canvas library, which matters because plugins run under `--no-addons` and cannot load native
 * modules. Text is deliberately left to real `text` layout items rather than drawn here, so it uses
 * Stream Deck's own font rendering.
 */

import type { TimerStatus } from "./timer";

/** The ring occupies a square on the left of the 200 × 100 touchscreen. */
export const RING_SIZE = 88;

const CENTRE = RING_SIZE / 2;
const RADIUS = 36;
const STROKE = 9;

export type Palette = {
	running: string;
	paused: string;
	elapsed: string;
	idle: string;
	warn: string;
	track: string;
};

export const DEFAULT_PALETTE: Palette = {
	running: "#22C55E",
	paused: "#FACC15",
	elapsed: "#EF4444",
	idle: "#38BDF8",
	warn: "#F97316",
	track: "#2E2E33"
};

export type RingState = {
	/** 0-1, how much of the countdown is left. */
	remainingFraction: number;
	status: TimerStatus;
	/** True while inside the warning window and the blink is in its "on" half. */
	warning: boolean;
	palette: Palette;
};

/** Colour the ring should be drawn in, given the timer's state. */
export function ringColour({ status, warning, palette }: RingState): string {
	if (status === "elapsed") {
		return palette.elapsed;
	}
	if (warning) {
		return palette.warn;
	}
	if (status === "paused") {
		return palette.paused;
	}
	return status === "running" ? palette.running : palette.idle;
}

/**
 * Builds the ring as an SVG string. The arc shows time *remaining*, so it empties as the countdown
 * runs — a full ring means a full timer, which is the way round people expect.
 */
export function renderRing(state: RingState): string {
	// A finished timer draws a *full* ring in the elapsed colour. Left to its own arithmetic it would
	// draw nothing at all — zero remaining, zero arc — and the one moment the user most needs to see
	// would be the blankest thing on the screen.
	const fraction = state.status === "elapsed" ? 1 : clamp01(state.remainingFraction);
	const colour = ringColour(state);

	// A paused ring is dimmed rather than recoloured alone, so the state reads at a glance.
	const opacity = state.status === "paused" ? 0.75 : 1;

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${RING_SIZE}" height="${RING_SIZE}" viewBox="0 0 ${RING_SIZE} ${RING_SIZE}">`,
		`<circle cx="${CENTRE}" cy="${CENTRE}" r="${RADIUS}" fill="none" stroke="${state.palette.track}" stroke-width="${STROKE}"/>`,
		arc(fraction, colour, opacity),
		`</svg>`
	].join("");
}

function arc(fraction: number, colour: string, opacity: number): string {
	if (fraction <= 0) {
		return "";
	}

	const stroke = `stroke="${colour}" stroke-width="${STROKE}" stroke-linecap="round" fill="none" opacity="${opacity}"`;

	// A full circle cannot be expressed as a single arc — the start and end points coincide, and the
	// renderer draws nothing at all. Two half-circles are the standard way round it.
	if (fraction >= 1) {
		return (
			`<path d="M ${CENTRE} ${CENTRE - RADIUS} A ${RADIUS} ${RADIUS} 0 0 1 ${CENTRE} ${CENTRE + RADIUS} ` +
			`A ${RADIUS} ${RADIUS} 0 0 1 ${CENTRE} ${CENTRE - RADIUS}" ${stroke}/>`
		);
	}

	const angle = fraction * 2 * Math.PI;
	const end = pointOnCircle(angle);
	const largeArc = fraction > 0.5 ? 1 : 0;

	return `<path d="M ${CENTRE} ${CENTRE - RADIUS} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${end.x} ${end.y}" ${stroke}/>`;
}

/** Clockwise from twelve o'clock. */
function pointOnCircle(angle: number): { x: number; y: number } {
	return {
		x: round(CENTRE + RADIUS * Math.sin(angle)),
		y: round(CENTRE - RADIUS * Math.cos(angle))
	};
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.max(0, Math.min(1, value));
}

/** Wraps SVG markup as a data URI, the form a `pixmap` item's value takes. */
export function asDataUri(svg: string): string {
	return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
