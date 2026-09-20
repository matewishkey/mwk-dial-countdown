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

const { FADE_AFTER_PLAYS, listSounds, resolveSound, sequence, soundExists, volumeForPlay, wantsSound } =
	await import("../src/sound.ts");
type Launch = import("../src/sound.ts").Launch;

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

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

/**
 * The run of plays itself: when each one starts, and what stops them.
 *
 * `sequence` is the part of `src/sound.ts` that had the bug and had no coverage, and it is separated
 * from `playSound` precisely so it can be driven here — the launcher is injected, so nothing spawns
 * and nothing makes a noise on the machine running the suite.
 *
 * The fake launcher hands back a `finish` for each play, so a test decides exactly when a sound
 * "ends". That is the whole substance of the fix: a play begins when the previous one has *finished*,
 * not when a stopwatch says it probably has.
 */
describe("sequence", () => {
	/** A launcher that records every play and lets the test end each one by hand. */
	function fakePlayer(options: { failFrom?: number } = {}): {
		launch: Launch;
		plays: number[];
		killed: number[];
		finish: (play: number, ok?: boolean) => void;
	} {
		const plays: number[] = [];
		const killed: number[] = [];
		const enders = new Map<number, (ok: boolean) => void>();

		return {
			plays,
			killed,
			launch: (play, done) => {
				if (options.failFrom !== undefined && play >= options.failFrom) {
					return null;
				}
				plays.push(play);
				enders.set(play, done);
				return () => killed.push(play);
			},
			finish: (play, ok = true) => enders.get(play)?.(ok)
		};
	}

	it("starts the next play only once the previous one has ended", async () => {
		const player = fakePlayer();
		const playback = sequence(3, 1, player.launch);

		// **The bug, stated as a test.** The old code scheduled all three from the start, so all three
		// would already be here — and with a 2.00 s chime against a 900 ms offset, all three would have
		// been sounding at once, which is exactly what was reported.
		assert.deepEqual(player.plays, [0], "only the first play should have started");

		player.finish(0);
		await wait(10);
		assert.deepEqual(player.plays, [0, 1]);

		player.finish(1);
		await wait(10);
		assert.deepEqual(player.plays, [0, 1, 2]);

		assert.equal(playback?.active, true, "still going while the last play runs");
		player.finish(2);
		assert.equal(playback?.active, false, "and done once it ends");
	});

	it("waits the gap between one play ending and the next beginning", async () => {
		const player = fakePlayer();
		sequence(2, 60, player.launch);

		player.finish(0);
		assert.deepEqual(player.plays, [0], "the gap has not elapsed yet");

		await wait(120);
		assert.deepEqual(player.plays, [0, 1]);
	});

	it("stops mid-run: kills the play in progress and starts no more", async () => {
		const player = fakePlayer();
		const playback = sequence(5, 1, player.launch);

		playback?.stop();

		assert.deepEqual(player.killed, [0], "the sound that was actually playing has to be cut off");
		assert.equal(playback?.active, false);

		// Nothing is in flight to revive it, but the wait is the point: a stopped run stays stopped.
		await wait(20);
		assert.deepEqual(player.plays, [0]);
	});

	it("stops during the gap, before the next play has begun", async () => {
		const player = fakePlayer();
		const playback = sequence(5, 60, player.launch);

		player.finish(0);
		playback?.stop();

		await wait(120);
		// What this proves is that no further play begins, which is the behaviour that matters. It
		// deliberately does not claim the pending timer was *cleared*: `stop` clears it and `next` also
		// refuses to run once the sequence is inactive, and from out here the two are indistinguishable.
		// A mutation run confirmed it — deleting the `clearTimeout` left this test green. The clear stays
		// because releasing a timer early is worth doing; the guard in `next` is what makes it correct.
		assert.deepEqual(player.plays, [0], "no further play may begin after a stop");
		assert.deepEqual(player.killed, [], "there was nothing playing to kill");
	});

	it("is safe to stop twice, and after it has finished on its own", () => {
		const player = fakePlayer();
		const playback = sequence(1, 1, player.launch);

		player.finish(0);
		assert.equal(playback?.active, false);

		playback?.stop();
		playback?.stop();
		assert.deepEqual(player.killed, [], "a run that already ended has nothing left to kill");
	});

	it("answers null when the very first play could not be started", () => {
		// What `playerFor` does on Linux, and what a missing `afplay` does anywhere. The caller needs
		// to tell this from silence the user asked for — see `wantsSound`.
		const player = fakePlayer({ failFrom: 0 });
		assert.equal(sequence(3, 1, player.launch), null);
	});

	it("gives up rather than relaunching a player that failed", async () => {
		// A run of sixty against a player that is not installed would otherwise be sixty doomed spawns.
		const player = fakePlayer();
		const playback = sequence(60, 1, player.launch);

		player.finish(0, false);
		await wait(20);

		assert.deepEqual(player.plays, [0]);
		assert.equal(playback?.active, false);
	});
});

describe("volumeForPlay", () => {
	it("leaves every play at the chosen volume when the fade is off", () => {
		for (const play of [0, 1, 2, 3, 10, 59]) {
			assert.equal(volumeForPlay(play, 0.8, false), 0.8);
		}
	});

	it("keeps the first three plays at full volume", () => {
		// Those are the ones that have to be heard; the fade is about what comes after.
		for (const play of [0, 1, 2]) {
			assert.equal(volumeForPlay(play, 1, true), 1, `play ${play} should not be faded`);
		}
	});

	it("drops to half from the fourth play onwards", () => {
		assert.equal(volumeForPlay(3, 1, true), 0.5);
		assert.equal(volumeForPlay(4, 1, true), 0.5);
		assert.equal(volumeForPlay(59, 1, true), 0.5);
	});

	it("halves the chosen volume rather than jumping to a fixed level", () => {
		// Half of *your* volume. A fade that landed on 50% of full scale would make a quiet alarm
		// louder as it went on.
		assert.equal(volumeForPlay(FADE_AFTER_PLAYS, 0.4, true), 0.2);
	});
});
