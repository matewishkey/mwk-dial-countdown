import streamDeck, {
	action,
	type DialAction,
	type DialDownEvent,
	type DialRotateEvent,
	type DialUpEvent,
	type FeedbackPayload,
	type KeyAction,
	type TouchTapEvent
} from "@elgato/streamdeck";

import type { Countdown } from "../countdown";
import { asDataUri, renderGlyph, renderRing, ringColour, themeFor } from "../render";
import type { DialCountdownSettings } from "../settings";
import { formatClockTime, formatDuration, formatPresetLabel } from "../timer";
import { CountdownAction, type Instance } from "./countdown-action";

export type { DialCountdownSettings };

/**
 * Font sizes for the big clock. `1:10:10` at the layout's default 30px overruns its 96px box, so the
 * size steps down with the length of the string rather than being fixed.
 */
const VALUE_FONT_SIZES: Record<number, number> = { 4: 32, 5: 30, 6: 25, 7: 22, 8: 20 };
const VALUE_FONT_MIN = 18;

type Dial = DialAction<DialCountdownSettings>;

/** The dial's own state, on top of what every countdown carries. */
type DialInstance = Instance<Dial> & {
	/**
	 * Set when the dial is turned while held down, so the release that follows is not *also* read as a
	 * press. Holding the dial in is how you ask for minutes; letting go afterwards is the end of that
	 * turn, not a separate instruction to start the clock.
	 */
	turnedWhileDown: boolean;
	lastLayout: string | null;
};

@action({ UUID: "com.matewishkey.dial-countdown-v2.countdown" })
export class DialCountdown extends CountdownAction<Dial, DialInstance> {
	protected readonly controller = "Encoder" as const;

	protected owns(control: Dial | KeyAction<DialCountdownSettings>): control is Dial {
		return control.isDial();
	}

	protected extras(): Omit<DialInstance, keyof Instance<Dial>> {
		return { turnedWhileDown: false, lastLayout: null };
	}

	protected override attach(instance: DialInstance): void {
		this.#applyLayout(instance);
	}

	/**
	 * Turning adjusts time — **a second a click, or a minute a click while the dial is pushed in.**
	 *
	 * That is the whole of the step model. `pressed` arrives on the event itself, so the plugin holds
	 * no mode, expires no mode, and has nothing to put on screen reminding you which mode you left it
	 * in: your own finger is the state.
	 *
	 * Every click is acknowledged by a pulse of the ring. There is no haptic feedback to be had on this
	 * hardware, so the ring answering each click is what tells you the dial is being heard — and the
	 * word on the bottom line (`+1s`, `+1m`) is what tells you which step it was heard at.
	 *
	 * Nothing is saved, because nothing worth saving changed: turning moves the clock, never the preset
	 * behind it.
	 */
	override onDialRotate(ev: DialRotateEvent<DialCountdownSettings>): void {
		const instance = this.instanceFor(ev.action.id);
		if (instance === undefined) {
			return;
		}

		if (ev.payload.pressed) {
			instance.turnedWhileDown = true;
		}

		instance.countdown.adjust(ev.payload.ticks, ev.payload.pressed);
		this.acknowledge(instance);
	}

	/**
	 * Nothing but bookkeeping: a push is only ever half a gesture until it is known whether the dial
	 * turned before it came back up.
	 *
	 * There is deliberately no long-press timer here any more. A hold on the dial does nothing at all,
	 * which is what lets holding it in mean "minutes" for as long as you like without a second meaning
	 * quietly accruing underneath.
	 */
	override onDialDown(ev: DialDownEvent<DialCountdownSettings>): void {
		const instance = this.instanceFor(ev.action.id);
		if (instance === undefined) {
			return;
		}

		instance.turnedWhileDown = false;
	}

	/**
	 * A press that did not turn the dial **starts or pauses the clock**.
	 *
	 * The most-used control on a countdown ought to be the one under the hand that is already on the
	 * dial. It used to be a tap on the touchscreen — reachable, but a different surface and a
	 * quarter-second slower, because a tap has to wait to find out whether a second one is coming.
	 * This one acts on release, immediately, because there is nothing it could turn out to be instead.
	 *
	 * A push that *did* turn was a minute-step rotation. Its release ends the turn and means nothing
	 * on its own — otherwise every pushed adjustment would start the timer as you let go of it.
	 */
	override onDialUp(ev: DialUpEvent<DialCountdownSettings>): void {
		const instance = this.instanceFor(ev.action.id);
		if (instance === undefined) {
			return;
		}

		if (instance.turnedWhileDown) {
			instance.turnedWhileDown = false;
			return;
		}

		this.perform(instance, "toggle");
	}

	/**
	 * Every gesture the screen has: one tap pauses or resumes, two reset the clock to full, and a held
	 * tap puts the clock right or loads the next preset.
	 *
	 * The hardware reports a tap and whether it was held, but never that two taps were a pair — that
	 * is worked out by the resolver, which is why a single tap acts a quarter of a second after the
	 * finger lifts rather than the instant it does.
	 */
	override onTouchTap(ev: TouchTapEvent<DialCountdownSettings>): void {
		const instance = this.instanceFor(ev.action.id);
		if (instance === undefined) {
			return;
		}

		instance.taps.press(ev.payload.hold);
	}

