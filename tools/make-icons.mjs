#!/usr/bin/env node
/**
 * Draws every icon the plugin ships, from one mark.
 *
 * Two rules decide the colour, and they pull in opposite directions, which is why this is generated
 * rather than drawn by hand:
 *
 * - **Anything shown inside the Stream Deck application is white.** The category icon and the action
 *   list icons must be a monochromatic `#FFFFFF` stroke on a transparent background, with no colour
 *   and no solid backing — Elgato's plugin guidelines are explicit, and a Marketplace submission was
 *   rejected on exactly this. `Encoder.Icon` is white too, which is a judgement call rather than a
 *   quoted rule: the guidelines word the colour requirement as "action list icons", and this is not
 *   one — it is sized like a key icon, 72/144. But the manifest reference calls it the image
 *   "displayed in the Stream Deck application in the circular canvas that represents the dial", and
 *   the reviewer asked for the icons "inside the Stream Deck app". White cannot fail that reading;
 *   red might.
 * - **Anything shown on the hardware keeps the brand red.** A key's `States[].Image` is the face of
 *   the button on the deck itself, which the guidelines do not constrain and where the red is the
 *   whole point.
 *
 * The dial action is the bare mark; the key action is the same mark inside the rounded square that
 * says "this one goes on a button", so the two are told apart in a list where they sit side by side.
 *
 *   node tools/make-icons.mjs
 *
 * The mark itself is not redrawn here: it is the same path data `src/render.ts` uses for the ring,
 * so the artwork and the running plugin cannot drift apart. SVG is written directly; the PNGs are
 * rasterised by `convert` (ImageMagick), the one external tool involved, and skipped without it.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IMGS = resolve(ROOT, "com.matewishkey.dial-countdown.sdPlugin/imgs");

/** Brand red, as `THEMES.mwk.running` in src/render.ts. Hardware only. */
const RED = "#E2342B";

/** The one colour the Stream Deck application will accept from an icon. */
const WHITE = "#FFFFFF";

/** The mark, as published in the brand's own `mwk-mark.svg` — kept identical to src/render.ts. */
const MARK_PATHS = ["M0 100 L23.09 0 L46.17 100 L69.26 0 L69.26 100", "M69.26 100 L118.03 0"];
const MARK_WIDTH = 118.03;
const MARK_HEIGHT = 100;

const round = (n) => Math.round(n * 100) / 100;

function strokes(colour, width) {
	return MARK_PATHS.map(
		(d) =>
			`<path d="${d}" fill="none" stroke="${colour}" stroke-width="${width}" ` +
			`stroke-linecap="round" stroke-linejoin="round"/>`
	).join("");
}

/**
 * The bare mark on its own, padded so the round caps are not clipped.
 *
 * Sized by `viewBox` rather than by pixels, since this is what Stream Deck scales down to 20px in
 * the action list and up again for a high-DPI display.
 */
function bareMark(colour) {
	const stroke = 9.5;
	// Half the stroke would only just clear the round caps; the extra 2 keeps the mark off the edge
	// of the tile, which is what the application crops to.
	const pad = stroke / 2 + 2;
	return (
		`<svg role="img" xmlns="http://www.w3.org/2000/svg" ` +
		`viewBox="${-pad} ${-pad} ${round(MARK_WIDTH + pad * 2)} ${round(MARK_HEIGHT + pad * 2)}" fill="none">` +
		`<title>Mate Wish Key</title>${strokes(colour, stroke)}</svg>`
	);
}

/**
 * The mark inside a rounded square.
 *
 * @param size Edge length of the square canvas.
 * @param markWidth How wide the mark is drawn. Larger fills the tile; smaller leaves the rounded
 * square room to read as a shape in its own right, which is what carries "key" at 20px.
 */
function boxedMark(colour, size, markWidth) {
	const scale = size / 100;
	const markScale = markWidth / MARK_WIDTH;

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
		`<rect x="${round(6 * scale)}" y="${round(6 * scale)}" width="${round(88 * scale)}" ` +
			`height="${round(88 * scale)}" rx="${round(20 * scale)}" fill="none" ` +
			`stroke="${colour}" stroke-width="${round(7 * scale)}"/>`,
		`<g transform="translate(${round(size / 2 - markWidth / 2)} ` +
			`${round(size / 2 - (MARK_HEIGHT * markScale) / 2)}) scale(${round(markScale)})">`,
		// Inside the scaled group, so this is the weight in the mark's own coordinates — the group's
		// own scale takes it down to match the square's border rather than swamping it.
		strokes(colour, 14),
		`</g>`,
		`</svg>`
	].join("");
}

const written = [];

function writeSvg(path, svg) {
	const file = resolve(IMGS, path);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${svg}\n`);
	written.push(path);
}

/** Rasterises an SVG at both the standard and the high-DPI size, on a transparent background. */
function writePng(path, size, svgFor) {
	for (const [name, edge] of [
		[path, size],
		[path.replace(/\.png$/, "@2x.png"), size * 2]
	]) {
		const file = resolve(IMGS, name);
		mkdirSync(dirname(file), { recursive: true });
		const scratch = `${file}.svg`;
		writeFileSync(scratch, svgFor(edge));
		try {
			execFileSync("convert", ["-background", "none", scratch, "-resize", `${edge}x${edge}`, file]);
			written.push(name);
		} catch {
			console.warn(`! could not rasterise ${name} — is ImageMagick's \`convert\` installed?`);
		}
		rmSync(scratch, { force: true });
	}
}

// ── Inside the Stream Deck application: white, monochromatic, transparent ─────────────────────────

// The group heading in the action list, and the dial action's own row beside it.
writeSvg("plugin/category-icon.svg", bareMark(WHITE));
writeSvg("actions/timer/icon.svg", bareMark(WHITE));

// The key action's row. The rounded square is what tells it from the dial action at 20px.
writeSvg("actions/key/icon.svg", boxedMark(WHITE, 100, 46));

// The circular canvas standing in for the dial in the application's layout view.
writePng("actions/timer/encoder-icon.png", 72, (edge) => bareMark(WHITE).replace("<svg ", `<svg width="${edge}" height="${edge}" `));

// ── On the hardware: brand red ───────────────────────────────────────────────────────────────────

// The static key face, shown before the plugin draws its first frame and in the Stream Deck canvas.
// A key is mostly mark, since at 72px the square is the tile's own edge and needs less emphasis.
writePng("actions/key/key.png", 72, (edge) => boxedMark(RED, edge, edge * 0.52));
writePng("actions/timer/key.png", 72, (edge) => bareMark(RED).replace("<svg ", `<svg width="${edge}" height="${edge}" `));

console.log(`Wrote:\n  ${written.join("\n  ")}`);
