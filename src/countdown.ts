/**
 * Everything a countdown is, minus the Stream Deck.
 *
 * A countdown on a dial and a countdown on a key differ in exactly two ways: how they are driven,
 * and how they are drawn. The clock, the presets, the alert, the stage sequence and the word that
 * acknowledges a gesture are identical, so they live here — once — rather than in each action.
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

	/**
	 * Which stage of the selected preset is on the clock, 0-based.
	 *
	 * This is what became of the count of completed repeat laps, and it is a better thing to hold:
	 * the old counter was a *tally* that the stopping rule had to compare against a separate setting,
	 * and reading it as "repeats so far" rather than "runs finished" is what once made a count of 3
	 * run four times. A position in a list cannot be off by one against itself — the timer moves on
	 * while there is a next stage, and stops when there is not.
	 */
	#stageIndex = 0;

	/**
	 * The stage list the clock was last loaded from.
	 *
	 * Held rather than re-read so {@link Countdown.applySettings} can tell "the preset was edited"
	 * from "the clock has been dialled off it" — comparing the settings against the live clock would
	 * make every touch of the volume slider reload a countdown that had merely been nudged.
	 */
	#loadedStages: number[];

	#settings: DialCountdownSettings;

	/** Guards against re-playing the alert on every frame once the timer has elapsed. */
	#alerted = false;

	/**
	 * When the whole job finished, or `null` when it has not.
	 *
	 * Only set on the elapse that ends the *last* stage — the earlier ones load the next stage and
	 * never come through here. It is the clock the auto-reset delay is measured from, and it is
	 * cleared the moment the timer is anything but elapsed, so a finished timer somebody restarted by
	 * hand does not carry a pending reset into its next run.
	 */
	#finishedAt: number | null = null;

	#ack: Acknowledgement | null = null;

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
	 * Which stage is on screen, 1-based.
	 *
	 * A finished timer keeps the number of its last stage rather than running one past it: `×3/3`
	 * with `done` beside it, not `×4/3`. The two together are what tell a finished job from one still
	 * on its final stage — a distinction the tally alone could not make, and did not, for a while.
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
	 * How long the stages *after* this one add up to, in seconds.
	 *
	 * What the finish time needs, and the reason it was wrong before: `ends 3:40` was the end of the
	 * clock on screen, which on anything that repeated was the end of that lap and not of the job.
	 */
	get remainingStagesSeconds(): number {
		return this.stages.slice(this.#stageIndex + 1).reduce((total, seconds) => total + seconds, 0);
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
	 * The window is capped at half the stage's own length: a five minute warning on a five minute
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

	/**
	 * True when the clock has been dialled away from the stage it was loaded from.
	 *
	 * The dial deliberately no longer writes back to the preset list, so this is the state that needs
	 * saying out loud: the working duration says one thing and the configuration says another. It is
	 * what puts `from 20m` on the label, and it is deliberately *only* about the duration — a timer
	 * merely running has not been dialled anywhere, and labelling it as though it had would be noise.
	 */
	get drifted(): boolean {
		return this.timer.durationMs !== this.stageSeconds * 1000;
	}

	/**
	 * True when the clock is sitting stopped, full, on the first stage of the preset it is set to.
	 *
	 * This is the "nothing to put right" state, and it is what decides whether a hold of the screen
	 * restores or advances — see {@link Countdown.cyclePreset}. It is deliberately wider than
	 * {@link Countdown.drifted}: a countdown that is *running*, paused, finished or part-way through
	 * its stages is not sitting on its preset either, even though its duration may still match.
	 *
	 * `idle` is enough to mean full: every path that reaches it — reset, loading a preset, adjusting a
	 * stopped clock — puts the remaining time back to the whole duration. `test/countdown.test.ts`
	 * holds that invariant, since this getter now leans on it.
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
	 * @returns `true` when the selected preset actually changed, which is the only case that should
	 * reload the clock — otherwise nudging the volume slider would reset a running timer.
	 *
	 * Compared against the stage list the clock was *loaded* from, never against the clock itself: a
	 * countdown dialled off its stage must not be yanked back to it by an unrelated edit. Editing the
	 * stages does put the timer back to the first of them, tally included, because the run it was
	 * part-way through belonged to a preset that no longer exists — and a `×2/3` counted against a
	 * list that now has five entries is a number about nothing.
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
	 * One job: **a timer that ran out while nobody was looking has nothing left to announce.** The
	 * alert exists to say that the moment has arrived, and by the time the control is on screen again
	 * the moment has been and gone — sounding an alarm for it now would be reporting old news at full
	 * volume, possibly hours late. The screen still says `done`, in the elapsed colour, because that
	 * part is still true.
	 *
	 * The same reasoning stops a multi-stage timer from picking up where it left off. Its later
	 * stages were not run, so it does not get to claim them, and quietly fast-forwarding a tally
	 * nobody watched would be inventing history. It comes back where it stopped, and starting it
	 * starts the sequence again from the top.
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
	 * **To the preset, not to wherever the dial left the clock.** It used to restore the working
	 * duration, so a 5m preset wound up to 8m reset to 8m for ever after: the number you configured
	 * was reachable only by holding the screen, and the number you had nudged to once had quietly
	 * become the timer's real length. That is a last-used value wearing a preset's clothes. A preset
	 * that a reset cannot return you to is not a preset, so reset goes where the settings say.
	 *
	 * The dialled duration is therefore deliberately not recoverable. That is the trade, and it is the
	 * right way round: the clock is the scratch value and the preset is the record, so the gesture
	 * that means *put it back* has exactly one place to put it back to. Nudge it again if you want it
	 * again — that is one turn of the dial, against a configured length that was otherwise two
	 * gestures deep.
	 *
	 * Deliberately does not start it. Putting a timer back to the top and setting it running are two
	 * decisions, and a gesture that makes both takes the second one away from you: there is then no
	 * way to reset without immediately committing to a fresh run.
	 */
	reset(): void {
		this.#toStage(0);
		this.#say("reset");
	}

	/**
	 * Puts things right, or moves on — in that order.
	 *
	 * **If the clock is not sitting stopped and full on the first stage of its preset, the hold puts
	 * it there.** Only a hold made when there is nothing left to put right moves to another preset.
	 * Hold once, hold again: restore, then advance.
	 *
	 * The restore comes first because it is wanted far more often, and the rule was too narrow at
	 * first. It originally fired only when the dial had wound the clock off its preset, on the
	 * reasoning that a *running* timer has a reset of its own — the double tap. In the hand that was
	 * wrong: reaching for the dial mid-run and being thrown onto the next preset is exactly the
	 * surprise the restore exists to prevent, and the double tap lives on a different control. So
	 * running, paused, finished, part-way through the stages and dialled-off all count as something
	 * to put right.
	 *
	 * Nothing is lost by it. The press that would have advanced still advances, one press later, and
	 * the word says which of the two it just did: `preset · 20m` against `next · 30m`.
	 *
	 * It only ever moves forwards. Stepping backwards lived on the dial's hold, and the dial has no
	 * hold any more — a push is a push however long you lean on it. With the touchscreen as the only
	 * way through the list, one direction and a wrap round the end is the whole of it.
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

	/**
	 * Puts the clock on the first stage of the selected preset, stopped, and says so.
	 *
	 * A preset with stages is named by its first one with the count after it — `next · 40m ×3` — since
	 * the word has a moment on screen to say what you have just loaded, and "forty minutes" alone
	 * would be two thirds of a lie about a 40/10/10.
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
	 * Three gestures mean stage zero and they now all mean the same thing by construction — the
	 * double tap, a hold that finds something to put right, and the auto-reset falling due. They used
	 * to agree by coincidence and did not quite: the double tap restored the *working* duration while
	 * the other two restored the preset, so `reset` and `hold` disagreed about where the top of the
	 * clock was. One private method, one answer, and nothing left to drift.
	 *
	 * Silent on purpose. What to say about it is the caller's business, and the auto-reset says
	 * nothing at all.
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
	 * second. Passed in per rotation rather than held as state, because it *is* per rotation: the step
	 * is your finger, and it lasts exactly as long as your finger does. See `./step`.
	 *
	 * It deliberately does not touch the preset behind the clock. Winding a 20 minute timer up to 23
	 * for one call must not silently redefine "20 minutes" as 23 — a preset the dial rewrites is not a
	 * preset but a last-used value.
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
	 * The next stage starts immediately rather than after a pause: the alert has already fired, and a
	 * gap between stages is exactly what an interval timer must not have.
	 *
	 * @returns `true` on the one turn of the loop where a stage *has just* run out — once per elapse,
	 * never twice. Whether that makes a noise is the caller's business, and deliberately so: it keeps
	 * this file free of anything that touches the filesystem, and it keeps the question of which sound
	 * to play in one place rather than half here and half there.
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
	 * A countdown that has run out otherwise sits reading `done` until somebody presses it, which is
	 * right for a timer you are watching and wrong for one on a page you left — you come back to a
	 * used clock and have to clear it before it is a timer again. After the delay it clears itself:
	 * full clock, stopped, back on the first stage. Exactly the double tap, and deliberately so — the
	 * same state, arrived at two ways, rather than a second idea of what "the start" means.
	 *
	 * Silent, with no acknowledgement drawn. The words under the clock name the gesture you just
	 * made, and nobody made this one.
	 */
	#autoReset(): void {
		if (!this.#settings.autoResetEnabled || this.#finishedAt === null) {
			return;
		}

		if (this.#now() - this.#finishedAt < this.#settings.autoResetSeconds * 1000) {
			return;
		}

		this.#finishedAt = null;
		this.#toStage(0);
	}

	#say(text: string): void {
		this.#ack = { text, at: this.#now() };
	}
}

/** Whether two stage lists are the same sequence of durations. */
function sameStages(a: readonly number[], b: readonly number[]): boolean {
	return a.length === b.length && a.every((seconds, index) => seconds === b[index]);
}
