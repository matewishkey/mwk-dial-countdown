import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	DEFAULT_PRESETS,
	DEFAULT_SOUND,
	DEFAULTS,
	NO_SOUND,
	MAX_PRESET_SECONDS,
	MAX_SOUND_REPEAT,
	MAX_STAGES,
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
		assert.deepEqual(settings.presets, [[1500], [300]], "the durations are the part worth keeping");
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
		const good = { ...DEFAULTS, presets: [[30], [90, 15]], presetIndex: 1, theme: "mwk", showLogo: true, volume: 40 };
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
	it("reads a preset as the list of stages it runs", () => {
		assert.deepEqual(normalisePresets([[2400, 600, 600]]), [[2400, 600, 600]]);
	});

	it("discards stages that are not usable durations", () => {
		assert.deepEqual(normalisePresets([[60, "90", null, -5, 0, Number.NaN, 120]]), [[60, 120]]);
	});

	it("drops a preset with no usable stage left, rather than keeping an empty one", () => {
		// An empty stage list has no first stage, so everything downstream — the clock, the label, the
		// tally — would be reading `undefined` off the front of it.
		assert.deepEqual(normalisePresets([[60], ["x"], [120]]), [[60], [120]]);
	});

	it("falls back when nothing usable is left", () => {
		assert.deepEqual(normalisePresets([-1, "x"]), DEFAULT_PRESETS);
		assert.deepEqual(normalisePresets([]), DEFAULT_PRESETS);
		assert.deepEqual(normalisePresets([[]]), DEFAULT_PRESETS);
	});

	it("hands back a fresh copy of the defaults, not the defaults themselves", () => {
		// A preset list is edited in place — `push`, `splice`, `presets[i] = …`. Handing out the shared
		// default would let the first edit rewrite what every later fallback falls back to.
		const first = normalisePresets("nonsense");
		first[0].push(999);

		assert.deepEqual(normalisePresets("nonsense"), DEFAULT_PRESETS);
		assert.deepEqual(DEFAULT_PRESETS[0], [5 * 60], "the module's own defaults were edited");
	});

	it("clamps a stage longer than a day", () => {
		assert.deepEqual(normalisePresets([[99_999_999]]), [[MAX_PRESET_SECONDS]]);
	});

	it("caps how many stages one preset may hold", () => {
		const long = Array.from({ length: MAX_STAGES + 10 }, () => 60);
		assert.equal(normalisePresets([long])[0].length, MAX_STAGES);
	});
});

describe("settings written by an older build", () => {
	it("reads a preset stored as a bare number as a single-stage one", () => {
		// Every build before stages existed stored a plain duration per preset. It is the same timer,
		// said with one stage.
		assert.deepEqual(normalisePresets([300, 1200]), [[300], [1200]]);
	});

	it("still unwraps the `{ label, seconds }` presets of the build before that", () => {
		assert.deepEqual(normalisePresets([{ label: "5m", seconds: 300 }]), [[300]]);
	});

	it("turns a repeating preset into that many stages", () => {
		// `repeat: true, repeatCount: 3` on a 20 minute preset meant twenty minutes, three times over.
		// Three stages of twenty minutes is that instruction in the vocabulary that survives, and the
		// panel then shows it as `20m, 20m, 20m` — both what it does and one edit from being something
		// else. Every preset is expanded, because the switch applied to whichever one was loaded.
		const settings = normaliseSettings({ presets: [300, 1200], repeat: true, repeatCount: 3 });

		assert.deepEqual(settings.presets, [
			[300, 300, 300],
			[1200, 1200, 1200]
		]);
	});

	it("leaves a preset alone when repeat was switched off", () => {
		// The positive control. A migration that fired unconditionally, or read the flag the wrong way
		// round, would pass the test above just the same.
		assert.deepEqual(normaliseSettings({ presets: [1200], repeat: false, repeatCount: 3 }).presets, [[1200]]);
		assert.deepEqual(normaliseSettings({ presets: [1200], repeatCount: 3 }).presets, [[1200]], "no flag is not a flag");
	});

	it("treats a repeat count that is not a number as no repeat at all", () => {
		assert.deepEqual(normaliseSettings({ presets: [1200], repeat: true, repeatCount: "three" }).presets, [[1200]]);
	});

	it("does not resurrect the repeat switch", () => {
		// It is gone from the type; it must be gone from what is written back, or the next reader
		// expands a preset that has already been expanded.
		const settings = normaliseSettings({ presets: [1200], repeat: true, repeatCount: 3 });

		assert.ok(!("repeat" in settings));
		assert.ok(!("repeatCount" in settings));
	});

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