	/**
	 * Switches the touchscreen between the two layouts, when the choice changes.
	 *
	 * **Both layouts are the plugin's own files.** The progress-bar view used to be Stream Deck's
	 * built-in `$B1`, and that is why its bar never took the theme: a built-in layout's item keys are
	 * not published anywhere, so `bar_fill_c` was being sent hopefully to a key that may or may not
	 * have been called `indicator`, and there is no error when it is not. A layout we ship is a layout
	 * we can name every key of, so the colour now lands where it is aimed.
	 *
	 * A layout switch wipes the screen back to the layout's own defaults and discards feedback still
	 * in flight alongside it, so the frame that follows this may well not land. That is survivable
	 * because the render loop re-asserts the current frame every couple of seconds — and because both
	 * layouts default their pixmap to nothing rather than falling through to the action icon.
	 */
	#applyLayout(instance: DialInstance): void {
		const layout = instance.countdown.settings.layout === "bar" ? "layouts/bar.json" : "layouts/ring.json";
		if (layout === instance.lastLayout) {
			return;
		}

		instance.lastLayout = layout;
		instance.last = "";
		instance.action.setFeedbackLayout(layout).catch((err) => streamDeck.logger.error("Failed to set layout", err));
	}

	/**
	 * Pushes the current state to the touchscreen. Identical frames are dropped so an idle timer
	 * costs nothing, which is what keeps the 4 Hz render loop comfortably inside Elgato's limit.
	 */
	protected draw(instance: DialInstance, force: boolean): void {
		const { countdown } = instance;
		const { settings, timer } = countdown;
		const status = timer.status;
		const remainingMs = timer.remainingMs;

		// The label shows the preset's own length — as configured, never as the dial has since left it.
		// Once the two disagree it says so, because the gap is otherwise invisible: the clock reads
		// 23:00, the settings still say 20m, and holding the screen is what closes it.
		const label = `${countdown.drifted ? "from " : ""}${formatPresetLabel(countdown.presetSeconds * 1000)}`;
		const value = formatDuration(remainingMs);
		const dimmed = countdown.dimmed;
		const flash = countdown.flashing;
		const toast = countdown.toast;
		const title = settings.showTitle ? `${label}${suffixFor(countdown, status)}` : "";

		// One spare line, two claimants. What you just did wins for a second; after that, the finish
		// time, which is the useful thing on a running clock. The dial's step used to have a claim here
		// too, back when it was a mode that could be left switched on — it is your finger now, so there
		// is nothing left to remind you of.
		const footer = toast || finishText(countdown, remainingMs, status);

		const signature = `${instance.lastLayout}|${title}|${value}|${status}|${dimmed}|${flash}|${footer}|${settings.showLogo}|${settings.theme}`;
		if (!force && signature === instance.last) {
			return;
		}
		instance.last = signature;

		const palette = themeFor(settings.theme);
		const remainingFraction = remainingMs / Math.max(1, timer.durationMs);
		const colour = ringColour({ remainingFraction, status, dimmed, palette });

		// The same four facts either way — the state glyph, the clock, the progress, the two lines of
		// text — laid out differently. Keeping them one expression apart is what stops the two views
		// drifting into disagreeing about what the timer is doing.
		const glyph = asDataUri(
			renderGlyph({ remainingFraction, status, dimmed, palette, logo: settings.showLogo, size: 52 })
		);

		const feedback: FeedbackPayload =
			instance.lastLayout === "layouts/bar.json"
				? {
						glyph,
						value: { value, font: { size: valueFontSize(value) } },
						indicator: {
							value: Math.round((1 - remainingFraction) * 100),
							bar_fill_c: colour,
							bar_bg_c: palette.track
						},
						label: title,
						finish: footer
					}
				: {
						ring: asDataUri(renderRing({ remainingFraction, status, dimmed, flash, palette, logo: settings.showLogo })),
						// The clock is sent as a full item definition so its size can shrink for `1:10:10`.
						value: { value, font: { size: valueFontSize(value) } },
						label: title,
						finish: footer
					};

		instance.action.setFeedback(feedback).catch((err) => streamDeck.logger.error("Failed to set feedback", err));
	}
}

/**
 * The wall-clock time this timer will finish at. Only shown while running — on a stopped timer it
 * would be a prediction that quietly goes stale, which is worse than showing nothing.
 */
function finishText(countdown: Countdown, remainingMs: number, status: string): string {
	if (!countdown.settings.showFinishTime || status !== "running") {
		return "";
	}
	return `ends ${formatClockTime(Date.now() + remainingMs)}`;
}


/**
 * A repeating timer counts its laps; a finished one says so — **and a finished repeating timer says
 * both.**
 *
 * That last case is the one that was missing. The lap count used to win outright whenever it was
 * non-zero, so a timer that had run its last repeat and stopped for good showed `×3/3`, which is
 * character-for-character what it showed while that last repeat was still counting down. There was
 * no way to tell a job that was finished from one that had one lap left to go.
 *
 * The tally is shown on an idle clock too — `20m · ×1/3` before it is started. It is the only thing
 * on screen that says repeat is switched on at all, and the dial's label has room to append it
 * without displacing the preset. The key's one-line caption does not, so it waits until the timer is
 * running; see `captionFor` there.
 */
function suffixFor(countdown: Countdown, status: string): string {
	const done = status === "elapsed" ? " · done" : "";

	if (countdown.laps > 0) {
		return ` · ×${countdown.lap}/${countdown.laps}${done}`;
	}
	return done;
}

/** Shrinks the clock as it gets longer, so `1:10:10` fits the same box as `5:00`. */
function valueFontSize(value: string): number {
	return VALUE_FONT_SIZES[value.length] ?? VALUE_FONT_MIN;
}
