/**
 * Sound resolution and the question of whether a sound was wanted at all.
 *
 * This file exists because `src/sound.ts` had no tests, and the bug that found that out was in the
 * gap between two of its ideas: a path can resolve to the `none` sentinel, and a sentinel is not a
 * failure to play — but the alert in `actions/countdown-action.ts` only knew about the *other* way
 * of asking for silence, a volume of zero. Every timer set to *No sound* raised Stream Deck's error
 * triangle on finishing.
 *
 * Nothing here spawns a player. {@link playSound} is deliberately left alone: it launches a detached
 * OS process, and a test that made noise on the machine running it would be a worse thing than the
 * coverage is worth. What is tested is every decision taken *before* that point, which is where the
 * bug was.
 */

import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { CUSTOM_SOUND, DEFAULT_SOUND, NO_SOUND } from "../src/settings.ts";

/**
 * The bundled sounds are found relative to `process.cwd()`, so a test has to stand where the plugin
 * stands before the module is loaded — hence the `chdir` and the dynamic import rather than a plain
 * one, which would be hoisted above it.
 *
 * That is not a workaround for something crooked. Stream Deck launches a plugin with the `.sdPlugin`
 * folder as its working directory, and the SDK resolves `manifest.json` and its own log directory
 * the same way; `tools/mock-host.mjs` sets `cwd` for exactly that reason. `src/sound.ts` is making
 * the SDK's assumption rather than an extra one of its own — and this is the file that says so out
 * loud, so that anyone who changes it finds out here rather than on a user's machine at 2am.
 */
const PLUGIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../com.matewishkey.dial-countdown-v2.sdPlugin");
process.chdir(PLUGIN_DIR);

const { listSounds, resolveSound, soundExists, wantsSound } = await import("../src/sound.ts");

describe("resolveSound", () => {
	it("resolves the default sentinel to a real path rather than storing one", () => {
		// The bundled path is only knowable at runtime — storing it would break the moment the plugin
		// folder moved, which is the reason the sentinel exists at all.
		const path = resolveSound({ soundId: DEFAULT_SOUND });

		assert.notEqual(path, DEFAULT_SOUND, "the sentinel should have been resolved, not passed through");
		assert.ok(path.endsWith("chime.wav"), `expected the bundled chime, got ${path}`);
	});

	it("treats missing settings as the default", () => {
		assert.equal(resolveSound({}), resolveSound({ soundId: DEFAULT_SOUND }));
	});

	it("passes the none sentinel straight through", () => {
		// It has to survive as itself: everything downstream distinguishes "silence was chosen" from
		// "a file could not be played" by this exact value.
		assert.equal(resolveSound({ soundId: NO_SOUND }), NO_SOUND);
	});

	it("resolves a custom sound to its own path", () => {
		assert.equal(resolveSound({ soundId: CUSTOM_SOUND, customSoundPath: "/tmp/alarm.wav" }), "/tmp/alarm.wav");
	});

	it("falls back to silence when custom is chosen with no file behind it", () => {
		// Not to the default chime. The user picked a custom sound and the path is gone; playing
		// something else instead would be answering a question nobody asked.
		assert.equal(resolveSound({ soundId: CUSTOM_SOUND, customSoundPath: "" }), NO_SOUND);
		assert.equal(resolveSound({ soundId: CUSTOM_SOUND }), NO_SOUND);
	});

	it("passes a system sound's absolute path through untouched", () => {
		assert.equal(resolveSound({ soundId: "/System/Library/Sounds/Glass.aiff" }), "/System/Library/Sounds/Glass.aiff");
	});
});

describe("wantsSound", () => {
	/**
	 * The whole point of the function, and the case that shipped broken. `none` is a choice the user
	 * made in the picker, so a timer that finishes silently has done what it was told — there is
	 * nothing to alert about.
	 */
	it("is false for the none sentinel at any volume", () => {
		assert.equal(wantsSound(NO_SOUND, 100), false, "No sound is silence the user asked for, not a failure");
		assert.equal(wantsSound(NO_SOUND, 0), false);
	});

	it("is false at zero volume, whatever the sound", () => {
		assert.equal(wantsSound("/tmp/alarm.wav", 0), false);
	});

	it("is false when there is no path at all", () => {
		assert.equal(wantsSound(undefined, 100), false);
	});

	it("is true for a real sound at an audible volume", () => {
		// Only this combination can fail in a way worth reporting: something was asked for, and the
		// player is the one thing here that lives outside the plugin's control.
		assert.equal(wantsSound("/tmp/alarm.wav", 100), true);
		assert.equal(wantsSound("/tmp/alarm.wav", 1), true);
	});
});

describe("soundExists", () => {
	it("says no to the none sentinel, which is not a file", () => {
		assert.equal(soundExists(NO_SOUND), false);
	});

	it("says no to nothing at all", () => {
		assert.equal(soundExists(undefined), false);
		assert.equal(soundExists(""), false);
	});

	it("says yes to a file that is really there", () => {
		// The bundled chime, via the same resolution the plugin uses — so this also proves the two
		// agree about where the sounds live.
		assert.equal(soundExists(resolveSound({ soundId: DEFAULT_SOUND })), true);
	});

	it("says no to a path that is not", () => {
		assert.equal(soundExists("/nowhere/at/all/nothing.wav"), false);
	});
});

describe("listSounds", () => {
	const sounds = listSounds();

	it("always offers silence and the default, on every platform", () => {
		// These two are not read from disk, so they are the only entries that can be promised.
		assert.ok(
			sounds.some((sound) => sound.id === NO_SOUND),
			"No sound must always be offerable"
		);
		assert.ok(
			sounds.some((sound) => sound.id === DEFAULT_SOUND),
			"the default chime must always be offerable"
		);
	});

	it("includes the sounds shipped inside the plugin", () => {
		const bundled = sounds.filter((sound) => sound.group === "Bundled").map((sound) => sound.label);

		for (const expected of ["Chime", "Beep", "Alarm"]) {
			assert.ok(bundled.includes(expected), `expected the bundled ${expected}; got ${bundled.join(", ")}`);
		}
	});

	it("gives every option an id, a label and a group the inspector can bucket by", () => {
		// The property inspector builds its `optgroup`s straight from these, so a missing field is a
		// silently malformed dropdown rather than an error.
		for (const sound of sounds) {
			assert.ok(sound.id.length > 0, "an option with no id cannot be selected");
			assert.ok(sound.label.length > 0, `option ${sound.id} has no label`);
			assert.ok(["Bundled", "System"].includes(sound.group), `option ${sound.id} has group ${sound.group}`);
		}
	});

	it("offers no duplicate ids", () => {
		// A repeated id makes the `<select>` ambiguous about which entry is selected.
		const ids = sounds.map((sound) => sound.id);
		assert.equal(new Set(ids).size, ids.length, "the sound list contains a duplicate id");
	});
});
