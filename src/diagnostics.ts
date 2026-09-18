/**
 * Everything someone would need to answer "what is wrong with this thing", gathered into one block of
 * text that a button can put on the clipboard.
 *
 * **It exists because the previous answer was a set of instructions, and instructions are work.** The
 * honest version ran: find your Stream Deck plugins folder, which is in a different place on each
 * platform and depends how you installed it; open the `.sdPlugin` directory; find `logs`; open the
 * newest file; scroll to the bottom; work out which lines matter; copy some of them. Every
 * step of that is a place to give up, and none of it is the user's job — they reported a slow device,
 * which is a fact about the device, not a request to go filing.
 *
 * So the plugin reads its own log, because it is the one thing that knows where that log is, and
 * hands back the part that matters.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { arch, cpus, homedir, platform, release, totalmem } from "node:os";
import { join } from "node:path";
import { cwd } from "node:process";

/** What the plugin was told about its host at registration, which only the plugin can know. */
export type HostInfo = {
	appVersion?: string;
	platform?: string;
	platformVersion?: string;
	/** Each connected device, as a name and type — which is what the power advice turns on. */
	devices?: string[];
};

/**
 * Where this plugin's log is, asked of the process rather than assumed.
 *
 * The install path differs per platform and per install method, and writing a plausible one into a
 * document is how people end up searching a folder that was never right. Stream Deck launches a
 * plugin from inside its own `.sdPlugin` folder and the SDK resolves `logs/` from the working
 * directory — so this is the answer, on whatever machine is asking.
 */
export function logLocation(): string {
	return `${cwd()}/logs`;
}

/** How much of the log's tail is read. Enough for a few hours, small enough to paste. */
const TAIL_BYTES = 48 * 1024;

/** How many matching lines are kept, newest last. */
const MAX_LINES = 60;

/** How much of the application's own log to carry. Shorter: it is context, not the subject. */
const APP_LOG_LINES = 25;

/**
 * Only the lines that bear on a problem report. A whole log is unreadable in a chat window, and
 * everything this plugin logs routinely is noise to someone reading it cold.
 *
 * This once also matched every dial gesture and a per-minute performance line. Both were added while
 * chasing a fault that turned out to be a Stream Deck drawing 500 mA through a monitor's hub — no
 * part of it was ever in this plugin — and neither earned a permanent place in everybody's log. If a
 * question needs them again, they are a few lines to add back.
 */
const INTERESTING = /WARN|ERROR/;

/**
 * Where the Stream Deck **application** keeps its own log, which is a different thing from this
 * plugin's.
 *
 * Worth having, because the plugin's log can only report on the plugin. When the complaint is that
 * the whole machine is slow and other applications are lagging too, the application's own log is
 * where its side of the story is — and it is the shared component every plugin talks through.
 *
 * Paths from Elgato's logging guide, which names exactly these two. Derived rather than asked of the
 * running process, so unlike {@link logLocation} this one *can* be wrong — which is why a miss here
 * is reported as an absence and never as an error.
 *
 * The parameters exist so both branches can be checked from either platform; nothing passes them.
 */
export function streamDeckLogDir(
	plat: string = platform(),
	appData: string | undefined = process.env.APPDATA,
	home: string = homedir()
): string | null {
	if (plat === "win32") {
		return appData === undefined ? null : join(appData, "Elgato", "StreamDeck", "logs");
	}
	if (plat === "darwin") {
		return join(home, "Library", "Logs", "ElgatoStreamDeck");
	}
	return null;
}

/** The plugin's own version, read from the manifest beside it rather than duplicated in the source. */
function pluginVersion(pluginDir: string): string {
	try {
		const manifest = JSON.parse(readFileSync(join(pluginDir, "manifest.json"), "utf8")) as { Version?: string };
		return manifest.Version ?? "unknown";
	} catch {
		return "unknown";
	}
}

/** The newest log file, which is the one the running process is writing to. */
function newestLog(dir: string): string | null {
	try {
		const files = readdirSync(dir)
			.filter((name) => name.endsWith(".log"))
			.map((name) => ({ path: join(dir, name), at: statSync(join(dir, name)).mtimeMs }))
			.sort((a, b) => b.at - a.at);
		return files[0]?.path ?? null;
	} catch {
		return null;
	}
}

