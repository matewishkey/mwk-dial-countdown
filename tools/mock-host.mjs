#!/usr/bin/env node
/**
 * A stand-in for the Stream Deck application.
 *
 * A plugin is only ever a Node process that Stream Deck launches with four arguments — `-port`,
 * `-pluginUUID`, `-registerEvent` and `-info` — and which then dials back to `ws://127.0.0.1:<port>`.
 * Nothing in that handshake is proprietary, so this script can play the other end of it: it starts a
 * WebSocket server, spawns the built plugin against it, answers the registration, and then lets you
 * fire real dial events from the keyboard while it draws whatever the plugin sends back.
 *
 * That covers every part of this plugin except how the touchscreen actually looks, which needs
 * hardware. Run it with `npm run mock`, or `npm run demo` for a scripted, non-interactive pass.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { WebSocketServer } from "ws";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_UUID = "com.matewishkey.dial-countdown-v2";
const ACTION_UUID = `${PLUGIN_UUID}.countdown`;
const KEY_ACTION_UUID = `${PLUGIN_UUID}.key`;
const PLUGIN_DIR = resolve(ROOT, `${PLUGIN_UUID}.sdPlugin`);
const PLUGIN_ENTRY = resolve(PLUGIN_DIR, "bin/plugin.js");

const DEVICE_ID = "MOCK-DEVICE-0001";
const CONTEXT = "mock-context-dial-0";
const KEY_CONTEXT = "mock-context-key-0";
const PORT = Number(process.env.MOCK_PORT ?? 34567);

/**
 * Every ✓/✗ the scripted pass prints, counted.
 *
 * **The ✗ used to be decorative.** This file ended in an unconditional `process.exit(0)`, nothing read
 * the marks back, and `release.mjs` judges the demo step by its exit code alone — so a pass that was
 * wall-to-wall ✗ was recorded as a gate passed, and the release page said "all gates passed". v3.4.2
 * shipped that way, carrying two failures nobody was shown. `npm run check` does not run the demo at
 * all, so this is the only place those checks are ever executed.
 *
 * Counted by watching what is printed rather than by threading a helper through all thirty-odd call
 * sites. That is deliberate: the rule "a line that reports a verdict is a verdict" is total, so a
 * check added later is counted without anyone remembering to opt it in — which is exactly how the
 * marks came to be ignored in the first place.
 */
/**
 * The three words a press can be answered with. Which one you get depends on the state the step
 * before left behind, so a check that a press was HEARD asserts membership rather than a literal —
 * two checks here have gone green or red for the wrong reason by pinning one of these.
 */
const PRESS_WORDS = ["start", "resume", "pause"];

const tally = { passed: 0, failed: 0 };
const emit = console.log.bind(console);
console.log = (...args) => {
	const text = args.map(String).join(" ");
	if (text.includes("\u2713")) {
		tally.passed += 1;
	} else if (text.includes("\u2717")) {
		tally.failed += 1;
	}
	emit(...args);
};

/** `--demo` replays a fixed gesture sequence and exits, for CI and for showing the thing off. */
const DEMO = process.argv.includes("--demo");

/**
 * The key's double-press window, mirrored so the scripted pass can time a press past it rather than
 * inside it. The truth is `DOUBLE_PRESS_MS` in `src/gestures.ts`; this file is plain JavaScript and
 * cannot import it, so it is named here rather than left inline as a literal nobody would connect to
 * the source when it moves. The touchscreen's own window is not needed: every tap the pass makes is
 * either well inside it or a second apart.
 */
const KEY_WINDOW_MS = 500;

/**
 * How long the key holds a press before calling it a hold, mirrored for the same reason. The truth is
 * `LONG_PRESS_MS` in `src/gestures.ts`.
 */
const LONG_PRESS_MS = 600;

/** Mirrors the RegistrationInfo the real application passes in via `-info`. */
const INFO = {
	application: {
		font: "Inter",
		language: "en",
		platform: "mac",
		platformVersion: "14.0.0",
		version: "7.1.0.0"
	},
	colors: {
		buttonMouseOverBackgroundColor: "#464646FF",
		buttonPressedBackgroundColor: "#303030FF",
		buttonPressedBorderColor: "#646464FF",
		buttonPressedTextColor: "#969696FF",
		highlightColor: "#0092FFFF"
	},
	devicePixelRatio: 2,
	devices: [
		{
			id: DEVICE_ID,
			name: "Mock Stream Deck +",
			// DeviceType.StreamDeckPlus
			type: 7,
			size: { columns: 4, rows: 2 }
		}
	],
	plugin: {
		uuid: PLUGIN_UUID,
		version: readFileSync(resolve(PLUGIN_DIR, "manifest.json"), "utf8")
			? JSON.parse(readFileSync(resolve(PLUGIN_DIR, "manifest.json"), "utf8")).Version
			: "0.1.0.0"
	}
};

/** Latest touchscreen state, as reported by the plugin's setFeedback calls. */
const screen = {
	title: "—",
	value: "—",
	label: "",
	finish: "",
	indicator: 0,
	ring: 0,
	colour: "",
	barFill: "",
	font: 0,
	opacity: 1,
	glyph: "",
	layout: "(default)",
	flash: false
};

/** How many times the plugin has raised Stream Deck's own "that failed" alert. */
let alertCount = 0;

/**
 * Latest key face, recovered from the SVG the plugin sends to setImage. The key draws its own text
 * rather than using setTitle, so everything it says is in that one image and can be read back here.
 */
const key = { value: "—", caption: "", colour: "", flash: false, glyph: "" };
let settings = {};
let socket = null;

/** Counts frames the plugin pushed, so the periodic re-assert can be observed rather than assumed. */
let feedbackCount = 0;

const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });

wss.on("connection", (ws) => {
	socket = ws;
	ws.on("message", (raw) => handlePluginMessage(JSON.parse(raw.toString())));
	ws.on("close", () => {
		socket = null;
	});
});

const plugin = spawn(
	process.execPath,
	[
		PLUGIN_ENTRY,
		"-port",
		String(PORT),
		"-pluginUUID",
		PLUGIN_UUID,
		"-registerEvent",
		"register",
		"-info",
		JSON.stringify(INFO)
	],
	// The SDK resolves manifest.json and its log directory from process.cwd(), so the plugin must be
	// launched from inside the .sdPlugin folder — exactly as the Stream Deck application does.
	{ stdio: ["ignore", "pipe", "pipe"], cwd: PLUGIN_DIR }
);

plugin.stdout.on("data", (chunk) => process.stderr.write(dim(`  plugin › ${chunk}`)));
plugin.stderr.on("data", (chunk) => process.stderr.write(dim(`  plugin ! ${chunk}`)));
plugin.on("exit", (code) => {
	console.log(`\nPlugin exited with code ${code}`);
	process.exit(code ?? 0);
});

