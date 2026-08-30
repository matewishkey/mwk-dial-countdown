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
 * The **plugin icon** — the one Stream Deck shows in its preferences — is the countdown ring itself,
 * with the mark inside it. Elgato's guideline asks that it "accurately portray what your plugin
 * does", and a monogram portrays the organisation instead. It is not a drawing of the ring either:
 * it calls `renderRing` from `src/render.ts`, the very function the plugin draws with, so the icon
 * and the running plugin are the same artwork by construction rather than by promise.
 *
 *   npm run icons
 *
 * The mark is likewise not redrawn: it is read from `assets/mwk-mark.svg`, the brand's own file.
 * SVG is written directly; the PNGs are rasterised by headless Chromium — the copy Playwright
 * already keeps on this machine — rather than ImageMagick, which is not installed and is not
 * something a repo should require for `npm run icons` to work.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderRing } from "../src/render.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IMGS = resolve(ROOT, "com.matewishkey.dial-countdown-v2.sdPlugin/imgs");

/** Brand red, as `THEMES.mwk.running` in src/render.ts. Hardware only. */
const RED = "#E2342B";

/** The one colour the Stream Deck application will accept from an icon. */
const WHITE = "#FFFFFF";

/**
 * The brand's own mark file, supplied as artwork rather than transcribed.
 *
 * Read rather than copied in, so the icons cannot drift from it. The old version of this file
 * carried the path data as a literal with a comment promising it matched — a promise nothing
 * checked. `test/mark.test.ts` holds `src/render.ts` to the same file, which is the copy that has
 * to stay a literal because it is bundled into the plugin.
 */
const MARK_FILE = resolve(ROOT, "assets/mwk-mark.svg");
const { paths: MARK_PATHS, width: MARK_WIDTH, height: MARK_HEIGHT, stroke: MARK_STROKE } = readMark();

/**
 * Pulls the geometry out of the mark file: the two stroked paths, the weight they are drawn at, and
 * the extent of the artwork inside its padded viewBox. Throws rather than guessing — a silently
 * mis-parsed mark would produce plausible-looking artwork that is subtly the wrong shape.
 */
