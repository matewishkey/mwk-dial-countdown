/**
 * The half of an action that has nothing to do with which control it is on.
 *
 * Appearing, disappearing, taking an edit from the property inspector, auditioning a sound, running
 * the render loop, debouncing the settings write and turning a resolved gesture into a change plus a
 * redraw are identical on a dial and on a key. A subclass supplies only which events drive it and
 * how it is drawn.
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
import { collectDiagnostics, type HostInfo, logLocation } from "../diagnostics";
import { DOUBLE_TAP_MS, type Gesture, TapResolver } from "../gestures";
import { NO_SOUND, normaliseSettings, type DialCountdownSettings } from "../settings";
import { listSounds, type Playback, playSound, resolveSound, soundExists, wantsSound } from "../sound";

/**
 * Render cadence. Marketplace caps touchscreen updates at 10 per second; unchanged frames are
 * dropped before they reach the wire.
 */
const RENDER_INTERVAL_MS = 250;

/** Settings changes are batched, so spinning the dial does not write to disk on every tick. */
const SETTINGS_DEBOUNCE_MS = 400;

/**
 * How often the current frame is re-sent even though nothing has changed.
 *
 * Dropping unchanged frames assumes every frame sent arrives, and there is no way to ask the
 * hardware what it is showing. A countdown is static for long stretches, so one lost frame would
 * stay lost until the user touched something. Re-asserting bounds that to 2 seconds.
 */
const RESEND_INTERVAL_MS = 2_000;
const RESEND_EVERY_TICKS = Math.round(RESEND_INTERVAL_MS / RENDER_INTERVAL_MS);

/**
 * How long a countdown is held for a control that has left the screen. Not a limit on how long a
 * timer may run — only what stops {@link CountdownAction.#suspended} growing without bound, since a
 * deleted action looks exactly like one flipped away from.
 */
const SUSPEND_TTL_MS = 24 * 60 * 60 * 1_000;

/** A countdown waiting for its control to come back, and when it stopped being watched. */
type Suspended = { countdown: Countdown; at: number };

