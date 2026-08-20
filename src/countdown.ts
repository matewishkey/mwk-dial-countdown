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

import { Accelerator, IDLE_RESET_MS } from "./acceleration";
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
	 * a way out: the working duration says one thing and the configuration says another. Pressing for
	 * the next preset spends its first press closing that gap — see {@link Countdown.cyclePreset}.
	 */
	get drifted(): boolean {
		return this.timer.durationMs !== this.presetSeconds * 1000;
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
				this.cyclePreset(1);
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
		this.#accelerator.reset();
		this.#say("reset");
	}

	/**
	 * Moves to another preset and loads its duration, stopped — but spends its first press putting
	 * the clock back on the preset it is already on, if the dial has taken it off it.
	 *
	 * The restore comes first because it is wanted far more often. Turning the dial now leaves the
	 * configured preset alone, so a countdown that has been wound to 23 minutes has no other way back
	 * to the 20 it was set to, and "put it back" is a thing you do constantly while "move to the next
	 * one" is a thing you do occasionally. Press once and the clock returns; press again and it moves
	 * on. There is nothing to lose either way, since the press that would have advanced still does.
	 *
	 * Loading a preset deliberately does not start it: this is how you choose what to time, and
	 * choosing is not the same as beginning. The word names the preset landed on, so a blind cycle
	 * through four of them is still readable — and says which of the two things the press just did.
	 */
	cyclePreset(step: number): void {
		if (this.drifted) {
			this.#load("preset");
			return;
		}

		const count = this.#presets.length;
		this.#presetIndex = (this.#presetIndex + step + count) % count;
		this.#load("next");
	}

	/** Puts the clock on the selected preset, stopped, and says so. */
	#load(word: string): void {
		this.#loadedSeconds = this.presetSeconds;
		this.timer.setDuration(this.#loadedSeconds * 1000);
		this.#alerted = false;
		this.#cycles = 0;
		this.#accelerator.reset();
		this.#say(`${word} · ${formatPresetLabel(this.presetSeconds * 1000)}`);
	}

	/**
	 * Turning adjusts the clock, and nothing else.
	 *
	 * It used to write the new length straight back into the preset, on the reasoning that the dial
	 * is the preset editor. In practice that made the presets unusable: winding a 20 minute timer up
	 * to 23 for one call silently redefined "20 minutes" as 23, and cycling away saved it there. A
	 * preset is a setting, and a setting is changed where settings are changed. What the dial changes
	 * is the clock in front of you — the same thing it has always done to a *running* countdown, now
	 * true of a stopped one as well.
	 *
	 * The step sits in a gear chosen by how fast the dial is turned; see `./acceleration`.
	 */
	adjust(ticks: number, pressed: boolean): void {
		const before = this.timer.status;
		const deltaSeconds = this.#accelerator.rotate(ticks, this.#now(), pressed);

		// Adjusting an expired timer puts it back to a full, stopped clock, which ends that run.
		if (before === "elapsed") {
			this.#cycles = 0;
		}

		this.timer.adjust(deltaSeconds * 1000);
		this.#alerted = false;

		// Said for as long as the gear lasts, not for the usual moment. `+10s` is a readout of what the
		// *next* click will do, not a note about the last one — so it has to be on screen for exactly
		// as long as it stays true. It used to fade after 900ms while the gear ran on for another 1.1
		// seconds, which invited the reasonable and wrong conclusion that the dial had gone back to
		// seconds. Now the word going is what tells you it has.
		this.#say(formatDelta(deltaSeconds), IDLE_RESET_MS);
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

	#say(text: string, ttlMs?: number): void {
		this.#ack = { text, at: this.#now(), ttlMs };
	}
}
