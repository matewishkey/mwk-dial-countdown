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
const RING_SIZE = 88;

const CENTRE = RING_SIZE / 2;
const RADIUS = 36;
const STROKE = 9;

export type Palette = {
	running: string;
	elapsed: string;
	idle: string;
	track: string;
};

/**
 * Colour themes. Each has to survive being glanced at from a metre away, so the states are kept far
 * apart in hue rather than merely different, and the track stays dark enough that the remaining arc
 * reads as the bright thing on the screen.
 */
export const THEMES: Record<string, Palette> = {
	default: {
		running: "#22C55E",
		elapsed: "#EF4444",
		idle: "#38BDF8",
		track: "#2E2E33"
	},
	ocean: {
		running: "#2DD4BF",
		elapsed: "#F43F5E",
		idle: "#38BDF8",
		track: "#16262E"
	},
	ember: {
		running: "#FB923C",
		elapsed: "#DC2626",
		idle: "#F59E0B",
		track: "#2A211C"
	},
	neon: {
		running: "#00E5FF",
		elapsed: "#FF2D95",
		idle: "#7C4DFF",
		track: "#1E1B2E"
	},
	forest: {
		running: "#4ADE80",
		elapsed: "#F87171",
		idle: "#34D399",
		track: "#1B2A22"
	},
	mono: {
		running: "#E5E5E5",
		elapsed: "#FAFAFA",
		idle: "#6B7280",
		track: "#232326"
	},
	/**
	 * Mate Wish Key. Colours are the brand's own dark-mode tokens, taken from the site: red `#e2342b`,
	 * red-deep `#f0524a`, mute `#a8a2b0`, faint `#8e8896`. The track is the one derived value — brand
	 * `line` (#232c3a) reads too blue behind red, so it is warmed toward the brand's ink.
	 */
	mwk: {
		running: "#E2342B",
		elapsed: "#F0524A",
		idle: "#8E8896",
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
	/**
	 * Dim half of the warning blink. The blink is a shade of the state's own colour rather than a
	 * second colour, so there is one colour per state and nothing to configure.
	 */
	dimmed: boolean;
	palette: Palette;
	/** Draw the Mate Wish Key mark inside the ring. */
	logo?: boolean;
};

/** Opacity of the ring on the dim half of a blink. */
const DIM_OPACITY = 0.3;

/** A paused ring is very slightly held back, so the glyph is what carries the state. */
const PAUSED_OPACITY = 0.85;

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

/**
 * Colour the ring should be drawn in. A paused timer keeps the running colour — the pause glyph in
 * the middle says it is paused, and saying it twice in two different ways only invites the two to
 * disagree. That leaves three colours per theme instead of four.
 */
export function ringColour({ status, palette }: RingState): string {
	if (status === "elapsed") {
		return palette.elapsed;
	}
	return status === "idle" ? palette.idle : palette.running;
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

	const opacity = state.dimmed ? DIM_OPACITY : state.status === "paused" ? PAUSED_OPACITY : 1;

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${RING_SIZE}" height="${RING_SIZE}" viewBox="0 0 ${RING_SIZE} ${RING_SIZE}">`,
		`<circle cx="${CENTRE}" cy="${CENTRE}" r="${RADIUS}" fill="none" stroke="${state.palette.track}" stroke-width="${STROKE}"/>`,
		arc(fraction, colour, opacity),
		centre(state, colour, opacity),
		`</svg>`
	].join("");
}

/**
 * Whatever sits inside the ring. A paused timer shows a pause glyph, because "paused" is a fact
 * worth stating outright rather than leaving to a colour the user has to have learnt.
 */
function centre(state: RingState, colour: string, opacity: number): string {
	if (state.status === "paused") {
		return pauseGlyph(colour, opacity);
	}
	return state.logo === true ? mark(colour, opacity) : "";
}

/** Two upright bars, the universal pause mark. */
function pauseGlyph(colour: string, opacity: number): string {
	const barWidth = 6;
	const barHeight = 24;
	const gap = 7;
	const y = CENTRE - barHeight / 2;
	const left = CENTRE - gap / 2 - barWidth;
	const right = CENTRE + gap / 2;

	return (
		`<g opacity="${opacity}">` +
		`<rect x="${left}" y="${y}" width="${barWidth}" height="${barHeight}" rx="1.5" fill="${colour}"/>` +
		`<rect x="${right}" y="${y}" width="${barWidth}" height="${barHeight}" rx="1.5" fill="${colour}"/>` +
		`</g>`
	);
}

/** The brand mark, centred in the ring and tinted to match it so the two read as one object. */
function mark(colour: string, opacity: number): string {
	const scale = MARK_TARGET_WIDTH / MARK_WIDTH;
	const x = CENTRE - MARK_WIDTH * scale * 0.5;
	const y = CENTRE - MARK_HEIGHT * scale * 0.5;
	const stroke = `stroke="${colour}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" fill="none"`;

	return (
		`<g transform="translate(${round(x)} ${round(y)}) scale(${round(scale)})" opacity="${round(opacity * 0.85)}">` +
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
