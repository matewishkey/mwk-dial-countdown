import streamDeck, {
	type FeedbackPayload,
	action,
	SingletonAction,
	type DialAction,
	type DialDownEvent,
	type DialRotateEvent,
	type DialUpEvent,
	type DidReceiveSettingsEvent,
	type PropertyInspectorDidAppearEvent,
	type TouchTapEvent,
	type WillAppearEvent,
	type WillDisappearEvent
} from "@elgato/streamdeck";

import { Accelerator } from "../acceleration";
import { asDataUri, renderRing, ringColour, themeFor } from "../render";
import { CUSTOM_SOUND, listSounds, NO_SOUND, playSound, soundExists } from "../sound";
import { DEFAULT_PRESETS, formatClockTime, formatDuration, formatPresetLabel, Timer, type Preset } from "../timer";

/** How long the dial must be held before it counts as a reset rather than a start/pause. */
const LONG_PRESS_MS = 600;

/**
 * Render cadence. Marketplace guidelines cap touchscreen updates at 10 per second; 4 is plenty to
 * keep the seconds flipping promptly, and unchanged frames are dropped before they reach the wire.
 */
const RENDER_INTERVAL_MS = 250;

/** Blink period while inside the warning window — two render frames on, two off. */
const BLINK_MS = 500;

/** Settings changes are batched, so spinning the dial does not write to disk on every tick. */
const SETTINGS_DEBOUNCE_MS = 400;

const DEFAULT_WARN_SECONDS = 300;

export type DialTimerSettings = {
	presets?: Preset[];
	presetIndex?: number;
	/** `"ring"` is the countdown ring; `"bar"` falls back to Stream Deck's built-in bar layout. */
	layout?: "ring" | "bar";
	warnEnabled?: boolean;
	warnSeconds?: number;
	warnColor?: string;
	theme?: string;
	soundEnabled?: boolean;
	soundId?: string;
	/** Path to a user-supplied sound, used when `soundId` is {@link CUSTOM_SOUND}. */
	customSoundPath?: string;
	volume?: number;
	/** Restart automatically when the timer finishes. */
	repeat?: boolean;
	/** Show the wall-clock time the timer will finish at. */
	showFinishTime?: boolean;
	/** Draw the Mate Wish Key mark inside the ring. */
	showLogo?: boolean;
};

/** Everything that lives only for as long as the action is on screen. */
type Instance = {
	action: DialAction<DialTimerSettings>;
	timer: Timer;
	accelerator: Accelerator;
	presets: Preset[];
	presetIndex: number;
	settings: DialTimerSettings;
	renderHandle: NodeJS.Timeout | null;
	longPressHandle: NodeJS.Timeout | null;
	saveHandle: NodeJS.Timeout | null;
	longPressFired: boolean;
	/** Guards against re-playing the alert on every frame once the timer has elapsed. */
	alerted: boolean;
	/** How many times an auto-repeating timer has come round. */
	cycles: number;
	lastFeedback: string;
	lastLayout: string | null;
};

@action({ UUID: "com.mergodon.dial-timer.timer" })
export class DialTimer extends SingletonAction<DialTimerSettings> {
	/**
	 * One entry per visible dial, keyed by action id. A Stream Deck + has four dials and each can hold
	 * its own independent timer, so none of this state can live on the action class itself.
	 */
	readonly #instances = new Map<string, Instance>();

