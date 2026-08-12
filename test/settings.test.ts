import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	DEFAULT_PRESETS,
	DEFAULTS,
	fromParts,
	MAX_PRESET_SECONDS,
	MAX_REPEAT_COUNT,
	MAX_SOUND_REPEAT,
	normalisePresets,
	normaliseSettings,
	toParts
} from "../src/settings.ts";

describe("normaliseSettings", () => {
	it("returns a complete set of defaults for a fresh install", () => {
		assert.deepEqual(normaliseSettings({}), DEFAULTS);
		assert.deepEqual(normaliseSettings(undefined), DEFAULTS);
	});

	it("survives anything at all, which is the point of it", () => {
		for (const rubbish of [null, 0, "", "settings", [], true, Number.NaN, { presets: "nope" }]) {
			const settings = normaliseSettings(rubbish);
			assert.deepEqual(settings.presets, DEFAULT_PRESETS, `presets not restored for ${JSON.stringify(rubbish)}`);
			assert.equal(typeof settings.volume, "number");
			assert.equal(typeof settings.showTitle, "boolean");
		}
	});

	it("upgrades the presets an older build wrote", () => {
		const legacy = { presets: [{ label: "Focus", seconds: 1500 }, { label: "Break", seconds: 300 }], presetIndex: 1 };
		const settings = normaliseSettings(legacy);
		assert.deepEqual(settings.presets, [1500, 300], "the durations are the part worth keeping");
		assert.equal(settings.presetIndex, 1);
	});

	it("drops keys it does not recognise, so stale fields cannot resurface", () => {
		const settings = normaliseSettings({ warnColor: "#FF0000", soundPack: "old", presets: [60] });
		assert.ok(!("warnColor" in settings), "a removed setting must not survive a reinstall");
		assert.ok(!("soundPack" in settings));
	});

	it("repairs an index that points past the end of the presets", () => {
		assert.equal(normaliseSettings({ presets: [60, 120], presetIndex: 7 }).presetIndex, 0);
		assert.equal(normaliseSettings({ presets: [60, 120], presetIndex: -1 }).presetIndex, 0);
		assert.equal(normaliseSettings({ presets: [60, 120], presetIndex: 1.5 }).presetIndex, 0);
	});

	it("clamps numbers that are out of range rather than passing them on", () => {
		assert.equal(normaliseSettings({ volume: 900 }).volume, 100);
		assert.equal(normaliseSettings({ volume: -5 }).volume, 0);
		assert.equal(normaliseSettings({ soundRepeat: 999 }).soundRepeat, MAX_SOUND_REPEAT);
		assert.equal(normaliseSettings({ soundRepeat: 0 }).soundRepeat, 1);
	});

	it("keeps values that are already good", () => {
		const good = { ...DEFAULTS, presets: [30, 90], presetIndex: 1, theme: "mwk", showLogo: true, volume: 40 };
		assert.deepEqual(normaliseSettings(good), good);
	});

	it("is idempotent, so re-saving cannot drift", () => {
		const once = normaliseSettings({ presets: [{ seconds: 45 }], volume: 250, junk: 1 });
		assert.deepEqual(normaliseSettings(once), once);
	});

	it("defaults to playing a sound, since a silent timer is not much of an alarm", () => {
		assert.equal(DEFAULTS.soundEnabled, true);
		assert.equal(DEFAULTS.soundId, "default");
	});

	it("shows the logo out of the box", () => {
		assert.equal(DEFAULTS.showLogo, true);
	});

	it("measures the fade window in seconds", () => {
		assert.equal(normaliseSettings({ warnSeconds: 45 }).warnSeconds, 45, "a value under a minute must survive");
		assert.equal(normaliseSettings({ warnSeconds: 0 }).warnSeconds, 1);
	});
});

describe("normalisePresets", () => {
	it("discards entries that are not usable durations", () => {
		assert.deepEqual(normalisePresets([60, "90", null, -5, 0, Number.NaN, 120]), [60, 120]);
	});

	it("falls back when nothing usable is left", () => {
		assert.deepEqual(normalisePresets([-1, "x"]), DEFAULT_PRESETS);
		assert.deepEqual(normalisePresets([]), DEFAULT_PRESETS);
	});

	it("clamps a preset longer than a day", () => {
		assert.deepEqual(normalisePresets([99_999_999]), [MAX_PRESET_SECONDS]);
	});
});

describe("hours, minutes and seconds", () => {
	it("splits a duration into parts", () => {
		assert.deepEqual(toParts(4210), { hours: 1, minutes: 10, seconds: 10 });
		assert.deepEqual(toParts(300), { hours: 0, minutes: 5, seconds: 0 });
		assert.deepEqual(toParts(59), { hours: 0, minutes: 0, seconds: 59 });
	});

	it("round-trips through the editor's fields", () => {
		for (const seconds of [1, 59, 60, 300, 4210, 3600, MAX_PRESET_SECONDS]) {
			const { hours, minutes, seconds: s } = toParts(seconds);
			assert.equal(fromParts(hours, minutes, s), seconds, `round trip failed for ${seconds}`);
		}
	});

	it("never produces an impossible preset", () => {
		assert.equal(fromParts(0, 0, 0), 1, "a zero-length timer is not a timer");
		assert.equal(fromParts(999, 0, 0), MAX_PRESET_SECONDS);
		assert.equal(fromParts(Number.NaN, -5, 30), 30);
	});
});

describe("repeat count", () => {
	it("is bounded, so a repeating timer cannot run for ever", () => {
		assert.equal(normaliseSettings({ repeatCount: 999 }).repeatCount, MAX_REPEAT_COUNT);
		assert.equal(normaliseSettings({ repeatCount: 0 }).repeatCount, 1);
		assert.equal(normaliseSettings({ repeatCount: -4 }).repeatCount, 1);
	});

	it("defaults to a handful rather than the maximum", () => {
		assert.ok(DEFAULTS.repeatCount >= 1 && DEFAULTS.repeatCount < MAX_REPEAT_COUNT);
	});

	it("keeps a sensible value untouched", () => {
		assert.equal(normaliseSettings({ repeatCount: 5 }).repeatCount, 5);
	});
});
