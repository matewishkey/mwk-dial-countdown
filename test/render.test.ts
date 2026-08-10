import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { asDataUri, DEFAULT_PALETTE, renderRing, ringColour } from "../src/render.ts";

const base = { status: "running" as const, warning: false, palette: DEFAULT_PALETTE };

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
		assert.equal(ringColour({ ...base, remainingFraction: 1, status: "paused" }), DEFAULT_PALETTE.paused);
		assert.equal(ringColour({ ...base, remainingFraction: 1, status: "idle" }), DEFAULT_PALETTE.idle);
		assert.equal(ringColour({ ...base, remainingFraction: 0, status: "elapsed" }), DEFAULT_PALETTE.elapsed);
	});

	it("lets the warning colour win over running, but not over elapsed", () => {
		assert.equal(ringColour({ ...base, remainingFraction: 0.1, warning: true }), DEFAULT_PALETTE.warn);
		assert.equal(
			ringColour({ ...base, remainingFraction: 0, status: "elapsed", warning: true }),
			DEFAULT_PALETTE.elapsed,
			"a finished timer is finished, whatever the blink is doing"
		);
	});

	it("honours a custom warning colour", () => {
		const palette = { ...DEFAULT_PALETTE, warn: "#123456" };
		assert.equal(ringColour({ remainingFraction: 0.1, status: "running", warning: true, palette }), "#123456");
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
