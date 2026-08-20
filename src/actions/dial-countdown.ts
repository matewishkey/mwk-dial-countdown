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
import { LONG_PRESS_MS } from "../gestures";
import { asDataUri, renderRing, ringColour, themeFor } from "../render";
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
	longPressHandle: NodeJS.Timeout | null;
	longPressFired: boolean;
	/** Set when the dial is turned while held, so the release is not also read as a press. */
	turnedWhileDown: boolean;
	lastLayout: string | null;
};

@action({ UUID: "com.matewishkey.dial-countdown.countdown" })
export class DialCountdown extends CountdownAction<Dial, DialInstance> {
	protected readonly controller = "Encoder" as const;

	protected owns(control: Dial | KeyAction<DialCountdownSettings>): control is Dial {
		return control.isDial();
	}

	protected extras(): Omit<DialInstance, keyof Instance<Dial>> {
		return { longPressHandle: null, longPressFired: false, turnedWhileDown: false, lastLayout: null };
	}

	protected override attach(instance: DialInstance): void {
		this.#applyLayout(instance);
	}

	protected override detach(instance: DialInstance): void {
		this.#cancelLongPress(instance);
	}

	/**
	 * Turning adjusts time, and every click is acknowledged by a pulse of the ring — there is no
	 * haptic feedback to be had on this hardware, so the ring answering each click is what tells you
	 * the dial is being heard.
	 *
	 * Nothing is saved, because nothing worth saving changed: turning moves the clock, never the
	 * preset behind it, and never the step. A rotation while the dial is held is still just a
	 * rotation — it only cancels the press, so letting go afterwards does not also change the step.
	 */
	override onDialRotate(ev: DialRotateEvent<DialCountdownSettings>): void {
		const instance = this.instanceFor(ev.action.id);
		if (instance === undefined) {
			return;
		}

		if (ev.payload.pressed) {
			instance.turnedWhileDown = true;
			this.#cancelLongPress(instance);
		}

		instance.countdown.adjust(ev.payload.ticks);
		this.acknowledge(instance);
	}

	/**
	 * Starts the clock that decides whether this press is a short one or a long one.
	 *
	 * The dial sets the step. Preset cycling lives on the touchscreen, where the hand already is when
	 * it is reading the clock — pressing a dial in is a fiddly, two-handed movement by comparison, so
	 * it gets the job you do occasionally and deliberately rather than the one you do constantly.
	 */
	override onDialDown(ev: DialDownEvent<DialCountdownSettings>): void {
		const instance = this.instanceFor(ev.action.id);
		if (instance === undefined) {
			return;
		}

		instance.longPressFired = false;
		instance.turnedWhileDown = false;
		instance.longPressHandle = setTimeout(() => {
			instance.longPressFired = true;
			instance.longPressHandle = null;
			// Fires while the finger is still down: telling someone they have held long enough only
			// once they have let go is feedback that arrives after the fact.
			instance.countdown.coarsenStep();
			this.acknowledge(instance);
		}, LONG_PRESS_MS);
	}

	/** A release that beat the long-press threshold swaps the step between seconds and minutes. */
	override onDialUp(ev: DialUpEvent<DialCountdownSettings>): void {
		const instance = this.instanceFor(ev.action.id);
		if (instance === undefined) {
			return;
		}

		const acted = instance.longPressFired || instance.turnedWhileDown;
		this.#cancelLongPress(instance);

		if (!acted) {
			instance.countdown.cycleStep();
			this.acknowledge(instance);
		}
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

	#cancelLongPress(instance: DialInstance): void {
		if (instance.longPressHandle !== null) {
			clearTimeout(instance.longPressHandle);
			instance.longPressHandle = null;
		}
	}

	/**
	 * Switches the touchscreen between the ring layout and the built-in bar, when the choice changes.
	 *
	 * A layout switch wipes the screen back to the layout's own defaults and discards feedback still
	 * in flight alongside it, so the frame that follows this may well not land. That is survivable
	 * because the render loop re-asserts the current frame every couple of seconds — and because the
	 * ring layout now defaults its pixmap to nothing rather than falling through to the action icon.
	 */
	#applyLayout(instance: DialInstance): void {
		const layout = instance.countdown.settings.layout === "bar" ? "$B1" : "layouts/ring.json";
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

		// One spare line, three claimants, in order of how long they matter for. What you just did wins
		// for a second. Then the finish time, which is the useful thing on a running clock. Then the
		// dial's step — last because it is only there at all when it is not the default, but it has to
		// be somewhere: a chosen step never expires, so nothing else would ever remind you of it.
		const footer = toast || finishText(countdown, remainingMs, status) || countdown.stepLabel;

		const signature = `${instance.lastLayout}|${title}|${value}|${status}|${dimmed}|${flash}|${footer}|${settings.showLogo}|${settings.theme}`;
		if (!force && signature === instance.last) {
			return;
		}
		instance.last = signature;

		const palette = themeFor(settings.theme);
		const remainingFraction = remainingMs / Math.max(1, timer.durationMs);
		const colour = ringColour({ remainingFraction, status, dimmed, palette });

		const feedback: FeedbackPayload =
			instance.lastLayout === "$B1"
				? {
						// The bar layout has one text slot, so the acknowledgement takes the title while it lasts.
						title: toast || title,
						value,
						indicator: {
							value: Math.round((1 - remainingFraction) * 100),
							bar_fill_c: colour,
							bar_bg_c: palette.track
						}
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


/** A repeating timer counts its laps; a finished one says so. */
function suffixFor(countdown: Countdown, status: string): string {
	if (countdown.cycles > 0) {
		// The count says how far through the repeats it is, so an unattended timer is readable.
		return ` · ×${countdown.cycles}/${countdown.settings.repeatCount}`;
	}
	return status === "elapsed" ? " · done" : "";
}

/** Shrinks the clock as it gets longer, so `1:10:10` fits the same box as `5:00`. */
function valueFontSize(value: string): number {
	return VALUE_FONT_SIZES[value.length] ?? VALUE_FONT_MIN;
}
