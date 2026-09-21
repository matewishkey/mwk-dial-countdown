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
import { dialPress } from "../gestures";
import { dialLabel } from "../label";
import { asDataUri, renderGlyph, renderRing, ringColour, themeFor } from "../render";
import type { DialCountdownSettings } from "../settings";
import { formatClockTime, formatDuration } from "../timer";
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
	 * Set when the dial is turned while held down, so the release is not also read as a press.
	 * Holding the dial in asks for minutes; letting go ends that turn.
	 */
	turnedWhileDown: boolean;
	/**
	 * Whether the button is down, as this plugin saw it. Used to refuse a release this instance
	 * never saw the press for, which is what a page flip mid-press produces.
	 */
	down: boolean;
	/** When the button went in, so the release can tell a press from a hold. `null` when up. */
	pressedAt: number | null;
	lastLayout: string | null;
};

@action({ UUID: "com.matewishkey.dial-countdown-v2.countdown" })
export class DialCountdown extends CountdownAction<Dial, DialInstance> {
	protected readonly controller = "Encoder" as const;

	protected owns(control: Dial | KeyAction<DialCountdownSettings>): control is Dial {
		return control.isDial();
	}

	protected extras(): Omit<DialInstance, keyof Instance<Dial>> {
		return { turnedWhileDown: false, down: false, pressedAt: null, lastLayout: null };
	}

	protected override attach(instance: DialInstance): void {
		this.#applyLayout(instance);
	}

	/**
	 * Turning adjusts time: a second a click, or a minute a click while the dial is pushed in.
	 * `pressed` arrives on the event, so the plugin holds no mode.
	 *
	 * Every click pulses the ring. There is no haptic feedback on this hardware, so the ring
	 * answering each click is what says the dial is being heard.
	 */
	override onDialRotate(ev: DialRotateEvent<DialCountdownSettings>): void {
		const instance = this.instanceFor(ev.action.id);
		if (instance === undefined) {
			return;
		}

		// A rotation of no detents must not cost the press: a `ticks: 0` event between a press and its
		// release would set the guard below and the release would do nothing at all, which looks
		// exactly like a dial that is not wired up.
		if (ev.payload.ticks === 0) {
			return;
		}

		if (ev.payload.pressed) {
			instance.turnedWhileDown = true;
		}

		// Turning silences an alert but is not swallowed by it: winding a finished timer is how the
		// next one is set up, and losing a click of a rotation would read as the dial skipping.
		this.silence(instance);

		instance.countdown.adjust(ev.payload.ticks, ev.payload.pressed);
		this.acknowledge(instance);
	}

	/**
	 * Records the press, and settles anything the glass was still waiting on.
	 *
	 * The screen sits directly above the dials, so a tap and a press are often one reach of the
	 * hand. Both resolve to `toggle`, so without the cancel the pair arrives as start-then-pause and
	 * the clock lands back where it began. A press on the dial is unambiguous, so it wins.
	 */
	override onDialDown(ev: DialDownEvent<DialCountdownSettings>): void {
		const instance = this.instanceFor(ev.action.id);
		if (instance === undefined) {
			return;
		}

		instance.taps.cancel();
		instance.down = true;
		instance.pressedAt = Date.now();
		instance.turnedWhileDown = false;
	}

	/**
	 * A press that did not turn the dial starts or pauses the clock; a held one puts it right.
	 *
	 * This acts on release rather than on a timer — see `dialPress` in `../gestures` for why that is
	 * what makes a hold safe here at all.
	 */
	override onDialUp(ev: DialUpEvent<DialCountdownSettings>): void {
		const instance = this.instanceFor(ev.action.id);
		if (instance === undefined) {
			return;
		}

		const sawThePress = instance.down;
		const heldFrom = instance.pressedAt;
		instance.down = false;
		instance.pressedAt = null;

		if (instance.turnedWhileDown) {
			instance.turnedWhileDown = false;
			return;
		}

		// Only a release this instance saw the press for counts. A page flip mid-press rebuilds the
		// action with its latches clear, so the release of a minute-stepped turn would otherwise read
		// as a plain press and start the clock. The trade: a dropped `dialDown` swallows a genuine
		// press, which fails as "press it again" rather than as a clock moving unasked.
		if (!sawThePress) {
			return;
		}

		// Measured on release, never by a timer: pushing the dial in asks for minutes, so a threshold
		// firing mid-press would go off in the pause before the wind started. A press that turned has
		// already returned above, so what reaches here can only be a hold.
		//
		// The trade: a slow, deliberate press meant as a pause reads as a hold, undone by one more.
		this.perform(instance, dialPress(heldFrom === null ? 0 : Date.now() - heldFrom));
	}

