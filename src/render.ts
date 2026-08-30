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

/** A Stream Deck key is 144 × 144, so the same ring is drawn again at nearly twice the size. */
export const KEY_SIZE = 144;

const CENTRE = RING_SIZE / 2;
const RADIUS = 36;
const STROKE = 9;

/**
 * The ring's proportions at an arbitrary size.
 *
 * Every dimension is expressed as a fraction of the 88px original rather than picked again for the
 * key, so the two controls cannot drift apart: change the ring's weight once and both follow.
 */
type Geometry = {
	size: number;
	centre: number;
	radius: number;
	stroke: number;
	/** Width the brand mark is drawn at. */
	mark: number;
};

function geometryFor(size: number): Geometry {
	const scale = size / RING_SIZE;
	return {
		size,
		centre: size / 2,
		radius: round(RADIUS * scale),
		stroke: round(STROKE * scale),
		mark: round(MARK_TARGET_WIDTH * scale)
	};
}

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

/**
 * Resolves a theme id from settings, falling back rather than throwing on an unknown name.
 *
 * `Object.hasOwn`, not a plain lookup. {@link THEMES} is an object literal, so it inherits
 * `Object.prototype` and every key on it answers truthy: `themeFor("constructor")` returned the
 * `Object` function, whose `track` and `running` are `undefined`, and the ring was then drawn with
 * `stroke="undefined"`. A theme id is an unconstrained string by the time it reaches here — see
 * `settings.ts`, which validates `layout` against its two values and lets `theme` through as any
 * non-empty string — so the check has to be for a theme *we* declared, not merely for something.
 */
export function themeFor(id: string | undefined): Palette {
	return id !== undefined && Object.hasOwn(THEMES, id) ? THEMES[id] : THEMES.default;
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
	/**
	 * Allow the Mate Wish Key mark in the middle of the ring.
	 *
	 * Only ever *allow*: the mark is drawn on a clock that is sitting idle and nothing else. See
	 * {@link centre} for why the state won the argument over the brand.
	 */
	logo?: boolean;
	/**
	 * Pulse the ring, acknowledging a gesture. Drawn as a separate hairline outside the arc rather
	 * than by brightening the arc itself, so it is unmistakably an event and not a change of state —
	 * and so it still reads during the warning blink, when the arc is already being dimmed.
	 */
	flash?: boolean;
	/** Edge length of the square the ring is drawn in. Defaults to the touchscreen's 88px. */
	size?: number;
	/**
	 * Leave the middle of the ring empty — no mark, and no pause glyph either. The key draws its
	 * clock there and cannot have a glyph sitting behind the digits.
	 */
	hollow?: boolean;
};

/** Opacity of the ring on the dim half of a blink. */
const DIM_OPACITY = 0.3;

/**
 * A paused *arc* is very slightly held back, so the glyph is what carries the state.
 *
 * The arc only. Dimming the glyph as well — which is what happened while the two shared one opacity
 * — held back the very thing this exists to make prominent, and meant the bar layout's glyph could
 * not be drawn from the same call, since it has no arc to contrast against.
 */
const PAUSED_OPACITY = 0.85;

/**
 * The gesture pulse, as fractions of the arc's own stroke width. The gap places it clear of the arc
 * while staying inside the box — at the touchscreen's 88px that lands the hairline at r=42 in a
 * 44px half-width, which is the tightest the geometry allows without clipping.
 */
const PULSE_GAP_RATIO = 0.667;
const PULSE_STROKE_RATIO = 0.22;
const PULSE_OPACITY = 0.9;

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
	const geometry = geometryFor(state.size ?? RING_SIZE);

	// A finished timer draws a *full* ring in the elapsed colour. Left to its own arithmetic it would
	// draw nothing at all — zero remaining, zero arc — and the one moment the user most needs to see
	// would be the blankest thing on the screen.
	const fraction = state.status === "elapsed" ? 1 : clamp01(state.remainingFraction);
	const colour = ringColour(state);

	// The warning blink dims everything on the screen; a pause holds back only the arc.
	const glyphOpacity = glyphOpacityFor(state);
	const arcOpacity = state.status === "paused" ? glyphOpacity * PAUSED_OPACITY : glyphOpacity;

	return [
		svgOpen(geometry),
		track(geometry, state.palette.track),
		arc(geometry, fraction, colour, arcOpacity),
		centre(geometry, state, colour, glyphOpacity),
		pulse(geometry, state, colour),
		`</svg>`
	].join("");
}