function readMark() {
	const svg = readFileSync(MARK_FILE, "utf8");

	const paths = [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
	const box = svg.match(/viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/);
	const stroke = svg.match(/stroke-width="([\d.]+)"/);

	if (paths.length !== 2 || box === null || stroke === null) {
		throw new Error(`${MARK_FILE} is not the shape this expects: 2 paths, a viewBox and a stroke-width`);
	}

	// The viewBox is the artwork plus equal padding on every side, so the artwork's own extent is the
	// box less twice the padding — and the padding is the box's own negative origin.
	const [, x, y, w, h] = box.map(Number);
	return { paths, width: w + x * 2, height: h + y * 2, stroke: Number(stroke[1]), pad: -x };
}

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
	const stroke = MARK_STROKE;
	// Half the stroke would only just clear the round caps; the extra 2 keeps the mark off the edge
	// of the tile, which is what the application crops to. It reproduces the mark file's own padding.
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

/**
 * The plugin icon: the countdown ring, on brand red, with the mark inside it.
 *
 * Every part of this is the plugin's own. `renderRing` is the function that draws the touchscreen
 * four times a second, called here with a white palette instead of a theme — so the ring's weight,
 * its radius, the arc's round caps and the mark's placement inside it are not measurements copied
 * into an icon, they are the same code path. Change the ring and the icon changes with it.
 *
 * `idle` because that is the state whose middle holds the mark; anything else would draw a play
 * triangle or a pause glyph, which is the right behaviour on hardware and the wrong picture for an
 * icon. The arc is left three-quarters full: a complete circle reads as a doughnut, and a countdown
 * ring that has visibly counted is the thing being portrayed.
 *
 * The track is painted in the background red so it disappears. It has to be *some* colour — the ring
 * always draws one — and matching the ground is how you get none.
 */
const ICON_REMAINING = 0.78;

/** The ring is drawn at 84 of the icon's 100 units, which leaves it 8 units of air on every side. */
const ICON_RING_SIZE = 84;

function ringIcon(size) {
	const inset = round(((100 - ICON_RING_SIZE) / 2) * (size / 100));
	const ring = renderRing({
		remainingFraction: ICON_REMAINING,
		status: "idle",
		dimmed: false,
		logo: true,
		size: round(ICON_RING_SIZE * (size / 100)),
		palette: { running: WHITE, elapsed: WHITE, idle: WHITE, track: RED }
	});

	// Unwrap the ring's own <svg> and re-anchor its contents inside the red tile.
	const inner = ring
		.replace(/^<svg[^>]*>/, "")
		.replace(/<\/svg>$/, "")
		// The mark is drawn slightly held back on hardware, so it sits behind a themed ring rather
		// than competing with it. An icon has no ring to defer to and no theme to sit behind, and at
		// 256px the same restraint just reads as a pink smudge on the red. Full white here.
		.replace(/(<g transform="[^"]*")\s+opacity="[\d.]+"/, '$1 opacity="1"');

	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
		`<rect width="${size}" height="${size}" fill="${RED}"/>` +
		`<g transform="translate(${inset} ${inset})">${inner}</g>` +
		`</svg>`
	);
}

const written = [];

function writeSvg(path, svg) {
	const file = resolve(IMGS, path);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${svg}\n`);
	written.push(path);
}

/**
 * Finds the Chromium that Playwright keeps in its own cache.
 *
 * Newest first, since several versions accumulate there. Returns `null` rather than throwing so the
 * SVG icons — which need no rasteriser at all — are still written on a machine without one.
 */
function findChromium() {
	const cache = resolve(homedir(), ".cache/ms-playwright");
	if (!existsSync(cache)) {
		return null;
	}

	const builds = readdirSync(cache)
		.filter((name) => /^chromium-\d+$/.test(name))
		.sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));

	for (const build of builds) {
		const binary = resolve(cache, build, "chrome-linux64/chrome");
		if (existsSync(binary)) {
			return binary;
		}
	}
	return null;
}

const CHROMIUM = findChromium();

/**
 * Rasterises an SVG at both the standard and the high-DPI size, on a transparent background.
 *
 * `--default-background-color=00000000` is what keeps it transparent; without it Chromium paints its
 * own white page behind the artwork, and a white box is exactly what the guidelines reject.
 */
function writePng(path, size, svgFor) {
	for (const [name, edge] of [
		[path, size],
		[path.replace(/\.png$/, "@2x.png"), size * 2]
	]) {
		const file = resolve(IMGS, name);
		mkdirSync(dirname(file), { recursive: true });

		if (CHROMIUM === null) {
			console.warn(`! could not rasterise ${name} — no Chromium found under ~/.cache/ms-playwright`);
			continue;
		}

		const scratch = `${file}.svg`;
		writeFileSync(scratch, svgFor(edge));
		try {
			execFileSync(
				CHROMIUM,
				[
					"--headless",
					"--disable-gpu",
					"--no-sandbox",
					"--hide-scrollbars",
					"--default-background-color=00000000",
					"--force-device-scale-factor=1",
					`--window-size=${edge},${edge}`,
					`--screenshot=${file}`,
					`file://${scratch}`
				],
				{ stdio: "ignore" }
			);
			written.push(name);
		} catch (err) {
			console.warn(`! could not rasterise ${name}: ${err.message}`);
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
writePng("actions/timer/encoder-icon.png", 72, (edge) =>
	bareMark(WHITE).replace("<svg ", `<svg width="${edge}" height="${edge}" `)
);

// ── The plugin's own icon, in Stream Deck's preferences and on the Marketplace listing ───────────

// 256 and 512, which is what the manifest's `Icon` resolves to. Elgato's guideline asks that this
// one "accurately portray what your plugin does" — so it is the ring, not the monogram.
writePng("plugin/marketplace.png", 256, ringIcon);

// ── On the hardware: brand red ───────────────────────────────────────────────────────────────────

// The static key face, shown before the plugin draws its first frame and in the Stream Deck canvas.
// A key is mostly mark, since at 72px the square is the tile's own edge and needs less emphasis.
writePng("actions/key/key.png", 72, (edge) => boxedMark(RED, edge, edge * 0.52));
writePng("actions/timer/key.png", 72, (edge) =>
	bareMark(RED).replace("<svg ", `<svg width="${edge}" height="${edge}" `)
);

console.log(`Wrote:\n  ${written.join("\n  ")}`);
