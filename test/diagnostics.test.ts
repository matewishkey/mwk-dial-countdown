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
import { join } from "node:path";
import { describe, it } from "node:test";

import { collectDiagnostics } from "../src/diagnostics.ts";

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

	it("does not throw when the log folder is not there at all", () => {
		const report = collectDiagnostics(join(tmpdir(), "dial-diag-nonexistent-dir"));
		assert.match(report, /no log file found/, `should report the absence, not crash: ${report}`);
	});
});
