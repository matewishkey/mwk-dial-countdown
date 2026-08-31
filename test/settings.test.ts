import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	DEFAULT_PRESETS,
	DEFAULT_SOUND,
	DEFAULTS,
	NO_SOUND,
	MAX_PRESET_SECONDS,
	MAX_REPEAT_COUNT,
	MAX_SOUND_REPEAT,
	MAX_TITLE_LENGTH,
	normalisePresets,
	normaliseSettings
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
			assert.equal(typeof settings.showLabel, "boolean");
			assert.equal(typeof settings.title, "string");
		}
	});

	it("upgrades the presets an older build wrote", () => {
		const legacy = {
			presets: [
				{ label: "Focus", seconds: 1500 },
				{ label: "Break", seconds: 300 }
			],
			presetIndex: 1
		};
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
		assert.equal(DEFAULTS.soundId, DEFAULT_SOUND);
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

describe("the title", () => {
	it("is empty out of the box, so an unnamed timer still shows its preset length", () => {
		assert.equal(DEFAULTS.title, "");
	});

	it("keeps what was typed", () => {
		assert.equal(normaliseSettings({ title: "Tea" }).title, "Tea");
	});

	it("trims it, since a title of spaces would win the label line and then draw nothing", () => {
		assert.equal(normaliseSettings({ title: "  Tea  " }).title, "Tea");
		assert.equal(normaliseSettings({ title: "   " }).title, "", "whitespace alone is not a title");
	});

	it("caps what is stored, so a pasted paragraph does not live in the settings for ever", () => {
		const long = "x".repeat(MAX_TITLE_LENGTH + 40);
		assert.equal(normaliseSettings({ title: long }).title.length, MAX_TITLE_LENGTH);
	});

	it("treats anything that is not a string as no title at all", () => {
		for (const rubbish of [42, null, {}, ["Tea"], true]) {
			assert.equal(normaliseSettings({ title: rubbish }).title, "");
		}
	});
});

describe("the auto-reset", () => {
	it("is off out of the box — a finished timer stays finished until it is told otherwise", () => {
		assert.equal(DEFAULTS.autoResetEnabled, false);
	});

	it("waits a minute by default", () => {
		assert.equal(DEFAULTS.autoResetSeconds, 60);
	});

	it("measures its wait in seconds, clamped like every other duration", () => {
		assert.equal(normaliseSettings({ autoResetSeconds: 15 }).autoResetSeconds, 15);
		assert.equal(normaliseSettings({ autoResetSeconds: 0 }).autoResetSeconds, 1);
		assert.equal(normaliseSettings({ autoResetSeconds: 99_999_999 }).autoResetSeconds, MAX_PRESET_SECONDS);
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

describe("settings written by an older build", () => {
	it("turns a switched-off sound into the No sound option", () => {
		// `soundEnabled` was removed in favour of the picker's own *No sound* entry. Settings outlive
		// the build that wrote them, so without this an install upgrading with the sound deliberately
		// switched off would come back making a noise — nothing else in the stored settings says the
		// user wanted silence once the flag is gone.
		const settings = normaliseSettings({ soundEnabled: false, soundId: "default" });

		assert.equal(settings.soundId, NO_SOUND);
	});

	it("leaves a switched-on sound exactly as it was", () => {
		// The positive control. If the migration read the flag the wrong way round, or fired
		// unconditionally, the test above would pass just the same.
		const chosen = "/System/Library/Sounds/Glass.aiff";

		assert.equal(normaliseSettings({ soundEnabled: true, soundId: chosen }).soundId, chosen);
		assert.equal(normaliseSettings({ soundId: chosen }).soundId, chosen, "no flag at all is not a flag set to false");
	});

	it("carries a label switch that was turned off across its rename", () => {
		// `showTitle` never named a title — it switched the label line, and now that a title is a real
		// thing you can type, keeping the old name would have been a lie. An install that had the line
		// switched off must not come back with it switched on.
		assert.equal(normaliseSettings({ showTitle: false }).showLabel, false);
	});

	it("leaves a label switch that was turned on alone", () => {
		// The positive control, again: a migration that fired unconditionally would pass the test above.
		assert.equal(normaliseSettings({ showTitle: true }).showLabel, true);
		assert.equal(normaliseSettings({}).showLabel, true, "no flag at all is not a flag set to false");
	});

	it("prefers the new name when both are present", () => {
		assert.equal(normaliseSettings({ showTitle: true, showLabel: false }).showLabel, false);
	});

	it("does not resurrect the old label switch either", () => {
		assert.ok(!("showTitle" in normaliseSettings({ showTitle: false })));
	});

	it("does not resurrect the flag itself", () => {
		// It is gone from the type; it must be gone from what is written back, or every save carries a
		// setting nothing reads and the next reader has to wonder whether it means anything.
		assert.ok(!("soundEnabled" in normaliseSettings({ soundEnabled: false })));
	});
});
