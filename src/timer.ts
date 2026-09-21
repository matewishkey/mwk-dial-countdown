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

	/**
	 * Fraction of the duration already spent, 0-1, for the progress indicator.
	 *
	 * **Clamped, because a nudged clock is allowed to hold more time than its own duration.** That
	 * used to be prevented by ratcheting the duration up to meet it, which kept this fraction in range
	 * by quietly redefining how long the timer was — see {@link Timer.adjust}. The ring pins at full
	 * while the clock is wound above its length, which is the honest picture: there is more time left
	 * than the timer is long, and no fraction of the duration describes that.
	 */
	get progress(): number {
		if (this.#durationMs <= 0) {
			return 1;
		}
		return Math.min(1, Math.max(0, 1 - this.remainingMs / this.#durationMs));
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
	 * Adds or removes time.
	 *
	 * **A clock with time left on it is nudged; one without is re-scaled.** Running and paused move
	 * only the remaining time, leaving the duration — and the pause — where they were. Idle and
	 * elapsed have nothing to nudge, so the turn edits the duration itself.
	 *
	 * `paused` belongs with `running`: falling through to the second case rewrote the duration and
	 * put the clock back to full, losing both the count and the pause.
	 *
	 * **A started clock's duration is left entirely alone, which is what makes a turn reversible.**
	 * Ratcheting it up to whatever the clock was wound to was one-way, so an equal turn down
	 * restored the clock but left the duration somewhere it had never been — and the next stage ran
	 * that length rather than the preset's. {@link Timer.progress} clamps instead.
	 */
	adjust(deltaMs: number): void {
		this.#settle();
		if (this.#status === "running" || this.#status === "paused") {
			// **Floored at zero, not at MIN_DURATION_MS.** That floor is the shortest a *preset* may
			// be, and a clock with 400 ms left on it is not a preset — clamping it there answered a
			// click of *less* by handing back 600 ms more, and made a running clock impossible to wind
			// down to nothing. Reaching zero while running is an ordinary elapse: the deadline lands on
			// `now`, and the next `#settle` retires it exactly as if it had run out on its own.
			const next = clampRemaining(this.remainingMs + deltaMs);
			// Only a running clock has a deadline to move; a paused one is held in `#restingMs` alone.
			this.#deadline = this.#status === "running" ? this.#now() + next : null;
			this.#restingMs = next;
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
 * The same ceiling, but a floor of zero: this is for time *left on a clock*, which may legitimately
 * be none. {@link MIN_DURATION_MS} governs how short a preset may be set to and has no business here.
 */
function clampRemaining(ms: number): number {
	if (!Number.isFinite(ms)) {
		return 0;
	}
	return Math.min(MAX_DURATION_MS, Math.max(0, Math.round(ms)));
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
