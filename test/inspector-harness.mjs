/**
 * Drives the property inspector in a real browser, so its inline JavaScript can be tested at all.
 *
 * `ui/dial-countdown.html` is a plain page Stream Deck loads; it is not part of the rollup bundle and
 * cannot import from `src/`. So everything it needs it carries inline — the preset clamps,
 * `MAX_PRESET_SECONDS`, its own `toParts`, the settings round-trip, the sound picker. None of that
 * was reachable from a unit test, which is how the page came to hold a second copy of the settings
 * shape with nothing checking the two agreed.
 *
 * The harness is deliberately dependency-free. Two things it needs, and both are already here:
 *
 * - **A browser.** Chromium is in Playwright's cache on this machine, driven here over the DevTools
 *   Protocol directly rather than through Playwright, which is not installed and would be a large
 *   dependency for one file. {@link chromiumPath} returns `null` when there is none, and the tests
 *   skip rather than fail — a machine without a browser should not have a red suite.
 * - **A WebSocket client.** `ws` is already a devDependency, for `tools/mock-host.mjs`.
 *
 * The page is served over HTTP rather than opened as `file://`, for one reason: the vendored
 * `sdpi-components.js` would define the real `SDPIComponents` and overwrite the stub. Serving it
 * lets that one request be answered with nothing, and `file://` cannot be intercepted the same way.
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { WebSocket } from "ws";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UI = resolve(ROOT, "com.matewishkey.dial-countdown-v2.sdPlugin/ui");

/** Newest Chromium in Playwright's cache, or `null` if there is none to be had. */
export function chromiumPath() {
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

/**
 * Serves the inspector's own directory, with one substitution: `sdpi-components.js` comes back empty.
 *
 * The real one defines `window.SDPIComponents`, which would land on top of the stub no matter when
 * the stub was injected. Answering it with nothing is what leaves the stub standing.
 */
function serveUi() {
	const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

	const server = createServer((req, res) => {
		const name = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");

		if (name === "sdpi-components.js") {
			res.writeHead(200, { "content-type": "text/javascript" });
			res.end("/* stubbed by test/inspector-harness.mjs */");
			return;
		}

		// Refuse anything trying to climb out of the ui directory.
		const file = resolve(UI, name);
		if (!file.startsWith(`${UI}/`) || !existsSync(file)) {
			res.writeHead(404).end("not found");
			return;
		}

		res.writeHead(200, { "content-type": types[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream" });
		res.end(readFileSync(file));
	});

	return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server)));
}

/** The stand-in for the Stream Deck property-inspector SDK, injected before any page script runs. */
function stubSource(settings) {
	return `
		window.__initial = ${JSON.stringify(settings)};
		window.__calls = { setSettings: [], send: [] };
		window.__subs = {};
		const copy = (value) => JSON.parse(JSON.stringify(value ?? null));
		window.SDPIComponents = {
			streamDeckClient: {
				getSettings: () => Promise.resolve({ settings: copy(window.__initial) }),
				setSettings: (value) => { window.__calls.setSettings.push(copy(value)); },
				send: (event, payload) => { window.__calls.send.push({ event, payload: copy(payload) }); },
				didReceiveSettings: { subscribe: (fn) => { window.__subs.didReceiveSettings = fn; } },
				sendToPropertyInspector: { subscribe: (fn) => { window.__subs.toInspector = fn; } }
			}
		};
	`;
}

/** Minimal DevTools Protocol client: one WebSocket, one id counter, one map of pending replies. */
class Devtools {
	#socket;
	#next = 1;
	#pending = new Map();
	#waiters = [];

	constructor(socket) {
		this.#socket = socket;
		socket.on("message", (raw) => {
			const message = JSON.parse(raw.toString());
			if (message.id !== undefined) {
				const pending = this.#pending.get(message.id);
				this.#pending.delete(message.id);
				pending?.(message);
				return;
			}
			this.#waiters = this.#waiters.filter((waiter) => !waiter(message));
		});
	}

	send(method, params = {}) {
		const id = this.#next++;
		return new Promise((done, fail) => {
			this.#pending.set(id, (message) =>
				message.error === undefined ? done(message.result) : fail(new Error(`${method}: ${message.error.message}`))
			);
			this.#socket.send(JSON.stringify({ id, method, params }));
		});
	}

	/** Resolves on the next event with this name. */
	once(method) {
		return new Promise((done) => {
			this.#waiters.push((message) => {
				if (message.method !== method) {
					return false;
				}
				done(message.params);
				return true;
			});
		});
	}

	close() {
		this.#socket.close();
	}
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/** Polls the browser's HTTP endpoint until it answers — it is not listening the instant it is spawned. */
async function pageSocketUrl(port) {
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
			const page = targets.find((target) => target.type === "page");
			if (page?.webSocketDebuggerUrl !== undefined) {
				return page.webSocketDebuggerUrl;
			}
		} catch {
			// Not up yet.
		}
		await wait(100);
	}
	throw new Error("Chromium never opened its DevTools endpoint");
}

/**
 * Starts a browser and a server, once, for a whole test file.
 *
 * @returns An object with `load(settings)` — which opens the inspector with those settings already
 * stored — `evaluate(expression)`, and `close()`.
 */
export async function startInspector() {
	const binary = chromiumPath();
	if (binary === null) {
		throw new Error("no Chromium found under ~/.cache/ms-playwright");
	}

	const server = await serveUi();
	const origin = `http://127.0.0.1:${server.address().port}`;

	const port = 9333 + Math.floor(Math.random() * 500);
	const browser = spawn(
		binary,
		[
			"--headless",
			"--disable-gpu",
			"--no-sandbox",
			"--no-first-run",
			"--disable-dev-shm-usage",
			`--remote-debugging-port=${port}`,
			"about:blank"
		],
		{ stdio: "ignore" }
	);

	const devtools = new Devtools(new WebSocket(await pageSocketUrl(port)));
	await new Promise((done) => setTimeout(done, 50));
	await devtools.send("Page.enable");
	await devtools.send("Runtime.enable");

	let injected = null;

	return {
		/** Opens a fresh inspector, with `settings` already in Stream Deck's store. */
		async load(settings = {}) {
			if (injected !== null) {
				await devtools.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: injected });
			}
			({ identifier: injected } = await devtools.send("Page.addScriptToEvaluateOnNewDocument", {
				source: stubSource(settings)
			}));

			const loaded = devtools.once("Page.loadEventFired");
			await devtools.send("Page.navigate", { url: `${origin}/dial-countdown.html` });
			await loaded;

			// `getSettings()` is a promise, so the controls are populated a microtask after load.
			await this.evaluate("new Promise((done) => setTimeout(done, 0))");
		},

		/**
		 * Runs an expression in the page and returns its value. Rejects on a page-side throw.
		 *
		 * @param {string} expression
		 * @returns {Promise<unknown>} Whatever the page produced — `unknown` rather than `any`, so a
		 * caller has to say what it expects instead of quietly inheriting it.
		 */
		async evaluate(expression) {
			const result = await devtools.send("Runtime.evaluate", {
				expression: `(async () => { return (${expression}); })()`,
				awaitPromise: true,
				returnByValue: true
			});
			if (result.exceptionDetails !== undefined) {
				throw new Error(result.exceptionDetails.exception?.description ?? "page threw");
			}
			return result.result.value;
		},

		async close() {
			devtools.close();
			browser.kill();
			await new Promise((done) => server.close(done));
		}
	};
}
