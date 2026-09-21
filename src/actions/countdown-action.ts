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
import { collectDiagnostics, type HostInfo, logLocation } from "../diagnostics";
import { DOUBLE_TAP_MS, type Gesture, TapResolver } from "../gestures";
import { NO_SOUND, normaliseSettings, type DialCountdownSettings } from "../settings";
import { listSounds, type Playback, playSound, resolveSound, soundExists, wantsSound } from "../sound";

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

/**
 * How long a countdown is held for a control that has left the screen.
 *
 * Not a limit on how long a timer may run — it is only what stops {@link CountdownAction.#suspended}
 * growing without bound. An action *deleted* from a profile looks exactly like one flipped away from,
 * and nothing tells the plugin which it was, so the only difference is that nobody ever comes back
 * for the first. A day is the longest a countdown can be set to in the first place.
 */
const SUSPEND_TTL_MS = 24 * 60 * 60 * 1_000;

/** A countdown waiting for its control to come back, and when it stopped being watched. */
type Suspended = { countdown: Countdown; at: number };

/**
 * The alert currently sounding for one control, and whether it is a *ring*.
 *
 * One object rather than two fields, so the two cannot come to disagree. `ringing` is the plugin's
 * policy — it is not something the player knows or should — and it is fixed when the run starts:
 * whether this particular alert is the kind a press silences instead of obeying.
 */