	override onWillAppear(ev: WillAppearEvent<DialTimerSettings>): void {
		if (!ev.action.isDial()) {
			return;
		}

		const settings = ev.payload.settings ?? {};
		const presets = normalisePresets(settings.presets);
		const presetIndex = clampIndex(settings.presetIndex, presets.length);

		const instance: Instance = {
			action: ev.action,
			timer: new Timer(presets[presetIndex] * 1000),
			accelerator: new Accelerator(),
			presets,
			presetIndex,
			settings,
			renderHandle: null,
			longPressHandle: null,
			saveHandle: null,
			longPressFired: false,
			alerted: false,
			cycles: 0,
			lastFeedback: "",
			lastLayout: null
		};

		this.#instances.set(ev.action.id, instance);
		instance.renderHandle = setInterval(() => this.#render(instance), RENDER_INTERVAL_MS);
		this.#applyLayout(instance);
		this.#render(instance, true);
	}

	/**
	 * Fires when the user flips to another page or profile. The render loop is torn down, but the
	 * timer itself is deliberately dropped with it: a countdown the user cannot see, on a dial that no
	 * longer exists, has nothing to count for. Persisted presets survive; the running clock does not.
	 */
	override onWillDisappear(ev: WillDisappearEvent<DialTimerSettings>): void {
		const instance = this.#instances.get(ev.action.id);
		if (instance === undefined) {
			return;
		}

		clearTimers(instance);
		this.#instances.delete(ev.action.id);
	}

	/** Picks up preset and appearance edits made in the property inspector. */
	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<DialTimerSettings>): void {
		const instance = this.#instances.get(ev.action.id);
		if (instance === undefined) {
			return;
		}

		const settings = ev.payload.settings ?? {};
		const presets = normalisePresets(settings.presets);
		const presetIndex = clampIndex(settings.presetIndex, presets.length);

		// Only reload the clock when the selected duration actually changed — otherwise adjusting the
		// volume slider would reset a running timer.
		const durationChanged = presets[presetIndex] * 1000 !== instance.timer.durationMs;

		instance.settings = settings;
		instance.presets = presets;
		instance.presetIndex = presetIndex;
		if (durationChanged) {
			instance.timer.setDuration(presets[presetIndex] * 1000);
			instance.alerted = false;
		}

		this.#applyLayout(instance);
		this.#render(instance, true);
	}

	/** The property inspector cannot read the filesystem, so the plugin hands it the sound list. */
	override onPropertyInspectorDidAppear(ev: PropertyInspectorDidAppearEvent<DialTimerSettings>): void {
		void ev;
		streamDeck.ui
			.sendToPropertyInspector({ event: "sounds", sounds: listSounds() })
			.catch((err) => streamDeck.logger.error("Failed to send sound list", err));
	}