/** How often a running preview is checked, so the inspector's button can go back to saying Test. */
const PREVIEW_POLL_MS = 250;

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
	/** The run of plays sounding for this control, or `null` when nothing is. */
	alert: Playback | null;
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

	/**
	 * Countdowns belonging to controls that are not on screen at the moment.
	 *
	 * A control flipped away from comes back still counting: `Timer` works from an absolute deadline
	 * rather than accumulating ticks, so a suspended countdown keeps good time with nothing running.
	 * Only the drawing stops.
	 *
	 * Held in memory, so lost when the plugin restarts — writing it to disk would mean deciding what
	 * a timer that "finished" while Stream Deck was closed should do.
	 */
	readonly #suspended = new Map<string, Suspended>();

	/**
	 * The property inspector's *Test* sound, and the poll that notices it finishing.
	 *
	 * On the class rather than an instance because the preview belongs to the panel, not a control.
	 */
	#preview: Playback | null = null;

	#previewWatch: NodeJS.Timeout | null = null;

	/** Which control this action runs on, as the manifest declares it. */
	protected abstract readonly controller: "Encoder" | "Keypad";

	/** How long a second press waits for its partner. Glass and a key are not the same speed. */
	protected readonly tapWindowMs: number = DOUBLE_TAP_MS;

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

	/** Anything the control started and must stop, which the base cannot know about. */
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

		// Tearing down first makes a second `willAppear` a replacement rather than a leak. Events are
		// not assumed to be paired: the cost of being wrong is a 4 Hz `setInterval` drawing for ever
		// with its handle unreachable.
		const existing = this.#instances.get(ev.action.id);
		if (existing !== undefined) {
			this.#teardown(existing);
		}

		// Settings arriving from an older build are rebuilt rather than trusted, then written straight
		// back, so a fresh install ends up with a complete, valid set on disk instead of nothing.
		const settings = normaliseSettings(ev.payload.settings);

		const instance = {
			action: ev.action,
			countdown: this.#revive(ev.action.id, settings),
			// Filled in below: the resolver has to be able to call back into the instance holding it.
			taps: undefined,
			renderHandle: null,
			saveHandle: null,
			flashHandle: null,
			last: "",
			ticks: 0,
			alert: null,
			...this.extras()
		} as unknown as I;
		instance.taps = new TapResolver((gesture) => this.perform(instance, gesture), this.tapWindowMs);

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
	 * Fires when the user flips to another page or profile. The render loop is torn down; the
	 * countdown is set aside in {@link #suspended} and handed back if the control returns.
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
	 * The pending settings write is **flushed, not dropped** — teardown is the one moment the
	 * debounce must not swallow, or a preset chosen in the last 400 ms before a page flip is lost.
	 */
	#teardown(instance: I): void {
		this.detach(instance);
		instance.taps.cancel();

		// A control leaving the screen takes its alert with it: the handle that stops a run lives on
		// the instance being thrown away, so one left going could never be silenced.
		this.silence(instance);

		this.#suspend(instance);

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

	/**
	 * Picks up preset and appearance edits made in the property inspector.
	 *
	 * **While a save is pending, the inspector's `presetIndex` is stale and must not be taken.** The
	 * write is held back by {@link SETTINGS_DEBOUNCE_MS}, and Stream Deck forwards a plugin's
	 * `setSettings` on to the inspector — so for those 400 ms the panel is authoritative and out of
	 * date at once, and an unrelated checkbox tick would put the old preset back.
	 *
	 * Only `presetIndex` is held back, and only while a write is outstanding: it is the single field
	 * a gesture can move.
	 */
	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<DialCountdownSettings>): void {
		const instance = this.#instances.get(ev.action.id);
		if (instance === undefined) {
			return;
		}

		const stale = instance.saveHandle !== null;
		const settings = stale
			? { ...ev.payload.settings, presetIndex: instance.countdown.presetIndex }
			: ev.payload.settings;

		instance.countdown.applySettings(settings);

		// The inspector is working from an old copy, so end that: flush the write now rather than at
		// the end of the debounce, which both settles the disk and brings the inspector up to date.
		if (stale && instance.saveHandle !== null) {
			clearTimeout(instance.saveHandle);
			instance.saveHandle = null;
			this.#save(instance);
		}

		this.attach(instance);
		this.refresh(instance, true);
	}

	/**
	 * The property inspector cannot read the filesystem, so the plugin hands it the sound list — and
	 * says which control is being inspected, since one page serves the dial and the key.
	 */
	override onPropertyInspectorDidAppear(ev: PropertyInspectorDidAppearEvent<DialCountdownSettings>): void {
		void ev;
		streamDeck.ui
			.sendToPropertyInspector({ event: "controller", controller: this.controller })
			.catch((err) => streamDeck.logger.error("Failed to send controller", err));
		streamDeck.ui
			.sendToPropertyInspector({ event: "sounds", sounds: listSounds() })
			.catch((err) => streamDeck.logger.error("Failed to send sound list", err));

		// **Where the log is, asked of the running process rather than assumed.** The install path
		// differs by platform and by how Stream Deck was installed, and a plausible-looking path
		// written into a document is how someone ends up searching a folder that was never right.
		streamDeck.ui
			.sendToPropertyInspector({ event: "logPath", logPath: logLocation() })
			.catch((err) => streamDeck.logger.error("Failed to send the log path", err));
	}

	/**
	 * The panel closing stops whatever it was auditioning.
	 *
	 * A preview is reachable only through `sendToPlugin`, so a run left going when the panel closes
	 * has nothing left to stop it. At {@link MAX_SOUND_REPEAT} that is most of a minute of chime.
	 */
	override onPropertyInspectorDidDisappear(): void {
		this.#stopPreview();
	}

	/** Auditions a sound, and answers whether a chosen file actually resolves. */
	override onSendToPlugin(ev: { payload: unknown }): void {
		const payload = ev.payload as
			| {
					event?: string;
					soundId?: string;
					customSoundPath?: string;
					volume?: number;
					soundRepeat?: number;
					fadeRepeats?: boolean;
			  }
			| undefined;

		if (payload?.event === "preview") {
			// Test is a toggle: a second click stops the run rather than starting another underneath it.
			if (this.#preview !== null && this.#preview.active) {
				this.#stopPreview();
				return;
			}

			// The full count and the fade, so what you hear is what the timer will do.
			const path = resolveSound(payload);

			// Through the same seam the timer's alert uses, so one place reaches the operating system.
			this.#preview = this.play(path, payload.volume ?? 100, payload.soundRepeat ?? 1, payload.fadeRepeats === true);
			void this.#reportSound(path, this.#preview !== null);
			void this.#reportPreview(this.#preview !== null);
			this.#watchPreview();
			return;
		}

		// One button, rather than a set of instructions ending in "now find the log folder".
		if (payload?.event === "diagnostics") {
			streamDeck.ui
				.sendToPropertyInspector({ event: "diagnostics", report: collectDiagnostics(undefined, undefined, host()) })
				.catch((err) => streamDeck.logger.error("Failed to send diagnostics", err));
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
		// **A press silences the alert and then stops.** A press made on hearing one is a reflex grab
		// for quiet, so letting it also reach the clock means changing what the timer was doing by
		// accident — on `40m, 10m, 10m, 10m` it paused the ten that had just started.
		//
		// The hold is the exception: it means *put this right*, so it silences and does its job in
		// the one gesture. Turning the dial is not swallowed either — see `dial-countdown.ts`.
		const wasSounding = this.silence(instance);

		if (wasSounding && gesture !== "next") {
			instance.countdown.note("silenced");
			this.acknowledge(instance);
			return;
		}

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
	 * Redraws now, and again when the pulse is due to end, so a flash is a fixed length rather than
	 * anything between nothing and a full render interval.
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
			this.#sound(instance);
		}

		this.#tendAlert(instance);

		instance.ticks += 1;
		this.draw(instance, force || instance.ticks % RESEND_EVERY_TICKS === 0);
	}

	/** Sounds the alert for a stage that has just run out, and decides whether it is a ring. */
	#sound(instance: I): void {
		const { countdown } = instance;
		const { settings } = countdown;

		// One alert at a time, and the newer one wins — two runs playing at once are indistinguishable
		// from a single run whose plays overlap.
		this.silence(instance);

		const path = resolveSound(settings);

		// Every alert is the same kind of thing, whether it ends a step or the whole job. A step
		// boundary is the moment an interval timer most needs announcing, so it is not a lesser one.
		const playback = this.play(path, settings.volume, settings.soundRepeat, settings.fadeRepeats);

		if (playback !== null) {
			instance.alert = playback;
			countdown.ringing = true;
		}

		// A timer that finishes silently when it was asked to make a noise is indistinguishable from
		// one that has not finished, so a failed alert raises Stream Deck's error triangle. It has to
		// tell that from silence the user *chose* — that is what `wantsSound` answers.
		if (wantsSound(path, settings.volume) && playback === null) {
			instance.action.showAlert().catch((err) => streamDeck.logger.error("Failed to show alert", err));
		}
	}

	/**
	 * Notices an alert that ran out of plays on its own, so the next press is not swallowed by a
	 * state that is over.
	 *
	 * **Nothing here silences an alert because the clock is running.** The next step begins the
	 * instant the last ends, so that condition is true one frame after every step's alert starts and
	 * would call it off before it could be heard. An alert outlives the moment it announces: what
	 * ends one is the plays running out, a press, a newer alert, or the control leaving the screen.
	 */
	#tendAlert(instance: I): void {
		if (instance.alert !== null && !instance.alert.active) {
			this.#forgetAlert(instance);
		}
	}

	/**
	 * Stops whatever is sounding for this control.
	 *
	 * @returns `true` if a sound was **actually still playing**, so the caller knows its press has
	 * been spent. A run that had already finished answers `false`, which is what stops a press
	 * arriving before {@link CountdownAction.#tendAlert} notices being eaten by a dead alert.
	 */
	protected silence(instance: I): boolean {
		const alert = instance.alert;
		if (alert === null) {
			return false;
		}

		const wasSounding = alert.active;
		alert.stop();
		this.#forgetAlert(instance);
		return wasSounding;
	}

	#forgetAlert(instance: I): void {
		instance.alert = null;
		instance.countdown.ringing = false;
	}

	/**
	 * The operating system's player, behind a seam so a test can see what was asked for without
	 * making a noise. `playSound` is the only thing in this class that spawns a process.
	 */
	protected play(soundId: string | undefined, volumePercent: number, repeat: number, fade: boolean): Playback | null {
		return playSound(soundId, volumePercent, repeat, fade);
	}

	/** Watches a running preview so the inspector's button can stop saying *Stop*. */
	#watchPreview(): void {
		if (this.#previewWatch !== null) {
			clearInterval(this.#previewWatch);
			this.#previewWatch = null;
		}

		if (this.#preview === null) {
			return;
		}

		this.#previewWatch = setInterval(() => {
			if (this.#preview !== null && this.#preview.active) {
				return;
			}
			this.#stopPreview();
		}, PREVIEW_POLL_MS);
		this.#previewWatch.unref?.();
	}

	/** Ends the preview, however it ended, and tells the panel so its button can go back. */
	#stopPreview(): void {
		if (this.#previewWatch !== null) {
			clearInterval(this.#previewWatch);
			this.#previewWatch = null;
		}

		this.#preview?.stop();
		this.#preview = null;
		void this.#reportPreview(false);
	}

	/** Whether a preview is sounding, so the panel can offer to stop it. */
	async #reportPreview(playing: boolean): Promise<void> {
		try {
			await streamDeck.ui.sendToPropertyInspector({ event: "preview", playing });
		} catch (err) {
			streamDeck.logger.error("Failed to report the preview", err);
		}
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

	/**
	 * The countdown this control should come back to: the one it left with, or a new one.
	 *
	 * A revived countdown is given the current settings through {@link Countdown.applySettings},
	 * which reloads the clock only when the selected duration changed — so a timer running on an
	 * untouched preset keeps running, while one whose preset was rewritten comes back on the new
	 * length.
	 */
	#revive(id: string, settings: DialCountdownSettings): Countdown {
		const suspended = this.#suspended.get(id);
		this.#suspended.delete(id);

		if (suspended === undefined) {
			return new Countdown(settings);
		}

		suspended.countdown.applySettings(settings);
		suspended.countdown.resume();
		return suspended.countdown;
	}

	/** Sets a countdown aside for a control that has left the screen, and forgets the long-gone. */
	#suspend(instance: I): void {
		const now = Date.now();
		for (const [id, held] of this.#suspended) {
			if (now - held.at > SUSPEND_TTL_MS) {
				this.#suspended.delete(id);
			}
		}

		this.#suspended.set(instance.action.id, { countdown: instance.countdown, at: now });
	}

	/** The write itself, so the debounce and the teardown flush cannot come to disagree about it. */
	#save(instance: I): void {
		instance.action
			.setSettings(instance.countdown.persistable)
			.catch((err) => streamDeck.logger.error("Failed to save settings", err));
	}

	/** Tells the property inspector what became of a sound, which it cannot check for itself. */
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

/**
 * What Stream Deck told this plugin about itself when it started, for the diagnostics report. It
 * arrives in the registration handshake and appears nowhere a user could look it up.
 */
function host(): HostInfo {
	return {
		appVersion: streamDeck.info.application.version,
		platform: streamDeck.info.application.platform,
		platformVersion: streamDeck.info.application.platformVersion,
		devices: [...streamDeck.devices].map((device) => `${device.name ?? "unnamed"} (type ${device.type})`)
	};
}

/** Structural comparison, used only to avoid a pointless settings write on every appearance. */
function deepEqual(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}