/** The tail of a file, without reading the whole of it into memory. */
function tail(path: string): string[] {
	const size = statSync(path).size;
	const from = Math.max(0, size - TAIL_BYTES);
	const text = readFileSync(path, "utf8");
	// Read whole and slice: the log is capped at 50MB by the SDK, and a partial read can split a
	// multi-byte character. Correctness over cleverness on a path that runs once, on a button press.
	return text.slice(from === 0 ? 0 : text.length - TAIL_BYTES).split("\n");
}

/**
 * The report, as plain text ready to paste.
 *
 * Deliberately not JSON: it is going into a chat message or an issue, where a human reads it first.
 *
 * @param logDir Only a test passes this. In the plugin it is wherever the process is running from.
 * @param pluginDir Likewise — the folder holding `manifest.json`, which is the plugin's own.
 */
export function collectDiagnostics(
	logDir: string = logLocation(),
	pluginDir: string = cwd(),
	host: HostInfo = {}
): string {
	const lines: string[] = [];
	lines.push(`Dial Countdown ${pluginVersion(pluginDir)}`);
	// `process.version` is Node's. `os.version()` is the KERNEL's, and on Linux it reads as a
	// plausible Node version while being nothing of the sort — it printed `node #139-Ubuntu SMP` here.
	lines.push(
		`${platform()} ${release()} ${arch()} · ${cpus().length} cores · ${(totalmem() / 1024 ** 3).toFixed(0)}GB · node ${process.version}`
	);
	// **The Stream Deck application's own version, and the device.** Added after researching what is
	// actually reported when a Stream Deck stops responding: the two answers that come back most are
	// an out-of-date application and a device not getting enough power through a hub. Neither can be
	// asked about usefully without knowing which version and which device — and asking the user costs
	// a round trip, on a report whose whole point is that it takes one press.
	if (host.appVersion !== undefined || host.platform !== undefined) {
		lines.push(`Stream Deck ${host.appVersion ?? "?"} on ${host.platform ?? "?"} ${host.platformVersion ?? ""}`.trim());
	}
	if (host.devices !== undefined && host.devices.length > 0) {
		lines.push(`devices: ${host.devices.join(", ")}`);
	}
	lines.push(`log: ${logDir}`);
	lines.push("");

	const path = newestLog(logDir);
	if (path === null) {
		lines.push("(no log file found — this plugin may have only just started)");
		return lines.join("\n");
	}

	let kept: string[];
	try {
		kept = tail(path)
			.filter((line) => INTERESTING.test(line))
			.slice(-MAX_LINES);
	} catch (err) {
		lines.push(`(could not read the log: ${err instanceof Error ? err.message : String(err)})`);
		return lines.join("\n");
	}

	if (kept.length === 0) {
		lines.push("(no warnings or errors logged — which is the good answer)");
	} else {
		lines.push(`last ${kept.length} warnings and errors:`);
		lines.push(...kept);
	}

	lines.push("");
	lines.push(...streamDeckAppLog());
	return lines.join("\n");
}

/**
 * The tail of the Stream Deck application's own log.
 *
 * Unfiltered, unlike this plugin's: its format is Elgato's and not ours to have opinions about, so
 * picking lines out of it would mean guessing at which ones matter. A short tail of everything is
 * more honest than a filtered view built on an assumption.
 */
function streamDeckAppLog(): string[] {
	const dir = streamDeckLogDir();
	if (dir === null) {
		return [`(Stream Deck's own log: no known location on ${platform()})`];
	}

	const path = newestLog(dir);
	if (path === null) {
		return [`(Stream Deck's own log: nothing found in ${dir})`];
	}

	try {
		const recent = tail(path)
			.filter((line) => line.trim() !== "")
			.slice(-APP_LOG_LINES);
		return [`last ${recent.length} lines of Stream Deck's own log (${path}):`, ...recent];
	} catch (err) {
		return [`(Stream Deck's own log could not be read: ${err instanceof Error ? err.message : String(err)})`];
	}
}
