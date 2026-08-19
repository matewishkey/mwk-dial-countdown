/**
 * Holds the mark drawn inside the ring to the brand's own artwork file.
 *
 * `assets/mwk-mark.svg` is supplied artwork, not something transcribed here. `tools/make-icons.mjs`
 * reads it directly, so the icons cannot drift from it — but `src/render.ts` cannot, because it is
 * bundled into the plugin and has no filesystem to read from at runtime. Its copy has to be a
 * literal, and a literal that promises in a comment to match another file is a promise nothing
 * checks. This is the check.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { renderRing, themeFor } from "../src/render.ts";

const MARK_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/mwk-mark.svg");

/** The stroked paths in the brand's mark, in the order it draws them. */
function markPaths(): string[] {
	const paths = [...readFileSync(MARK_FILE, "utf8").matchAll(/\sd="([^"]+)"/g)].map((match) => match[1]);
	assert.equal(paths.length, 2, "the mark is an M stroke and a K stroke; anything else means the file changed shape");
	return paths;
}

function ringWithLogo(): string {
	return renderRing({ remainingFraction: 1, status: "idle", dimmed: false, flash: false, palette: themeFor("default"), logo: true });
}

describe("the mark drawn in the ring", () => {
	it("is the brand's own artwork, path for path", () => {
		const drawn = ringWithLogo();

		for (const path of markPaths()) {
			assert.ok(
				drawn.includes(`d="${path}"`),
				`src/render.ts no longer draws the mark from assets/mwk-mark.svg — missing "${path}"`
			);
		}
	});

	it("is only drawn when the logo is asked for", () => {
		const without = renderRing({
			remainingFraction: 1,
			status: "idle",
			dimmed: false,
			flash: false,
			palette: themeFor("default"),
			logo: false
		});

		for (const path of markPaths()) {
			assert.ok(!without.includes(`d="${path}"`), "the logo setting must actually remove it");
		}
	});

	it("is drawn in the ring's colour, never the brand red baked into the artwork file", () => {
		// The file ships red because that is how the brand publishes it. In the ring the mark takes
		// whatever colour the theme is using, so a red literal leaking through would be a bug.
		assert.match(readFileSync(MARK_FILE, "utf8"), /#e2342b/i, "precondition: the source artwork is red");

		const drawn = ringWithLogo();
		const marks = drawn.slice(drawn.indexOf(markPaths()[0]));
		assert.ok(!/#e2342b/i.test(marks), "the mark must be recoloured by the theme, not drawn in the source red");
	});
});
