/**
 * Sound playback.
 *
 * The Stream Deck SDK has no audio API, so the plugin plays sound by handing a file to whatever the
 * operating system ships with. Nothing here hard-codes a sound that might not exist: the bundled
 * sounds are read from the plugin's own folder, and the system sounds are enumerated from disk, so
 * an unavailable sound is simply absent from the list rather than a path that fails at 2am.
 *
 * **A run of plays is one object you can stop, not a burst of unowned `setTimeout`s.** It used to be
 * the latter, and that one line held two bugs: the plays overlapped each other (see
 * {@link REPEAT_GAP_MS}), and nothing anywhere could call them off (see {@link sequence}).
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

import { CUSTOM_SOUND, DEFAULT_SOUND, MAX_SOUND_REPEAT, NO_SOUND } from "./settings";

export type SoundOption = {
	/** Absolute path, or one of the sentinels from settings. */
	id: string;
	label: string;
	group: "Bundled" | "System";
};

/** The sound a fresh install uses, and the fallback when a chosen one has gone missing. */
const DEFAULT_SOUND_FILE = "chime.wav";

/**
 * Silence between one play ending and the next beginning.
 *
 * **Measured from the end of the previous play, which is the whole of the fix.** It used to be
 * measured from the *start*: every repeat was scheduled at `i * 900 ms` from the moment the first
 * one was launched, on the stated reasoning that 900 ms was "long enough that two plays do not run
 * into one another". Nothing had checked that against the files the plugin ships. `chime.wav` — the
 * default — is 2.00 s, and `alarm.wav` is 1.95 s, so the second play began while the first was still
 * sounding and the third while both were. What you heard was one chime, then two at once, then
 * three, and never more than three, because by the fourth the 2.7 s offset had finally cleared the
 * 2.00 s file. That is exactly how it was reported.
 *
 * The gap cannot be got right from a constant, because it depends on a file the user chose — so it
 * is not got from a constant any more. {@link sequence} waits for the player process to *exit*,
 * which both platforms' players do only when the sound has finished, and this is the pause it leaves
 * afterwards. Long enough to read as separate rings; short enough to be an alarm.
 */
const REPEAT_GAP_MS = 500;

/**
 * How many plays sound at the chosen volume before the fade takes hold, when it is switched on.
 *
 * A step rather than a ramp, deliberately: the ask was for something that stops a long alarm boring
 * a hole in the room, not a curve. Three full-volume plays is the part that has to be heard.
 */
export const FADE_AFTER_PLAYS = 3;

/** What the fade drops to, as a fraction of the chosen volume. */
export const FADED_VOLUME = 0.5;

/** Sounds shipped inside the plugin; always present, on every platform. */
const BUNDLED_DIR = resolve(process.cwd(), "sounds");

/**
 * Where each platform keeps its own alert sounds. These are read, never assumed — if the directory
 * is missing or empty the system group is simply absent.
 */
const SYSTEM_DIRS: Partial<Record<NodeJS.Platform, string[]>> = {
	darwin: ["/System/Library/Sounds", join(process.env.HOME ?? "", "Library/Sounds")],
	win32: [join(process.env.SystemRoot ?? "C:\\Windows", "Media")]
};

const PLAYABLE = new Set([".wav", ".aiff", ".aif", ".mp3", ".m4a"]);

/** Absolute path of the bundled default, whatever the plugin folder turns out to be. */
function defaultSoundPath(): string {
	return join(BUNDLED_DIR, DEFAULT_SOUND_FILE);
}

/**
 * Turns the sound settings into the single path that will actually be played. The sentinels are
 * resolved here rather than stored, since a bundled sound's path is only known at runtime and a
 * stored absolute path would break the moment the plugin moved.
 */
export function resolveSound(settings: { soundId?: string; customSoundPath?: string }): string {
	if (settings.soundId === CUSTOM_SOUND) {
		return settings.customSoundPath || NO_SOUND;
	}
	if (settings.soundId === DEFAULT_SOUND || settings.soundId === undefined) {
		return defaultSoundPath();
	}
	return settings.soundId;
}

/** Everything the user can pick from, ready for the property inspector. */
export function listSounds(): SoundOption[] {
	const options: SoundOption[] = [
		{ id: NO_SOUND, label: "No sound", group: "Bundled" },
		{ id: DEFAULT_SOUND, label: "Default (Chime)", group: "Bundled" }
	];

	for (const [dir, group] of [
		[BUNDLED_DIR, "Bundled"] as const,
		...(SYSTEM_DIRS[process.platform] ?? []).map((dir) => [dir, "System"] as const)
	]) {
		options.push(...readSoundDir(dir, group));
	}

	return options;
}

