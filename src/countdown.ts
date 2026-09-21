/**
 * Everything a countdown is, minus the Stream Deck.
 *
 * A countdown on a dial and one on a key differ only in how they are driven and how they are drawn,
 * so the clock, presets, alert, stage sequence and acknowledgement live here once.
 *
 * Nothing in this file imports the SDK, which is what lets the whole state machine be driven from a
 * test with an injected clock.
 */

import { deltaFor } from "./step";
import { type Acknowledgement, formatDelta, isFlashing, toastText } from "./feedback";
import type { Gesture } from "./gestures";
import { normaliseSettings, type DialCountdownSettings, type Preset } from "./settings";
import { formatPresetLabel, Timer } from "./timer";

/** Blink period while inside the warning window — two render frames on, two off. */
export const BLINK_MS = 500;

type Clock = () => number;

export class Countdown {
	readonly timer: Timer;

	#presets: Preset[];

	#presetIndex: number;

	/** Which stage of the selected preset is on the clock, 0-based. */
	#stageIndex = 0;

	/**
	 * The stage list the clock was last loaded from.
	 *
	 * Held rather than re-read so {@link Countdown.applySettings} can tell "the preset was edited"
	 * from "the clock has been dialled off it" — comparing against the live clock would reload on
	 * every touch of the volume slider.
	 */
	#loadedStages: number[];

	#settings: DialCountdownSettings;

	/** Guards against re-playing the alert on every frame once the timer has elapsed. */
	#alerted = false;

	/**
	 * When the whole job finished, or `null` when it has not.
	 *
	 * Set only on the elapse that ends the *last* stage. It is what the auto-reset delay is measured
	 * from, and is cleared the moment the timer is anything but elapsed.
	 */
	#finishedAt: number | null = null;

	#ack: Acknowledgement | null = null;

	/** Whether an alert is still sounding. See {@link Countdown.ringing}. */
	#ringing = false;

	readonly #now: Clock;