/**
 * Handles a command sent *by* the plugin. Only the handful this plugin actually uses are
 * implemented; anything else is logged so an unexpected call is visible rather than silently eaten.
 */
function handlePluginMessage(message) {
	switch (message.event) {
		case "register":
			// The plugin has registered. Put a dial *and* a key on screen, as a real device would —
			// the two actions are separate registrations and must not interfere with one another.
			send({
				event: "willAppear",
				action: ACTION_UUID,
				context: CONTEXT,
				device: DEVICE_ID,
				payload: {
					controller: "Encoder",
					coordinates: { column: 0, row: 0 },
					isInMultiAction: false,
					settings
				}
			});
			send({
				event: "willAppear",
				action: KEY_ACTION_UUID,
				context: KEY_CONTEXT,
				device: DEVICE_ID,
				payload: {
					controller: "Keypad",
					coordinates: { column: 1, row: 0 },
					isInMultiAction: false,
					state: 0,
					settings
				}
			});
			draw();
			if (DEMO) {
				runDemo().catch((err) => {
					console.error(err);
					process.exit(1);
				});
			}
			break;

		case "setFeedback": {
			feedbackCount += 1;
			const payload = message.payload ?? {};
			if (payload.title !== undefined) screen.title = payload.title;
			if (typeof payload.value === "string") screen.value = payload.value;
			if (payload.label !== undefined) screen.label = payload.label;
			if (payload.finish !== undefined) screen.finish = payload.finish;
			if (payload.value !== undefined && typeof payload.value === "object") {
				screen.value = payload.value.value ?? screen.value;
				screen.font = payload.value.font?.size ?? screen.font;
			}
			if (payload.indicator !== undefined) {
				screen.indicator = typeof payload.indicator === "object" ? payload.indicator.value : payload.indicator;
				screen.colour = payload.indicator?.bar_fill_c ?? screen.colour;
				// Held apart from `colour`, which the ring also writes: the bar layout has no ring, so
				// this is the only place its fill can be read back from.
				screen.barFill = payload.indicator?.bar_fill_c ?? screen.barFill;
			}
			// The ring layout draws a ring; the bar layout draws the same state glyph on its own.
			for (const key of ["ring", "glyph"]) {
				if (typeof payload[key] === "string") {
					readRing(payload[key]);
				}
			}
			draw();
			break;
		}

		case "setFeedbackLayout":
			screen.layout = message.payload?.layout ?? "(unknown)";
			draw();
			break;

		case "setSettings":
			settings = message.payload ?? {};
			draw();
			break;

		case "setImage":
			readKey(message.payload?.image ?? "");
			draw();
			break;

		case "setTitle":
			break;

		case "showAlert":
			alertCount += 1;
			break;

		default:
			console.log(dim(`  ← ${message.event}`));
	}
}

function send(message) {
	socket?.send(JSON.stringify(message));
}

/**
 * Names whatever the plugin drew in the middle of the ring.
 *
 * Order matters: the brand mark is two `<path>` elements and the play triangle is one, so the mark
 * has to be ruled out first or a logo would be read as a play glyph.
 */
function glyphIn(svg) {
	if (svg.includes("M0 100")) {
		return "logo";
	}
	// The bell is one path and no rects, so none of the counts below would name it — they would
	// quietly report "nothing in the middle", which is the answer a broken renderer gives too.
	if (svg.includes('d="M12 3.4 C8.8 ')) {
		return "bell";
	}
	const rects = svg.match(/<rect /g)?.length ?? 0;
	if (rects === 2) {
		return "pause";
	}
	if (rects === 1) {
		return "done";
	}
	return /<path d="M [\d.]+ [\d.]+ L .* Z"/.test(svg) ? "play" : "";
}

/**
 * Reads back what the plugin drew.
 *
 * The ring arrives as an SVG data URI, so rather than trusting the plugin's own arithmetic the
 * harness recovers the fraction from the geometry: the arc's end point, converted back to an angle
 * about the centre. A ring that renders wrong therefore shows up here as a wrong number.
 */
function readRing(dataUri) {
	const [, encoded] = dataUri.split(",");
	if (encoded === undefined) {
		return;
	}
	const svg = Buffer.from(encoded, "base64").toString("utf8");

	const colour = svg.match(/stroke="(#[0-9A-Fa-f]{6})" stroke-width="\d+" stroke-linecap/);
	if (colour !== null) {
		screen.colour = colour[1];
	}

	const opacity = svg.match(/stroke-linecap="round" fill="none" opacity="([\d.]+)"/);
	screen.opacity = opacity === null ? 1 : Number(opacity[1]);
	screen.glyph = glyphIn(svg);
	screen.flash = PULSE.test(svg);

	// Two arcs is the full-circle special case; no path at all means nothing is drawn.
	const arcs = svg.match(/A /g)?.length ?? 0;
	if (arcs === 0) {
		screen.ring = 0;
		return;
	}
	if (arcs >= 2) {
		screen.ring = 100;
		return;
	}

	const end = svg.match(/A 36 36 0 [01] 1 ([\d.]+) ([\d.]+)/);
	if (end === null) {
		return;
	}

	const [x, y] = [Number(end[1]), Number(end[2])];
	const centre = 44;
	let angle = Math.atan2(x - centre, centre - y);
	if (angle < 0) {
		angle += 2 * Math.PI;
	}
	screen.ring = Math.round((angle / (2 * Math.PI)) * 100);
}

/**
 * The gesture pulse is the only circle drawn with an opacity of its own, so its presence in the
 * markup is exactly the assertion "the ring acknowledged that gesture on this frame".
 */
const PULSE = /<circle[^>]*opacity="0\.9"/;

/**
 * Reads back the key face. Everything the key says is drawn into its image — there is no title to
 * inspect — so the two text runs in the SVG are the clock and the line underneath it, in that order.
 */
function readKey(image) {
	const svg = image.startsWith("data:") ? Buffer.from(image.split(",")[1] ?? "", "base64").toString("utf8") : image;

	const texts = [...svg.matchAll(/<text[^>]*fill="([^"]+)"[^>]*>([^<]*)<\/text>/g)];
	key.value = texts[0]?.[2] ?? key.value;
	key.caption = texts[1]?.[2] ?? "";
	key.flash = PULSE.test(svg);

	// The state colour is the arc's, not the clock's — the clock is always white.
	const arc = svg.match(/stroke="(#[0-9A-Fa-f]{6})" stroke-width="[\d.]+" stroke-linecap/);
	key.colour = arc === null ? key.colour : arc[1];
	key.glyph = svg.includes("<rect ") ? "pause" : "";
}

