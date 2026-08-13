/**
 * The same countdown, on an ordinary key.
 *
 * A key has one button and no dial, so the gesture vocabulary is the screen's, minus the turning:
 * press to pause or resume, press twice to restart, hold for the next preset. Presets themselves
 * are edited in the property inspector, since there is nothing here to wind them with.
 *
 * The one thing the key must do for itself is decide what counts as a hold. The touchscreen reports
 * that on the event; `keyUp` does not, so the threshold is timed here and fires while the finger is
 * still down — waiting for the release to say "you have held this long enough" would be feedback
 * that arrives after the fact.
 */

import streamDeck, {
	action,
	type DialAction,
	type KeyAction,
	type KeyDownEvent,
	type KeyUpEvent
} from "@elgato/streamdeck";

import type { Countdown } from "../countdown";
import { LONG_PRESS_MS } from "../gestures";
import { renderKey, themeFor } from "../render";
import type { DialCountdownSettings } from "../settings";
import { formatDuration, formatPresetLabel } from "../timer";
import { CountdownAction, type Instance } from "./countdown-action";

/** Blink period while inside the warning window — two render frames on, two off. */
const BLINK_MS = 500;

type Key = KeyAction<DialCountdownSettings>;

type KeyInstance = Instance<Key> & {
	longPressHandle: NodeJS.Timeout | null;
	longPressFired: boolean;
};

@action({ UUID: "com.matewishkey.dial-countdown.key" })
export class KeyCountdown extends CountdownAction<Key, KeyInstance> {
	protected readonly controller = "Keypad" as const;

	protected owns(control: DialAction<DialCountdownSettings> | Key): control is Key {
		return control.isKey();
	}

	protected extras(): Omit<KeyInstance, keyof Instance<Key>> {
		return { longPressHandle: null, longPressFired: false };
	}

	protected override detach(instance: KeyInstance): void {
		this.#cancelLongPress(instance);
	}

	override onKeyDown(ev: KeyDownEvent<DialCountdownSettings>): void {
		const instance = this.instanceFor(ev.action.id);
		if (instance === undefined) {
			return;
		}

		instance.longPressFired = false;
		instance.longPressHandle = setTimeout(() => {
			instance.longPressFired = true;
			instance.longPressHandle = null;
			// A hold is unambiguous, so it settles any tap still waiting to see if it had a partner.
			instance.taps.cancel();
			this.perform(instance, "next");
		}, LONG_PRESS_MS);
	}

	override onKeyUp(ev: KeyUpEvent<DialCountdownSettings>): void {
		const instance = this.instanceFor(ev.action.id);
		if (instance === undefined) {
			return;
		}

		const wasLongPress = instance.longPressFired;
		this.#cancelLongPress(instance);

		// The hold already acted, back when the threshold passed; the release itself means nothing.
		if (!wasLongPress) {
			instance.taps.press(false);
		}
	}

	#cancelLongPress(instance: KeyInstance): void {
		if (instance.longPressHandle !== null) {
			clearTimeout(instance.longPressHandle);
			instance.longPressHandle = null;
		}
	}

	/** Draws the whole key face as one image, clock included. */
	protected draw(instance: KeyInstance, force: boolean): void {
		const { countdown } = instance;
		const { settings, timer } = countdown;
		const status = timer.status;
		const remainingMs = timer.remainingMs;

		const value = formatDuration(remainingMs);
		const dimmed = isBlinkDim(countdown, remainingMs, status);
		const flash = countdown.flashing;
		const toast = countdown.toast;

		// One line, three jobs, in order of urgency: what you just did, then the fact that it is
		// paused, then — when there is nothing to report — which preset this is.
		const caption = toast || (status === "paused" ? "paused" : captionFor(countdown, status));
		const accent = toast !== "" || status === "paused";

		const signature = `${value}|${caption}|${accent}|${status}|${dimmed}|${flash}|${settings.theme}`;
		if (!force && signature === instance.last) {
			return;
		}
		instance.last = signature;

		const svg = renderKey({
			remainingFraction: remainingMs / Math.max(1, timer.durationMs),
			status,
			dimmed,
			flash,
			palette: themeFor(settings.theme),
			value,
			caption,
			accent
		});

		instance.action.setImage(svg).catch((err) => streamDeck.logger.error("Failed to set key image", err));
	}
}

/** What the key says when nothing is happening: the preset, its lap count, or that it is done. */
function captionFor(countdown: Countdown, status: string): string {
	if (countdown.cycles > 0) {
		return `×${countdown.cycles}/${countdown.settings.repeatCount}`;
	}
	if (status === "elapsed") {
		return "done";
	}
	return countdown.settings.showTitle ? formatPresetLabel(countdown.presetSeconds * 1000) : "";
}

/** As on the dial: the window is capped at half the preset, so a fresh timer never starts faded. */
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
