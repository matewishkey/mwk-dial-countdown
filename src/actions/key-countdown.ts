/**
 * The same countdown, on an ordinary key.
 *
 * One button and no dial, so the vocabulary is the screen's minus the turning: press to pause or
 * resume, twice to reset, hold for the next preset.
 *
 * The key must decide what counts as a hold for itself — `keyUp` does not report it — so the
 * threshold is timed here and fires while the finger is still down, rather than waiting for a
 * release that would make the feedback arrive after the fact.
 */

import streamDeck, {
	action,
	type DialAction,
	type KeyAction,
	type KeyDownEvent,
	type KeyUpEvent
} from "@elgato/streamdeck";

import { DOUBLE_PRESS_MS, LONG_PRESS_MS } from "../gestures";
import { keyCaption } from "../label";
import { asDataUri, renderKey, themeFor } from "../render";
import type { DialCountdownSettings } from "../settings";
import { formatDuration } from "../timer";
import { CountdownAction, type Instance } from "./countdown-action";

type Key = KeyAction<DialCountdownSettings>;

type KeyInstance = Instance<Key> & {
	longPressHandle: NodeJS.Timeout | null;
	longPressFired: boolean;
};

@action({ UUID: "com.matewishkey.dial-countdown-v2.key" })
export class KeyCountdown extends CountdownAction<Key, KeyInstance> {
	protected readonly controller = "Keypad" as const;

	/** A key is slower to press twice than glass is to tap twice, so it waits longer for the partner. */
	protected override readonly tapWindowMs = DOUBLE_PRESS_MS;

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

		// **Clear the old handle before arming a new one.** Every other timer in this plugin does; this
		// one did not, so a `keyDown` with no `keyUp` between overwrote a live handle and left it
		// unreachable — `#cancelLongPress` would then find `null` and teardown would clear nothing, so
		// the orphan fired `next` against a dead instance, advancing the preset of a countdown parked
		// off screen and scheduling two more handles nothing could ever clear. The base class refuses
		// to assume events are paired (see `countdown-action.ts`); this handler was assuming it.
		this.#cancelLongPress(instance);

		// A press still waiting on a partner stops counting down while this one is in progress, so the
		// hold below is free to settle it rather than racing it. See `../gestures`.
		instance.taps.hold();

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
		const dimmed = countdown.dimmed;
		const flash = countdown.flashing;
		const toast = countdown.toast;

		// One line, three jobs, in order of urgency: what you just did, then the fact that it is
		// paused, then — when there is nothing to report — what this timer is.
		const caption = toast || (status === "paused" ? "paused" : keyCaption(countdown, status));
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

		// A data URI, not the bare markup. setImage documents a file path or "a base64 encoded string
		// with the mime type declared" — a raw <svg> string is not one of them, and is dropped, which
		// leaves the key showing the static image from the manifest and looking completely dead.
		instance.action.setImage(asDataUri(svg)).catch((err) => streamDeck.logger.error("Failed to set key image", err));
	}
}
