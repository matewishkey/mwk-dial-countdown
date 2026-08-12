/**
 * Sound playback.
 *
 * The Stream Deck SDK has no audio API, so the plugin plays sound by handing a file to whatever the
 * operating system ships with. Nothing here hard-codes a sound that might not exist: the bundled
 * sounds are read from the plugin's own folder, and the system sounds are enumerated from disk, so
 * an unavailable sound is simply absent from the list rather than a path that fails at 2am.
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

export type SoundOption = {
	/** Absolute path, or `"none"`. */
	id: string;
	label: string;
	group: "Bundled" | "System";
};

export const NO_SOUND = "none";

/** Sentinel for "use the file the user picked", whose path lives separately in settings. */
export const CUSTOM_SOUND = "custom";

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

/** Everything the user can pick from, ready for the property inspector. */
export function listSounds(): SoundOption[] {
	const options: SoundOption[] = [{ id: NO_SOUND, label: "No sound", group: "Bundled" }];

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
 * Plays a sound, detached, and never throws — a timer that finishes silently is a disappointment,
 * but one that crashes the plugin is a bug.
 *
 * @param soundId Absolute path to a sound file, or {@link NO_SOUND}.
 * @param volumePercent 0-100, as set in the property inspector.
 * @returns `true` if a player was launched.
 */
export function playSound(soundId: string | undefined, volumePercent = 100): boolean {
	if (!soundId || soundId === NO_SOUND || !existsSync(soundId)) {
		return false;
	}

	const volume = Math.max(0, Math.min(100, volumePercent)) / 100;
	if (volume === 0) {
		return false;
	}

	const command = playerFor(soundId, volume);
	if (command === null) {
		return false;
	}

	try {
		const child = spawn(command.file, command.args, { stdio: "ignore", detached: true });
		child.on("error", () => {
			/* No player available; silence is the correct fallback. */
		});
		child.unref();
		return true;
	} catch {
		return false;
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
