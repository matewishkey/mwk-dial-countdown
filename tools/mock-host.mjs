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
const PLUGIN_UUID = "com.matewishkey.dial-countdown";
const ACTION_UUID = `${PLUGIN_UUID}.countdown`;
const KEY_ACTION_UUID = `${PLUGIN_UUID}.key`;
const PLUGIN_DIR = resolve(ROOT, `${PLUGIN_UUID}.sdPlugin`);
const PLUGIN_ENTRY = resolve(PLUGIN_DIR, "bin/plugin.js");

const DEVICE_ID = "MOCK-DEVICE-0001";
const CONTEXT = "mock-context-dial-0";
const KEY_CONTEXT = "mock-context-key-0";
const PORT = Number(process.env.MOCK_PORT ?? 34567);

/** `--demo` replays a fixed gesture sequence and exits, for CI and for showing the thing off. */
const DEMO = process.argv.includes("--demo");

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
const screen = { title: "—", value: "—", label: "", finish: "", indicator: 0, ring: 0, colour: "", font: 0, opacity: 1, glyph: "", layout: "(default)", flash: false };

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
	[PLUGIN_ENTRY, "-port", String(PORT), "-pluginUUID", PLUGIN_UUID, "-registerEvent", "register", "-info", JSON.stringify(INFO)],
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
			}
			if (typeof payload.ring === "string") {
				readRing(payload.ring);
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
	screen.glyph = svg.includes("<rect ") ? "pause" : svg.includes("M0 100") ? "logo" : "";
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
	const svg = image.startsWith("data:")
		? Buffer.from(image.split(",")[1] ?? "", "base64").toString("utf8")
		: image;

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

/** Long enough with the dial untouched that the gear drops back to the first — see IDLE_RESET_MS. */
const IDLE_MS = 2_500;

/** The magnitude of a step toast: "+10m" and "-10m" are the same step in opposite directions. */
function size(toast) {
	return String(toast).replace(/^[+-]/, "");
}

/** Spins the dial repeatedly, the way a wrist does — this is what builds acceleration. */
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
 * Two taps inside the double-tap window. The gap has to be shorter than the plugin's own window
 * (250 ms) or this is simply two single taps, which is the very thing being tested.
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
		["press dial → 20m", async () => press(80)],

		// Cadence: you step in the largest unit you have already travelled. Move ten seconds and you
		// move in tens of seconds; move a minute and you move in minutes. Distance, not speed.
		["one click → +1s", async () => gestures.rotate(1)],
		["8 more slow clicks → still one second a click; nine seconds is short of ten", async () => spin(8, 1, 400)],
		[
			"the tenth click reaches ten seconds travelled → so now ten seconds a click",
			async () => {
				await spin(1, 1, 200);
				const tenth = screen.finish;
				await spin(1, 1, 200);
				console.log(`\n   tenth click: ${tenth}, eleventh: ${screen.finish}`);
				console.log(
					`   ${tenth === "+1s" && screen.finish === "+10s" ? "\u2713 the click that gets you there is the last fine one" : "\u2717 changed at the wrong click"}`
				);
			}
		],
		["five more → a minute travelled, so a minute a click", async () => spin(5, 1, 120)],
		["nine more → ten minutes travelled, so ten minutes a click; twelve hours is in reach", async () => spin(9, 1, 100)],

		// Turning back is a correction, not progress. The step has to hold, or the correction lands in
		// a different unit from the movement it is correcting.
		[
			"…turn back the other way → the step HOLDS at whatever it had reached",
			async () => {
				// One click each way, so the two toasts are comparable — a batched event carries more
				// ticks and so a bigger total at the very same step.
				await spin(1, 1, 120);
				const forward = screen.finish;
				await spin(1, -1, 120);
				console.log(`\n   one click forward: ${forward}, one click back: ${screen.finish}`);
				console.log(
					`   ${size(forward) === size(screen.finish) ? "\u2713 same unit both ways" : "\u2717 the step changed under the correction"}`
				);
			}
		],

		// The word on screen is a readout of the NEXT click, not a note about the last one — so it has
		// to last exactly as long as it stays true. It used to fade at 900ms while the gear ran on to
		// 2s, which read as "the dial has gone back to seconds" when it had not.
		[
			"…the step readout lasts exactly as long as the gear, and they go together",
			async () => {
				await spin(1, -1, 100);
				const said = screen.finish;
				await wait(1_200);
				const midway = screen.finish;
				await wait(1_100);
				console.log(`\n   step: "${said}", 1.2s later: "${midway}", 2.3s later: "${screen.finish}"`);
				console.log(
					`   ${said !== "" && midway === said && screen.finish === "" ? "\u2713 readable while it is true, gone when it is not" : "\u2717 the word and the gear are out of step"}`
				);
			}
		],

		// ...and the DISTANCE starts over on a reversal, which is what makes hovering safe. Travel here
		// is large; travel in any one direction never reaches ten seconds, so it must never escalate.
		[
			"…hover — nine up, nine back, over and over → it never runs away",
			async () => {
				await wait(IDLE_MS);
				await spin(9, 1, 60);
				const first = screen.finish;

				for (let pass = 1; pass < 6; pass++) {
					await spin(9, pass % 2 === 0 ? 1 : -1, 60);
				}

				console.log(`\n   first click: ${first}, after 54 clicks of hovering back and forth: ${screen.finish}`);
				console.log(
					`   ${size(screen.finish) === "1s" ? "\u2713 still one second a click" : `\u2717 hovering escalated to ${screen.finish}`}`
				);
			}
		],

		// Turning never writes to the preset list. The label says so — "from 20m" — for as long as the
		// two disagree, and the first press of the dial is what closes the gap rather than moving on.
		[
			"press dial once → BACK to the preset it was dialled off, not on to the next one",
			async () => {
				await wait(2500);
				const drifted = screen.label;
				await press(80);
				await wait(300);
				console.log(`\n   label while drifted: "${drifted}", clock after one press: ${screen.value}`);
				console.log(
					`   ${drifted.startsWith("from ") && screen.value === "20:00" ? "\u2713 restored, and the preset was never overwritten" : "\u2717 the preset did not survive being dialled"}`
				);
			}
		],
		[
			"…press dial again → NOW it moves on, because there is nothing left to put back",
			async () => {
				await press(80);
				await wait(300);
			}
		],

		// The long clock has to fit its box.
		["set 1:10:10 → font shrinks to fit", async () => {
			applySettings({ presets: [4210], presetIndex: 0 });
			await wait(300);
		}],
		["…running", async () => {
			gestures.touch(false);
			await wait(300);
		}],

		// Pause is now stated by a glyph, not by colour alone. The bottom line names the gesture.
		["one tap → paused, pause glyph in the ring, bottom line says so", async () => gestures.touch(false)],
		["one tap → running again", async () => gestures.touch(false)],

		// A frame lost on the way — Stream Deck discards feedback sent alongside a layout switch —
		// would sit on screen for ever on a display that is static by nature. So the current frame is
		// re-asserted every couple of seconds even when nothing has changed.
		[
			"an untouched, idle timer still re-sends its frame, so a dropped one cannot stick",
			async () => {
				applySettings({ presets: [3600], presetIndex: 0, theme: "default" });
				await wait(1000);

				const before = feedbackCount;
				await wait(5000);
				const sent = feedbackCount - before;

				console.log(`\n   frames in 5s with nothing happening: ${sent}`);
				console.log(`   ${sent >= 2 && sent <= 12 ? "\u2713 re-asserting, and not spamming" : "\u2717 " + (sent < 2 ? "silent — a dropped frame would stick" : "far too chatty")}`);
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
				console.log(`\n   pulse right after the tick: ${during ? "yes" : "no"}, half a second later: ${after ? "yes" : "no"}`);
				console.log(`   ${during && !after ? "\u2713 pulses, then clears" : "\u2717 not pulsing as intended"}`);
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
				applySettings({ presets: [4210, 600], presetIndex: 0 });
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
		["fade on at 5 min, on a 5 min preset — must NOT fade immediately", async () => {
			applySettings({ presets: [300], presetIndex: 0, warnEnabled: true, warnSeconds: 300 });
			await wait(300);
			gestures.touch(false);
			await wait(600);
		}],
		[
			"fade at 20s on a 20s preset, run into the window → shades, one colour",
			async () => {
				applySettings({ presets: [20], presetIndex: 0, warnEnabled: true, warnSeconds: 20 });
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

		// Title off, logo on, brand theme.
		["title hidden, logo on, brand theme", async () => {
			applySettings({ presets: [600], presetIndex: 0, warnEnabled: false, showTitle: false, showLogo: true, theme: "mwk" });
			await wait(300);
		}],

		// Sound repeats. On Linux no player exists, so this proves it does not crash — and, since the
		// sound genuinely cannot play here, that a failed alarm raises Stream Deck's own alert rather
		// than finishing in a silence indistinguishable from not having finished at all.
		["alarm set to play 3 times, 2s timer → runs out", async () => {
			const before = alertCount;
			applySettings({ presets: [2], presetIndex: 0, soundEnabled: true, soundRepeat: 3, showTitle: true });
			await wait(300);
			gestures.touch(false);
			await wait(2600);
			console.log(`\n   no audio player on this platform, so the alarm cannot sound: showAlert raised ${alertCount - before}x`);
			console.log(`   ${alertCount > before ? "\u2713 a failed alert is reported, not swallowed" : "\u2717 silent failure"}`);
		}],

		// Auto-repeat, and the fact that it stops. A timer that loops for ever is a nuisance.
		["repeat on, limit 2, 2s preset → first lap", async () => {
			applySettings({ presets: [2], presetIndex: 0, repeat: true, repeatCount: 2, soundEnabled: false });
			await wait(300);
			gestures.touch(false);
			await wait(2400);
		}],
		["…second lap", async () => wait(2200)],
		[
			"…and STOPS at the limit rather than looping for ever",
			async () => {
				await wait(3000);
				const settled = screen.value;
				await wait(2000);
				console.log(`\n   clock 2s apart: ${settled} then ${screen.value}`);
				console.log(`   ${settled === screen.value ? "\u2713 stopped" : "\u2717 still running"}`);
			}
		],

		// The bug: the lap count was left where the spent run put it, so starting the timer again gave
		// a run that could never repeat once — under a display still reading ×2/2.
		[
			"…and starting it again is a FRESH run, with its laps back",
			async () => {
				gestures.touch(false);
				await wait(700);
				// The ring layout's heading is the `label` slot; `title` belongs to the bar layout.
				const restarted = screen.label;
				await wait(2400);
				console.log(`\n   label on restart: "${restarted}", one lap later: "${screen.label}"`);
				console.log(
					`   ${restarted === "2s" && screen.label.includes("\u00d71/2") ? "\u2713 counter reset, and it repeats again" : "\u2717 the spent lap count stuck"}`
				);
			}
		]
	];

	// ── The key, which has the same three gestures minus the turning ──────────
	const keySteps = [
		[
			"key: one press → starts",
			async () => {
				applySettings({ presets: [600, 1200], presetIndex: 0, repeat: false, soundEnabled: false, showTitle: true });
				await wait(400);
				await keyPress(60);
			}
		],
		[
			"key: one press → pauses; the caption names the gesture, then settles on the state",
			async () => {
				await keyPress(60);
				await wait(400);
				const said = key.caption;
				// The toast lasts 900 ms and expires between render ticks, so the state it falls back to
				// can be up to one 250 ms frame late. Sample past that, not on the nose.
				await wait(1400);
				console.log(`\n   caption right after: "${said}", once the toast expires: "${key.caption}"`);
				console.log(`   ${said === "pause" && key.caption === "paused" ? "\u2713 gesture then state" : "\u2717 caption not settling"}`);
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
		await run();
		// Long enough for the plugin's reply to land, the 250ms render loop to turn over, and the
		// 400ms settings debounce to flush — otherwise a frame shows state that is merely in flight.
		await wait(600);
		frame(label);
	}

	for (const [label, run] of keySteps) {
		await run();
		await wait(600);
		keyFrame(label);
	}

	console.log("\nScripted pass complete.\n");
	plugin.kill();
	process.exit(0);
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
		dim("   ←/→ adjust   shift+←/→ ×5   ↑/↓ press+turn 60s"),
		dim("   t tap: pause/resume   d double tap: reset   y hold: next preset"),
		dim("   space press dial: next preset   r hold dial: previous"),
		dim("   k press key   j double press key   l hold key   ctrl+c quit")
	];

	process.stdout.write("\x1b[2J\x1b[H" + lines.join("\n") + "\n");
}

/** Appends a labelled frame instead of repainting, so a scripted pass reads as a transcript. */
function frame(label) {
	console.log(`\n▸ ${label}`);
	console.log(screenLines().join("\n"));
}

/** Same, for a step whose point is what the key did. */
function keyFrame(label) {
	console.log(`\n▸ ${label}`);
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
