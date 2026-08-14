/**
 * Everything a countdown is, minus the Stream Deck.
 *
 * A countdown on a dial and a countdown on a key differ in exactly two ways: how they are driven,
 * and how they are drawn. The clock, the presets, the alert, the auto-repeat and the word that
 * acknowledges a gesture are identical, so they live here — once — rather than in each action.
 *
 * Nothing in this file imports the SDK, which is what lets the whole state machine be driven from a
 * test with an injected clock.
 */

import { Accelerator } from "./acceleration";
import { type Acknowledgement, formatDelta, isFlashing, toastText } from "./feedback";
import type { Gesture } from "./gestures";
import { normaliseSettings, type DialCountdownSettings, type Preset } from "./settings";
import { formatPresetLabel, Timer } from "./timer";

/** Blink period while inside the warning window — two render frames on, two off. */
const BLINK_MS = 500;

type Clock = () => number;

export class Countdown {
	readonly timer: Timer;

	readonly #accelerator = new Accelerator();

	#presets: Preset[];

	#presetIndex: number;

	#settings: DialCountdownSettings;

	/** Guards against re-playing the alert on every frame once the timer has elapsed. */
	#alerted = false;

	/** How many times an auto-repeating timer has come round. */
	#cycles = 0;

	#ack: Acknowledgement | null = null;

	readonly #now: Clock;

	constructor(settings: DialCountdownSettings, now: Clock = Date.now) {
		this.#now = now;
		this.#settings = settings;
		this.#presets = settings.presets;
		this.#presetIndex = settings.presetIndex;
		this.timer = new Timer(this.#presets[this.#presetIndex] * 1000, now);
	}

	get settings(): DialCountdownSettings {
		return this.#settings;
	}

	get presets(): Preset[] {
		return this.#presets;
	}

	get presetIndex(): number {
		return this.#presetIndex;
	}

	get cycles(): number {
		return this.#cycles;
	}

	/** Length of the selected preset, in seconds — where this timer started, not where it is now. */
	get presetSeconds(): number {
		return this.#presets[this.#presetIndex];
	}

	/** The word acknowledging the last gesture, or `""` once it has had its time. */
	get toast(): string {
		return toastText(this.#ack, this.#now());
	}

	/** Whether the ring should be drawn pulsing, having just been given an instruction. */
	get flashing(): boolean {
		return isFlashing(this.#ack, this.#now());
	}

	/**
	 * True on the dim half of the end-of-timer blink.
	 *
	 * The window is capped at half the preset's own length: a five minute warning on a five minute
	 * timer would blink from the moment it started, which is what once made adjusting the clock look
	 * like it had triggered the warning.
	 */
	get dimmed(): boolean {
		if (!this.#settings.warnEnabled || this.timer.status !== "running") {
			return false;
		}

		const windowMs = Math.min(this.#settings.warnSeconds * 1000, this.timer.durationMs / 2);
		if (this.timer.remainingMs > windowMs) {
			return false;
		}

		return Math.floor(this.#now() / BLINK_MS) % 2 === 1;
	}

	/** The settings to persist: what the inspector wrote, plus what the dial has since changed. */
	get persistable(): DialCountdownSettings {
		return { ...this.#settings, presets: this.#presets, presetIndex: this.#presetIndex };
	}

	/**
	 * Takes an edit from the property inspector.
	 *
	 * @returns `true` when the selected duration actually changed, which is the only case that should
	 * reload the clock — otherwise nudging the volume slider would reset a running timer.
	 */
	applySettings(raw: unknown): boolean {
		const settings = normaliseSettings(raw);
		const durationChanged = settings.presets[settings.presetIndex] * 1000 !== this.timer.durationMs;

		this.#settings = settings;
		this.#presets = settings.presets;
		this.#presetIndex = settings.presetIndex;

		if (durationChanged) {
			this.timer.setDuration(this.presetSeconds * 1000);
			this.#alerted = false;
		}

		return durationChanged;
	}

	/** Runs whatever a press turned out to mean. */
	apply(gesture: Gesture): void {
		switch (gesture) {
			case "toggle":
				this.toggle();
				return;
			case "reset":
				this.reset();
				return;
			case "next":
				this.cyclePreset(1);
		}
	}

	/** Pause a running timer, start or resume a stopped one. */
	toggle(): void {
		// "resume" is only honest when there is something to resume. A timer that has run out goes
		// back to its full duration when started, so calling that a resume would describe the one
		// case where the clock jumps rather than carries on.
		const before = this.timer.status;
		this.timer.toggle();
		this.#alerted = false;
		this.#say(before === "running" ? "pause" : before === "paused" ? "resume" : "start");
	}

	/**
	 * Back to a full clock, stopped — the double tap.
	 *
	 * Deliberately does not start it. Putting a timer back to the top and setting it running are two
	 * decisions, and a gesture that makes both takes the second one away from you: there is then no
	 * way to reset without immediately committing to a fresh run.
	 */
	reset(): void {
		this.timer.reset();
		this.#cycles = 0;
		this.#alerted = false;
		this.#accelerator.reset();
		this.#say("reset");
	}

	/**
	 * Moves to another preset and loads its duration, stopped.
	 *
	 * Deliberately does not start it: this is how you choose what to time, and choosing is not the
	 * same as beginning. The word names the preset landed on, so a blind cycle through four of them
	 * is still readable.
	 */
	cyclePreset(step: number): void {
		const count = this.#presets.length;
		this.#presetIndex = (this.#presetIndex + step + count) % count;
		this.timer.setDuration(this.presetSeconds * 1000);
		this.#alerted = false;
		this.#cycles = 0;
		this.#accelerator.reset();
		this.#say(`next · ${formatPresetLabel(this.presetSeconds * 1000)}`);
	}

	/**
	 * Turning adjusts time. The step accelerates the longer the dial is spun — a second for a nudge,
	 * ten once it is being wound, a minute once it is being wound hard — so setting an hour-long
	 * timer does not mean sixty turns of the wrist.
	 *
	 * @returns `true` when the change edited the preset rather than merely nudging a running clock,
	 * so the caller knows there is something worth saving.
	 */
	adjust(ticks: number, pressed: boolean): boolean {
		const deltaSeconds = this.#accelerator.rotate(ticks, this.#now(), pressed);
		this.timer.adjust(deltaSeconds * 1000);
		this.#alerted = false;
		this.#say(formatDelta(deltaSeconds));

		// Only an idle timer writes back: while running the dial nudges the clock, not the preset.
		if (this.timer.status === "running") {
			return false;
		}

		this.#presets[this.#presetIndex] = Math.round(this.timer.durationMs / 1000);
		return true;
	}

	/**
	 * Moves an elapsed timer on, once per elapse.
	 *
	 * Auto-repeat restarts immediately rather than after a pause: the alert has already fired, and a
	 * gap between cycles is exactly what an interval timer must not have. It is bounded, though — an
	 * unattended timer that never stops is a nuisance, not a feature.
	 *
	 * @returns `true` when the alert should sound. Playing it is the caller's job, which is what
	 * keeps this file free of anything that touches the filesystem.
	 */
	settle(): boolean {
		if (this.timer.status !== "elapsed" || this.#alerted) {
			return false;
		}

		this.#alerted = true;
		const alert = this.#settings.soundEnabled;

		if (this.#settings.repeat && this.#cycles < this.#settings.repeatCount) {
			this.#cycles += 1;
			this.#alerted = false;
			this.timer.reset();
			this.timer.start();
		}

		return alert;
	}

	#say(text: string): void {
		this.#ack = { text, at: this.#now() };
	}
}