	/** Auditions a sound, and answers whether a chosen file actually resolves. */
	override onSendToPlugin(ev: { payload: unknown }): void {
		const payload = ev.payload as
			| { event?: string; soundId?: string; customSoundPath?: string; volume?: number }
			| undefined;

		if (payload?.event === "preview") {
			const path = resolveSound(payload);
			const played = playSound(path, payload.volume ?? 100);
			void this.#reportSound(path, played);
			return;
		}

		if (payload?.event === "checkSound") {
			void this.#reportSound(resolveSound(payload), null);
		}
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

	/**
	 * Turning adjusts time. The step accelerates the longer the dial is spun — ten seconds for a
	 * nudge, a minute once it is being wound, five once it is being wound hard — so setting an
	 * hour-long timer does not mean six turns of the wrist.
	 */
	override onDialRotate(ev: DialRotateEvent<DialTimerSettings>): void {
		const instance = this.#instances.get(ev.action.id);
		if (instance === undefined) {
			return;
		}

		// A rotation is an adjustment, not a reset — cancel the pending long press so a
		// press-and-turn does not wipe the value the user is in the middle of setting.
		this.#cancelLongPress(instance);

		const deltaSeconds = instance.accelerator.rotate(ev.payload.ticks, Date.now(), ev.payload.pressed);
		instance.timer.adjust(deltaSeconds * 1000);
		instance.alerted = false;

		// Only an idle timer writes back: while running the dial nudges the clock, not the preset.
		if (instance.timer.status !== "running") {
			instance.presets[instance.presetIndex] = Math.round(instance.timer.durationMs / 1000);
			this.#scheduleSave(instance);
		}

		this.#render(instance, true);
	}

	/**
	 * Starts the clock that decides whether this press is a short one or a long one.
	 *
	 * The dial press cycles presets rather than starting the timer: pressing a dial in is a fiddly,
	 * two-handed movement compared with tapping the screen above it, so the screen owns the gesture
	 * that gets used constantly and the dial owns the one that does not.
	 */
	override onDialDown(ev: DialDownEvent<DialTimerSettings>): void {
		const instance = this.#instances.get(ev.action.id);
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
	override onDialUp(ev: DialUpEvent<DialTimerSettings>): void {
		const instance = this.#instances.get(ev.action.id);
		if (instance === undefined) {
			return;
		}

		const wasLongPress = instance.longPressFired;
		this.#cancelLongPress(instance);

		if (wasLongPress) {
			return;
		}

		this.#cyclePreset(instance, 1);
	}

	/** Tapping the touchscreen starts or pauses; holding the tap resets. */
	override onTouchTap(ev: TouchTapEvent<DialTimerSettings>): void {
		const instance = this.#instances.get(ev.action.id);
		if (instance === undefined) {
			return;
		}

		if (ev.payload.hold) {
			instance.timer.reset();
			instance.cycles = 0;
			instance.accelerator.reset();
		} else {
			instance.timer.toggle();
		}

		instance.alerted = false;
		this.#render(instance, true);
	}

	/** Moves to another preset and loads its duration. */
	#cyclePreset(instance: Instance, step: number): void {
		const count = instance.presets.length;
		instance.presetIndex = (instance.presetIndex + step + count) % count;
		instance.timer.setDuration(instance.presets[instance.presetIndex] * 1000);
		instance.alerted = false;
		instance.cycles = 0;
		instance.accelerator.reset();

		this.#scheduleSave(instance);
		this.#render(instance, true);
	}

	/** Switches the touchscreen between the ring layout and the built-in bar, when the choice changes. */
	#applyLayout(instance: Instance): void {
		const layout = instance.settings.layout === "bar" ? "$B1" : "layouts/ring.json";
		if (layout === instance.lastLayout) {
			return;
		}

		instance.lastLayout = layout;
		instance.lastFeedback = "";
		instance.action.setFeedbackLayout(layout).catch((err) => streamDeck.logger.error("Failed to set layout", err));
	}

	/**
	 * Pushes the current state to the touchscreen. Identical frames are dropped so an idle timer
	 * costs nothing, which is what keeps the 4 Hz render loop comfortably inside Elgato's limit.
	 */
	#render(instance: Instance, force = false): void {
		const { timer, settings } = instance;
		let status = timer.status;
		let remainingMs = timer.remainingMs;

		if (status === "elapsed" && !instance.alerted) {
			instance.alerted = true;
			if (settings.soundEnabled !== false) {
				playSound(resolveSound(settings), settings.volume ?? 100);
			}

			// Auto-repeat restarts immediately rather than after a pause: the alert has already fired,
			// and a gap between cycles is exactly what an interval timer must not have.
			if (settings.repeat === true) {
				instance.cycles += 1;
				instance.alerted = false;
				timer.reset();
				timer.start();
				status = timer.status;
				remainingMs = timer.remainingMs;
			}
		}

		// The label shows the preset's own length — where this timer started — and so stays put while
		// a running timer is nudged. Adjusting a stopped timer edits the preset, and the label follows.
		const presetSeconds = instance.presets[instance.presetIndex];
		const label = formatPresetLabel(presetSeconds * 1000);
		const value = formatDuration(remainingMs);
		const warning = this.#isWarning(instance, remainingMs, status);
		const finish = this.#finishText(instance, remainingMs, status);

		const signature = `${instance.lastLayout}|${label}|${value}|${status}|${warning}|${finish}|${instance.cycles}|${settings.showLogo}|${settings.theme}`;
		if (!force && signature === instance.lastFeedback) {
			return;
		}
		instance.lastFeedback = signature;

		const theme = themeFor(settings.theme);
		const palette = { ...theme, warn: settings.warnColor || theme.warn };
		const remainingFraction = remainingMs / Math.max(1, timer.durationMs);
		const colour = ringColour({ remainingFraction, status, warning, palette });