function readSoundDir(dir: string, group: SoundOption["group"]): SoundOption[] {
	if (!existsSync(dir)) {
		return [];
	}

	try {
		return readdirSync(dir)
			.filter((file) => PLAYABLE.has(extname(file).toLowerCase()))
			.sort((a, b) => a.localeCompare(b))
			.map((file) => ({
				id: join(dir, file),
				label: titleCase(basename(file, extname(file))),
				group
			}));
	} catch {
		// An unreadable sound directory is not worth failing a timer over.
		return [];
	}
}

function titleCase(name: string): string {
	return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Whether a chosen sound will actually play. The property inspector uses this to tell the user that
 * a picked file did not resolve, rather than leaving them to discover it when the timer ends.
 */
export function soundExists(path: string | undefined): boolean {
	return typeof path === "string" && path.length > 0 && path !== NO_SOUND && existsSync(path);
}

/**
 * Whether a sound was asked for at all.
 *
 * **There are two ways to ask for silence, and neither one is a failure:** pick *No sound* in the
 * picker, or pull the volume to zero. This exists because only one of them was being honoured — a
 * timer set to *No sound* still took the "the alert did not play" branch and raised Stream Deck's
 * error triangle on every finish, on a countdown that had done exactly what it was configured to do.
 *
 * Kept here, next to {@link playSound}, because it answers a question about the same settings and
 * has to stay true as they change. See the alert in `actions/countdown-action.ts`.
 */
export function wantsSound(path: string | undefined, volumePercent: number): boolean {
	return path !== undefined && path !== NO_SOUND && volumePercent > 0;
}

/**
 * A run of plays, in progress.
 *
 * **The handle that did not exist.** Repeats used to be a fan of `setTimeout`s that nothing held, so
 * there was no way to say "stop" — not when a second stage ran out on top of the first, not when the
 * user pressed the control, not when the inspector's *Test* button was clicked twice. Everything
 * that follows from the ring mode needs this one object.
 */
export type Playback = {
	/** True until the last play has finished, or {@link Playback.stop} was called. */
	readonly active: boolean;
	/** Silences it now: the play in progress is killed, and no later one begins. Safe to repeat. */
	stop(): void;
};

/**
 * Starts one play and returns how to cancel it, or `null` if it could not be started at all.
 *
 * `done(true)` when the sound finished on its own, `done(false)` when the player failed — which ends
 * the run rather than trying the same doomed launch another nineteen times.
 */
export type Launch = (play: number, done: (ok: boolean) => void) => (() => void) | null;

/**
 * Runs `plays` plays back to back, each beginning `gapMs` after the last one *ended*.
 *
 * Separated from {@link playSound} so the part with all the ordering in it can be tested without an
 * audio device: everything below is about when a play starts and what stops it, and none of it needs
 * to know that a play is a process. `test/sound.test.ts` drives it with a fake launcher.
 *
 * @returns `null` when the very first play could not be started, which is the one case a caller has
 * to report — see `wantsSound`.
 */
export function sequence(plays: number, gapMs: number, launch: Launch): Playback | null {
	let index = 0;
	let active = true;
	let launched = false;
	let cancelCurrent: (() => void) | null = null;
	let gapHandle: NodeJS.Timeout | null = null;

	const finish = (): void => {
		active = false;
		cancelCurrent = null;
	};

	const next = (): void => {
		if (!active || index >= plays) {
			finish();
			return;
		}

		const play = index;
		index += 1;

		// A launcher is free to call `done` synchronously — the test one does — so the canceller is
		// only kept if the play is still running by the time it comes back. Without this the returned
		// canceller would land on top of the `null` that finishing had just written, leaving `stop`
		// holding a dead process.
		let ended = false;
		const cancel = launch(play, (ok) => {
			if (ended) {
				return;
			}
			ended = true;
			cancelCurrent = null;

			if (!active || !ok || index >= plays) {
				finish();
				return;
			}

			gapHandle = setTimeout(() => {
				gapHandle = null;
				next();
			}, gapMs);
			gapHandle.unref?.();
		});

		if (cancel === null) {
			finish();
			return;
		}

		launched = true;
		if (!ended) {
			cancelCurrent = cancel;
		}
	};

	next();

	if (!launched) {
		return null;
	}

	return {
		get active(): boolean {
			return active;
		},
		stop(): void {
			if (!active) {
				return;
			}
			active = false;

			// Hygiene rather than the guard: `next` refuses to run once `active` is false, so a gap
			// timer left pending would fire and do nothing anyway. Clearing it releases it now,
			// which is worth doing on a run of sixty that somebody has just silenced.
			if (gapHandle !== null) {
				clearTimeout(gapHandle);
				gapHandle = null;
			}

			const cancel = cancelCurrent;
			cancelCurrent = null;
			cancel?.();
		}
	};
}

/**
 * The volume one play sounds at, as a fraction of full scale.
 *
 * @param play Which play this is, counted from zero.
 * @param volume The chosen volume, 0-1.
 * @param fade Whether the later plays drop to {@link FADED_VOLUME}.
 */
export function volumeForPlay(play: number, volume: number, fade: boolean): number {
	if (!fade || play < FADE_AFTER_PLAYS) {
		return volume;
	}
	return volume * FADED_VOLUME;
}

/**
 * Plays a sound, detached, and never throws — a timer that finishes silently is a disappointment,
 * but one that crashes the plugin is a bug.
 *
 * @param soundId Absolute path to a sound file, or {@link NO_SOUND}.
 * @param volumePercent 0-100, as set in the property inspector.
 * @param repeat How many times to play it, one after the other rather than on top of each other.
 * @param fade Whether to drop to half volume after the first few plays.
 * @returns The run in progress, or `null` if nothing was launched.
 */
export function playSound(soundId: string | undefined, volumePercent = 100, repeat = 1, fade = false): Playback | null {
	if (!soundId || soundId === NO_SOUND || !existsSync(soundId)) {
		return null;
	}

	const volume = Math.max(0, Math.min(100, volumePercent)) / 100;
	if (volume === 0) {
		return null;
	}

	const plays = Math.max(1, Math.min(MAX_SOUND_REPEAT, Math.round(repeat)));

	return sequence(plays, REPEAT_GAP_MS, (play, done) =>
		launch(playerFor(soundId, volumeForPlay(play, volume, fade)), done)
	);
}

/**
 * Spawns one player and reports when it is done.
 *
 * **Exit is the signal.** `afplay` runs for as long as the sound does, and the PowerShell script
 * sleeps for the file's own `NaturalDuration`, so "the process closed" means "the sound finished" on
 * both platforms — without this plugin having to parse a WAV header, or an MP3, or an AIFF.
 */
function launch(command: { file: string; args: string[] } | null, done: (ok: boolean) => void): (() => void) | null {
	if (command === null) {
		return null;
	}

	try {
		const child = spawn(command.file, command.args, { stdio: "ignore", detached: true });

		// `error` and `close` can both arrive for a player that is not installed, so whichever comes
		// first is the one that counts. A missing player reports failure, which ends the run.
		let settled = false;
		const settle = (ok: boolean): void => {
			if (settled) {
				return;
			}
			settled = true;
			done(ok);
		};

		child.on("error", () => settle(false));
		child.on("close", () => settle(true));
		child.unref();

		return () => {
			try {
				child.kill();
			} catch {
				/* Already gone, which is the state the caller was asking for. */
			}
		};
	} catch {
		return null;
	}
}

function playerFor(soundId: string, volume: number): { file: string; args: string[] } | null {
	switch (process.platform) {
		case "darwin":
			// afplay's -v is a linear gain where 1 is the file's normal level.
			return { file: "afplay", args: ["-v", volume.toFixed(2), soundId] };

		case "win32":
			// SoundPlayer has no volume control, so this uses MediaPlayer from WPF, which does. The
			// script has to wait for playback to open and finish before the host process exits.
			return {
				file: "powershell",
				args: [
					"-NoProfile",
					"-NonInteractive",
					"-Command",
					[
						"Add-Type -AssemblyName presentationCore;",
						"$p = New-Object System.Windows.Media.MediaPlayer;",
						`$p.Open([uri]'${soundId.replace(/'/g, "''")}');`,
						`$p.Volume = ${volume.toFixed(2)};`,
						"Start-Sleep -Milliseconds 400;",
						"$p.Play();",
						"Start-Sleep -Seconds ([Math]::Max(1, $p.NaturalDuration.TimeSpan.TotalSeconds));",
						"$p.Close();"
					].join(" ")
				]
			};

		default:
			return null;
	}
}