/**
 * The state glyph on its own, with no ring around it — what the progress-bar layout shows.
 *
 * The bar layout has no ring to put anything inside, but it needs the same one-glance answer the
 * ring gives: running, paused, done, or sitting idle with the mark on it. Drawn from the very same
 * {@link centre}, so the two layouts cannot come to disagree about what a state looks like.
 */
export function renderGlyph(state: RingState): string {
	const geometry = geometryFor(state.size ?? RING_SIZE);

	return [
		svgOpen(geometry),
		centre(geometry, { ...state, hollow: false }, ringColour(state), glyphOpacityFor(state)),
		`</svg>`
	].join("");
}

/** One rule for both layouts, so a glyph is the same glyph wherever it is drawn. */
function glyphOpacityFor(state: RingState): number {
	return state.dimmed ? DIM_OPACITY : 1;
}

function svgOpen({ size }: Geometry): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`;
}

function track({ centre: c, radius, stroke }: Geometry, colour: string): string {
	return `<circle cx="${c}" cy="${c}" r="${radius}" fill="none" stroke="${colour}" stroke-width="${stroke}"/>`;
}

/**
 * The gesture pulse: a hairline circle just outside the arc, drawn only on the frames immediately
 * following a press or a tick of the dial. It has to sit clear of the arc without leaving the box,
 * so its radius is set from the arc's own outer edge rather than picked.
 */
function pulse(geometry: Geometry, state: RingState, colour: string): string {
	if (state.flash !== true) {
		return "";
	}

	const { centre: c, radius, stroke } = geometry;
	const width = round(stroke * PULSE_STROKE_RATIO);
	const at = round(radius + stroke * PULSE_GAP_RATIO);

	return `<circle cx="${c}" cy="${c}" r="${at}" fill="none" stroke="${colour}" stroke-width="${width}" opacity="${PULSE_OPACITY}"/>`;
}

/**
 * Whatever sits inside the ring: **the state, or — when there is no state to report — the mark.**
 *
 * The middle of the ring can hold one thing, and it used to hold two on a rota nobody had been told
 * about: the brand mark normally, silently swapped for a pause glyph while paused. So the logo came
 * and went for reasons that looked random from the outside, and the other three states had no glyph
 * at all — a running clock and a finished one differed only by a colour you had to have learnt.
 *
 * The rule now is one sentence. **An idle clock shows the mark; every other state shows itself.**
 * Idle is the empty state — nothing running, nothing to resume, nothing finished — so it is the one
 * moment there is genuinely nothing to say, and the only moment the mark is not in the way.
 */
function centre(geometry: Geometry, state: RingState, colour: string, opacity: number): string {
	if (state.hollow === true) {
		return "";
	}

	switch (state.status) {
		case "running":
			return playGlyph(geometry, colour, opacity);
		case "paused":
			return pauseGlyph(geometry, colour, opacity);
		case "elapsed":
			return doneGlyph(geometry, colour, opacity);
		default:
			return state.logo === true ? mark(geometry, colour, opacity) : "";
	}
}

/**
 * The three state glyphs, drawn to one set of proportions so they read as one family.
 *
 * All are sized from the same box as the pause bars always were, so nothing here changes how much of
 * the ring's inside is occupied — only which shape occupies it.
 */
const GLYPH_HEIGHT = 24;
const GLYPH_BAR_WIDTH = 6;
const GLYPH_BAR_GAP = 7;
const GLYPH_RADIUS = 1.5;

/** A right-pointing triangle: the clock is running. */
function playGlyph({ size, centre: c }: Geometry, colour: string, opacity: number): string {
	const scale = size / RING_SIZE;
	const height = round(GLYPH_HEIGHT * scale);
	// Optically centred rather than geometrically: a triangle's mass sits behind its point, so a
	// centred bounding box reads as though it has slid to the right.
	const width = round(height * 0.86);
	const left = round(c - width / 2 + width * 0.12);
	const top = round(c - height / 2);

	return (
		`<path d="M ${left} ${top} L ${round(left + width)} ${round(c)} L ${left} ${round(top + height)} Z" ` +
		`fill="${colour}" opacity="${opacity}" stroke="${colour}" stroke-width="${round(2 * scale)}" ` +
		`stroke-linejoin="round"/>`
	);
}

/** Two upright bars, the universal pause mark. */
function pauseGlyph({ size, centre: c }: Geometry, colour: string, opacity: number): string {
	const scale = size / RING_SIZE;
	const barWidth = round(GLYPH_BAR_WIDTH * scale);
	const barHeight = round(GLYPH_HEIGHT * scale);
	const gap = round(GLYPH_BAR_GAP * scale);
	const y = round(c - barHeight / 2);
	const left = round(c - gap / 2 - barWidth);
	const right = round(c + gap / 2);

	return (
		`<g opacity="${opacity}">` +
		`<rect x="${left}" y="${y}" width="${barWidth}" height="${barHeight}" rx="${round(GLYPH_RADIUS * scale)}" fill="${colour}"/>` +
		`<rect x="${right}" y="${y}" width="${barWidth}" height="${barHeight}" rx="${round(GLYPH_RADIUS * scale)}" fill="${colour}"/>` +
		`</g>`
	);
}

/**
 * A filled square: the timer has run out and has nothing left to do.
 *
 * A square rather than a tick. The ring behind it is already full and already in the elapsed colour,
 * so this only has to say "stopped", and a square is what the same button says on every transport
 * control ever made — whereas a tick would claim the timer had *succeeded*, which is a judgement a
 * countdown is in no position to make.
 */
function doneGlyph({ size, centre: c }: Geometry, colour: string, opacity: number): string {
	const scale = size / RING_SIZE;
	const side = round(GLYPH_HEIGHT * 0.82 * scale);
	const at = round(c - side / 2);

	return `<rect x="${at}" y="${at}" width="${side}" height="${side}" rx="${round(GLYPH_RADIUS * 1.6 * scale)}" fill="${colour}" opacity="${opacity}"/>`;
}

/** The brand mark, centred in the ring and tinted to match it so the two read as one object. */
function mark({ centre: c, mark: width }: Geometry, colour: string, opacity: number): string {
	const scale = width / MARK_WIDTH;
	const x = c - MARK_WIDTH * scale * 0.5;
	const y = c - MARK_HEIGHT * scale * 0.5;
	const stroke = `stroke="${colour}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" fill="none"`;

	return (
		`<g transform="translate(${round(x)} ${round(y)}) scale(${round(scale)})" opacity="${round(opacity * 0.85)}">` +
		MARK_PATHS.map((d) => `<path d="${d}" ${stroke}/>`).join("") +
		`</g>`
	);
}

function arc(geometry: Geometry, fraction: number, colour: string, opacity: number): string {
	if (fraction <= 0) {
		return "";
	}

	const { centre: c, radius, stroke: width } = geometry;
	const stroke = `stroke="${colour}" stroke-width="${width}" stroke-linecap="round" fill="none" opacity="${opacity}"`;

	// A full circle cannot be expressed as a single arc — the start and end points coincide, and the
	// renderer draws nothing at all. Two half-circles are the standard way round it.
	if (fraction >= 1) {
		return (
			`<path d="M ${c} ${round(c - radius)} A ${radius} ${radius} 0 0 1 ${c} ${round(c + radius)} ` +
			`A ${radius} ${radius} 0 0 1 ${c} ${round(c - radius)}" ${stroke}/>`
		);
	}

	const angle = fraction * 2 * Math.PI;
	const end = pointOnCircle(geometry, angle);
	const largeArc = fraction > 0.5 ? 1 : 0;

	return `<path d="M ${c} ${round(c - radius)} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}" ${stroke}/>`;
}

