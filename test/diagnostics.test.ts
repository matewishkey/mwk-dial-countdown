/**
 * The one-button report.
 *
 * What it replaces is a set of instructions — find the plugins folder, which differs per platform;
 * open the `.sdPlugin` directory; find `logs`; open the newest file; scroll; copy some lines. Every
 * step of that is a place to give up, so what matters here is that one press produces something
 * complete enough to act on, and that it fails legibly rather than silently when it cannot.
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { describe, it } from "node:test";

import { collectDiagnostics, streamDeckLogDir } from "../src/diagnostics.ts";

/** The real plugin folder, which is where `manifest.json` lives — the version has to come from it. */
const PLUGIN_DIR = "com.matewishkey.dial-countdown-v2.sdPlugin";

function logDir(files: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), "dial-diag-"));
	// Each file is stamped a minute newer than the last, so "newest" is well defined rather than
	// depending on how fast the filesystem records three writes in the same millisecond.
	let when = Date.now() / 1000 - 3600;
	for (const [name, body] of Object.entries(files)) {
		const path = join(dir, name);
		writeFileSync(path, body);
		utimesSync(path, when, when);
		when += 60; // each file newer than the last, so "newest" is the last one written
	}
	return dir;
}

describe("the diagnostics report", () => {
	it("names the build and the machine, so a report can be acted on without asking twice", () => {
		const report = collectDiagnostics(logDir({ "a.log": "INFO  health: cpu 1%\n" }), PLUGIN_DIR);

		// The real manifest, so this also proves the version is READ rather than defaulted to "unknown".
		assert.match(report, /^Dial Countdown \d+\.\d+\.\d+\.\d+/m, `the shipped version must be named: ${report}`);
		assert.match(report, /\d+ cores/, "the machine's size matters for every per-control cost");
		assert.match(report, /node v\d+/, "and Node's own version, not the kernel's");
	});

	it("carries the health lines AND the gesture lines", () => {
		// The two kinds of trouble this plugin has actually had: is it slow and is it us, and what did
		// the hardware really send. A report that answered only one would send someone back for the other.
		const report = collectDiagnostics(
			logDir({
				"a.log": [
					"INFO  health: cpu 0.4% lag 2ms | machine: cpu 1%",
					"INFO  dialRotate ticks=0 pressed=true down=true",
					"INFO  setting the volume to 40",
					"WARN  health: event loop ran 800ms late"
				].join("\n")
			})
		);

		assert.match(report, /health: cpu 0\.4%/, "the health line");
		assert.match(report, /dialRotate ticks=0/, "the gesture line");
		assert.match(report, /ran 800ms late/, "and the warning");
		assert.doesNotMatch(report, /setting the volume/, "but not every line the plugin ever wrote");
	});

	it("reads the NEWEST log, which is the one being written to", () => {
		const report = collectDiagnostics(
			logDir({ "old.log": "INFO  health: from an old session\n", "new.log": "INFO  health: from this session\n" })
		);

		assert.match(report, /from this session/);
		assert.doesNotMatch(report, /from an old session/, "an older rotation would date the whole report");
	});

	it("says so plainly when there is nothing to report yet", () => {
		// A button that returns an empty box reads as broken. The first health line takes a minute.
		const report = collectDiagnostics(logDir({}));
		assert.match(report, /no log file found|no health lines yet/, `should explain itself: ${report}`);
	});

	it("says where Stream Deck's OWN log is, or says plainly that it does not know", () => {
		// The application's log is a different thing from the plugin's, and it is the one that matters
		// when the complaint is that the whole machine is slow: the app is the component every plugin
		// talks through. Its path is DERIVED from Elgato's docs rather than asked of the process, so
		// unlike our own log location it can be wrong — and a wrong guess must read as an absence, not
		// as a working answer. On Linux, where Stream Deck does not run, that is exactly what it says.
		const report = collectDiagnostics(logDir({ "a.log": "INFO  health: cpu 1%\n" }), PLUGIN_DIR);

		assert.match(report, /Stream Deck's own log/, `the application's log must be accounted for either way: ${report}`);
	});

	it("knows where Stream Deck's own log lives on each platform it runs on", () => {
		// Both branches checked from whichever platform the suite happens to run on — otherwise the
		// Windows path is never executed on a Mac and vice versa, and the one that is wrong is the one
		// nobody ran. These two paths come from Elgato's logging guide.
		assert.equal(
			streamDeckLogDir("win32", "C:\\Users\\x\\AppData\\Roaming", "C:\\Users\\x"),
			"C:\\Users\\x\\AppData\\Roaming/Elgato/StreamDeck/logs".replaceAll("/", sep)
		);
		assert.equal(
			streamDeckLogDir("darwin", undefined, "/Users/x"),
			["", "Users", "x", "Library", "Logs", "ElgatoStreamDeck"].join(sep)
		);
		assert.equal(streamDeckLogDir("linux", undefined, "/home/x"), null, "Stream Deck does not run here");
		assert.equal(
			streamDeckLogDir("win32", undefined, "C:\\Users\\x"),
			null,
			"and without APPDATA there is nothing to point at"
		);
	});

	it("does not throw when the log folder is not there at all", () => {
		const report = collectDiagnostics(join(tmpdir(), "dial-diag-nonexistent-dir"));
		assert.match(report, /no log file found/, `should report the absence, not crash: ${report}`);
	});
});
