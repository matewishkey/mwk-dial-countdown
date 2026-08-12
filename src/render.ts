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

/**
 * Colour themes. Each has to survive being glanced at from a metre away, so the four states are
 * kept far apart in hue rather than merely different, and the track stays dark enough that the
 * remaining arc reads as the bright thing on the screen.
 */
export const THEMES: Record<string, Palette> = {
	default: {
		running: "#22C55E",
		paused: "#FACC15",
		elapsed: "#EF4444",
		idle: "#38BDF8",
		warn: "#F97316",
		track: "#2E2E33"
	},
	ocean: {
		running: "#2DD4BF",
		paused: "#67E8F9",
		elapsed: "#F43F5E",
		idle: "#38BDF8",
		warn: "#FBBF24",
		track: "#16262E"
	},
	ember: {
		running: "#FB923C",
		paused: "#FCD34D",
		elapsed: "#DC2626",
		idle: "#F59E0B",
		warn: "#EF4444",
		track: "#2A211C"
	},
	neon: {
		running: "#00E5FF",
		paused: "#FFD400",
		elapsed: "#FF2D95",
		idle: "#7C4DFF",
		warn: "#FF9100",
		track: "#1E1B2E"
	},
	forest: {
		running: "#4ADE80",
		paused: "#A3E635",
		elapsed: "#F87171",
		idle: "#34D399",
		warn: "#FACC15",
		track: "#1B2A22"
	},
	mono: {
		running: "#E5E5E5",
		paused: "#8E8E93",
		elapsed: "#FAFAFA",
		idle: "#6B7280",
		warn: "#C7C7CC",
		track: "#232326"
	},
	/**
	 * Mate Wish Key. Colours are the brand's own dark-mode tokens, taken from the site: red `#e2342b`,
	 * red-deep `#f0524a`, ink `#f4f2f6`, mute `#a8a2b0`. The track is the one derived value — brand
	 * `line` (#232c3a) reads too blue behind red, so it is warmed toward the brand's ink.
	 */
	mwk: {
		running: "#E2342B",
		paused: "#A8A2B0",
		elapsed: "#F0524A",
		idle: "#8E8896",
		warn: "#F4F2F6",
		track: "#2A2630"
	}
};

export const DEFAULT_PALETTE: Palette = THEMES.default;

/** Resolves a theme id from settings, falling back rather than throwing on an unknown name. */
export function themeFor(id: string | undefined): Palette {
	return (id !== undefined && THEMES[id]) || THEMES.default;
}

export type RingState = {
	/** 0-1, how much of the countdown is left. */
	remainingFraction: number;
	status: TimerStatus;
	/** True while inside the warning window and the blink is in its "on" half. */
	warning: boolean;
	palette: Palette;
	/** Draw the Mate Wish Key mark inside the ring. */
	logo?: boolean;
};

/**
 * The Mate Wish Key mark, as published in the brand's own `mwk-mark.svg`: an "M" and a "K" stroke.
 * Kept as bare path data so it can be recoloured and scaled to sit inside the ring, rather than
 * embedded as a fixed-colour image.
 */
const MARK_PATHS = [
	"M0 100 L23.09 0 L46.17 100 L69.26 0 L69.26 100",
	"M69.26 100 L118.03 0"
] as const;

/** Native extent of {@link MARK_PATHS}, from the source artwork's viewBox. */
const MARK_WIDTH = 118.03;
const MARK_HEIGHT = 100;

/** Width the mark is drawn at inside the ring, leaving well over the brand's 18% clear space. */
const MARK_TARGET_WIDTH = 34;

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
		state.logo === true ? mark(colour) : "",
		`</svg>`
	].join("");
}

/** The brand mark, centred in the ring and tinted to match it so the two read as one object. */
function mark(colour: string): string {
	const scale = MARK_TARGET_WIDTH / MARK_WIDTH;
	const x = CENTRE - MARK_WIDTH * scale * 0.5;
	const y = CENTRE - MARK_HEIGHT * scale * 0.5;
	const stroke = `stroke="${colour}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" fill="none"`;

	return (
		`<g transform="translate(${round(x)} ${round(y)}) scale(${round(scale)})" opacity="0.85">` +
		MARK_PATHS.map((d) => `<path d="${d}" ${stroke}/>`).join("") +
		`</g>`
	);
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