/** Sends an event as though the user had touched the hardware. */
const gestures = {
	rotate: (ticks, pressed = false) =>
		send({
			event: "dialRotate",
			action: ACTION_UUID,
			context: CONTEXT,
			device: DEVICE_ID,
			payload: { controller: "Encoder", coordinates: { column: 0, row: 0 }, settings, ticks, pressed }
		}),
	dialDown: () =>
		send({
			event: "dialDown",
			action: ACTION_UUID,
			context: CONTEXT,
			device: DEVICE_ID,
			payload: { controller: "Encoder", coordinates: { column: 0, row: 0 }, settings }
		}),
	dialUp: () =>
		send({
			event: "dialUp",
			action: ACTION_UUID,
			context: CONTEXT,
			device: DEVICE_ID,
			payload: { controller: "Encoder", coordinates: { column: 0, row: 0 }, settings }
		}),
	touch: (hold = false) =>
		send({
			event: "touchTap",
			action: ACTION_UUID,
			context: CONTEXT,
			device: DEVICE_ID,
			payload: { controller: "Encoder", coordinates: { column: 0, row: 0 }, settings, hold, tapPos: [100, 50] }
		}),
	/** A page or profile flip: the control leaves the screen and comes back. */
	dialDisappear: () =>
		send({
			event: "willDisappear",
			action: ACTION_UUID,
			context: CONTEXT,
			device: DEVICE_ID,
			payload: { controller: "Encoder", coordinates: { column: 0, row: 0 }, isInMultiAction: false, settings }
		}),
	dialAppear: () =>
		send({
			event: "willAppear",
			action: ACTION_UUID,
			context: CONTEXT,
			device: DEVICE_ID,
			payload: { controller: "Encoder", coordinates: { column: 0, row: 0 }, isInMultiAction: false, settings }
		}),
	keyDown: () =>
		send({
			event: "keyDown",
			action: KEY_ACTION_UUID,
			context: KEY_CONTEXT,
			device: DEVICE_ID,
			payload: { controller: "Keypad", coordinates: { column: 1, row: 0 }, isInMultiAction: false, state: 0, settings }
		}),
	keyUp: () =>
		send({
			event: "keyUp",
			action: KEY_ACTION_UUID,
			context: KEY_CONTEXT,
			device: DEVICE_ID,
			payload: { controller: "Keypad", coordinates: { column: 1, row: 0 }, isInMultiAction: false, state: 0, settings }
		})
};

/** Pushes a settings change, as the property inspector would — to both controls, as it would. */
function applySettings(patch) {
	settings = { ...settings, ...patch };
	send({
		event: "didReceiveSettings",
		action: ACTION_UUID,
		context: CONTEXT,
		device: DEVICE_ID,
		payload: { controller: "Encoder", coordinates: { column: 0, row: 0 }, isInMultiAction: false, settings }
	});
	send({
		event: "didReceiveSettings",
		action: KEY_ACTION_UUID,
		context: KEY_CONTEXT,
		device: DEVICE_ID,
		payload: { controller: "Keypad", coordinates: { column: 1, row: 0 }, isInMultiAction: false, settings }
	});
}

/** The magnitude of a step toast: "+10m" and "-10m" are the same step in opposite directions. */
function size(toast) {
	return String(toast).replace(/^[+-]/, "");
}

/** Spins the dial repeatedly, the way a wrist does. */
/**
 * Waits for the screen to reach a state, rather than for a duration.
 *
 * A check that sleeps a fixed number of milliseconds and then samples is betting on how long the
 * plugin, the socket and this process will take — and the auto-reset check lost that bet often
 * enough to print ✗ on a plugin that was working, for as long as nobody was reading the ✗.
 *
 * @returns whether the state arrived before the deadline, so the caller can say which it was.
 */
async function until(predicate, timeoutMs = 8_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) {
			return true;
		}
		await wait(50);
	}
	return false;
}

async function spin(events, ticks, gapMs) {
	for (let i = 0; i < events; i++) {
		gestures.rotate(ticks);
		await wait(gapMs);
	}
}

/**
 * A press is down-then-up; how long you hold decides what the plugin makes of it. Resolves only
 * once the release has been sent, so a caller that awaits it is looking at the settled result.
 */
function press(holdMs) {
	gestures.dialDown();
	return new Promise((done) =>
		setTimeout(() => {
			gestures.dialUp();
			done();
		}, holdMs)
	);
}

/** The same, for the key. A hold is decided by the plugin's own threshold, not by the hardware. */
function keyPress(holdMs) {
	gestures.keyDown();
	return new Promise((done) =>
		setTimeout(() => {
			gestures.keyUp();
			done();
		}, holdMs)
	);
}

/**
 * Two taps inside the double-tap window. The gap has to be shorter than the plugin's own window, or
 * this is simply two single taps, which is the very thing being tested. 90 ms is inside both the
 * touchscreen's 250 ms and the key's {@link KEY_WINDOW_MS}.
 */
async function doubleTap(tap, gapMs = 90) {
	await tap();
	await wait(gapMs);
	await tap();
}

// ── Scripted pass ────────────────────────────────────────────────────────────

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Walks the whole gesture vocabulary once, printing the touchscreen after each step. Every
 * assertion a human would make by eye on real hardware is visible in this transcript.
 */
