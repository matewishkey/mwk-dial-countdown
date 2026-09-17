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
	 * Set when the dial is turned while held down, so the release that follows is not *also* read as a
	 * press. Holding the dial in is how you ask for minutes; letting go afterwards is the end of that
	 * turn, not a separate instruction to start the clock.
	 */
	turnedWhileDown: boolean;
	/**
	 * Whether the button is down, as this plugin saw it — `dialDown` in, `dialUp` out.
	 *
	 * A rotation already carries a `pressed` flag, so this looks redundant. It is not: the flag
	 * describes the button *as the rotation was reported*, and the two are separate messages from the
	 * hardware. Where they disagree, the one we assembled from the button's own events is the better
	 * answer, so the step is decided from either — the same call `xp_streamdeck` makes.
	 */
	down: boolean;
	lastLayout: string | null;
};

@action({ UUID: "com.matewishkey.dial-countdown-v2.countdown" })
export class DialCountdown extends CountdownAction<Dial, DialInstance> {
	protected readonly controller = "Encoder" as const;

	protected owns(control: Dial | KeyAction<DialCountdownSettings>): control is Dial {
		return control.isDial();
	}

	protected extras(): Omit<DialInstance, keyof Instance<Dial>> {
		return { turnedWhileDown: false, down: false, lastLayout: null };
	}

	protected override attach(instance: DialInstance): void {
		this.#applyLayout(instance);
	}

	/**
	 * Turning adjusts time — **a second a click, or a minute a click while the dial is pushed in.**
	 *
	 * That is the whole of the step model. Whether the dial is pushed in is read per rotation, so the
	 * plugin holds no mode, expires no mode, and has nothing to put on screen reminding you which mode
	 * you left it in: your own finger is the state. It is read from the rotation's own `pressed` flag
	 * or from the button events this plugin has already seen, whichever says yes — see
	 * {@link DialInstance.down}.
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

		streamDeck.logger.info(`dialRotate ticks=${ev.payload.ticks} pressed=${ev.payload.pressed} down=${instance.down}`);

		// **A rotation of no detents is not a rotation, and must not cost you the press.** It is the
		// one variant of this that is completely invisible: a rotate carrying `ticks: 0` between the
		// press and its release sets the guard below, so the release does nothing — no clock moved, no
		// word on the screen, no pulse of the ring. The dial simply appears not to be wired up, which
		// is the report that started this. Elgato documents `ticks` as "positive or negative" and says
		// nothing about ordering, coalescing, or a floor, so nothing here is entitled to assume.
		if (ev.payload.ticks === 0) {
			return;
		}

		// Either source counts. See `DialInstance.down`.
		const pressed = ev.payload.pressed || instance.down;
		if (pressed) {
			instance.turnedWhileDown = true;
		}

		instance.countdown.adjust(ev.payload.ticks, pressed);
		this.acknowledge(instance);
	}

	/**
	 * Bookkeeping, and one decision: **touching the dial settles anything the glass was still waiting
	 * on.**
	 *
	 * A push is only ever half a gesture until it is known whether the dial turned before it came back
	 * up, which is what `turnedWhileDown` records. There is deliberately no long-press timer here any
	 * more. A hold on the dial does nothing at all, which is what lets holding it in mean "minutes" for
	 * as long as you like without a second meaning quietly accruing underneath.
	 *
	 * The cancel is the part that matters. A tap on the touchscreen is held back for
	 * `DOUBLE_TAP_MS` in case a second one is coming, and the screen sits directly above the
	 * dials — so a tap and a press are one reach of the hand often enough to matter. Both resolve to
	 * `toggle`, so the pair used to arrive as **start, then pause**: the plugin said so itself, one
	 * word after the other, and the clock landed back exactly where it began. On a finished timer that
	 * is the whole complaint — you press it to get going again, it sits there full and stopped, and
	 * pressing again cannot recover because an even number of toggles always lands back where it
	 * started.
	 *
	 * A press on the dial is unambiguous and acts at once, so it is the gesture that wins: whatever the
	 * glass was still deciding is stale the moment a finger arrives here. The same rule as the key's
	 * long press, which settles a pending tap for the same reason — see `../gestures`.
	 */
	override onDialDown(ev: DialDownEvent<DialCountdownSettings>): void {
		const instance = this.instanceFor(ev.action.id);
		if (instance === undefined) {
			return;
		}

		streamDeck.logger.info("dialDown");
		instance.taps.cancel();
		instance.down = true;
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

		streamDeck.logger.info(`dialUp turnedWhileDown=${instance.turnedWhileDown} down=${instance.down}`);

		const sawThePress = instance.down;
		instance.down = false;

		if (instance.turnedWhileDown) {
			instance.turnedWhileDown = false;
			return;
		}

		// **Only a release this instance saw the press for counts.** An action is torn down and rebuilt
		// whenever the user flips page or profile, and the rebuilt one starts with both latches clear —
		// so a flip made while the dial was held in came back with no memory of the push, and the
		// release of a minute-stepped turn read as a plain press and started the clock. The clock
		// itself survives the flip (it is parked and revived), which is what made the stray toggle land
		// on a real countdown rather than a fresh one.
		//
		// The trade is deliberate: a *dropped* `dialDown` now swallows a genuine press. That fails as
		// "nothing happened, press it again", which recovers on the next press — against a clock
		// starting or stopping when nobody asked, which announces itself to nobody and does not.
		if (!sawThePress) {
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

		streamDeck.logger.info(`touchTap hold=${ev.payload.hold}`);
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

		const value = formatDuration(remainingMs);
		const dimmed = countdown.dimmed;
		const flash = countdown.flashing;
		const toast = countdown.toast;
		const label = dialLabel(countdown, status);

		// One spare line, two claimants. What you just did wins for a second; after that, the finish
		// time, which is the useful thing on a running clock. The dial's step used to have a claim here
		// too, back when it was a mode that could be left switched on — it is your finger now, so there
		// is nothing left to remind you of.
		const footer = toast || finishText(countdown, remainingMs, status);

		const signature = `${instance.lastLayout}|${label}|${value}|${status}|${dimmed}|${flash}|${footer}|${settings.showLogo}|${settings.theme}`;
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
						label,
						finish: footer
					}
				: {
						ring: asDataUri(renderRing({ remainingFraction, status, dimmed, flash, palette, logo: settings.showLogo })),
						// The clock is sent as a full item definition so its size can shrink for `1:10:10`.
						value: { value, font: { size: valueFontSize(value) } },
						label,
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

/** Shrinks the clock as it gets longer, so `1:10:10` fits the same box as `5:00`. */
function valueFontSize(value: string): number {
	return VALUE_FONT_SIZES[value.length] ?? VALUE_FONT_MIN;
}
