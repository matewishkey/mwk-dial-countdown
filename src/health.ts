/**
 * What this plugin is costing the machine it runs on, written to its own log.
 *
 * **It exists because "the device feels slow" is not a claim anyone can check from a developer's
 * desk.** Every performance question this plugin has raised has been answered by measuring a mock
 * host on a Linux box with one control on it — which says nothing about a Stream Deck + with four
 * dials and eight keys, on Windows, with a dozen other plugins running beside it. The rendering was
 * measured at 4 µs a frame and the process at under 1% of a core, and both of those numbers are true
 * and neither of them is evidence about the hardware in front of the user.
 *
 * So the plugin reports on itself, in the log the user already has, in a form that can be read back
 * without any tooling. Four things, because between them they separate the three explanations:
 *
 * - **`cpu`** — this process's own share of one core. Ours to fix if it is high.
 * - **`lag`** — the worst the event loop ran late. **This is the one that matters for "not
 *   responsive".** Node is single-threaded: while it is behind, dial events sit unread, the render
 *   loop does not tick, and the gesture windows that decide a tap from a double tap drift with it. A
 *   plugin at 1% CPU and 400 ms of lag is a plugin that is *blocked*, not busy, and only this tells
 *   the two apart.
 * - **`frames`** — messages pushed to Stream Deck per second. Ours to fix if it is high, and the one
 *   number that grows with how many controls the user has placed.
 * - **`slowest`** — the longest single render pass. Names *us* as the cause of lag, if we are.
 *
 * One line a minute, and a `WARN` the moment lag crosses {@link LAG_WARN_MS}, so a freeze has a
 * timestamp to point at rather than having to be caught inside the minute it happened.
 */

import { cpus, freemem, totalmem } from "node:os";
import { cwd } from "node:process";

/** Just the two levels this writes at, so a test can pass a recorder instead of the SDK's logger. */
export type HealthLogger = { info(message: string): void; warn(message: string): void };

/** Only for tests, which cannot wait a minute for a line. The defaults are the shipped behaviour. */
export type HealthOptions = {
	reportIntervalMs?: number;
	lagSampleMs?: number;
	lagWarnMs?: number;
	/**
	 * A round trip to the Stream Deck application, timed to produce `rtt`. See {@link RTT_TIMEOUT_MS}.
	 */
	probe?: () => Promise<unknown>;
};

/**
 * How long a round trip is waited for before it is called lost.
 *
 * **`rtt` is the number that answers "is something else on this machine blocking us".** Every plugin
 * runs in its own process, so another plugin cannot stall *this* event loop — but all of them talk to
 * the one Stream Deck application, which drives the one USB device, and that is genuinely shared. A
 * plugin flooding the application would leave our `cpu` and `lag` looking perfectly healthy while the
 * hardware crawled, and no measurement taken inside this process would show it. This one does: it is
 * the application's own answering time.
 *
 * The probe asks for the *global* settings, which this plugin does not use and has no handler for, so
 * timing it cannot disturb anything. Asking for an action's settings would have worked too and would
 * have fired this plugin's own `didReceiveSettings` once a minute, re-applying settings nobody
 * changed — a measurement that alters what it measures.
 */
const RTT_TIMEOUT_MS = 5_000;

/** How often the summary line is written. */
const REPORT_INTERVAL_MS = 60_000;

/** How often the event loop is probed for lateness. */
const LAG_SAMPLE_MS = 500;

/**
 * Lag past which a line is written at once rather than waiting for the next summary.
 *
 * 250 ms is not arbitrary: it is the touchscreen's double-tap window. Once the loop is running that
 * late, the plugin can no longer tell a single tap from half of a double one, because the delay is
 * as long as the thing it is measuring. That is the point where slowness stops being cosmetic and
 * starts changing what a gesture means.
 */
const LAG_WARN_MS = 250;

/**
 * The machine's own CPU, not just this process's.
 *
 * **Added because the report came back "other apps are lagging as well".** Every number here until
 * now was about this plugin, and all of them can read perfectly healthy on a machine that is on its
 * knees — a starved process uses little CPU precisely *because* it is not being scheduled. So the
 * line would have said `cpu 0.2%` and looked like an exoneration when it was a symptom.
 *
 * Derived from per-core times rather than a load average, because `os.loadavg()` returns zeroes on
 * Windows and this has to mean the same thing on both.
 */
let lastCpuTimes = cpuTimes();

function cpuTimes(): { idle: number; total: number } {
	let idle = 0;
	let total = 0;
	for (const core of cpus()) {
		idle += core.times.idle;
		total += core.times.user + core.times.nice + core.times.sys + core.times.idle + core.times.irq;
	}
	return { idle, total };
}

/** The whole machine's CPU use since this was last called, as a percentage. */
function systemCpuPct(): number {
	const now = cpuTimes();
	const idle = now.idle - lastCpuTimes.idle;
	const total = now.total - lastCpuTimes.total;
	lastCpuTimes = now;
	return total <= 0 ? 0 : (1 - idle / total) * 100;
}

/** The last line written, so the property inspector can show it without anyone finding a file. */
let latest = "no report yet — the first lands about a minute after Stream Deck starts";

