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

/** Blink period while inside the warning window — two render frames on, two off. */
const BLINK_MS = 500;

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
	lastLayout: string | null;
};

@action({ UUID: "com.matewishkey.dial-countdown.countdown" })
export class DialCountdown extends CountdownAction<Dial, DialInstance> {
	protected readonly controller = "Encoder" as const;

	protected owns(control: Dial | KeyAction<DialCountdownSettings>): control is Dial {
		return control.isDial();
	}

	protected extras(): Omit<DialInstance, keyof Instance<Dial>> {
		return { longPressHandle: null, longPressFired: false, lastLayout: null };
	}

	protected override attach(instance: DialInstance): void {
		this.#applyLayout(instance);
	}

	protected override detach(instance: DialInstance): void {
		this.#cancelLongPress(instance);
	}

	/**
	 * Turning adjusts time, and every tick is acknowledged by a pulse of the ring — there is no
	 * haptic feedback to be had on this hardware, so the ring answering each click is what tells you
	 * the dial is being heard.
	 */
	override onDialRotate(ev: DialRotateEvent<DialCountdownSettings>): void {
		const instance = this.instanceFor(ev.action.id);
		if (instance === undefined) {
			return;
		}

		// A rotation is an adjustment, not a preset change — cancel the pending long press so a
		// press-and-turn does not move the preset out from under the value being set.
		this.#cancelLongPress(instance);

		if (instance.countdown.adjust(ev.payload.ticks, ev.payload.pressed)) {
			this.scheduleSave(instance);
		}

		this.acknowledge(instance);
	}

	/**
	 * Starts the clock that decides whether this press is a short one or a long one.
	 *
	 * The dial press cycles presets rather than starting the timer: pressing a dial in is a fiddly,
	 * two-handed movement compared with tapping the screen above it, so the screen owns the gestures
	 * that get used constantly and the dial owns the one that does not.
	 */
	override onDialDown(ev: DialDownEvent<DialCountdownSettings>): void {
		const instance = this.instanceFor(ev.action.id);
		if (instance === undefined) {
			return;
		}

		instance.longPressFired = false;
		instance.longPressHandle = setTimeout(() => {
			instance.longPressFired = true;
			instance.longPressHandle = null;
			this.#cyclePreset(instance, -1);
		}, LONG_PRESS_MS);
	}

	/** A release that beat the long-press threshold moves to the next preset. */
	override onDialUp(ev: DialUpEvent<DialCountdownSettings>): void {
		const instance = this.instanceFor(ev.action.id);
		if (instance === undefined) {
			return;
		}

		const wasLongPress = instance.longPressFired;
		this.#cancelLongPress(instance);

		if (!wasLongPress) {
			this.#cyclePreset(instance, 1);
		}
	}

	/**
	 * Every gesture the screen has: one tap pauses or resumes, two restart from the top, and a held
	 * tap loads the next preset without starting it.
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

	#cyclePreset(instance: DialInstance, step: number): void {
		instance.countdown.cyclePreset(step);
		this.scheduleSave(instance);
		this.acknowledge(instance);
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

		// The label shows the preset's own length — where this timer started — and so stays put while
		// a running timer is nudged. Adjusting a stopped timer edits the preset, and the label follows.
		const label = formatPresetLabel(countdown.presetSeconds * 1000);
		const value = formatDuration(remainingMs);
		const dimmed = isBlinkDim(countdown, remainingMs, status);
		const flash = countdown.flashing;
		const toast = countdown.toast;
		const title = settings.showTitle ? `${label}${suffixFor(countdown, status)}` : "";

		// The bottom line is the acknowledgement's while it lasts, and the finish time's otherwise:
		// there is one line spare, and what just happened matters more for a second than when it ends.
		const footer = toast || finishText(countdown, remainingMs, status);

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

/**
 * True on the dim half of the warning blink.
 *
 * The window is capped at half the preset's own length: a five minute warning on a five minute
 * timer would blink from the moment it started, which is what made adjusting the clock look like it
 * had triggered the warning.
 */
function isBlinkDim(countdown: Countdown, remainingMs: number, status: string): boolean {
	if (!countdown.settings.warnEnabled || status !== "running") {
		return false;
	}

	const windowMs = Math.min(countdown.settings.warnSeconds * 1000, countdown.timer.durationMs / 2);
	if (remainingMs > windowMs) {
		return false;
	}

	return Math.floor(Date.now() / BLINK_MS) % 2 === 1;
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
