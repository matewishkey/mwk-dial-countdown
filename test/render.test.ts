import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	asDataUri,
	KEY_SIZE,
	keyCaptionFontSize,
	keyValueFontSize,
	renderGlyph,
	renderKey,
	renderRing,
	ringColour,
	themeFor,
	THEMES
} from "../src/render.ts";

const palette = themeFor("default");
const base = { status: "running" as const, dimmed: false, palette };

describe("renderRing", () => {
	it("produces a well-formed svg", () => {
		const svg = renderRing({ ...base, remainingFraction: 0.5 });
		assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
		assert.match(svg, /<\/svg>$/);
		assert.ok(svg.includes("<circle"), "the track should always be drawn");
	});

	it("draws a full ring as two arcs, since one arc back to its own start renders nothing", () => {
		const svg = renderRing({ ...base, remainingFraction: 1 });
		assert.equal(svg.match(/A /g)?.length, 2);
	});

	it("draws no arc when a running timer is at zero", () => {
		// An arc is the only `A` command in the file, so it is what to look for rather than `<path`:
		// the running state's own glyph is a path too, and it belongs in the middle regardless.
		const svg = renderRing({ ...base, remainingFraction: 0 });
		assert.ok(!svg.includes("A "), "an empty ring should have no arc");
		assert.ok(svg.includes("<circle"), "but it still has its track");
	});

	it("fills the whole ring in the elapsed colour when done, rather than showing nothing", () => {
		const svg = renderRing({ ...base, remainingFraction: 0, status: "elapsed" });
		assert.equal(svg.match(/A /g)?.length, 2, "a finished timer should draw a complete ring");
		assert.ok(svg.includes(palette.elapsed), "and it should be the elapsed colour");
	});

	it("sets the large-arc flag only past the halfway point", () => {
		assert.match(renderRing({ ...base, remainingFraction: 0.75 }), /A 36 36 0 1 1/);
		assert.match(renderRing({ ...base, remainingFraction: 0.25 }), /A 36 36 0 0 1/);
	});

	it("clamps a nonsense fraction rather than emitting broken geometry", () => {
		for (const remainingFraction of [-1, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
			const svg = renderRing({ ...base, remainingFraction });
			assert.ok(!svg.includes("NaN"), `NaN leaked into the path for ${remainingFraction}`);
			assert.match(svg, /<\/svg>$/);
		}
	});
});

describe("ringColour", () => {
	it("maps each state to its own colour", () => {
		assert.equal(ringColour({ ...base, remainingFraction: 1, status: "running" }), palette.running);
		assert.equal(ringColour({ ...base, remainingFraction: 1, status: "idle" }), palette.idle);
		assert.equal(ringColour({ ...base, remainingFraction: 0, status: "elapsed" }), palette.elapsed);
	});

	it("does not recolour on pause — the glyph states that, not the colour", () => {
		assert.equal(
			ringColour({ ...base, remainingFraction: 0.5, status: "paused" }),
			palette.running,
			"pausing must not change the ring's colour"
		);
	});

	it("keeps the state's own colour while blinking, and only dims it", () => {
		const lit = renderRing({ ...base, remainingFraction: 0.1 });
		const dim = renderRing({ ...base, remainingFraction: 0.1, dimmed: true });

		assert.ok(lit.includes(palette.running), "precondition: the lit half is the running colour");
		assert.ok(dim.includes(palette.running), "the dim half must be the same colour, not a different one");
		assert.notEqual(lit, dim, "and it must actually differ");
		assert.match(dim, /opacity="0\.3"/, "the difference is opacity");
	});
});

describe("asDataUri", () => {
	it("wraps svg as a base64 data uri that round-trips", () => {
		const svg = renderRing({ ...base, remainingFraction: 0.5 });
		const uri = asDataUri(svg);
		assert.match(uri, /^data:image\/svg\+xml;base64,/);
		assert.equal(Buffer.from(uri.split(",")[1], "base64").toString("utf8"), svg);
	});
});

describe("themes", () => {
	it("provides several complete palettes", () => {
		const ids = Object.keys(THEMES);
		assert.ok(ids.length >= 5, `expected a handful of themes, got ${ids.length}`);

		for (const [id, palette] of Object.entries(THEMES)) {
			for (const role of ["running", "elapsed", "idle", "track"] as const) {
				assert.match(palette[role], /^#[0-9A-Fa-f]{6}$/, `${id}.${role} is not a hex colour`);
			}
		}
	});

	it("keeps each theme's states visually distinct from one another", () => {
		for (const [id, palette] of Object.entries(THEMES)) {
			const states = [palette.running, palette.elapsed, palette.idle];
			assert.equal(new Set(states).size, states.length, `${id} reuses a colour across states`);
			assert.ok(!states.includes(palette.track), `${id} uses its track colour for a state`);
		}
	});

	it("falls back to the default rather than throwing on an unknown id", () => {
		assert.equal(themeFor(undefined), THEMES.default);
		assert.equal(themeFor("nope"), THEMES.default);
		assert.equal(themeFor("ocean"), THEMES.ocean);
	});

	it("falls back on an id that names something on Object.prototype", () => {
		// `THEMES` is an object literal, so it inherits `Object.prototype` and every key on it answers
		// truthy — `THEMES["constructor"]` is the `Object` function. A plain lookup therefore returned
		// it as though it were a palette, and the ring was drawn with `stroke="undefined"`.
		//
		// Not reachable from the dropdown, which is why it went unnoticed. But `normaliseSettings`
		// validates `layout` against its two values and lets `theme` through as any non-empty string,
		// and settings outlive the build that wrote them — so "no user would type that" is not a
		// property this can rely on.
		for (const id of ["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf"]) {
			assert.equal(themeFor(id), THEMES.default, `${id} resolved to something other than the default`);
		}
	});

	it("gives every resolved palette a complete set of colours", () => {
		// The check that would have caught the above by its consequence rather than its cause: a
		// palette missing a field renders `stroke="undefined"` into the SVG, which draws nothing and
		// reports nothing.
		for (const id of [undefined, "default", "ocean", "nope", "constructor"]) {
			const resolved = themeFor(id);
			for (const key of ["running", "elapsed", "idle", "track"] as const) {
				assert.equal(typeof resolved[key], "string", `theme ${String(id)} has no ${key}`);
			}
		}
	});
});

describe("the gesture pulse", () => {
	/** The pulse is the only circle carrying an opacity of its own. */
	const pulses = (svg: string): boolean => /<circle[^>]*opacity="0\.9"/.test(svg);

	it("appears only when asked for", () => {
		assert.ok(!pulses(renderRing({ ...base, remainingFraction: 0.5 })));
		assert.ok(pulses(renderRing({ ...base, remainingFraction: 0.5, flash: true })));
	});

	it("stays inside the box it is drawn in, at every size", () => {
		for (const size of [88, KEY_SIZE]) {
			const svg = renderRing({ ...base, remainingFraction: 0.5, flash: true, size });
			const circle = svg.match(
				/<circle cx="[\d.]+" cy="[\d.]+" r="([\d.]+)"[^>]*stroke-width="([\d.]+)"[^>]*opacity="0\.9"/
			);
			assert.ok(circle !== null, `no pulse found at ${size}px`);

			const outer = Number(circle[1]) + Number(circle[2]) / 2;
			assert.ok(outer < size / 2, `the pulse reaches ${outer} of a ${size / 2} half-width and would be clipped`);
		}
	});

	it("sits clear of the arc rather than on top of it", () => {
		const svg = renderRing({ ...base, remainingFraction: 0.5, flash: true });
		const circle = svg.match(/r="([\d.]+)"[^>]*opacity="0\.9"/);

		// The arc is radius 36 with a 9px stroke, so its outer edge is at 40.5.
		assert.ok(Number(circle?.[1]) > 40.5, "a pulse drawn over the arc reads as a thicker arc, not an event");
	});

	it("still shows during the warning blink, when the arc itself is being dimmed", () => {
		const svg = renderRing({ ...base, remainingFraction: 0.1, dimmed: true, flash: true });
		assert.ok(pulses(svg), "the one moment feedback matters most must not be the moment it disappears");
	});

	it("reaches the progress-bar layout as well as the ring", () => {
		// It did not, for a while. The bar layout draws `renderGlyph`, which had no pulse — so on that
		// display winding the dial produced no flash at all, and the only acknowledgement left was the
		// word on the bottom line, which is the half you have to stop and read.
		const glyph = (flash: boolean): string =>
			renderGlyph({ ...base, remainingFraction: 0.5, status: "running", flash, size: 52 });

		assert.ok(!pulses(glyph(false)), "the glyph should be quiet when nothing has just happened");
		assert.ok(pulses(glyph(true)), "the bar layout gets no pulse, so a dial wound on it says nothing");
	});

	it("stays inside the glyph's own box, which is smaller than the ring's", () => {
		// The bar layout draws the glyph at 52px, not 88. The pulse is placed from the arc's outer
		// edge, so it scales with everything else — but the box it has to stay inside scales too, and
		// that is the check.
		const svg = renderGlyph({ ...base, remainingFraction: 0.5, status: "running", flash: true, size: 52 });
		const circle = svg.match(
			/<circle cx="[\d.]+" cy="[\d.]+" r="([\d.]+)"[^>]*stroke-width="([\d.]+)"[^>]*opacity="0\.9"/
		);
		assert.ok(circle !== null, "no pulse found on the glyph");

		const outer = Number(circle[1]) + Number(circle[2]) / 2;
		assert.ok(outer < 26, `the pulse reaches ${outer} of a 26px half-width and would be clipped`);
	});
});

describe("the key face", () => {
	const key = { ...base, remainingFraction: 0.5, value: "5:00", caption: "20m", accent: false };

	it("is a single well-formed svg at the key's own size", () => {
		const svg = renderKey(key);
		assert.match(svg, new RegExp(`^<svg [^>]*width="${KEY_SIZE}" height="${KEY_SIZE}"`));
		assert.match(svg, /<\/svg>$/);
		assert.equal(svg.match(/<svg /g)?.length, 1, "the ring and the text must be one image, not two nested ones");
	});

	it("draws the clock and the caption itself, since setTitle can be taken away by the user", () => {
		const svg = renderKey(key);
		assert.ok(svg.includes(">5:00</text>"));
		assert.ok(svg.includes(">20m</text>"));
	});

	it("leaves the middle clear, so nothing is drawn behind the digits", () => {
		const paused = renderKey({ ...key, status: "paused", caption: "paused" });
		assert.ok(!paused.includes("<rect "), "the pause glyph belongs to the dial, where there is room for it");
	});

	it("colours the caption only when it is reporting something, not merely labelling", () => {
		assert.match(
			renderKey({ ...key, accent: true }),
			new RegExp(`fill="${palette.running}"[^>]*>20m</text>`),
			"a gesture or a pause takes the ring's own colour"
		);
		assert.match(renderKey({ ...key, accent: false }), /fill="#9A9AA0"[^>]*>20m<\/text>/, "a plain label stays grey");
	});

	it("omits the caption line entirely when there is nothing to say", () => {
		assert.equal(renderKey({ ...key, caption: "" }).match(/<text /g)?.length, 1);
	});

	it("escapes anything a label could contain, since svg is xml", () => {
		const svg = renderKey({ ...key, caption: "a & b <c>" });
		assert.ok(svg.includes("a &amp; b &lt;c&gt;"));
		assert.ok(!svg.includes("<c>"), "an unescaped angle bracket would break the whole image");
	});

	it("shrinks the caption so it stays inside the ring rather than running under it", () => {
		// The ring closes in at the caption's height, leaving roughly 88px across — a caption that
		// overruns that is drawn straight through the ring's stroke.
		for (const caption of ["20m", "paused", "next · 40m", "1h 10m 10s", "×10/10", "reset"]) {
			const width = (caption.length * keyCaptionFontSize(caption)) / 2;
			assert.ok(width <= 90, `"${caption}" needs about ${Math.round(width)}px and would foul the ring`);
		}
	});

	it("shrinks the clock as it gets longer, so an hour-long timer still fits the key", () => {
		assert.ok(keyValueFontSize("5:00") > keyValueFontSize("1:10:10"));
		assert.ok(keyValueFontSize("59:59") > keyValueFontSize("10:00:00"));
		assert.equal(keyValueFontSize("wildly too long"), keyValueFontSize("123456789"), "anything unexpected floors");
	});
});

describe("the centre of the ring", () => {
	const MARK = "M0 100";
	const middle = { ...base, remainingFraction: 0.5, logo: true };

	/** Two bars is a pause; one square is done; a triangle is running. */
	const rects = (svg: string): number => svg.match(/<rect /g)?.length ?? 0;
	const triangles = (svg: string): number => svg.match(/<path d="M [\d.]+ [\d.]+ L .* Z"/g)?.length ?? 0;

	it("shows the mark on an idle clock, which is the one state with nothing to report", () => {
		assert.ok(renderRing({ ...middle, status: "idle" }).includes(MARK));
	});

	it("keeps the mark switchable off even when idle", () => {
		assert.ok(!renderRing({ ...middle, status: "idle", logo: false }).includes(MARK));
	});

	it("shows the state instead of the mark on every state that has one", () => {
		// The bug this closes: the mark used to be drawn on running, idle and elapsed alike and then
		// silently swapped for a pause glyph, so it appeared and vanished for reasons that looked
		// random from the outside. An idle clock shows the mark; every other state shows itself.
		for (const status of ["running", "paused", "elapsed"] as const) {
			assert.ok(!renderRing({ ...middle, status }).includes(MARK), `the mark must not be drawn on a ${status} clock`);
		}
	});

	it("draws a distinct glyph for each of the three states", () => {
		assert.equal(triangles(renderRing({ ...middle, status: "running" })), 1, "running is a triangle");
		assert.equal(rects(renderRing({ ...middle, status: "paused" })), 2, "a pause glyph is two bars");
		assert.equal(rects(renderRing({ ...middle, status: "elapsed" })), 1, "done is one square");
	});

	it("shows the state whether the mark is switched on or off", () => {
		for (const status of ["running", "paused", "elapsed"] as const) {
			for (const logo of [true, false]) {
				const svg = renderRing({ ...middle, status, logo });
				assert.ok(rects(svg) + triangles(svg) > 0, `${status} lost its glyph with logo=${logo}`);
			}
		}
	});

	it("keeps the key's middle clear, since its clock is drawn there", () => {
		for (const status of ["idle", "running", "paused", "elapsed"] as const) {
			const svg = renderRing({ ...middle, status, hollow: true });
			assert.equal(rects(svg) + triangles(svg), 0, `${status} drew a glyph behind the key's digits`);
			assert.ok(!svg.includes(MARK));
		}
	});
});

describe("the glyph on its own, for the progress-bar layout", () => {
	it("says exactly what the ring's middle says, with no ring around it", () => {
		// One source for both layouts, so the bar view and the ring view cannot come to disagree
		// about what a paused timer looks like.
		for (const status of ["idle", "running", "paused", "elapsed"] as const) {
			const state = { ...base, remainingFraction: 0.5, status, logo: true };
			const inRing = renderRing(state);
			const alone = renderGlyph(state);

			assert.ok(!alone.includes("<circle"), "a bare glyph draws no track and no pulse");
			assert.ok(!alone.includes("A "), "and no arc");

			const glyph = alone.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
			if (glyph !== "") {
				assert.ok(inRing.includes(glyph), `${status} draws a different glyph in the two layouts`);
			}
		}
	});

	it("scales to whatever box the layout gives it", () => {
		const state = { ...base, remainingFraction: 0.5, status: "running" as const };
		assert.ok(renderGlyph({ ...state, size: 52 }).includes('width="52"'));
		assert.ok(renderGlyph({ ...state, size: 88 }).includes('width="88"'));
	});
});