type Alert = { playback: Playback; ringing: boolean };

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
	/** The alert sounding for this control, or `null` when nothing is. */
	alert: Alert | null;
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
	 * **A timer used to be destroyed the moment you flipped to another page**, on the reasoning that a
	 * countdown nobody can see has nothing to count for. That is true of a control that is *gone*; it
	 * is not true of one you looked away from for eleven seconds to press something else — and
	 * flipping pages is a thing Stream Deck users do constantly. Losing the count because of it is the
	 * single worst thing a timer can do.
	 *
	 * The clock survives because it never needed the render loop in the first place: `Timer` works
	 * from an absolute deadline rather than accumulating ticks, so a suspended countdown keeps
	 * perfectly good time with nothing running. Only the drawing stops.
	 *
	 * **Held in memory, deliberately, and so lost when the plugin restarts.** Writing it to disk would
	 * mean deciding what a timer that "finished" while Stream Deck was closed should do, and there is
	 * no good answer to that. Page and profile switches are the case worth solving.
	 */
	readonly #suspended = new Map<string, Suspended>();

	/**
	 * The property inspector's *Test* sound, and the poll that notices it finishing.
	 *
	 * On the class rather than on an instance because the preview belongs to the panel, not to a
	 * control: there is one inspector open at a time and it is auditioning settings, not ringing a
	 * timer. Held at all because clicking *Test* twice used to start a second run over the top of the
	 * first — which was a curiosity at three plays and is a minute of chime you cannot call off now
	 * that the count goes to {@link MAX_SOUND_REPEAT}.
	 */
	#preview: Playback | null = null;

	#previewWatch: NodeJS.Timeout | null = null;

	/** Which control this action runs on, as the manifest declares it. */
	protected abstract readonly controller: "Encoder" | "Keypad";

	/**
	 * How long a second press has to arrive to count as a double one.
	 *
	 * Glass and a physical key are not the same speed, so this belongs to the control rather than to
	 * the resolver — see `../gestures`. The touchscreen's figure is the default.
	 */
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
	 * Fires when the user flips to another page or profile.
	 *
	 * The render loop is torn down; the countdown is not. It is set aside in {@link #suspended} and
	 * handed back if the control returns — see there for why, and for what is deliberately not kept.
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

		// **A control that has left the screen takes its alarm with it.** Not because a page flip means
		// you heard it — it does not, and `Countdown.resume` is where that reasoning lives — but
		// because the handle that stops a ring lives on the instance being thrown away. An alert left
		// running here is one nothing can ever silence, which is the one thing worse than a missed one.
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
	 * **A pending save means the inspector cannot have seen the user's last gesture, so its idea of
	 * which preset is selected is stale and must not be taken.** The write is held back by
	 * {@link SETTINGS_DEBOUNCE_MS} so that spinning the dial does not go to disk per click; Stream Deck
	 * forwards a plugin's `setSettings` on to the inspector, which subscribes to it, so the inspector
	 * catches up the moment that write lands — but not before. For those 400 ms it is authoritative and
	 * out of date at once.
	 *
	 * What that cost: hold the screen to pick the next preset, then tick any checkbox in the inspector
	 * within the window, and the inspector's `presetIndex` came back over the top — the clock reloaded
	 * the old preset and the debounced write then put the old index on disk, so the selection was gone
	 * from memory and from disk both. Measured against the built plugin: at 80 ms and 250 ms after the
	 * hold the advance was undone; at 800 ms, past the write, it survived.
	 *
	 * Only `presetIndex` is held back, and only while a write is outstanding. It is the single field a
	 * gesture can move — {@link CountdownAction.perform} schedules a save for `next` and nothing else —
	 * so everything the user actually came to the inspector to change is taken as sent, including an
	 * edit to the preset lengths themselves.
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

		// **Where the log is, asked of the running process rather than assumed.** The install path
		// differs by platform and by how Stream Deck was installed, and a plausible-looking path
		// written into a document is how someone ends up searching a folder that was never right.
		streamDeck.ui
			.sendToPropertyInspector({ event: "logPath", logPath: logLocation() })
			.catch((err) => streamDeck.logger.error("Failed to send the log path", err));
	}

	/**
	 * **The panel closing stops whatever it was auditioning.**
	 *
	 * The preview is reachable only through `sendToPlugin`, which is to say only through the panel —
	 * so a run left going when the panel closes is a noise with nothing left to stop it. That was
	 * survivable while the count stopped at ten and is not now it reaches {@link MAX_SOUND_REPEAT}:
	 * close the inspector mid-audition and the machine chimes for the better part of a minute with no
	 * button anywhere to press. The whole reason the cap could be raised is that no setting may
	 * produce a sound there is no way to call off, and this was the hole in that claim.
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
			// **Test is a toggle.** A second click while it is still going stops it rather than starting
			// a second run underneath the first, which is what it used to do — bearable at three plays,
			// and not at the sixty the ring mode makes settable.
			if (this.#preview !== null && this.#preview.active) {
				this.#stopPreview();
				return;
			}

			// The preview plays the full count, with the fade, so what you hear is what the timer will
			// do. It does not ring: the ringing state is a property of a control you can press, and
			// there is nothing in the panel to press it with except the button that started it.
			const path = resolveSound(payload);

			// Through the same seam the timer's own alert uses. One place in this class reaches the
			// operating system, which is what lets a test watch the panel's audition being called off
			// as well as a timer's.
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
		// **A press silences the alert before it does anything else, always.** That alone is new
		// behaviour worth having: until now nothing at all could call off a sound that was already
		// playing, so an alert you had heard went on announcing itself while you pressed the control
		// to deal with it.
		const wasRinging = this.silence(instance);

		// **And on a ring, silencing it is the whole of what the press does.** This is the state the
		// ring mode exists to create: you set twenty plays precisely because you expect to be absorbed
		// in something else, and the press you make on hearing it is a press to stop the noise — not a
		// considered instruction to the clock. Letting it also toggle would mean reaching for quiet and
		// finding you had started the next run by reflex.
		//
		// The hold is the one exception, because it is the gesture that means *put this right*: it
		// clears the ringing and does its job, so one long press gets you back to a settled timer
		// rather than two presses where the first is spent.
		if (wasRinging && gesture !== "next") {
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

		// One alert at a time, and the newer one wins. A second stage running out used to start its
		// plays over the top of the first stage's, which nothing could then tell apart from the
		// overlap bug this release fixes.
		this.silence(instance);

		const path = resolveSound(settings);

		// **Only the end of the whole job rings, never the end of a stage.** It is forced by the rule
		// below it: a ring is called off the moment the clock is running again, and an intermediate
		// stage starts the next one immediately — so a ring begun here would be cancelled in the same
		// breath. A stage boundary gets the ordinary alert, which is what it is: a marker, not an alarm.
		const ringing = settings.keepRinging && countdown.finished;
		const playback = this.play(path, settings.volume, settings.soundRepeat, settings.fadeRepeats);

		if (playback !== null) {
			instance.alert = { playback, ringing };
			countdown.ringing = ringing;
		}

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
		if (wantsSound(path, settings.volume) && playback === null) {
			instance.action.showAlert().catch((err) => streamDeck.logger.error("Failed to show alert", err));
		}
	}

	/**
	 * Keeps the ringing state honest, once per frame.
	 *
	 * Two things end a ring that no press ended. It can simply run out of plays — nobody came, and
	 * sixty chimes is where it stops — after which the control is an ordinary finished timer again and
	 * the next press must do what it says rather than being swallowed by a state that is over.
	 *
	 * Or **the clock can stop being finished underneath it**, which is the case worth spelling out.
	 * A ring outlives the instant it announces: it is still going when the timer is started again,
	 * reset, handed an edited preset, or dialled somewhere new. Any of those means the finish has been
	 * dealt with, whoever dealt with it, so the alarm is announcing a moment that has passed. Checking
	 * the *state* rather than enumerating the gestures is the point — this cannot be got wrong by a
	 * path nobody thought of, which is how the last few bugs in this file got in.
	 *
	 * The press is still handled explicitly in {@link CountdownAction.perform}, because a quarter of a
	 * second of extra ringing is a long time when your finger is on the button. This is the net.
	 */
	#tendAlert(instance: I): void {
		const alert = instance.alert;
		if (alert === null) {
			return;
		}

		if (!alert.playback.active) {
			this.#forgetAlert(instance);
			return;
		}

		if (alert.ringing && !instance.countdown.finished) {
			this.silence(instance);
		}
	}

	/**
	 * Stops whatever is sounding for this control.
	 *
	 * @returns `true` if what it stopped was a *ring* — the state in which a press means "be quiet"
	 * and nothing else. A run that had already finished its plays answers `false`, so a press arriving
	 * in the quarter-second before {@link CountdownAction.#tendAlert} notices is not swallowed by a
	 * ring that is already over.
	 */
	protected silence(instance: I): boolean {
		const alert = instance.alert;
		if (alert === null) {
			return false;
		}

		const wasRinging = alert.ringing && alert.playback.active;
		alert.playback.stop();
		this.#forgetAlert(instance);
		return wasRinging;
	}

	#forgetAlert(instance: I): void {
		instance.alert = null;
		instance.countdown.ringing = false;
	}

	/**
	 * The operating system's player, behind a seam.
	 *
	 * Overridable for one reason: a test of the ringing state must be able to hear what was asked for
	 * without making a noise on the machine running it. It is not a pretend boundary — `playSound` is
	 * the only thing in this class that spawns a process, and on Linux, which is where this plugin is
	 * written, it answers `null` on every call.
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
	 * Settings may have been edited in the property inspector while the control was away, so a revived
	 * countdown is given them — through {@link Countdown.applySettings}, which reloads the clock only
	 * when the *selected duration* changed. That is the whole point of going through it: a timer
	 * running on a preset nobody touched keeps running, while one whose preset was rewritten while it
	 * was off screen comes back on the new length rather than silently counting the old one.
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

/**
 * What Stream Deck told this plugin about itself when it started, for the diagnostics report.
 *
 * Only the plugin ever sees this — it arrives in the registration handshake and appears nowhere a
 * user could look it up. It is also the pair of facts that the two most commonly reported causes of
 * an unresponsive Stream Deck turn on: an out-of-date application, and a device drawing more power
 * than the port it is plugged into will give it.
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