	constructor(settings: DialCountdownSettings, now: Clock = Date.now) {
		this.#now = now;
		this.#settings = settings;
		this.#presets = settings.presets;
		this.#presetIndex = settings.presetIndex;
		this.#loadedStages = [...this.stages];
		this.timer = new Timer(this.stageSeconds * 1000, now);
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

	/** The stages of the selected preset, in seconds — one entry for a plain countdown. */
	get stages(): readonly number[] {
		return this.#presets[this.#presetIndex];
	}

	/** How many stages the selected preset runs. Always at least one. */
	get stageCount(): number {
		return this.stages.length;
	}

	/**
	 * Which stage is on screen, 1-based. A finished timer keeps its last stage's number rather than
	 * running one past it: `×3/3` with `done` beside it, never `×4/3`.
	 */
	get stage(): number {
		return this.#stageIndex + 1;
	}

	/**
	 * True once the timer has run out with no stage left to move on to — the end of the whole job,
	 * not the end of one stage.
	 */
	get finished(): boolean {
		return this.timer.status === "elapsed";
	}

	/**
	 * Length of the current stage, in seconds — as configured, not as the dial has since left it.
	 */
	get stageSeconds(): number {
		return this.stages[this.#stageIndex];
	}

	/**
	 * How long the stages *after* this one add up to, in seconds. What the finish time needs: `ends`
	 * is the end of the whole job, not of the stage on screen.
	 */
	get remainingStagesSeconds(): number {
		return this.stages.slice(this.#stageIndex + 1).reduce((total, seconds) => total + seconds, 0);
	}

	/**
	 * Whether an alert is still sounding, told to the clock by whoever is playing it.
	 *
	 * It exists so the auto-reset does not tidy a finish away while it is still being announced: the
	 * delay starts counting once the sound stops. A plain flag rather than anything this file works
	 * out for itself, because how long a sound lasts is a property of a file on disk.
	 */
	get ringing(): boolean {
		return this.#ringing;
	}

	set ringing(value: boolean) {
		this.#ringing = value;
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
	 * The window is capped at half the stage's own length, so a five minute warning on a five minute
	 * timer does not blink from the moment it starts.
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

	/**
	 * True when the clock has been dialled away from the stage it was loaded from. It is what puts
	 * `from 20m` on the label, and is deliberately only about the duration — a timer merely running
	 * has not been dialled anywhere.
	 */
	get drifted(): boolean {
		return this.timer.durationMs !== this.stageSeconds * 1000;
	}

	/**
	 * True when the clock is sitting stopped, full, on the first stage of its preset.
	 *
	 * This decides whether a hold restores or advances — see {@link Countdown.cyclePreset}. Wider
	 * than {@link Countdown.drifted}: running, paused, finished or part-way through the stages all
	 * count as not on the preset, even when the duration still matches.
	 */
	get onPreset(): boolean {
		return !this.drifted && this.#stageIndex === 0 && this.timer.status === "idle";
	}

	/** The settings to persist: what the inspector wrote, plus whichever preset is now selected. */
	get persistable(): DialCountdownSettings {
		return { ...this.#settings, presets: this.#presets, presetIndex: this.#presetIndex };
	}

	/**
	 * Takes an edit from the property inspector.
	 *
	 * @returns `true` when the selected preset actually changed, which is the only case that reloads
	 * the clock — otherwise nudging the volume slider would reset a running timer.
	 *
	 * Compared against the stage list the clock was *loaded* from, never against the clock itself.
	 * Editing the stages does put the timer back to the first of them, because a `×2/3` counted
	 * against a list that now has five entries is a number about nothing.
	 */
	applySettings(raw: unknown): boolean {
		const settings = normaliseSettings(raw);
		const nextStages = settings.presets[settings.presetIndex];
		const changed = !sameStages(nextStages, this.#loadedStages);

		this.#settings = settings;
		this.#presets = settings.presets;
		this.#presetIndex = settings.presetIndex;

		if (changed) {
			this.#toStage(0);
		}

		return changed;
	}

	/**
	 * Called when a countdown that was off screen comes back.
	 *
	 * A timer that ran out while nobody was looking has nothing left to announce, so the alert is
	 * marked as already given. The screen still says `done`. For the same reason a multi-stage timer
	 * does not pick up stages it never ran.
	 */
	resume(): void {
		if (this.timer.status === "elapsed") {
			this.#alerted = true;

			// The auto-reset's delay starts now rather than whenever the timer actually ran out. Nothing
			// was running to notice that moment, and dating the finish back to it would clear the clock
			// the instant the page came back — the one frame where seeing `done` is the whole point.
			this.#finishedAt = this.#now();
		}
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
		// back to the top of its preset when started, so calling that a resume would describe the one
		// case where the clock jumps rather than carries on.
		const before = this.timer.status;

		// Starting a finished timer starts the sequence again from its first stage — not from the last
		// one, which is merely where it happened to stop. Leaving the stage index where it was is what
		// used to strand a repeating timer: its budget read as already spent, so the restarted run
		// never repeated even once.
		if (before === "elapsed") {
			this.#toStage(0);
		}

		this.timer.toggle();
		this.#alerted = false;
		this.#say(before === "running" ? "pause" : before === "paused" ? "resume" : "start");
	}

	/**
	 * Back to the first stage of the preset, stopped — the double tap.
	 *
	 * **To the preset, not to wherever the dial left the clock.** The clock is the scratch value and
	 * the preset is the record, so the gesture that means *put it back* has one place to put it
	 * back to. The dialled duration is deliberately not recoverable.
	 *
	 * Deliberately does not start it: putting a timer back to the top and setting it running are two
	 * decisions.
	 */
	reset(): void {
		this.#toStage(0);
		this.#say("reset");
	}

	/**
	 * Puts things right, or moves on — in that order.
	 *
	 * If the clock is not sitting stopped and full on the first stage of its preset, the hold puts it
	 * there; only a hold with nothing left to put right moves to another preset. Running, paused,
	 * finished, part-way through the stages and dialled-off all count as something to put right.
	 *
	 * Forwards only, wrapping at the end. Loading a preset does not start it.
	 */
	cyclePreset(): void {
		if (!this.onPreset) {
			this.#load("preset");
			return;
		}

		this.#presetIndex = (this.#presetIndex + 1) % this.#presets.length;
		this.#load("next");
	}

	/**
	 * Puts the clock on the first stage of the selected preset, stopped, and says so.
	 *
	 * A preset with stages is named by its first one with the count after it — `next · 40m ×3` —
	 * since "forty minutes" alone would be two thirds of a lie about a 40/10/10.
	 */
	#load(word: string): void {
		this.#toStage(0);

		const name = formatPresetLabel(this.stageSeconds * 1000);
		const tally = this.stageCount > 1 ? ` ×${this.stageCount}` : "";
		this.#say(`${word} · ${name}${tally}`);
	}

	/**
	 * The start state for a given stage: that stage's length, full, stopped.
	 *
	 * The double tap, a hold that finds something to put right, and the auto-reset falling due all
	 * mean stage zero, and all go through here so they cannot drift apart.
	 *
	 * Silent on purpose — what to say about it is the caller's business.
	 */
	#toStage(index: number): void {
		this.#stageIndex = Math.min(Math.max(index, 0), this.stageCount - 1);
		this.#loadedStages = [...this.stages];
		this.timer.setDuration(this.stageSeconds * 1000);
		this.#alerted = false;
	}

	/**
	 * Turning adjusts the clock, and nothing else.
	 *
	 * @param pressed Whether the dial was pushed in for this turn — a minute a click rather than a
	 * second. Passed per rotation because it *is* per rotation; see `./step`.
	 *
	 * It deliberately does not touch the preset behind the clock: a preset the dial rewrites is a
	 * last-used value, not a preset.
	 */
	adjust(ticks: number, pressed = false): void {
		const before = this.timer.status;
		const deltaSeconds = deltaFor(ticks, pressed);

		// Adjusting a finished timer is the start of setting up the next one, so it goes back to the
		// first stage before the nudge lands — same as starting it would. Nudging the *last* stage of a
		// spent sequence and then pressing play would otherwise run that one stage alone.
		if (before === "elapsed") {
			this.#toStage(0);
		}

		this.timer.adjust(deltaSeconds * 1000);
		this.#alerted = false;
		this.#say(formatDelta(deltaSeconds));
	}

	/**
	 * Moves an elapsed timer on to its next stage, once per elapse.
	 *
	 * The next stage starts immediately rather than after a pause — a gap between stages is what an
	 * interval timer must not have.
	 *
	 * @returns `true` on the one turn of the loop where a stage has just run out. Whether that makes
	 * a noise is the caller's business, which keeps this file free of the filesystem.
	 */
	settle(): boolean {
		if (this.timer.status !== "elapsed") {
			this.#finishedAt = null;
			return false;
		}

		// Already announced, so the only thing left that can happen to this timer without a finger on
		// it is the auto-reset falling due.
		if (this.#alerted) {
			this.#autoReset();
			return false;
		}

		this.#alerted = true;

		// While there is a stage left, take it. The stopping rule is the end of the list rather than a
		// count compared against a tally, which is the whole reason the sequence replaced the repeat
		// switch: there is no off-by-one available to get wrong.
		if (this.#stageIndex + 1 < this.stageCount) {
			this.#toStage(this.#stageIndex + 1);
			this.timer.start();
			return true;
		}

		// The end of the whole job, stages and all — which is the only thing the auto-reset waits for.
		this.#finishedAt = this.#now();
		return true;
	}

	/**
	 * Puts a long-finished timer back to the start, if it has been asked to.
	 *
	 * Full clock, stopped, back on the first stage — exactly the double tap, by construction rather
	 * than coincidence. Silent, with no acknowledgement drawn: the words under the clock name the
	 * gesture you just made, and nobody made this one.
	 */
	#autoReset(): void {
		if (!this.#settings.autoResetEnabled || this.#finishedAt === null) {
			return;
		}

		// Still ringing, so the finish has not been dealt with yet. See {@link Countdown.ringing}.
		if (this.#ringing) {
			return;
		}

		if (this.#now() - this.#finishedAt < this.#settings.autoResetSeconds * 1000) {
			return;
		}

		this.#finishedAt = null;
		this.#toStage(0);
	}

	/**
	 * Says a word for something that was not one of this clock's own gestures. One caller: the press
	 * that silences an alert and is then swallowed, which changes nothing about the countdown and so
	 * has no gesture of its own to announce.
	 */
	note(text: string): void {
		this.#say(text);
	}

	#say(text: string): void {
		this.#ack = { text, at: this.#now() };
	}
}

/** Whether two stage lists are the same sequence of durations. */
function sameStages(a: readonly number[], b: readonly number[]): boolean {
	return a.length === b.length && a.every((seconds, index) => seconds === b[index]);
}
