import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	asDataUri,
	DEFAULT_PALETTE,
	KEY_SIZE,
	keyCaptionFontSize,
	keyValueFontSize,
	renderKey,
	renderRing,
	ringColour,
	themeFor,
	THEMES
} from "../src/render.ts";

const base = { status: "running" as const, dimmed: false, palette: DEFAULT_PALETTE };

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

	it("draws nothing but the track when a running timer is at zero", () => {
		const svg = renderRing({ ...base, remainingFraction: 0 });
		assert.ok(!svg.includes("<path"), "an empty ring should have no arc");
		assert.ok(svg.includes("<circle"));
	});

	it("fills the whole ring in the elapsed colour when done, rather than showing nothing", () => {
		const svg = renderRing({ ...base, remainingFraction: 0, status: "elapsed" });
		assert.equal(svg.match(/A /g)?.length, 2, "a finished timer should draw a complete ring");
		assert.ok(svg.includes(DEFAULT_PALETTE.elapsed), "and it should be the elapsed colour");
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
		assert.equal(ringColour({ ...base, remainingFraction: 1, status: "running" }), DEFAULT_PALETTE.running);
		assert.equal(ringColour({ ...base, remainingFraction: 1, status: "idle" }), DEFAULT_PALETTE.idle);
		assert.equal(ringColour({ ...base, remainingFraction: 0, status: "elapsed" }), DEFAULT_PALETTE.elapsed);
	});

	it("does not recolour on pause — the glyph states that, not the colour", () => {
		assert.equal(
			ringColour({ ...base, remainingFraction: 0.5, status: "paused" }),
			DEFAULT_PALETTE.running,
			"pausing must not change the ring's colour"
		);
	});

	it("keeps the state's own colour while blinking, and only dims it", () => {
		const lit = renderRing({ ...base, remainingFraction: 0.1 });
		const dim = renderRing({ ...base, remainingFraction: 0.1, dimmed: true });

		assert.ok(lit.includes(DEFAULT_PALETTE.running), "precondition: the lit half is the running colour");
		assert.ok(dim.includes(DEFAULT_PALETTE.running), "the dim half must be the same colour, not a different one");
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
			for (const role of ["running", "elapsed", "idle", "track"]) {
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
			const circle = svg.match(/<circle cx="[\d.]+" cy="[\d.]+" r="([\d.]+)"[^>]*stroke-width="([\d.]+)"[^>]*opacity="0\.9"/);
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
			new RegExp(`fill="${DEFAULT_PALETTE.running}"[^>]*>20m</text>`),
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
		for (const caption of ["20m", "paused", "next · 40m", "1h 10m 10s", "×10/10", "restart"]) {
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
	it("shows a pause glyph when paused, so the state is stated and not merely coloured", () => {
		const svg = renderRing({ ...base, remainingFraction: 0.5, status: "paused" });
		assert.equal(svg.match(/<rect /g)?.length, 2, "a pause glyph is two bars");
	});

	it("shows the pause glyph even when the logo is switched off", () => {
		const svg = renderRing({ ...base, remainingFraction: 0.5, status: "paused", logo: false });
		assert.ok(svg.includes("<rect "));
	});

	it("gives way to the pause glyph rather than drawing the logo too", () => {
		const svg = renderRing({ ...base, remainingFraction: 0.5, status: "paused", logo: true });
		assert.ok(!svg.includes("<path d=\"M0 100"), "the mark must not be drawn behind the pause glyph");
	});

	it("draws the logo only when asked, and only when not paused", () => {
		assert.ok(renderRing({ ...base, remainingFraction: 0.5, logo: true }).includes("M0 100"));
		assert.ok(!renderRing({ ...base, remainingFraction: 0.5, logo: false }).includes("M0 100"));
	});
});