		// A repeating timer counts its laps; a finished one says so.
		const suffix = instance.cycles > 0 ? ` · ×${instance.cycles}` : status === "elapsed" ? " · done" : "";

		const feedback: FeedbackPayload =
			instance.lastLayout === "$B1"
				? {
						title: `${label}${suffix}`,
						value,
						indicator: {
							value: Math.round((1 - remainingFraction) * 100),
							bar_fill_c: colour,
							bar_bg_c: palette.track
						}
					}
				: {
						ring: asDataUri(renderRing({ remainingFraction, status, warning, palette, logo: settings.showLogo === true })),
						value,
						label: `${label}${suffix}`,
						finish
					};

		instance.action.setFeedback(feedback).catch((err) => streamDeck.logger.error("Failed to set feedback", err));
	}

	/**
	 * The wall-clock time this timer will finish at. Only shown while running — on a stopped timer it
	 * would be a prediction that quietly goes stale, which is worse than showing nothing.
	 */
	#finishText(instance: Instance, remainingMs: number, status: string): string {
		if (instance.settings.showFinishTime !== true || status !== "running") {
			return "";
		}
		return `ends ${formatClockTime(Date.now() + remainingMs)}`;
	}

	/**
	 * True while the timer is inside its warning window *and* the blink is in its visible half. The
	 * phase comes from the wall clock rather than a counter, so it stays even when frames are dropped.
	 */
	#isWarning(instance: Instance, remainingMs: number, status: string): boolean {
		if (instance.settings.warnEnabled !== true || status !== "running") {
			return false;
		}

		const windowMs = (instance.settings.warnSeconds ?? DEFAULT_WARN_SECONDS) * 1000;
		if (remainingMs > windowMs) {
			return false;
		}

		return Math.floor(Date.now() / BLINK_MS) % 2 === 0;
	}

	#cancelLongPress(instance: Instance): void {
		if (instance.longPressHandle !== null) {
			clearTimeout(instance.longPressHandle);
			instance.longPressHandle = null;
		}
	}

	#scheduleSave(instance: Instance): void {
		if (instance.saveHandle !== null) {
			clearTimeout(instance.saveHandle);
		}
		instance.saveHandle = setTimeout(() => {
			instance.saveHandle = null;
			instance.action
				.setSettings({ ...instance.settings, presets: instance.presets, presetIndex: instance.presetIndex })
				.catch((err) => streamDeck.logger.error("Failed to save settings", err));
		}, SETTINGS_DEBOUNCE_MS);
	}
}

function clearTimers(instance: Instance): void {
	if (instance.renderHandle !== null) {
		clearInterval(instance.renderHandle);
		instance.renderHandle = null;
	}
	for (const handle of [instance.longPressHandle, instance.saveHandle]) {
		if (handle !== null) {
			clearTimeout(handle);
		}
	}
	instance.longPressHandle = null;
	instance.saveHandle = null;
}

/**
 * Guards against a hand-edited or empty preset list arriving from settings. Also tolerates the
 * `{ label, seconds }` shape presets used to have, so an existing dial keeps its durations.
 */
function normalisePresets(presets: unknown): Preset[] {
	if (!Array.isArray(presets) || presets.length === 0) {
		return [...DEFAULT_PRESETS];
	}

	const valid = presets
		.map((preset) => (typeof preset === "object" && preset !== null ? (preset as { seconds?: unknown }).seconds : preset))
		.filter((seconds): seconds is number => typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0)
		.map((seconds) => Math.round(seconds));

	return valid.length > 0 ? valid : [...DEFAULT_PRESETS];
}

/** Turns the sound settings into the single path that will actually be played. */
function resolveSound(settings: { soundId?: string; customSoundPath?: string }): string {
	if (settings.soundId === CUSTOM_SOUND) {
		return settings.customSoundPath ?? NO_SOUND;
	}
	return settings.soundId ?? NO_SOUND;
}

function clampIndex(index: number | undefined, length: number): number {
	if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= length) {
		return 0;
	}
	return index;
}
