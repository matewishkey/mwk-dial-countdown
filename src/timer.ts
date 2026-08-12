/**
 * Pure countdown state machine. Deliberately free of any Stream Deck imports so it can be driven
 * directly from tests, with an injectable clock instead of real time.
 */

export type TimerStatus = "idle" | "running" | "paused" | "elapsed";

/** Shortest and longest duration a preset can be adjusted to. */
export const MIN_DURATION_MS = 1_000;
export const MAX_DURATION_MS = 24 * 60 * 60 * 1_000;

type Clock = () => number;

export class Timer {
	/** Duration the timer resets to, in milliseconds. */
	#durationMs: number;

	/** Remaining time when not running; ignored while running, where {@link Timer.#deadline} is authoritative. */
	#restingMs: number;

	/** Epoch milliseconds at which the countdown hits zero; `null` unless running. */
	#deadline: number | null = null;

	#status: TimerStatus = "idle";

	readonly #now: Clock;

	constructor(durationMs: number, now: Clock = Date.now) {
		this.#now = now;
		this.#durationMs = clampDuration(durationMs);
		this.#restingMs = this.#durationMs;
	}

	get durationMs(): number {
		return this.#durationMs;
	}

	get status(): TimerStatus {
		this.#settle();
		return this.#status;
	}

	/**
	 * Time left on the clock, never negative. While running this is derived from the deadline rather
	 * than accumulated per tick, so a slow or skipped render loop cannot make the timer drift.
	 */
	get remainingMs(): number {
		this.#settle();
		if (this.#status === "running" && this.#deadline !== null) {
			return Math.max(0, this.#deadline - this.#now());
		}
		return this.#restingMs;
	}

	/** Fraction of the duration already spent, 0-1, for the progress indicator. */
	get progress(): number {
		if (this.#durationMs <= 0) {
			return 1;
		}
		return 1 - this.remainingMs / this.#durationMs;
	}

	/** Starts, or resumes, the countdown. A timer at zero restarts from its full duration. */
	start(): void {
		this.#settle();
		if (this.#status === "running") {
			return;
		}
		if (this.#restingMs <= 0) {
			this.#restingMs = this.#durationMs;
		}
		this.#deadline = this.#now() + this.#restingMs;
		this.#status = "running";
	}

	/** Freezes the countdown, keeping the time left. */
	pause(): void {
		this.#settle();
		if (this.#status !== "running") {
			return;
		}
		this.#restingMs = this.remainingMs;
		this.#deadline = null;
		this.#status = "paused";
	}

	/** Start when stopped, pause when running — the short-press behaviour. */
	toggle(): void {
		if (this.status === "running") {
			this.pause();
		} else {
			this.start();
		}
	}

	/** Returns to a full, stopped clock — the long-press behaviour. */
	reset(): void {
		this.#restingMs = this.#durationMs;
		this.#deadline = null;
		this.#status = "idle";
	}

	/**
	 * Replaces the duration, e.g. when a different preset is selected. A running timer is stopped, on
	 * the grounds that silently retargeting a countdown mid-flight is a surprise, not a feature.
	 */
	setDuration(durationMs: number): void {
		this.#durationMs = clampDuration(durationMs);
		this.#restingMs = this.#durationMs;
		this.#deadline = null;
		this.#status = "idle";
	}

	/**
	 * Adds or removes time. While stopped this re-scales the duration itself, so turning the dial
	 * edits the preset; while running it only nudges the time left, leaving the duration alone.
	 */
	adjust(deltaMs: number): void {
		this.#settle();
		if (this.#status === "running") {
			const next = clampDuration(this.remainingMs + deltaMs);
			this.#deadline = this.#now() + next;
			this.#restingMs = next;
			// Growing past the original duration would leave progress pinned at zero; track the ceiling.
			this.#durationMs = Math.max(this.#durationMs, next);
			return;
		}
		this.#durationMs = clampDuration(this.#durationMs + deltaMs);
		this.#restingMs = this.#durationMs;
		this.#status = "idle";
	}

	/** Moves `running` to `elapsed` once the deadline has passed. */
	#settle(): void {
		if (this.#status !== "running" || this.#deadline === null) {
			return;
		}
		if (this.#now() >= this.#deadline) {
			this.#restingMs = 0;
			this.#deadline = null;
			this.#status = "elapsed";
		}
	}
}

function clampDuration(ms: number): number {
	if (!Number.isFinite(ms)) {
		return MIN_DURATION_MS;
	}
	return Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, Math.round(ms)));
}

/**
 * Names a preset by its length, since presets carry no name of their own. Round durations get the
 * short form a person would say out loud — "20m" — and anything untidy keeps its parts, so a preset
 * nudged off a round number still reads honestly rather than rounding itself away.
 */
export function formatPresetLabel(ms: number): string {
	const total = Math.round(Math.max(0, ms) / 1000);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;

	const parts: string[] = [];
	if (hours > 0) {
		parts.push(`${hours}h`);
	}
	if (minutes > 0) {
		parts.push(`${minutes}m`);
	}
	if (seconds > 0 || parts.length === 0) {
		parts.push(`${seconds}s`);
	}
	return parts.join(" ");
}

/**
 * Wall-clock time of day, 24 hour, for showing when a timer will finish. Deliberately not
 * locale-formatted: the touchscreen has room for five characters, and `2:05 pm` is not five.
 */
export function formatClockTime(epochMs: number): string {
	const date = new Date(epochMs);
	return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Formats milliseconds as `m:ss`, or `h:mm:ss` once past an hour. */
export function formatDuration(ms: number): string {
	const total = Math.ceil(Math.max(0, ms) / 1000);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;

	if (hours > 0) {
		return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
	}
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