async function runDemo() {
	const steps = [
		["fresh install → defaults, and they get written back", async () => {}],
		[
			"hold the screen → 20m; preset cycling lives on the touchscreen now",
			async () => {
				gestures.touch(true);
				await wait(400);
			}
		],

		// The step is your FINGER. A free turn is a second a click; a turn made with the dial pushed
		// in is a minute a click. Nothing is held between turns, so there is no mode to leave on.
		["one click → +1s", async () => gestures.rotate(1)],
		[
			"turn as much as you like, however fast → still a second a click",
			async () => {
				await spin(30, 1, 25);
				await spin(20, -1, 300);
				await spin(12, 3, 40);
				// One last single click, so the toast reports the step rather than a batch's total —
				// a three-tick event says "+3s" at the very same one-second step.
				await spin(1, 1, 200);
				console.log(`\n   after 87 clicks at three different speeds, the step is ${size(screen.finish)}`);
				console.log(
					`   ${size(screen.finish) === "1s" ? "\u2713 unchanged — a free turn is always seconds" : `\u2717 it drifted to ${screen.finish}`}`
				);
			}
		],

		[
			"push the dial IN and turn → a minute a click",
			async () => {
				await wait(1200);
				gestures.rotate(1, true);
				await wait(300);
				console.log(`\n   one pushed click reported ${screen.finish}`);
				console.log(
					`   ${screen.finish === "+1m" ? "\u2713 pushed in, and a click is a minute" : "\u2717 the push was not read"}`
				);
			}
		],

		// The whole point of the redesign: nothing survives the release. The old design set a step
		// that stayed set until you set another one, and needed a permanent label on screen saying so.
		[
			"…let go and turn again → straight back to seconds, with nothing to un-set",
			async () => {
				await wait(1200);
				await spin(1, 1, 200);
				console.log(`\n   the very next free click reported ${screen.finish}`);
				console.log(
					`   ${screen.finish === "+1s" ? "\u2713 no mode left behind" : "\u2717 a minute step stuck around"}`
				);
			}
		],

		// A press of the dial that did NOT turn it is the start/pause control — the most-used job on
		// a countdown, under the hand that is already on the dial.
		[
			"press the dial → starts the clock",
			async () => {
				await wait(1200);
				const before = screen.value;
				await press(80);
				await wait(500);
				const said = screen.finish;
				await wait(1200);
				console.log(`\n   was ${before}, press said "${said}", 1.2s later ${screen.value}`);
				console.log(
					`   ${said === "start" && screen.value !== before ? "\u2713 the dial starts it" : "\u2717 the press did not start the clock"}`
				);
			}
		],
		[
			"press again → pauses it, and the ring shows the pause glyph",
			async () => {
				await press(80);
				await wait(500);
				const said = screen.finish;
				const held = screen.value;
				await wait(1500);
				console.log(`\n   press said "${said}", glyph is "${screen.glyph}", clock ${held} then ${screen.value}`);
				console.log(
					`   ${said === "pause" && screen.glyph === "pause" && held === screen.value ? "\u2713 paused, stated, and frozen" : "\u2717 not paused as intended"}`
				);
			}
		],
		[
			"a PUSHED turn's release does nothing — otherwise every minute-nudge would start the clock",
			async () => {
				await wait(400);
				const before = screen.value;
				gestures.dialDown();
				await wait(60);
				gestures.rotate(2, true);
				await wait(60);
				gestures.dialUp();
				await wait(500);
				console.log(`\n   was ${before}, after push-turn-release ${screen.value}, said "${screen.finish}"`);
				console.log(
					`   ${screen.finish === "+2m" ? "\u2713 read as a turn, not as a press" : "\u2717 the release was also taken as a press"}`
				);
			}
		],
		// The knob has a hold, and it is the touchscreen's: put the clock right, then move on. The
		// threshold is measured on RELEASE, never by a timer running while the finger is down —
		// pushing the dial in is how you ask for minutes, so anything firing mid-press would go off
		// in the pause before the wind started. The push-turn-release step above is the guard on
		// that half, and it runs first.
		[
			"holding the knob puts the clock right — the touchscreen's hold, on the dial",
			async () => {
				await wait(1200);
				gestures.dialDown();
				await wait(1500);
				gestures.dialUp();
				await wait(500);
				console.log(`\n   held the dial 1.5s, then let go: it said "${screen.finish}"`);
				console.log(
					`   ${screen.finish.startsWith("preset") || screen.finish.startsWith("next") ? "\u2713 the hold restored the preset, as it does from the screen" : `\u2717 a hold of the knob did something else: "${screen.finish}"`}`
				);
			}
		],

		// ...and the short press still means what it always did. The positive control for the step
		// above: without it, a threshold of zero would look exactly like a working hold.
		[
			"a quick press of the knob is still just start/pause",
			async () => {
				await wait(600);
				gestures.dialDown();
				await wait(80);
				gestures.dialUp();
				await wait(500);
				console.log(`\n   pressed and released inside 100ms: it said "${screen.finish}"`);
				console.log(
					`   ${PRESS_WORDS.includes(screen.finish) ? "\u2713 below the threshold, so it is a press and nothing more" : `\u2717 a quick press was taken as something else: "${screen.finish}"`}`
				);
			}
		],

		// Turning never writes to the preset list. The label says so — "from 20m" — for as long as the
		// two disagree, and a hold of the SCREEN is what closes the gap.
		//
		// **It sets up its own drift rather than inheriting it from an earlier step.** It used to
		// inherit it, and when the knob gained a hold — which restores the preset, that being its
		// whole job — the drift was gone by the time this ran and the step reported a failure that
		// belonged to nothing. A step that depends on where the one before it happened to leave
		// things fails for reasons with no connection to what it is checking.
		//
		// **The double tap comes first, and it is not decoration: only an *idle* clock can drift.**
		// `Timer.adjust` moves the remaining time on a running or paused clock and leaves
		// `durationMs` alone, and `drifted` compares `durationMs` against the preset — so winding a
		// running clock produces no drift at all, and this step quietly tested nothing. A reset is
		// used rather than a hold because a hold of a clock already sitting on its preset *advances*
		// to the next one, which would make the set-up depend on the very state it is establishing.
		[
			"hold the screen → puts the dialled clock back on its preset, rather than moving on",
			async () => {
				gestures.touch(false);
				await wait(80);
				gestures.touch(false);
				await wait(500);
				gestures.rotate(3);
				await wait(400);
				const drifted = screen.label;
				gestures.touch(true);
				await wait(400);
				console.log(`\n   label while drifted: "${drifted}", clock after one hold: ${screen.value}`);
				console.log(
					`   ${drifted.startsWith("from ") && screen.value === "20:00" ? "\u2713 restored, and the preset was never overwritten" : "\u2717 the preset did not survive being dialled"}`
				);
			}
		],
		[
			"…hold again → NOW it moves on, because there is nothing left to put back",
			async () => {
				gestures.touch(true);
				await wait(400);
			}
		],

		// Reported from the hardware: a running clock is not sitting on its preset either, so the hold
		// puts it right before it moves on.
		[
			"start it running, then hold the screen → STOPS and restores; it does not jump to the next preset",
			async () => {
				gestures.touch(false);
				await wait(700);
				await wait(1200);
				const running = screen.value;

				gestures.touch(true);
				await wait(400);
				const after = screen.value;

				await wait(1500);
				console.log(`\n   running at ${running}, one hold later ${after}, 1.5s on ${screen.value}`);
				console.log(
					`   ${after === "30:00" && screen.value === after ? "\u2713 stopped and back to full, on the same preset" : "\u2717 moved on, or did not stop"}`
				);
			}
		],

		// The long clock has to fit its box.
		[
			"set 1:10:10 → font shrinks to fit",
			async () => {
				applySettings({ presets: [[4210]], presetIndex: 0 });
				await wait(300);
			}
		],
		[
			"…running",
			async () => {
				gestures.touch(false);
				await wait(300);
			}
		],

		// Pause is now stated by a glyph, not by colour alone. The bottom line names the gesture.
		["one tap → paused, pause glyph in the ring, bottom line says so", async () => gestures.touch(false)],
		["one tap → running again", async () => gestures.touch(false)],

		// A tap is held back for a quarter-second in case a second one is coming, and the touchscreen sits
		// directly above the dials — so a brush of the glass and a press of the dial are one reach of the
		// hand often enough to matter. Both mean toggle, so the pair arrived as start *then* pause and the
		// clock landed back exactly where it began. On a finished timer that is the state that looks
		// broken, and pressing again cannot get out of it: an even number of toggles always lands back
		// where it started. A press on the dial now settles whatever the glass was still deciding.
		[
			"a brush of the glass and a press of the dial → one start, not start then pause",
			async () => {
				applySettings({ presets: [[600]], presetIndex: 0 });
				await wait(400);

				const stopped = screen.value;
				gestures.touch(false);
				await wait(200);
				await press(80);
				await wait(300);
				const word = screen.finish;
				await wait(1200);

				console.log(`\n   the pair was answered with "${word}", and the clock went ${stopped} → ${screen.value}`);
				console.log(
					`   ${screen.value !== stopped ? "\u2713 one gesture, one outcome" : `\u2717 they cancelled out — still sitting on ${screen.value}`}`
				);
			}
		],

		// A rotation carrying no detents used to cost you the press, and cost it silently. The guard that
		// stops a push-and-turn's release from also toggling the clock was armed by *any* rotation while
		// the dial was down, `ticks: 0` included — so the release did nothing, and with no detents there
		// was no clock movement, no word and no pulse to show for it either. The dial simply looked as
		// though it were not wired up. Elgato documents neither a floor on `ticks` nor the ordering of
		// these events, so the plugin is not entitled to assume this cannot happen.
		[
			"a press with a no-detent rotation inside it → still a press",
			async () => {
				applySettings({ presets: [[600]], presetIndex: 0 });
				await wait(400);

				// Asserted on the *word*, and on the word being one of the three a press can answer
				// with. Two weaker versions of this check passed against a build that still had the
				// bug. "Did the clock move" is wrong because a press answers `start`, `resume` or
				// `pause` depending on what the case before it left behind, and one of those three
				// freezes the clock rather than moving it. "Was there a word at all" is wrong because
				// the swallowed press was not silent after all — the zero-tick rotation it was eaten by
				// announced itself as `+0s`, which is a word, and the check went green on it.
				const before = screen.value;
				gestures.dialDown();
				await wait(40);
				gestures.rotate(0, true);
				await wait(40);
				gestures.dialUp();
				await wait(300);
				const word = screen.finish;

				console.log(`\n   the press was answered with "${word}", on a clock reading ${before}`);
				console.log(
					`   ${PRESS_WORDS.includes(word) ? "\u2713 the press survived a zero-tick rotation" : `\u2717 swallowed — "${word}" is the rotation talking, not the press`}`
				);
			}
		],

		// An action is torn down and rebuilt on every page and profile flip, and the rebuilt one starts
		// with no memory of a press already in progress — but the COUNTDOWN is parked and handed back,
		// so a release arriving after the flip landed on a real clock. Holding the dial in is how you
		// ask for minutes, so the gesture interrupted here is a common one, not a contrived one.
		[
			"flip away mid-press, flip back, let go → the stray release is not a press",
			async () => {
				applySettings({ presets: [[600]], presetIndex: 0 });
				await wait(400);
				const stopped = screen.value;

				gestures.dialDown();
				await wait(60);
				gestures.dialDisappear();
				await wait(200);
				gestures.dialAppear();
				await wait(400);
				gestures.dialUp();
				await wait(500);

				const started = await until(() => screen.value !== stopped, 1500);
				console.log(`\n   clock was ${stopped}, and after the stray release it is ${screen.value}`);
				console.log(
					`   ${started ? `\u2717 the release started the clock — it is now ${screen.value}` : "\u2713 a release with no press behind it does nothing"}`
				);
			}
		],

		// A frame lost on the way — Stream Deck discards feedback sent alongside a layout switch —
		// would sit on screen for ever on a display that is static by nature. So the current frame is
		// re-asserted every couple of seconds even when nothing has changed.
		[
			"an untouched, idle timer still re-sends its frame, so a dropped one cannot stick",
			async () => {
				applySettings({ presets: [[3600]], presetIndex: 0, theme: "default" });
				await wait(1000);

				const before = feedbackCount;
				await wait(5000);
				const sent = feedbackCount - before;

				console.log(`\n   frames in 5s with nothing happening: ${sent}`);
				console.log(
					`   ${sent >= 2 && sent <= 12 ? "\u2713 re-asserting, and not spamming" : "\u2717 " + (sent < 2 ? "silent — a dropped frame would stick" : "far too chatty")}`
				);
			}
		],

		// There are no haptics on this hardware, so the ring pulsing is the whole of the physical
		// acknowledgement. It has to be there on the frame after the gesture, and gone shortly after.
		[
			"every gesture pulses the ring — on immediately, off again within a few frames",
			async () => {
				await wait(400);
				gestures.rotate(1);
				await wait(60);
				const during = screen.flash;
				await wait(500);
				const after = screen.flash;
				console.log(
					`\n   pulse right after the tick: ${during ? "yes" : "no"}, half a second later: ${after ? "yes" : "no"}`
				);
				console.log(`   ${during && !after ? "\u2713 pulses, then clears" : "\u2717 not pulsing as intended"}`);
			}
		],

		// A reset goes to the PRESET, not to wherever the dial left the clock. It used to restore the
		// working duration, so a preset nudged once was nudged for good. 11m, because a step that
		// reuses the previous step's length inherits its clock instead of loading a fresh one.
		[
			"two taps on a DIALLED clock → back to the preset, not to the dialled length",
			async () => {
				// Only what this step needs. `applySettings` MERGES into the shared settings, so a key set
				// here is set for every later step — adding `soundId: "none"` silenced the alarm check
				// four steps down, which then reported a silent failure that was this step's doing.
				applySettings({ presets: [[660]], presetIndex: 0 });
				await wait(400);
				await spin(3, 1, 200); // +3s, so the clock and the preset disagree
				await wait(400);
				const dialled = screen.value;
				const label = screen.label;

				await doubleTap(() => gestures.touch(false));
				await wait(700);

				console.log(`\n   dialled to ${dialled} (label "${label}"), after a double tap: ${screen.value}`);
				console.log(
					`   ${dialled === "11:03" && screen.value === "11:00" ? "\u2713 back to the preset — the dialled 11:03 is gone, as it should be" : "\u2717 the reset went to the dialled length, not the configured one"}`
				);
				console.log(
					`   ${screen.label === "11m" ? "\u2713 and nothing is left to put right" : `\u2717 label still reads "${screen.label}"`}`
				);
			}
		],

		// The three screen gestures, each doing something the other two do not.
		[
			"two taps → back to full, and NOT started",
			async () => {
				await wait(400);
				await spin(3, -1, 400);
				await wait(400);
				await doubleTap(() => gestures.touch(false));
				await wait(600);

				const settled = screen.value;
				await wait(1500);
				console.log(`\n   clock 1.5s after the double tap: ${settled} then ${screen.value}`);
				console.log(`   ${settled === screen.value ? "\u2713 reset and stayed stopped" : "\u2717 it started itself"}`);
			}
		],
		[
			"hold the screen → next preset, LOADED BUT NOT STARTED",
			async () => {
				applySettings({ presets: [[4210], [600]], presetIndex: 0 });
				await wait(400);
				gestures.touch(false);
				await wait(500);
				gestures.touch(true);
			}
		],
		[
			"…and the clock stays put, proving it did not start itself",
			async () => {
				const settled = screen.value;
				await wait(1500);
				console.log(`\n   clock 1.5s apart: ${settled} then ${screen.value}`);
				console.log(`   ${settled === screen.value ? "\u2713 stopped" : "\u2717 it started on its own"}`);
			}
		],

		// The bug: adjusting the clock used to look like it triggered the warning.
		[
			"fade on at 5 min, on a 5 min preset — must NOT fade immediately",
			async () => {
				applySettings({ presets: [[300]], presetIndex: 0, warnEnabled: true, warnSeconds: 300 });
				await wait(300);
				gestures.touch(false);
				await wait(600);
			}
		],
		[
			"fade at 20s on a 20s preset, run into the window → shades, one colour",
			async () => {
				applySettings({ presets: [[20]], presetIndex: 0, warnEnabled: true, warnSeconds: 20 });
				await wait(300);
				gestures.touch(false);
				await wait(11_000);

				const seen = [];
				for (let i = 0; i < 8; i++) {
					await wait(260);
					seen.push(`${screen.colour}@${screen.opacity}`);
				}
				const colours = new Set(seen.map((s) => s.split("@")[0]));
				const opacities = new Set(seen.map((s) => s.split("@")[1]));
				console.log(`\n   sampled: ${seen.join(" ")}`);
				console.log(`   ${colours.size === 1 ? "\u2713 one colour throughout" : "\u2717 colour changed"}`);
				console.log(`   ${opacities.size > 1 ? "\u2713 shaded and unshaded" : "\u2717 not fading"}`);
			}
		],

		// Label off, logo on, brand theme.
		[
			"label hidden, logo on, brand theme",
			async () => {
				applySettings({
					presets: [[600]],
					presetIndex: 0,
					warnEnabled: false,
					showLabel: false,
					showLogo: true,
					theme: "mwk"
				});
				await wait(300);
			}
		],

		// A named timer. The label says what it is rather than how long it is, and keeps saying so once
		// the dial has wound the clock off the preset — which is the half a name could have taken away.
		[
			"titled `Tea`, then dialled off its preset",
			async () => {
				applySettings({ presets: [[1200]], presetIndex: 0, title: "Tea", showLabel: true, theme: "default" });
				await wait(300);
				gestures.rotate(3, false);
				await wait(300);
			}
		],

		// Sound repeats. On Linux no player exists, so this proves it does not crash — and, since the
		// sound genuinely cannot play here, that a failed alarm raises Stream Deck's own alert rather
		// than finishing in a silence indistinguishable from not having finished at all.
		[
			"alarm set to play 3 times, 2s timer → runs out",
			async () => {
				const before = alertCount;
				applySettings({ presets: [[2]], presetIndex: 0, title: "", soundRepeat: 3, showLabel: true });
				await wait(300);
				gestures.touch(false);
				await wait(2600);
				console.log(
					`\n   no audio player on this platform, so the alarm cannot sound: showAlert raised ${alertCount - before}x`
				);
				console.log(
					`   ${alertCount > before ? "\u2713 a failed alert is reported, not swallowed" : "\u2717 silent failure"}`
				);
			}
		],

		// A preset with several steps, and the fact that it stops at the end of the list. A timer that
		// loops for ever is a nuisance.
		[
			"two-step preset, 2s each → first step",
			async () => {
				applySettings({ presets: [[2, 2]], presetIndex: 0, soundId: "none" });
				await wait(300);
				gestures.touch(false);
				await wait(2400);
			}
		],
		["…second step", async () => wait(2200)],
		// Two steps is two RUNS. The repeat count this replaced was compared against repeats *made*
		// rather than runs *finished*, which quietly ran every repeating timer one lap more than told.
		[
			"…and STOPS at the end of the list, saying `done`, rather than looping for ever or going quiet",
			async () => {
				await wait(3000);
				const settled = screen.value;
				// The ring layout's heading is the `label` slot; `title` belongs to the bar layout.
				const said = screen.label;
				await wait(2000);
				console.log(`\n   clock 2s apart: ${settled} then ${screen.value}; label reads "${said}"`);
				console.log(`   ${settled === screen.value ? "\u2713 stopped" : "\u2717 still running"}`);
				console.log(
					`   ${said.includes("\u00d72/2") && said.includes("done") ? "\u2713 and it says so — a finished job no longer looks like its own last step" : "\u2717 nothing on screen distinguishes finished from still-running"}`
				);
				console.log(
					`   ${screen.glyph === "done" ? "\u2713 the ring shows the done glyph, not the brand mark" : `\u2717 the middle of the ring shows "${screen.glyph}"`}`
				);
			}
		],

		// The bug: the tally was left where the spent run put it, so starting the timer again gave a
		// run that could never move on once — under a display still reading ×2/2.
		[
			"…and starting it again is a FRESH run, back on the first step",
			async () => {
				gestures.touch(false);
				await wait(700);
				const restarted = screen.label;
				await wait(2400);
				console.log(`\n   label on restart: "${restarted}", one step later: "${screen.label}"`);
				console.log(
					`   ${restarted.includes("\u00d71/2") && !restarted.includes("done") && screen.label.includes("\u00d72/2") ? "\u2713 counter reset, and it moves on again" : "\u2717 the spent tally stuck"}`
				);
			}
		],

		// Auto-reset: the other end of a finished timer. A next step starts at once; this waits for the
		// whole job to be over and then clears the clock, so a page you left has a timer on it rather
		// than a used one.
		[
			"auto-reset on, 1s wait, 3s preset → runs out, says `done`, then clears itself",
			async () => {
				// Three seconds, not the two the step above used: an unchanged duration is not a reload,
				// so a 2s preset here would leave the previous step's clock running rather than start one.
				applySettings({
					presets: [[3]],
					presetIndex: 0,
					showLogo: true,
					soundId: "none",
					autoResetEnabled: true,
					autoResetSeconds: 1
				});
				await wait(300);
				gestures.touch(false);

				// Waited for, not slept through. This used to sample 3.4 s after the tap and call that
				// the finish; when anything upstream ran slow the clock still had a second on it, and
				// the check reported a timer that had failed to clear while it was in fact still
				// counting down. It printed ✗ in the v3.4.2 release run for exactly that reason.
				const finished = await until(() => screen.label.includes("done") && screen.glyph === "done");
				const atFinish = `${screen.value} / "${screen.label}" / glyph "${screen.glyph}"`;

				const cleared = await until(() => screen.glyph === "logo" && screen.value === "0:03");

				console.log(`\n   at the finish: ${atFinish}`);
				console.log(`   after the auto-reset: ${screen.value} / "${screen.label}" / glyph "${screen.glyph}"`);
				console.log(
					`   ${finished && cleared ? "\u2713 done was shown, then the clock went back to full and idle on its own" : `\u2717 ${finished ? "it showed done but never cleared" : "it never reached done at all"}`}`
				);
			}
		],

		// The middle of the ring: the mark on an idle clock, the state on every other. It used to be
		// the mark on three states out of four and a pause glyph on the fourth, which is why the logo
		// looked like it came and went at random.
		[
			"the ring's middle shows the STATE, and the brand mark only on an idle clock",
			async () => {
				applySettings({ presets: [[600]], presetIndex: 0, repeat: false, showLogo: true, layout: "ring" });
				await wait(600);
				const whenIdle = screen.glyph;

				await press(80);
				await wait(600);
				const whenRunning = screen.glyph;

				await press(80);
				await wait(600);
				const whenPaused = screen.glyph;

				console.log(`\n   idle: "${whenIdle}", running: "${whenRunning}", paused: "${whenPaused}"`);
				console.log(
					`   ${whenIdle === "logo" && whenRunning === "play" && whenPaused === "pause" ? "\u2713 one glyph per state, and the mark only where there is nothing to report" : "\u2717 the middle of the ring is not following the state"}`
				);
			}
		],

		// The progress-bar view used to be Stream Deck's built-in $B1, whose item keys are published
		// nowhere — so the bar colour was being sent hopefully and never landed. Both layouts are the
		// plugin's own files now.
		[
			"the progress-bar layout takes the theme, and carries the same state glyph",
			async () => {
				// A different duration from the step before, so the clock is reloaded and genuinely
				// idle rather than left paused — otherwise the "idle" sample is a paused one.
				applySettings({ presets: [[900]], presetIndex: 0, layout: "bar", theme: "neon" });
				await wait(800);
				const idleFill = screen.barFill;
				const idleGlyph = screen.glyph;

				await press(80);
				await wait(800);

				console.log(
					`\n   layout "${screen.layout}", bar idle ${idleFill} (glyph "${idleGlyph}") → running ${screen.barFill} (glyph "${screen.glyph}")`
				);
				console.log(
					`   ${idleFill === "#7C4DFF" && screen.barFill === "#00E5FF" ? "\u2713 the bar is coloured, and follows both the theme and the state" : "\u2717 the bar did not take the theme"}`
				);
				console.log(
					`   ${idleGlyph === "logo" && screen.glyph === "play" ? "\u2713 and the bar view says the same thing the ring view does" : "\u2717 the two layouts disagree"}`
				);
			}
		]
	];

	// ── The key, which has the same three gestures minus the turning ──────────
	const keySteps = [
		[
			"key: one press → starts",
			async () => {
				applySettings({ presets: [[600], [1200]], presetIndex: 0, repeat: false, soundId: "none", showLabel: true });
				await wait(400);
				await keyPress(60);
			}
		],
		[
			"key: one press → pauses; the caption names the gesture, then settles on the state",
			async () => {
				await keyPress(60);
				// A press does not act on release: it is held back for the control's whole double-press
				// window first, in case a second one is coming. Sampling inside that window reads the
				// state from before the gesture, which looks like a plugin that ignored the press.
				await wait(KEY_WINDOW_MS + 300);
				const said = key.caption;
				// The toast lasts 900 ms and expires between render ticks, so the state it falls back to
				// can be up to one 250 ms frame late. Sample past that, not on the nose.
				await wait(1400);
				console.log(`\n   caption right after: "${said}", once the toast expires: "${key.caption}"`);
				console.log(
					`   ${said === "pause" && key.caption === "paused" ? "\u2713 gesture then state" : "\u2717 caption not settling"}`
				);
			}
		],
		// The clock starts AND the preset advances, from one press-and-hold. taps.press() is only ever
		// reached from keyUp, so a pending press starts at the PREVIOUS release while the hold starts
		// at the NEXT press — the pending one always expired first, and the cancel in the hold's own
		// callback was dead code. Only the built bundle can show this: KeyCountdown's handlers carry
		// an @action decorator, and driving the built bundle over a socket is a different claim from
		// driving the classes in-process, which `test/actions-live.test.ts` now also does.
		[
			"key: a press, then a press-and-hold → the hold wins, and only the hold",
			async () => {
				applySettings({ presets: [[540], [1200]], presetIndex: 0 });
				await wait(500);
				// Reset first, so the clock is idle and sitting on its preset however the step before
				// this one left it — an unchanged duration is not a reload, so applySettings alone does
				// not guarantee it, and a hold on a clock that is NOT on its preset restores instead of
				// advancing. That is what made the first version of this check fail on working code.
				await doubleTap(() => keyPress(60));
				await wait(KEY_WINDOW_MS + 400);

				// **Asserted on the words, not on where the clock ends up.** Both the right answer and
				// the wrong one land on 20:00 and stopped, because advancing a preset stops the clock —
				// so the end state cannot tell one gesture from two. Only the acknowledgement can: the
				// bug says `start` on its way past.
				const words = [];
				let last = key.caption;
				const recorder = setInterval(() => {
					if (key.caption !== last) {
						last = key.caption;
						words.push(last);
					}
				}, 40);

				await keyPress(60); // a press, left waiting to see if it had a partner
				await wait(200); // a second press begins, inside that window
				await keyPress(LONG_PRESS_MS + 250); // ...and is held
				await wait(900);
				clearInterval(recorder);

				const started = words.some((word) => PRESS_WORDS.includes(word));
				console.log(`\n   the key said, in order: ${JSON.stringify(words)}`);
				console.log(
					`   ${started ? `\u2717 two gestures from one press-and-hold: ${JSON.stringify(words)}` : "\u2713 the hold settled the press waiting behind it, and acted alone"}`
				);
			}
		],

		// onKeyDown armed a long-press timer without clearing the previous one, so a keyDown with no
		// keyUp between left a live orphan that nothing could cancel — and both handles fired, so the
		// preset advanced twice from one hold.
		[
			"key: a repeated key-down does not leave a second long-press armed",
			async () => {
				applySettings({ presets: [[300], [600], [1200]], presetIndex: 0 });
				await wait(500);
				const before = key.value;

				gestures.keyDown();
				await wait(80);
				gestures.keyDown(); // the pairing Stream Deck normally guarantees, and this must not rely on
				await wait(LONG_PRESS_MS + 400);
				gestures.keyUp();
				await wait(900);

				console.log(`\n   clock was ${before}, and after the doubled key-down it is ${key.value}`);
				console.log(
					`   ${key.value === "10:00" ? "\u2713 one hold, one preset" : `\u2717 the preset moved more than once — landed on ${key.value}`}`
				);
			}
		],

		[
			"key: two presses → back to full, and NOT started",
			async () => {
				await doubleTap(() => keyPress(60));
				await wait(600);

				const settled = key.value;
				await wait(1500);
				console.log(`\n   key clock 1.5s after the double press: ${settled} then ${key.value}`);
				console.log(`   ${settled === key.value ? "\u2713 reset and stayed stopped" : "\u2717 it started itself"}`);
			}
		],
		[
			"key: hold → next preset, loaded but not started",
			async () => {
				await keyPress(900);
				await wait(400);
			}
		],
		[
			"…and the key's clock stays put too",
			async () => {
				const settled = key.value;
				await wait(1500);
				console.log(`\n   key clock 1.5s apart: ${settled} then ${key.value}`);
				console.log(`   ${settled === key.value ? "\u2713 stopped" : "\u2717 it started on its own"}`);
			}
		]
	];

	for (const [label, run] of steps) {
		// The heading goes first, so whatever the step prints lands underneath its own heading rather
		// than under the previous step's frame. Getting this the wrong way round made the transcript
		// quoted in docs/how-it-works.md one this tool never actually emitted.
		heading(label);
		await run();
		// Long enough for the plugin's reply to land, the 250ms render loop to turn over, and the
		// 400ms settings debounce to flush — otherwise a frame shows state that is merely in flight.
		await wait(600);
		frame();
	}

	for (const [label, run] of keySteps) {
		heading(label);
		await run();
		await wait(600);
		keyFrame();
	}

	// A pass that asserted nothing is a failure, not a success — an empty tally is what a harness that
	// died early, or was refactored into silence, looks like, and it is indistinguishable from a clean
	// run by exit code alone. That is the shape this whole change exists to stop.
	const ran = tally.passed + tally.failed;
	const verdict =
		ran === 0
			? "asserted NOTHING"
			: tally.failed === 0
				? "all checks passed"
				: `${tally.failed} of ${ran} checks FAILED`;
	emit(`\nScripted pass complete — ${verdict}.\n`);

	plugin.kill();
	process.exit(tally.failed === 0 && ran > 0 ? 0 : 1);
}

