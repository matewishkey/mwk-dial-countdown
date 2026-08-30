/**
 * The half of an action that has nothing to do with which control it is on.
 *
 * Appearing, disappearing, taking an edit from the property inspector, auditioning a sound, running
 * the render loop, debouncing the settings write, and turning a resolved gesture into a change plus
 * a redraw — all of that is identical whether the countdown lives on a dial or on a key. What is
 * left to a subclass is only the two things that genuinely differ: which events drive it, and how it
 * is drawn.
 */

import streamDeck, {
	type DialAction,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type PropertyInspectorDidAppearEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent
} from "@elgato/streamdeck";

import { Countdown } from "../countdown";
import { FLASH_MS } from "../feedback";
import { type Gesture, TapResolver } from "../gestures";
import { NO_SOUND, normaliseSettings, type DialCountdownSettings } from "../settings";
import { listSounds, playSound, resolveSound, soundExists, wantsSound } from "../sound";

/**
 * Render cadence. Marketplace guidelines cap touchscreen updates at 10 per second; 4 is plenty to
 * keep the seconds flipping promptly, and unchanged frames are dropped before they reach the wire.
 */
const RENDER_INTERVAL_MS = 250;

/** Settings changes are batched, so spinning the dial does not write to disk on every tick. */
const SETTINGS_DEBOUNCE_MS = 400;

/**
 * How often the current frame is re-sent even though nothing has changed.
 *
 * Dropping unchanged frames assumes every frame that *is* sent arrives, and there is no way to ask
 * the hardware what it is actually showing. A countdown is static for long stretches — idle, paused,
 * finished — so a single frame lost on the way would stay lost until the user touched something. It
 * has happened: feedback sent alongside a layout switch is discarded by Stream Deck, which left the
 * ring layout showing its fallback for an undrawn pixmap, the action's own red icon.
 *
 * Re-asserting every 2 seconds bounds that to 2 seconds, at a cost of one message per control.
 */
const RESEND_INTERVAL_MS = 2_000;
const RESEND_EVERY_TICKS = Math.round(RESEND_INTERVAL_MS / RENDER_INTERVAL_MS);

/** Everything that lives only for as long as the action is on screen. */
export type Instance<A> = {
	action: A;
	countdown: Countdown;
	/** Assigned immediately after construction, since it has to call back into its own instance. */
	taps: TapResolver;
	renderHandle: NodeJS.Timeout | null;
	saveHandle: NodeJS.Timeout | null;
	flashHandle: NodeJS.Timeout | null;
	/** Signature of the last frame sent, so an unchanged one can be dropped. */
	last: string;
	/** Turns of the render loop, counted only so the frame can be re-asserted periodically. */
	ticks: number;
};

export abstract class CountdownAction<
	A extends DialAction<DialCountdownSettings> | KeyAction<DialCountdownSettings>,
	I extends Instance<A> = Instance<A>
