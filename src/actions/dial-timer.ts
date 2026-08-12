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
import { listSounds, playSound, resolveSound, soundExists } from "../sound";
import { normaliseSettings, NO_SOUND, type DialTimerSettings, type Preset } from "../settings";
import { formatClockTime, formatDuration, formatPresetLabel, Timer } from "../timer";

export type { DialTimerSettings };

/** How long the dial must be held before it counts as a reset rather than a start/pause. */
const LONG_PRESS_MS = 600;

/**
 * Render cadence. Marketplace guidelines cap touchscreen updates at 10 per second; 4 is plenty to
 * keep the seconds flipping promptly, and unchanged frames are dropped before they reach the wire.
 */
const RENDER_INTERVAL_MS = 250;

/** Blink period while inside the warning window — two render frames on, two off. */
const BLINK_MS = 500;

/**
 * Font sizes for the big clock. `1:10:10` at the layout's default 30px overruns its 96px box, so the
 * size steps down with the length of the string rather than being fixed.
 */
const VALUE_FONT_SIZES: Record<number, number> = { 4: 32, 5: 30, 6: 25, 7: 22, 8: 20 };
const VALUE_FONT_MIN = 18;

/** Settings changes are batched, so spinning the dial does not write to disk on every tick. */
const SETTINGS_DEBOUNCE_MS = 400;

const DEFAULT_WARN_SECONDS = 300;

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

		// Settings arriving from an older build are rebuilt rather than trusted, then written straight
		// back, so a fresh install ends up with a complete, valid set on disk instead of nothing.
		const settings = normaliseSettings(ev.payload.settings);
		const presets = settings.presets;
		const presetIndex = settings.presetIndex;

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

		if (!deepEqual(ev.payload.settings, settings)) {
			instance.action
				.setSettings(settings)
				.catch((err) => streamDeck.logger.error("Failed to persist normalised settings", err));
		}
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

		const settings = normaliseSettings(ev.payload.settings);
		const presets = settings.presets;
		const presetIndex = settings.presetIndex;

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
			if (settings.soundEnabled) {
				playSound(resolveSound(settings), settings.volume, settings.soundRepeat);
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
		const dimmed = this.#isBlinkDim(instance, remainingMs, status);
		const finish = this.#finishText(instance, remainingMs, status);
		const title = settings.showTitle ? `${label}${suffixFor(instance, status)}` : "";

		const signature = `${instance.lastLayout}|${title}|${value}|${status}|${dimmed}|${finish}|${settings.showLogo}|${settings.theme}`;
		if (!force && signature === instance.lastFeedback) {
			return;
		}
		instance.lastFeedback = signature;

		const palette = themeFor(settings.theme);
		const remainingFraction = remainingMs / Math.max(1, timer.durationMs);
		const colour = ringColour({ remainingFraction, status, dimmed, palette });

		const feedback: FeedbackPayload =
			instance.lastLayout === "$B1"
				? {
						title,
						value,
						indicator: {
							value: Math.round((1 - remainingFraction) * 100),
							bar_fill_c: colour,
							bar_bg_c: palette.track
						}
					}
				: {
						ring: asDataUri(renderRing({ remainingFraction, status, dimmed, palette, logo: settings.showLogo })),
						// The clock is sent as a full item definition so its size can shrink for `1:10:10`.
						value: { value, font: { size: valueFontSize(value) } },
						label: title,
						finish
					};

		instance.action.setFeedback(feedback).catch((err) => streamDeck.logger.error("Failed to set feedback", err));
	}

	/**
	 * The wall-clock time this timer will finish at. Only shown while running — on a stopped timer it
	 * would be a prediction that quietly goes stale, which is worse than showing nothing.
	 */
	#finishText(instance: Instance, remainingMs: number, status: string): string {
		if (!instance.settings.showFinishTime || status !== "running") {
			return "";
		}
		return `ends ${formatClockTime(Date.now() + remainingMs)}`;
	}

	/**
	 * True on the dim half of the warning blink.
	 *
	 * The window is capped at half the preset's own length: a five minute warning on a five minute
	 * timer would blink from the moment it started, which is what made adjusting the clock look like
	 * it had triggered the warning.
	 */
	#isBlinkDim(instance: Instance, remainingMs: number, status: string): boolean {
		if (!instance.settings.warnEnabled || status !== "running") {
			return false;
		}

		const windowMs = Math.min(instance.settings.warnSeconds * 1000, instance.timer.durationMs / 2);
		if (remainingMs > windowMs) {
			return false;
		}

		return Math.floor(Date.now() / BLINK_MS) % 2 === 1;
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

/** A repeating timer counts its laps; a finished one says so. */
function suffixFor(instance: Instance, status: string): string {
	if (instance.cycles > 0) {
		return ` · ×${instance.cycles}`;
	}
	return status === "elapsed" ? " · done" : "";
}

/** Shrinks the clock as it gets longer, so `1:10:10` fits the same box as `5:00`. */
function valueFontSize(value: string): number {
	return VALUE_FONT_SIZES[value.length] ?? VALUE_FONT_MIN;
}

/** Structural comparison, used only to avoid a pointless settings write on every appearance. */
function deepEqual(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
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

