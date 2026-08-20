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

import { Selector, type Step } from "./step";
import { type Acknowledgement, formatDelta, isFlashing, toastText } from "./feedback";
import type { Gesture } from "./gestures";
import { normaliseSettings, type DialCountdownSettings, type Preset } from "./settings";
import { formatPresetLabel, Timer } from "./timer";

/** Blink period while inside the warning window — two render frames on, two off. */
const BLINK_MS = 500;

type Clock = () => number;

export class Countdown {
	readonly timer: Timer;

	readonly #selector = new Selector();

	#presets: Preset[];

	#presetIndex: number;

	/**
	 * The preset duration the clock was last loaded from, in seconds.
	 *
	 * Not the same as the clock's own duration, which the dial moves freely, and not the same as the
	 * selected preset either while an inspector edit is being taken. It exists so that
	 * {@link Countdown.applySettings} can tell "the configured length changed" from "the clock has
	 * been dialled off it" — comparing the settings against the live clock would make every touch of
	 * the volume slider reload a countdown that had merely been nudged.
	 */
	#loadedSeconds: number;

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
		this.#loadedSeconds = this.#presets[this.#presetIndex];
		this.timer = new Timer(this.#loadedSeconds * 1000, now);
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

	/** Length of the selected preset, in seconds — as configured, not as the dial has since left it. */
	get presetSeconds(): number {
		return this.#presets[this.#presetIndex];
	}

	/**
	 * True when the clock has been dialled away from the preset it was loaded from.
	 *
	 * The dial deliberately no longer writes back to the preset list, so this is the state that needs
	 * saying out loud: the working duration says one thing and the configuration says another. It is
	 * what puts `from 20m` on the label, and it is deliberately *only* about the duration — a timer
	 * merely running has not been dialled anywhere, and labelling it as though it had would be noise.
	 */
	get drifted(): boolean {
		return this.timer.durationMs !== this.presetSeconds * 1000;
	}

	/**
	 * True when the clock is sitting stopped, full, on exactly the preset it is set to.
	 *
	 * This is the "nothing to put right" state, and it is what decides whether a press of the dial
	 * restores or advances — see {@link Countdown.cyclePreset}. It is deliberately wider than
	 * {@link Countdown.drifted}: a countdown that is *running*, paused, or finished is not sitting on
	 * its preset either, even though its duration still matches.
	 *
	 * `idle` is enough to mean full: every path that reaches it — reset, loading a preset, adjusting a
	 * stopped clock — puts the remaining time back to the whole duration. `test/countdown.test.ts`
	 * holds that invariant, since this getter now leans on it.
	 */
	get onPreset(): boolean {
		return !this.drifted && this.timer.status === "idle";
	}

	/**
	 * The dial's current step, when it is worth saying — `1m`, `1h`, or `""` for the default.
	 *
	 * A chosen step has no time-out, which is what makes it predictable and also what makes it easy to
	 * forget. So any step other than the default says so on screen for as long as it is set. The
	 * default stays silent: a permanent label reading `1s` would be noise on every timer that has
	 * never had its dial pressed.
	 */
	get stepLabel(): string {
		return this.#selector.step === "second" ? "" : `step · ${this.#selector.label}`;
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

	/** The settings to persist: what the inspector wrote, plus whichever preset is now selected. */
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

		// Against the preset the clock was loaded from, never against the clock itself — otherwise a
		// countdown dialled off its preset would be yanked back to it by an unrelated edit.
		const durationChanged = settings.presets[settings.presetIndex] !== this.#loadedSeconds;

		this.#settings = settings;
		this.#presets = settings.presets;
		this.#presetIndex = settings.presetIndex;

		if (durationChanged) {
			this.#loadedSeconds = this.presetSeconds;
			this.timer.setDuration(this.#loadedSeconds * 1000);
			this.#alerted = false;
			this.#cycles = 0;
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
				this.cyclePreset();
		}
	}

	/** Pause a running timer, start or resume a stopped one. */
	toggle(): void {
		// "resume" is only honest when there is something to resume. A timer that has run out goes
		// back to its full duration when started, so calling that a resume would describe the one
		// case where the clock jumps rather than carries on.
		const before = this.timer.status;

		// Starting an expired timer puts the clock back to full, which begins a fresh run — so the lap
		// count goes back with it. Leaving it where it was is what used to strand an auto-repeating
		// timer: its budget read as already spent, so the restarted run never repeated even once.
		if (before === "elapsed") {
			this.#cycles = 0;
		}

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
		this.#say("reset");
	}

	/**
	 * Puts things right, or moves on — in that order.
	 *
	 * **If the clock is not sitting stopped and full on its preset, the press puts it there.** Only a
	 * press made when there is nothing left to put right moves to another preset. Press once, press
	 * again: restore, then advance.
	 *
	 * The restore comes first because it is wanted far more often, and the rule was too narrow at
	 * first. It originally fired only when the dial had wound the clock off its preset, on the
	 * reasoning that a *running* timer has a reset of its own — the double tap. In the hand that was
	 * wrong: reaching for the dial mid-run and being thrown onto the next preset is exactly the
	 * surprise the restore exists to prevent, and the double tap lives on a different control. So
	 * running, paused, finished and dialled-off all count as something to put right.
	 *
	 * Nothing is lost by it. The press that would have advanced still advances, one press later, and
	 * the word says which of the two it just did: `preset · 20m` against `next · 30m`.
	 *
	 * It only ever moves forwards. Stepping backwards lived on the dial's hold, which now sets how
	 * much a click is worth; with the touchscreen as the only way through the list, one direction and
	 * a wrap round the end is the whole of it.
	 *
	 * Loading a preset deliberately does not start it: this is how you choose what to time, and
	 * choosing is not the same as beginning.
	 */
	cyclePreset(): void {
		if (!this.onPreset) {
			this.#load("preset");
			return;
		}

		this.#presetIndex = (this.#presetIndex + 1) % this.#presets.length;
		this.#load("next");
	}

	/** Puts the clock on the selected preset, stopped, and says so. */
	#load(word: string): void {
		this.#loadedSeconds = this.presetSeconds;
		this.timer.setDuration(this.#loadedSeconds * 1000);
		this.#alerted = false;
		this.#cycles = 0;
		this.#say(`${word} · ${formatPresetLabel(this.presetSeconds * 1000)}`);
	}

	/**
	 * Turning adjusts the clock, and nothing else.
	 *
	 * Two things it deliberately does not do. It does not touch the preset behind the clock — winding
	 * a 20 minute timer up to 23 for one call must not silently redefine "20 minutes" as 23, and a
	 * preset the dial rewrites is not a preset but a last-used value. And it does not change the step:
	 * however far or fast you turn, a click is worth whatever the last press of the dial said. See
	 * `./step` for why that took four attempts to get to.
	 */
	adjust(ticks: number): void {
		const before = this.timer.status;
		const deltaSeconds = this.#selector.delta(ticks);

		// Adjusting an expired timer puts it back to a full, stopped clock, which ends that run.
		if (before === "elapsed") {
			this.#cycles = 0;
		}

		this.timer.adjust(deltaSeconds * 1000);
		this.#alerted = false;
		this.#say(formatDelta(deltaSeconds));
	}

	/** A press of the dial: swap the step between seconds and minutes. */
	cycleStep(): Step {
		return this.#sayStep(this.#selector.toggle());
	}

	/** A hold of the dial: an hour a click. */
	coarsenStep(): Step {
		return this.#sayStep(this.#selector.coarsen());
	}

	#sayStep(step: Step): Step {
		this.#say(`step · ${this.#selector.label}`);
		return step;
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
