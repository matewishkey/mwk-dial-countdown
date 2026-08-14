#!/usr/bin/env node
/**
 * Draws the key action's artwork.
 *
 * The dial action's icon is the bare Mate Wish Key mark. The key action needs to be told apart from
 * it in a list where the two sit next to each other, while still obviously belonging to the same
 * plugin — so it is the same mark, inside the rounded square that says "this one goes on a button".
 *
 * The mark itself is not redrawn here: it is the same path data `src/render.ts` uses for the ring,
 * so the artwork and the running plugin cannot drift apart.
 *
 *   node tools/make-icons.mjs
 *
 * Writes SVG directly. The PNGs it also needs are rasterised by `convert` (ImageMagick), which is
 * the one external tool involved; without it the SVGs are still written and the PNGs are skipped.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "com.matewishkey.dial-countdown.sdPlugin/imgs/actions/key");

/** Brand red, as `THEMES.mwk.running` in src/render.ts. */
const RED = "#E2342B";

/** The mark, as published in the brand's own `mwk-mark.svg` — kept identical to src/render.ts. */
const MARK_PATHS = ["M0 100 L23.09 0 L46.17 100 L69.26 0 L69.26 100", "M69.26 100 L118.03 0"];
const MARK_WIDTH = 118.03;
const MARK_HEIGHT = 100;

/**
 * One icon, at a given canvas size.
 *
 * @param size Edge length of the square.
 * @param markWidth How wide the mark is drawn. Larger fills the tile; smaller leaves the rounded
 * square room to read as a shape in its own right, which is what carries "key" at 20px.
 */
function icon(size, markWidth) {
	const scale = size / 100;
	const round = (n) => Math.round(n * 100) / 100;

	const inset = round(6 * scale);
	const side = round(88 * scale);
	const radius = round(20 * scale);
	const border = round(7 * scale);

	const markScale = markWidth / MARK_WIDTH;
	const x = round(size / 2 - (MARK_WIDTH * markScale) / 2);
	const y = round(size / 2 - (MARK_HEIGHT * markScale) / 2);
	const stroke = round(14 * markScale);

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
		`<rect x="${inset}" y="${inset}" width="${side}" height="${side}" rx="${radius}" ` +
			`fill="none" stroke="${RED}" stroke-width="${border}"/>`,
		`<g transform="translate(${x} ${y}) scale(${round(markScale)})">`,
		MARK_PATHS.map(
			(d) =>
				`<path d="${d}" stroke="${RED}" stroke-width="${round(stroke / markScale)}" ` +
				`stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
		).join(""),
		`</g>`,
		`</svg>`
	].join("");
}

mkdirSync(OUT, { recursive: true });

// The actions list icon, scalable — Stream Deck renders it small, so the mark is kept modest and
// the rounded square is given room to be the thing you actually recognise.
const listIcon = icon(100, 46);
writeFileSync(resolve(OUT, "icon.svg"), listIcon + "\n");

// The static key face, shown before the plugin draws its first frame and in the Stream Deck canvas.
// A key is mostly mark, since at 72px the square is the tile's own edge and needs less emphasis.
const written = ["icon.svg"];
for (const [name, size] of [
	["key.png", 72],
	["key@2x.png", 144]
]) {
	const svg = icon(size, size * 0.52);
	const svgPath = resolve(OUT, `${name}.svg`);
	writeFileSync(svgPath, svg);

	try {
		execFileSync("convert", ["-background", "none", svgPath, "-resize", `${size}x${size}`, resolve(OUT, name)]);
		written.push(name);
	} catch {
		console.warn(`! could not rasterise ${name} — is ImageMagick's \`convert\` installed?`);
	}
	execFileSync("rm", ["-f", svgPath]);
}

console.log(`Wrote ${written.join(", ")} to imgs/actions/key/`);