// ── Keyboard driving ─────────────────────────────────────────────────────────

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY && !DEMO) {
	process.stdin.setRawMode(true);
}

process.stdin.on("keypress", (_str, key) => {
	if (key.ctrl && key.name === "c") {
		plugin.kill();
		process.exit(0);
	}

	switch (key.name) {
		case "right":
			gestures.rotate(key.shift ? 5 : 1, false);
			break;
		case "left":
			gestures.rotate(key.shift ? -5 : -1, false);
			break;
		case "up":
			gestures.rotate(1, true);
			break;
		case "down":
			gestures.rotate(-1, true);
			break;
		case "space":
			press(80);
			break;
		case "r":
			press(900);
			break;
		case "t":
			gestures.touch(false);
			break;
		case "d":
			doubleTap(() => gestures.touch(false));
			break;
		case "y":
			gestures.touch(true);
			break;
		case "k":
			keyPress(80);
			break;
		case "j":
			doubleTap(() => keyPress(60));
			break;
		case "l":
			keyPress(900);
			break;
		default:
			break;
	}
});

// ── Rendering ────────────────────────────────────────────────────────────────

const BAR_WIDTH = 34;

/** The touchscreen as the plugin last described it, drawn as a 200 × 100 stand-in. */
function screenLines() {
	// The ring layout reports how much of the ring is drawn; the bar layout reports elapsed percent.
	const isRing = screen.layout.includes("ring");
	const percent = isRing ? screen.ring : screen.indicator;
	const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * BAR_WIDTH);
	const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
	const presets = (settings.presets ?? [])
		.map((seconds, i) => {
			const label = seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`;
			return i === settings.presetIndex ? `[${label}]` : label;
		})
		.join(" ");

	const heading = screen.layout.includes("ring") ? screen.label : screen.title;

	return [
		"  ┌────────────────────────────────────┐",
		`  │ ${pad(heading, 34)} │`,
		`  │ ${pad(screen.value.padStart(18), 34)} │`,
		`  │ ${bar} │`,
		"  └────────────────────────────────────┘",
		`  │ ${pad(screen.finish, 34)} │`,
		dim(
			`   ${isRing ? "ring" : "bar "} ${String(percent).padStart(3)}%   colour ${screen.colour || "—"}` +
				`   opacity ${screen.opacity}   font ${screen.font || "—"}   centre ${screen.glyph || "—"}`
		),
		dim(`   presets: ${presets || "(not yet saved)"}`)
	];
}

function draw() {
	if (DEMO) {
		return;
	}

	const lines = [
		"",
		...screenLines(),
		"",
		...keyLines(),
		"",
		dim("   ←/→ turn: ±1s   shift+←/→ ×5   ↑/↓ push in and turn: ±1m"),
		dim("   t tap: pause/resume   d double tap: reset   y hold: put right, then next preset"),
		dim("   space press dial: start/pause   r hold the dial (the same thing — there is no long press)"),
		dim("   k press key   j double press key   l hold key   ctrl+c quit")
	];

	process.stdout.write("\x1b[2J\x1b[H" + lines.join("\n") + "\n");
}

/** Appends a labelled frame instead of repainting, so a scripted pass reads as a transcript. */
/** Announces the step about to run, so its own output appears beneath it. */
function heading(label) {
	console.log(`\n▸ ${label}`);
}

function frame() {
	console.log(screenLines().join("\n"));
}

/** Same, for a step whose point is what the key did. */
function keyFrame() {
	console.log(keyLines().join("\n"));
}

/** The key, drawn as the 144 × 144 square it is — clock, caption, and whether the ring pulsed. */
function keyLines() {
	return [
		"  ┌──────────────────┐",
		`  │ ${pad(key.value.padStart((18 + key.value.length) >> 1), 16)} │`,
		`  │ ${pad(key.caption.padStart((18 + key.caption.length) >> 1), 16)} │`,
		"  └──────────────────┘",
		dim(`   key   colour ${key.colour || "—"}   pulse ${key.flash ? "yes" : "no"}   centre ${key.glyph || "clock"}`)
	];
}

function pad(text, width) {
	const value = String(text);
	return value.length > width ? value.slice(0, width) : value.padEnd(width);
}

function dim(text) {
	return `\x1b[2m${text}\x1b[0m`;
}

console.log(`Mock Stream Deck host listening on ws://127.0.0.1:${PORT}`);