let frames = 0;
let slowestRefreshMs = 0;
let worstLagMs = 0;
/**
 * Controls on screen, **counted per action rather than in one total.**
 *
 * The dial and the key are separate `SingletonAction`s with separate instance maps, so a single
 * shared number is written twice per change and whichever ran last wins. Measured: four dials and
 * eight keys on screen reported `controls 8`. The count exists to be multiplied by the per-control
 * costs beside it, so an undercount makes the whole line read better than the truth — the one
 * direction a health report must never be wrong in.
 */
const controlsByAction = new Map<string, number>();
let lastCpu = process.cpuUsage();
let lastAt = Date.now();

/** Counts one message pushed to Stream Deck. */
export function recordFrame(): void {
	frames += 1;
}

/** Records how long one pass of the render loop took. */
export function recordRefresh(ms: number): void {
	if (ms > slowestRefreshMs) {
		slowestRefreshMs = ms;
	}
}

/**
 * How many controls one action has on screen, which is what every per-control cost multiplies by.
 *
 * @param action Which action is reporting — its own instances only. See {@link controlsByAction}.
 */
export function setControlCount(action: string, n: number): void {
	controlsByAction.set(action, n);
}

function totalControls(): number {
	let total = 0;
	for (const n of controlsByAction.values()) {
		total += n;
	}
	return total;
}

/**
 * Starts reporting. Returns a stop function, so a test can drive this without leaking two intervals
 * into the suite — both are `unref`'d as well, so neither can hold the process open by itself.
 */
export function startHealthLog(logger: HealthLogger, options: HealthOptions = {}): () => void {
	const reportMs = options.reportIntervalMs ?? REPORT_INTERVAL_MS;
	const sampleMs = options.lagSampleMs ?? LAG_SAMPLE_MS;
	const warnMs = options.lagWarnMs ?? LAG_WARN_MS;
	let warnedAt = 0;

	let expected = Date.now() + sampleMs;
	const lagTimer = setInterval(() => {
		const late = Date.now() - expected;
		expected = Date.now() + sampleMs;
		if (late > worstLagMs) {
			worstLagMs = late;
		}
		// Rate-limited to one a minute: a machine that is struggling would otherwise write a line
		// every half second, which is itself work, on a plugin that is already behind.
		if (late >= warnMs && Date.now() - warnedAt >= reportMs) {
			warnedAt = Date.now();
			logger.warn(`health: event loop ran ${late}ms late — gestures and the clock will both drift`);
		}
	}, sampleMs);

	const reportTimer = setInterval(() => {
		void report();
	}, reportMs);

	async function report(): Promise<void> {
		const rtt = await measureRoundTrip(options.probe);
		const cpu = process.cpuUsage(lastCpu);
		const elapsedMs = Date.now() - lastAt;
		lastCpu = process.cpuUsage();
		lastAt = Date.now();

		const cpuPct = ((cpu.user + cpu.system) / 1000 / elapsedMs) * 100;
		const rssMb = process.memoryUsage().rss / 1024 / 1024;

		latest =
			`health: cpu ${cpuPct.toFixed(1)}% rss ${rssMb.toFixed(0)}MB controls ${totalControls()} ` +
			`frames ${(frames / (elapsedMs / 1000)).toFixed(1)}/s lag ${worstLagMs}ms ` +
			`slowest-render ${slowestRefreshMs.toFixed(1)}ms rtt ${rtt} ` +
			`| machine: cpu ${systemCpuPct().toFixed(0)}% free-mem ${(freemem() / 1024 / 1024 / 1024).toFixed(1)}/${(totalmem() / 1024 / 1024 / 1024).toFixed(0)}GB`;

		logger.info(latest);

		frames = 0;
		slowestRefreshMs = 0;
		worstLagMs = 0;
	}

	lagTimer.unref?.();
	reportTimer.unref?.();

	return () => {
		clearInterval(lagTimer);
		clearInterval(reportTimer);
	};
}

/**
 * Times one round trip to the Stream Deck application.
 *
 * @returns the time in milliseconds, or `timeout` / `error` / `n/a` — reported rather than thrown,
 * because a probe that cannot answer is itself the most interesting result this line can carry.
 */
async function measureRoundTrip(probe: (() => Promise<unknown>) | undefined): Promise<string> {
	if (probe === undefined) {
		return "n/a";
	}

	const startedAt = performance.now();
	try {
		const timedOut = Symbol("timed out");
		const result = await Promise.race([
			probe(),
			new Promise((resolve) => setTimeout(() => resolve(timedOut), RTT_TIMEOUT_MS).unref?.())
		]);
		return result === timedOut ? `>${RTT_TIMEOUT_MS}ms` : `${(performance.now() - startedAt).toFixed(0)}ms`;
	} catch {
		return "error";
	}
}

/** The last line written, so the property inspector can show it without anyone finding a file. */
export function latestHealth(): string {
	return latest;
}

/**
 * Where this plugin's log actually is, asked of the process rather than assumed.
 *
 * The install path differs per platform and per install method, and writing a plausible one into a
 * document is how people end up looking in a folder that was never right. The SDK resolves its log
 * directory from the working directory, and Stream Deck launches a plugin from inside its own
 * `.sdPlugin` folder — so this is the answer, on whatever machine is asking.
 */
export function logLocation(): string {
	return `${cwd()}/logs`;
}
