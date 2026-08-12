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
const ACTION_UUID = `${PLUGIN_UUID}.timer`;
const PLUGIN_DIR = resolve(ROOT, `${PLUGIN_UUID}.sdPlugin`);
const PLUGIN_ENTRY = resolve(PLUGIN_DIR, "bin/plugin.js");

const DEVICE_ID = "MOCK-DEVICE-0001";
const CONTEXT = "mock-context-dial-0";
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
const screen = { title: "—", value: "—", label: "", finish: "", indicator: 0, ring: 0, colour: "", font: 0, opacity: 1, glyph: "", layout: "(default)" };
let settings = {};
let socket = null;

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
			// The plugin has registered. Put a dial on screen, exactly as a real device would.
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
			draw();
			if (DEMO) {
				runDemo().catch((err) => {
					console.error(err);
					process.exit(1);
				});
			}
			break;

		case "setFeedback": {
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
		case "setTitle":
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
		})
};

/** Pushes a settings change, as the property inspector would. */
function applySettings(patch) {
	settings = { ...settings, ...patch };
	send({
		event: "didReceiveSettings",
		action: ACTION_UUID,
		context: CONTEXT,
		device: DEVICE_ID,
		payload: { controller: "Encoder", coordinates: { column: 0, row: 0 }, isInMultiAction: false, settings }
	});
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

		// Cadence: a single click is now one second, and winding reaches a minute a tick.
		["one click → +1s", async () => gestures.rotate(1)],
		["8 slow clicks → +8s, still fine control", async () => spin(8, 1, 400)],
		["a hard spin → minutes a tick", async () => spin(6, 3, 50)],
		["keep winding → ten minutes a tick, half a day in one gesture", async () => spin(16, 3, 45)],

		// The long clock has to fit its box.
		["set 1:10:10 → font shrinks to fit", async () => {
			applySettings({ presets: [4210], presetIndex: 0 });
			await wait(300);
		}],
		["…running", async () => {
			gestures.touch(false);
			await wait(300);
		}],

		// Pause is now stated by a glyph, not by colour alone.
		["tap screen → paused, pause glyph in the ring", async () => gestures.touch(false)],
		["tap screen → running again", async () => gestures.touch(false)],

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

		// Sound repeats. On Linux no player exists, so this proves it does not crash.
		["alarm set to play 3 times, 2s timer → runs out", async () => {
			applySettings({ presets: [2], presetIndex: 0, soundEnabled: true, soundRepeat: 3, showTitle: true });
			await wait(300);
			gestures.touch(false);
			await wait(2600);
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
		]
	];

	for (const [label, run] of steps) {
		await run();
		// Long enough for the plugin's reply to land, the 250ms render loop to turn over, and the
		// 400ms settings debounce to flush — otherwise a frame shows state that is merely in flight.
		await wait(600);
		frame(label);
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
		case "y":
			gestures.touch(true);
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
		dim("   ←/→ adjust   shift+←/→ ×5   ↑/↓ press+turn 60s"),
		dim("   t tap screen: start/pause   y hold screen: reset"),
		dim("   space press dial: next preset   r hold dial: previous   ctrl+c quit")
	];

	process.stdout.write("\x1b[2J\x1b[H" + lines.join("\n") + "\n");
}

/** Appends a labelled frame instead of repainting, so a scripted pass reads as a transcript. */
function frame(label) {
	console.log(`\n▸ ${label}`);
	console.log(screenLines().join("\n"));
}

function pad(text, width) {
	const value = String(text);
	return value.length > width ? value.slice(0, width) : value.padEnd(width);
}

function dim(text) {
	return `\x1b[2m${text}\x1b[0m`;
}

console.log(`Mock Stream Deck host listening on ws://127.0.0.1:${PORT}`);