> extends SingletonAction<DialCountdownSettings> {
	/**
	 * One entry per visible control, keyed by action id. A Stream Deck + has four dials and any
	 * number of keys, each holding its own independent timer, so none of this state can live on the
	 * action class itself.
	 */
	readonly #instances = new Map<string, I>();

	/** Which control this action runs on, as the manifest declares it. */
	protected abstract readonly controller: "Encoder" | "Keypad";

	/** Narrows a control to the one this action can drive; anything else is left alone. */
	protected abstract owns(action: DialAction<DialCountdownSettings> | KeyAction<DialCountdownSettings>): action is A;

	/** Per-instance state this control needs on top of the shared fields, at its starting values. */
	protected abstract extras(): Omit<I, keyof Instance<A>>;

	/** Pushes the current state to the hardware, dropping the frame if nothing has changed. */
	protected abstract draw(instance: I, force: boolean): void;

	/** Anything the control needs setting up once, before it can be drawn on. */
	protected attach(instance: I): void {
		void instance;
	}

	/**
	 * Anything the control started and must stop. The base cannot know about a subclass's own timers,
	 * and one left running would fire against a control that is no longer on screen.
	 */
	protected detach(instance: I): void {
		void instance;
	}

	protected instanceFor(id: string): I | undefined {
		return this.#instances.get(id);
	}

	override onWillAppear(ev: WillAppearEvent<DialCountdownSettings>): void {
		if (!this.owns(ev.action)) {
			return;
		}

		// Stream Deck normally pairs an appearance with a disappearance, but nothing here is in a
		// position to rely on it, and the cost of being wrong is not a stale object — it is a 4 Hz
		// `setInterval` drawing to a control for ever with its handle no longer reachable by anything.
		// Tearing down first makes a second `willAppear` a replacement rather than a leak.
		const existing = this.#instances.get(ev.action.id);
		if (existing !== undefined) {
			this.#teardown(existing);
		}

		// Settings arriving from an older build are rebuilt rather than trusted, then written straight
		// back, so a fresh install ends up with a complete, valid set on disk instead of nothing.
		const settings = normaliseSettings(ev.payload.settings);

		const instance = {
			action: ev.action,
			countdown: new Countdown(settings),
			// Filled in below: the resolver has to be able to call back into the instance holding it.
			taps: undefined,
			renderHandle: null,
			saveHandle: null,
			flashHandle: null,
			last: "",
			ticks: 0,
			...this.extras()
		} as unknown as I;
		instance.taps = new TapResolver((gesture) => this.perform(instance, gesture));

		this.#instances.set(ev.action.id, instance);
		instance.renderHandle = setInterval(() => this.refresh(instance), RENDER_INTERVAL_MS);
		this.attach(instance);
		this.refresh(instance, true);

		if (!deepEqual(ev.payload.settings, settings)) {
			instance.action
				.setSettings(settings)
				.catch((err) => streamDeck.logger.error("Failed to persist normalised settings", err));
		}
	}

	/**
	 * Fires when the user flips to another page or profile. The render loop is torn down, but the
	 * timer itself is deliberately dropped with it: a countdown the user cannot see, on a control that
	 * no longer exists, has nothing to count for. Persisted presets survive; the running clock does not.
	 */
	override onWillDisappear(ev: WillDisappearEvent<DialCountdownSettings>): void {
		const instance = this.#instances.get(ev.action.id);
		if (instance === undefined) {
			return;
		}

		this.#teardown(instance);
	}

	/**
	 * Stops everything an instance started, and forgets it.
	 *
	 * **The pending settings write is flushed, not dropped.** {@link CountdownAction.scheduleSave}
	 * holds a write back by {@link SETTINGS_DEBOUNCE_MS} so that spinning the dial does not go to disk
	 * on every tick, which is right — but teardown is the one moment that debounce must not swallow.
	 * Dropping it is what lost a preset selection made in the four hundred milliseconds before the
	 * user flipped to another page: the gesture had happened, the acknowledgement had been drawn, and
	 * the write was silently binned on the way out.
	 */
	#teardown(instance: I): void {
		this.detach(instance);
		instance.taps.cancel();

		if (instance.renderHandle !== null) {
			clearInterval(instance.renderHandle);
			instance.renderHandle = null;
		}

		if (instance.saveHandle !== null) {
			clearTimeout(instance.saveHandle);
			instance.saveHandle = null;
			this.#save(instance);
		}

		if (instance.flashHandle !== null) {
			clearTimeout(instance.flashHandle);
			instance.flashHandle = null;
		}

		this.#instances.delete(instance.action.id);
	}

	/** Picks up preset and appearance edits made in the property inspector. */
	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<DialCountdownSettings>): void {
		const instance = this.#instances.get(ev.action.id);
		if (instance === undefined) {
			return;
		}

		instance.countdown.applySettings(ev.payload.settings);
		this.attach(instance);
		this.refresh(instance, true);
	}

	/**
	 * The property inspector cannot read the filesystem, so the plugin hands it the sound list — and
	 * tells it which control it is inspecting, since the same page serves the dial and the key and
	 * they do not have the same settings or the same gestures to describe.
	 */
	override onPropertyInspectorDidAppear(ev: PropertyInspectorDidAppearEvent<DialCountdownSettings>): void {
		void ev;
		streamDeck.ui
			.sendToPropertyInspector({ event: "controller", controller: this.controller })
			.catch((err) => streamDeck.logger.error("Failed to send controller", err));
		streamDeck.ui
			.sendToPropertyInspector({ event: "sounds", sounds: listSounds() })
			.catch((err) => streamDeck.logger.error("Failed to send sound list", err));
	}

	/** Auditions a sound, and answers whether a chosen file actually resolves. */
	override onSendToPlugin(ev: { payload: unknown }): void {
		const payload = ev.payload as
			| { event?: string; soundId?: string; customSoundPath?: string; volume?: number; soundRepeat?: number }
			| undefined;

		if (payload?.event === "preview") {
			// The preview plays the full repeat count, so what you hear is what the timer will do.
			const path = resolveSound(payload);
			const played = playSound(path, payload.volume ?? 100, payload.soundRepeat ?? 1);
			void this.#reportSound(path, played);
			return;
		}

		if (payload?.event === "checkSound") {
			void this.#reportSound(resolveSound(payload), null);
		}
	}

	/**
	 * Runs a resolved gesture: change the state, redraw at once so the acknowledgement is immediate,
	 * and book a second redraw for the moment the pulse expires.
	 */
	protected perform(instance: I, gesture: Gesture): void {
		instance.countdown.apply(gesture);

		// Only a preset change alters anything worth keeping. Pausing and restarting are states of a
		// clock that is deliberately not persisted at all, so writing on those is a disk write and a
		// message to the property inspector in exchange for nothing.
		if (gesture === "next") {
			this.scheduleSave(instance);
		}

		this.acknowledge(instance);
	}

	/**
	 * Redraws now, and again when the pulse is due to end.
	 *
	 * Without the second redraw the pulse would last until the render loop next came round, which is
	 * anywhere between nothing and a full 250 ms — a flash of visibly random length. This pins it.
	 */
	protected acknowledge(instance: I): void {
		this.refresh(instance, true);

		if (instance.flashHandle !== null) {
			clearTimeout(instance.flashHandle);
		}
		instance.flashHandle = setTimeout(() => {
			instance.flashHandle = null;
			this.refresh(instance, true);
		}, FLASH_MS);
	}

	/** One turn of the render loop: move an elapsed timer on, sound its alert, then draw. */
	protected refresh(instance: I, force = false): void {
		if (instance.countdown.settle()) {
			const { settings } = instance.countdown;
			const path = resolveSound(settings);
			const played = playSound(path, settings.volume, settings.soundRepeat);

			// The alert sound is the only thing here that can fail outside the plugin's control: a
			// custom file that has since been moved or renamed, or a platform with no player to hand
			// it to. Elgato's guidelines ask for `showAlert` when an action was unsuccessful, and this
			// is the case that most needs it — a timer that finishes in silence when it was asked to
			// make a noise is indistinguishable from a timer that has not finished yet, which is the
			// one thing an alarm must never be.
			//
			// Which is exactly why it has to know the difference between a sound that failed and a
			// sound nobody asked for. `wantsSound` is that question, and getting it half right is what
			// put an error triangle on every finish of a timer set to *No sound*: the volume check was
			// here, the picker check was not. See `../sound`.
			if (wantsSound(path, settings.volume) && !played) {
				instance.action.showAlert().catch((err) => streamDeck.logger.error("Failed to show alert", err));
			}
		}

		instance.ticks += 1;
		this.draw(instance, force || instance.ticks % RESEND_EVERY_TICKS === 0);
	}

	protected scheduleSave(instance: I): void {
		if (instance.saveHandle !== null) {
			clearTimeout(instance.saveHandle);
		}
		instance.saveHandle = setTimeout(() => {
			instance.saveHandle = null;
			this.#save(instance);
		}, SETTINGS_DEBOUNCE_MS);
	}

	/** The write itself, so the debounce and the teardown flush cannot come to disagree about it. */
	#save(instance: I): void {
		instance.action
			.setSettings(instance.countdown.persistable)
			.catch((err) => streamDeck.logger.error("Failed to save settings", err));
	}

	/**
	 * Tells the property inspector what became of a sound. The inspector cannot reach the filesystem,
	 * so without this a mistyped or unresolved path looks identical to a working one until it matters.
	 */
	async #reportSound(path: string, played: boolean | null): Promise<void> {
		try {
			await streamDeck.ui.sendToPropertyInspector({
				event: "soundStatus",
				path,
				exists: path === NO_SOUND ? true : soundExists(path),
				played
			});
		} catch (err) {
			streamDeck.logger.error("Failed to report sound status", err);
		}
	}
}

/** Structural comparison, used only to avoid a pointless settings write on every appearance. */
function deepEqual(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}