	/** Every gesture the screen has: tap to pause or resume, twice to reset, hold to put right. */
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
	 * Both layouts are the plugin's own files: a built-in layout's item keys are not published, so
	 * the theme colour could not be aimed at them. A layout switch wipes the screen and discards
	 * feedback in flight, which the periodic re-assert covers.
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

	/** Pushes the current state to the touchscreen, dropping identical frames. */
	protected draw(instance: DialInstance, force: boolean): void {
		const { countdown } = instance;
		const { settings, timer } = countdown;
		const status = timer.status;
		const remainingMs = timer.remainingMs;

		const value = formatDuration(remainingMs);
		const dimmed = countdown.dimmed;
		const flash = countdown.flashing;
		const toast = countdown.toast;
		const ringing = countdown.ringing;
		const label = dialLabel(countdown, status);

		// One spare line, two claimants. What you just did wins for a second; after that, the finish
		// time, which is the useful thing on a running clock. The dial's step used to have a claim here
		// too, back when it was a mode that could be left switched on — it is your finger now, so there
		// is nothing left to remind you of.
		const footer = toast || finishText(countdown, remainingMs, status);

		const palette = themeFor(settings.theme);
		const remainingFraction = remainingMs / Math.max(1, timer.durationMs);
		const colour = ringColour({ remainingFraction, status, dimmed, palette });

		// The same four facts either way — the state glyph, the clock, the progress, the two lines of
		// text — laid out differently. Keeping them one expression apart is what stops the two views
		// drifting into disagreeing about what the timer is doing.
		const glyph = asDataUri(
			renderGlyph({ remainingFraction, status, dimmed, ringing, palette, logo: settings.showLogo, size: 52 })
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
						label,
						finish: footer
					}
				: {
						ring: asDataUri(
							renderRing({ remainingFraction, status, dimmed, flash, ringing, palette, logo: settings.showLogo })
						),
						// The clock is sent as a full item definition so its size can shrink for `1:10:10`.
						value: { value, font: { size: valueFontSize(value) } },
						label,
						finish: footer
					};

		// **The frame is its own signature.** This used to be a hand-written list of the things a
		// frame depends on, and the trouble with such a list is that it goes stale silently: the
		// draw keeps working, the omitted field simply stops being able to change the picture. That
		// is how a sounding alert could set its bell without the bell ever reaching the screen — the
		// clock behind it read the same second, so the frame was judged identical and dropped.
		// Comparing what is actually being sent cannot forget a field, because there is no list.
		const frame = JSON.stringify(feedback);
		if (!force && frame === instance.last) {
			return;
		}
		instance.last = frame;

		instance.action.setFeedback(feedback).catch((err) => streamDeck.logger.error("Failed to set feedback", err));
	}
}

/**
 * The wall-clock time this timer will finish at — the end of the whole job, stages included. Only
 * shown while running; on a stopped timer it would be a prediction that goes stale.
 */
function finishText(countdown: Countdown, remainingMs: number, status: string): string {
	if (!countdown.settings.showFinishTime || status !== "running") {
		return "";
	}
	const aheadMs = remainingMs + countdown.remainingStagesSeconds * 1000;
	return `ends ${formatClockTime(Date.now() + aheadMs)}`;
}

/** Shrinks the clock as it gets longer, so `1:10:10` fits the same box as `5:00`. */
function valueFontSize(value: string): number {
	return VALUE_FONT_SIZES[value.length] ?? VALUE_FONT_MIN;
}
