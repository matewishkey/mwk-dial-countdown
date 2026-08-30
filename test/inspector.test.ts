/**
 * The property inspector's inline JavaScript, exercised in a real browser.
 *
 * `ui/dial-countdown.html` is loaded by Stream Deck as a plain page. It is not in the rollup bundle
 * and cannot import from `src/`, so it carries its own copy of the preset clamps,
 * `MAX_PRESET_SECONDS`, a `toParts`, the settings round-trip and the sound picker — none of which
 * any test could reach.
 *
 * That gap had already cost something. `src/settings.ts` once exported `toParts`/`fromParts` with
 * tests over them, and *nothing in the plugin called either* — the tested copy was not the running
 * copy, which is worse than no coverage because it reads like coverage. The first suite below is
 * the direct guard against the version of that which is still live: the page's `DEFAULTS` and
 * `MAX_PRESET_SECONDS` are a second copy of `src/settings.ts`, and now something checks they agree.
 *
 * See `test/inspector-harness.mjs` for how the page is driven. Skipped, not failed, where there is
 * no browser to drive it with.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { chromiumPath, startInspector } from "./inspector-harness.mjs";
import { DEFAULT_PRESETS, DEFAULTS, MAX_PRESET_SECONDS, MAX_REPEAT_COUNT, MAX_SOUND_REPEAT } from "../src/settings.ts";

const noBrowser = chromiumPath() === null;

describe("the property inspector", { skip: noBrowser ? "no Chromium in Playwright's cache" : false }, () => {
	let ui: Awaited<ReturnType<typeof startInspector>>;

	before(async () => {
		ui = await startInspector();
	});

	after(async () => {
		await ui?.close();
	});

	/** The settings object the page last wrote, or `null` if it has not written one. */
	const lastSaved = (): Promise<Record<string, unknown> | null> =>
		ui.evaluate("window.__calls.setSettings.at(-1) ?? null") as Promise<Record<string, unknown> | null>;

	/** A page value read as the string it is displayed as. */
	const text = async (expression: string): Promise<string> => String(await ui.evaluate(expression));

	/** Sets a control's value and fires the `change` event the page listens for. */
	const change = (id: string, value: string | boolean): Promise<unknown> =>
		ui.evaluate(`(() => {
			const input = document.getElementById(${JSON.stringify(id)});
			${typeof value === "boolean" ? `input.checked = ${value};` : `input.value = ${JSON.stringify(value)};`}
			input.dispatchEvent(new Event("change", { bubbles: true }));
			return true;
		})()`);

	describe("its copy of the settings shape", () => {
		it("declares exactly the defaults src/settings.ts does", async () => {
			// The whole reason this file exists. The page cannot import the real thing, so it holds a
			// transcription — and a transcription nothing compares is a transcription that drifts.
			await ui.load({});
			const inline = await ui.evaluate("DEFAULTS");

			assert.deepEqual(inline, DEFAULTS, "the inspector's inline DEFAULTS have drifted from src/settings.ts");
		});

		it("declares the same keys, in the same order, so a diff of the two reads cleanly", async () => {
			await ui.load({});
			assert.deepEqual(await ui.evaluate("Object.keys(DEFAULTS)"), Object.keys(DEFAULTS));
		});

		it("agrees on the longest preset it will accept", async () => {
			await ui.load({});
			assert.equal(await ui.evaluate("MAX_PRESET_SECONDS"), MAX_PRESET_SECONDS);
		});

		it("agrees on the repeat and sound-repeat ceilings, which it enforces in the markup", async () => {
			await ui.load({});
			assert.equal(await ui.evaluate('document.getElementById("repeatCount").max'), String(MAX_REPEAT_COUNT));
			assert.equal(await ui.evaluate('document.getElementById("soundRepeat").max'), String(MAX_SOUND_REPEAT));
		});
	});

	describe("loading stored settings", () => {
		it("shows what is stored, not what is default", async () => {
			await ui.load({
				...DEFAULTS,
				presets: [90, 600],
				presetIndex: 1,
				layout: "bar",
				theme: "neon",
				showLogo: false,
				repeat: true,
				repeatCount: 5,
				volume: 40
			});

			assert.equal(await ui.evaluate('document.getElementById("layout").value'), "bar");
			assert.equal(await ui.evaluate('document.getElementById("theme").value'), "neon");
			assert.equal(await ui.evaluate('document.getElementById("showLogo").checked'), false);
			assert.equal(await ui.evaluate('document.getElementById("repeat").checked'), true);
			assert.equal(await ui.evaluate('document.getElementById("repeatCount").value'), "5");
			assert.equal(await ui.evaluate('document.getElementById("volume").value'), "40");
		});

		it("draws one row per preset, and marks the selected one", async () => {
			await ui.load({ ...DEFAULTS, presets: [90, 600, 1800], presetIndex: 1 });

			assert.equal(await ui.evaluate('document.querySelectorAll("#rows li").length'), 3);
			assert.equal(await ui.evaluate('[...document.querySelectorAll("#rows li")].findIndex((r) => r.className === "active")'), 1);
		});

		it("splits a preset into hours, minutes and seconds", async () => {
			await ui.load({ ...DEFAULTS, presets: [3671] });

			assert.deepEqual(
				await ui.evaluate('[...document.querySelectorAll("#rows li input")].map((i) => i.value)'),
				["1", "1", "11"],
				"1h 1m 11s"
			);
		});

		it("falls back to the defaults when Stream Deck has nothing stored", async () => {
			await ui.load({});
			assert.deepEqual(await ui.evaluate("state.presets"), DEFAULTS.presets);
			assert.equal(await ui.evaluate("state.theme"), DEFAULTS.theme);
		});
	});

	describe("writing an edit back", () => {
		it("saves on every change, since a Save button is not allowed in an inspector", async () => {
			await ui.load({ ...DEFAULTS });
			assert.equal(await ui.evaluate("window.__calls.setSettings.length"), 0, "nothing written just by opening");

			await change("theme", "ember");
			const saved = await lastSaved();
			assert.equal(saved?.theme, "ember");
		});

		it("changes the one field it owns and leaves the rest alone", async () => {
			const stored = { ...DEFAULTS, presets: [90, 600], presetIndex: 1, theme: "ocean", volume: 30 };
			await ui.load(stored);

			await change("showFinishTime", true);
			const saved = await lastSaved();

			assert.deepEqual(saved, { ...stored, showFinishTime: true });
		});

		it("round-trips a full settings object unchanged apart from the edit", async () => {
			// A settings object that survives a load and a save is one the plugin can normalise back to
			// itself; anything the page silently drops would show up here as a missing key.
			const stored = {
				...DEFAULTS,
				presets: [1, MAX_PRESET_SECONDS],
				presetIndex: 1,
				layout: "bar",
				theme: "mwk",
				showLogo: false,
				showTitle: false,
				showFinishTime: true,
				warnEnabled: true,
				warnSeconds: 125,
				repeat: true,
				repeatCount: MAX_REPEAT_COUNT,
				soundEnabled: false,
				soundId: "custom",
				customSoundPath: "/tmp/ding.wav",
				volume: 0,
				soundRepeat: MAX_SOUND_REPEAT
			};
			await ui.load(stored);

			await change("showTitle", true);
			assert.deepEqual(await lastSaved(), { ...stored, showTitle: true });
		});

		it("clamps a repeat count typed outside its range", async () => {
			await ui.load({ ...DEFAULTS });

			await change("repeatCount", "99");
			assert.equal((await lastSaved())?.repeatCount, MAX_REPEAT_COUNT);

			await change("repeatCount", "0");
			assert.equal((await lastSaved())?.repeatCount, 1, "zero repeats is not a thing; one run is");
		});

		it("clamps the volume to 0-100", async () => {
			await ui.load({ ...DEFAULTS });

			await change("volume", "500");
			assert.equal((await lastSaved())?.volume, 100);

			await change("volume", "-20");
			assert.equal((await lastSaved())?.volume, 0);
		});

		it("combines the fade's minutes and seconds into one duration", async () => {
			await ui.load({ ...DEFAULTS });

			await ui.evaluate(`(() => {
				document.getElementById("warnMin").value = "2";
				document.getElementById("warnSec").value = "5";
				document.getElementById("warnSec").dispatchEvent(new Event("change", { bubbles: true }));
				return true;
			})()`);

			assert.equal((await lastSaved())?.warnSeconds, 125);
			assert.equal(await ui.evaluate('document.getElementById("warnTotal").textContent'), "left · 2m 5s");
		});

		it("never lets the fade reach zero", async () => {
			await ui.load({ ...DEFAULTS });

			await ui.evaluate(`(() => {
				document.getElementById("warnMin").value = "0";
				document.getElementById("warnSec").value = "0";
				document.getElementById("warnSec").dispatchEvent(new Event("change", { bubbles: true }));
				return true;
			})()`);

			assert.equal((await lastSaved())?.warnSeconds, 1);
		});
	});

	describe("editing presets", () => {
		it("writes hours, minutes and seconds back as one duration", async () => {
			await ui.load({ ...DEFAULTS, presets: [60] });

			await ui.evaluate(`(() => {
				const [h, m, s] = document.querySelectorAll("#rows li input");
				h.value = "1"; m.value = "30"; s.value = "15";
				s.dispatchEvent(new Event("change", { bubbles: true }));
				return true;
			})()`);

			assert.deepEqual((await lastSaved())?.presets, [3600 + 1800 + 15]);
		});

		it("clamps a preset to twenty-four hours", async () => {
			await ui.load({ ...DEFAULTS, presets: [60] });

			await ui.evaluate(`(() => {
				const [h] = document.querySelectorAll("#rows li input");
				h.value = "99";
				h.dispatchEvent(new Event("change", { bubbles: true }));
				return true;
			})()`);

			assert.deepEqual((await lastSaved())?.presets, [MAX_PRESET_SECONDS]);
		});

		it("clamps an emptied preset to one second rather than zero", async () => {
			await ui.load({ ...DEFAULTS, presets: [60] });

			await ui.evaluate(`(() => {
				const [h, m, s] = document.querySelectorAll("#rows li input");
				h.value = "0"; m.value = "0"; s.value = "0";
				s.dispatchEvent(new Event("change", { bubbles: true }));
				return true;
			})()`);

			assert.deepEqual((await lastSaved())?.presets, [1], "a zero-length countdown is not a countdown");
		});

		it("adds a preset, and offers no remove button when only one is left", async () => {
			await ui.load({ ...DEFAULTS, presets: [60] });
			assert.equal(await ui.evaluate('document.querySelectorAll("#rows .remove").length'), 0);

			await ui.evaluate('document.getElementById("add").click()');
			assert.equal(await ui.evaluate('document.querySelectorAll("#rows li").length'), 2);
			assert.equal(await ui.evaluate('document.querySelectorAll("#rows .remove").length'), 2);
		});

		it("pulls the selection back in range when the selected preset is removed", async () => {
			await ui.load({ ...DEFAULTS, presets: [60, 120], presetIndex: 1 });

			await ui.evaluate('document.querySelectorAll("#rows .remove")[1].click()');

			const saved = await lastSaved();
			assert.deepEqual(saved?.presets, [60]);
			assert.equal(saved?.presetIndex, 0, "an index pointing past the end would show the wrong preset");
		});

		it("does not edit its own DEFAULTS when the stored settings carry no presets", async () => {
			// A spread is shallow. `{ ...DEFAULTS, ...settings }` shared `DEFAULTS.presets` itself
			// whenever the incoming settings had none — so `push`, `splice` and `presets[i] = …` were
			// all rewriting the module's defaults, and every later load started from settings the user
			// had never chosen. Reachable only when the plugin has not yet written a full set back,
			// which is a guarantee held in another file entirely.
			await ui.load({});

			await ui.evaluate('document.getElementById("add").click()');
			await ui.evaluate('document.getElementById("add").click()');

			assert.deepEqual(
				await ui.evaluate("DEFAULTS.presets"),
				DEFAULT_PRESETS,
				"editing the presets rewrote the page's own defaults"
			);
			assert.equal(
				await ui.evaluate("state.presets.length"),
				DEFAULT_PRESETS.length + 2,
				"the edits should still have landed on the live state"
			);
		});

		it("keeps a loaded preset list independent of the defaults", async () => {
			// The same hazard from the other side: settings that *do* carry presets must not be able
			// to reach DEFAULTS either, whatever else is spread around them.
			await ui.load({ ...DEFAULTS, presets: [60] });

			await ui.evaluate('document.getElementById("add").click()');

			assert.deepEqual(await ui.evaluate("DEFAULTS.presets"), DEFAULT_PRESETS);
		});
	});

	describe("what the plugin tells it", () => {
		it("hides the dial-only rows when it is inspecting a key", async () => {
			await ui.load({ ...DEFAULTS });

			await ui.evaluate('window.__subs.toInspector({ payload: { event: "controller", controller: "Keypad" } })');
			assert.equal(await ui.evaluate("document.body.dataset.controller"), "Keypad");

			await ui.evaluate('window.__subs.toInspector({ payload: { event: "controller", controller: "Encoder" } })');
			assert.equal(await ui.evaluate("document.body.dataset.controller"), "Encoder");
		});

		it("builds the sound list from what the plugin found on disk", async () => {
			await ui.load({ ...DEFAULTS });

			await ui.evaluate(`window.__subs.toInspector({ payload: { event: "sounds", sounds: [
				{ id: "default", label: "Chime", group: "Bundled" },
				{ id: "beep", label: "Beep", group: "Bundled" },
				{ id: "none", label: "None", group: "Other" }
			] } })`);

			assert.deepEqual(await ui.evaluate('[...document.querySelectorAll("#soundId optgroup")].map((g) => g.label)'), [
				"Bundled",
				"Other"
			]);
			assert.equal(await ui.evaluate('document.querySelectorAll("#soundId option").length'), 3);
		});

		it("adds the chosen custom file to the list, so it can be selected back", async () => {
			await ui.load({ ...DEFAULTS, soundId: "custom", customSoundPath: "/home/me/Sounds/gong.wav" });

			await ui.evaluate(
				'window.__subs.toInspector({ payload: { event: "sounds", sounds: [{ id: "default", label: "Chime", group: "Bundled" }] } })'
			);

			assert.deepEqual(
				await ui.evaluate('[...document.querySelectorAll("#soundId option")].map((o) => o.textContent)'),
				["Chime", "gong.wav"]
			);
			assert.equal(await ui.evaluate('document.getElementById("soundId").value'), "custom");
		});

		it("reports a sound that did not resolve, rather than leaving it to fail at the alarm", async () => {
			await ui.load({ ...DEFAULTS });

			await ui.evaluate(
				'window.__subs.toInspector({ payload: { event: "soundStatus", path: "/gone.wav", exists: false } })'
			);
			assert.match(await text('document.getElementById("soundStatus").textContent'), /not found/);

			await ui.evaluate(
				'window.__subs.toInspector({ payload: { event: "soundStatus", path: "/there.wav", exists: true, played: true } })'
			);
			assert.match(await text('document.getElementById("soundStatus").textContent'), /^✓/);

			await ui.evaluate(
				'window.__subs.toInspector({ payload: { event: "soundStatus", path: "/there.wav", exists: true, played: false } })'
			);
			assert.match(await text('document.getElementById("soundStatus").textContent'), /no player/);
		});

		it("reloads its controls when the plugin saves settings of its own", async () => {
			// The plugin writes the preset index back when the touchscreen cycles presets, and that
			// echoes here. An inspector that ignored it would show a stale selection.
			await ui.load({ ...DEFAULTS, presets: [60, 120], presetIndex: 0 });

			await ui.evaluate(
				'window.__subs.didReceiveSettings({ payload: { settings: { ...DEFAULTS, presets: [60, 120], presetIndex: 1, theme: "forest" } } })'
			);

			assert.equal(await ui.evaluate('document.getElementById("theme").value'), "forest");
			assert.equal(
				await ui.evaluate('[...document.querySelectorAll("#rows li")].findIndex((r) => r.className === "active")'),
				1
			);
		});
	});

	describe("auditioning a sound", () => {
		it("asks the plugin to play exactly what the timer would play", async () => {
			await ui.load({ ...DEFAULTS, soundId: "beep", volume: 55, soundRepeat: 3 });

			await ui.evaluate('document.getElementById("preview").click()');

			const sent = await ui.evaluate("window.__calls.send.at(-1)");
			assert.deepEqual(sent, {
				event: "sendToPlugin",
				payload: { event: "preview", soundId: "beep", customSoundPath: "", volume: 55, soundRepeat: 3 }
			});
		});

		it("checks the sound resolves as soon as it opens, not when the alarm is due", async () => {
			await ui.load({ ...DEFAULTS, soundId: "custom", customSoundPath: "/tmp/x.wav" });

			const sent = await ui.evaluate("window.__calls.send[0]");
			assert.deepEqual(sent, {
				event: "sendToPlugin",
				payload: { event: "checkSound", soundId: "custom", customSoundPath: "/tmp/x.wav" }
			});
		});
	});
});
