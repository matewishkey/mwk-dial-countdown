/**
 * The self-report, which exists to answer "the device feels slow" from the user's own machine.
 *
 * Driven with short intervals rather than the shipped minute — the defaults are what ships, and what
 * is under test here is that the numbers reach the log at all and that a blocked loop is noticed.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { recordFrame, recordRefresh, setControlCount, startHealthLog } from "../src/health.ts";

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** A logger that records instead of writing, so the lines can be asserted on. */
function recorder(): { info: string[]; warn: string[]; log: { info(m: string): void; warn(m: string): void } } {
	const info: string[] = [];
	const warn: string[] = [];
	return { info, warn, log: { info: (m) => void info.push(m), warn: (m) => void warn.push(m) } };
}

describe("the health report", () => {
	it("writes a line carrying every number needed to tell the three causes apart", async () => {
		// Asserted on the VALUES, not on the field names. Checking that the line merely contains the
		// word `controls` passes against a report that has hard-coded every number in it — and a
		// health report that always says the same thing is worse than none, because it reads as
		// evidence. The control count here is deliberately an odd number no default would produce.
		const seen = recorder();
		const stop = startHealthLog(seen.log, { reportIntervalMs: 150, lagSampleMs: 40 });
		try {
			setControlCount("Encoder", 3);
			setControlCount("Keypad", 4);
			recordFrame();
			recordFrame();
			recordRefresh(3.5);
			await wait(350);
		} finally {
			stop();
		}

		assert.ok(seen.info.length >= 1, "a summary line must be written");
		const line = seen.info[0];
		assert.match(line, /controls 7\b/, `the two actions' counts must be SUMMED, not overwritten: ${line}`);
		assert.match(line, /slowest-render 3\.5ms/, `the slowest render must be the one recorded: ${line}`);
		assert.match(line, /frames [1-9]/, `two frames in ~150ms is more than 1/s: ${line}`);
		assert.match(line, /cpu \d+\.\d+% rss \d+MB/, `cpu and memory must be real numbers: ${line}`);
	});

	it("reports the worst lag it saw, not merely the word `lag`", async () => {
		// Guards the sampler rather than the warning: the two are separate, and the warning reads the
		// lateness directly, so stubbing out the high-water mark left the summary saying `lag 0ms`
		// for ever while the warning still fired correctly.
		const seen = recorder();
		const stop = startHealthLog(seen.log, { reportIntervalMs: 600, lagSampleMs: 40, lagWarnMs: 10_000 });
		try {
			const until = Date.now() + 300;
			while (Date.now() < until) {
				/* block the loop outright */
			}
			await wait(700);
		} finally {
			stop();
		}

		const line = seen.info[0] ?? "";
		const lag = Number(/lag (\d+)ms/.exec(line)?.[1] ?? "0");
		assert.ok(lag >= 200, `a 300ms stall must show up as lag, and the line reads: ${line}`);
	});

	it("warns when the event loop runs late enough to change what a gesture means", async () => {
		// The case the whole file exists for: a plugin that is BLOCKED rather than busy. CPU stays low
		// and nothing renders slowly, but dial events sit unread and the double-tap window drifts with
		// them — so only lag separates this from a plugin that is simply working hard.
		const seen = recorder();
		const stop = startHealthLog(seen.log, { reportIntervalMs: 5_000, lagSampleMs: 40, lagWarnMs: 150 });
		try {
			await wait(80);
			// Block the loop outright, as a synchronous stall on the real machine would.
			const until = Date.now() + 400;
			while (Date.now() < until) {
				/* deliberately hot */
			}
			await wait(200);
		} finally {
			stop();
		}

		assert.equal(seen.warn.length, 1, `expected one warning, got ${JSON.stringify(seen.warn)}`);
		assert.match(seen.warn[0], /event loop ran \d+ms late/);
	});

	it("says nothing about lag on a loop that is keeping up", async () => {
		// The positive control. Without it the warning above could be fired by any run at all.
		const seen = recorder();
		const stop = startHealthLog(seen.log, { reportIntervalMs: 5_000, lagSampleMs: 40, lagWarnMs: 150 });
		try {
			await wait(400);
		} finally {
			stop();
		}

		assert.deepEqual(seen.warn, [], "an idle plugin must not cry wolf");
	});
});