/** Clockwise from twelve o'clock. */
function pointOnCircle({ centre: c, radius }: Geometry, angle: number): { x: number; y: number } {
	return {
		x: round(c + radius * Math.sin(angle)),
		y: round(c - radius * Math.cos(angle))
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

/**
 * Draws the whole key face: the ring, the clock inside it, and a line of state underneath.
 *
 * Unlike the touchscreen, a key has no layout with text items to fill, and its one text facility —
 * `setTitle` — is overridden the moment the user types a title of their own in the Stream Deck
 * application. A clock that silently stops being a clock because someone labelled the button is not
 * a clock, so the text is drawn into the image instead, where nothing can take it away.
 */
export function renderKey(state: KeyState): string {
	const geometry = geometryFor(KEY_SIZE);
	const { centre: c } = geometry;
	const colour = ringColour(state);

	return [
		renderRing({ ...state, size: KEY_SIZE, hollow: true }).replace(/<\/svg>$/, ""),
		text(state.value, c, round(c + KEY_VALUE_BASELINE), keyValueFontSize(state.value), 600, "#FFFFFF"),
		state.caption === ""
			? ""
			: text(
					state.caption,
					c,
					round(c + KEY_CAPTION_BASELINE),
					keyCaptionFontSize(state.caption),
					400,
					state.accent ? colour : KEY_CAPTION_COLOUR
				),
		`</svg>`
	].join("");
}

export type KeyState = Omit<RingState, "size" | "logo" | "hollow"> & {
	/** The clock itself, already formatted. */
	value: string;
	/** The line beneath it: the gesture just made, the paused state, or the preset's name. */
	caption: string;
	/**
	 * Draw the caption in the ring's own colour rather than grey. Reserved for the things that are
	 * happening — a gesture, a pause — so that a caption which is merely naming the preset does not
	 * shout as loudly as one reporting an event.
	 */
	accent: boolean;
};

/** Caption colour when it is only labelling, matching the touchscreen layout's own muted grey. */
const KEY_CAPTION_COLOUR = "#9A9AA0";

/** Baselines, measured down from the centre of the key. */
const KEY_VALUE_BASELINE = 4;
const KEY_CAPTION_BASELINE = 30;

/**
 * How wide the caption may be.
 *
 * The caption sits 30px below the centre, where the ring has closed in from the sides — so the room
 * is not the key's width but the chord across the ring's inside at that height, which works out at
 * about 90px. A caption is a variable-length string (`next · 40m`, `1h 10m 10s`) so it is the font
 * that gives way, not the text: at these sizes sans-serif digits and lower case average close
 * enough to half the font size per character to size from the length alone.
 */
const KEY_CAPTION_WIDTH = 88;
const KEY_CAPTION_SIZE_MAX = 19;
const KEY_CAPTION_SIZE_MIN = 11;

export function keyCaptionFontSize(caption: string): number {
	const fitted = Math.floor((KEY_CAPTION_WIDTH * 2) / Math.max(1, caption.length));
	return Math.max(KEY_CAPTION_SIZE_MIN, Math.min(KEY_CAPTION_SIZE_MAX, fitted));
}

/**
 * Font sizes for the key's clock, by length of string. A key is square and the ring eats its
 * corners, so the usable width is narrower than the touchscreen's box and the steps are steeper.
 */
const KEY_VALUE_FONT_SIZES: Record<number, number> = { 4: 40, 5: 36, 6: 28, 7: 25, 8: 22 };
const KEY_VALUE_FONT_MIN = 20;

export function keyValueFontSize(value: string): number {
	return KEY_VALUE_FONT_SIZES[value.length] ?? KEY_VALUE_FONT_MIN;
}

/**
 * A centred line of text. The font is named only by generic family: the plugin cannot ship a font
 * to the renderer, and asking for one it does not have is how you get a fallback nobody chose.
 */
function text(value: string, x: number, y: number, size: number, weight: number, colour: string): string {
	return (
		`<text x="${x}" y="${y}" text-anchor="middle" fill="${colour}" ` +
		`font-family="sans-serif" font-size="${size}" font-weight="${weight}">${escapeText(value)}</text>`
	);
}

/** SVG is XML, so anything a preset label or a custom sound name might contain has to be escaped. */
function escapeText(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Wraps SVG markup as a data URI, the form a `pixmap` item's value takes. */
export function asDataUri(svg: string): string {
	return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
