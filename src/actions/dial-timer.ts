import streamDeck, {
	action,
	SingletonAction,
	type DialAction,
	type DialDownEvent,
	type DialRotateEvent,
	type DialUpEvent,
	type DidReceiveSettingsEvent,
	type TouchTapEvent,
	type WillAppearEvent,
	type WillDisappearEvent
} from "@elgato/streamdeck";

import { DEFAULT_PRESETS, formatDuration, Timer, type Preset } from "../timer";

/** How long the dial must be held before it counts as a reset rather than a start/pause. */
const LONG_PRESS_MS = 600;

/** Seconds added per rotation tick, plain and with the dial held down. */
const FINE_STEP_SECONDS = 10;
const COARSE_STEP_SECONDS = 60;

/**
 * Render cadence. Marketplace guidelines cap touchscreen updates at 10 per second; 4 is plenty to
 * keep the seconds flipping promptly, and unchanged frames are dropped before they reach the wire.
 */
const RENDER_INTERVAL_MS = 250;

/** Settings changes are batched, so spinning the dial does not write to disk on every tick. */
const SETTINGS_DEBOUNCE_MS = 400;

export type DialTimerSettings = {
	presets?: Preset[];
	presetIndex?: number;
};

/** Everything that lives only for as long as the action is on screen. */
type Instance = {
	action: DialAction<DialTimerSettings>;
	timer: Timer;
	presets: Preset[];
	presetIndex: number;
	renderHandle: NodeJS.Timeout | null;
	longPressHandle: NodeJS.Timeout | null;
	saveHandle: NodeJS.Timeout | null;
	longPressFired: boolean;
	lastFeedback: string;
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

		const presets = normalisePresets(ev.payload.settings.presets);
		const presetIndex = clampIndex(ev.payload.settings.presetIndex, presets.length);

		const instance: Instance = {
			action: ev.action,
			timer: new Timer(presets[presetIndex].seconds * 1000),
			presets,
			presetIndex,
			renderHandle: null,
			longPressHandle: null,
			saveHandle: null,
			longPressFired: false,
			lastFeedback: ""
		};

		this.#instances.set(ev.action.id, instance);
		instance.renderHandle = setInterval(() => this.#render(instance), RENDER_INTERVAL_MS);
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

	/** Picks up preset edits made in the property inspector. */
	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<DialTimerSettings>): void {
		const instance = this.#instances.get(ev.action.id);
		if (instance === undefined) {
			return;
		}

		instance.presets = normalisePresets(ev.payload.settings.presets);
		instance.presetIndex = clampIndex(ev.payload.settings.presetIndex, instance.presets.length);
		instance.timer.setDuration(instance.presets[instance.presetIndex].seconds * 1000);
		this.#render(instance, true);
	}

	/** Turning adjusts time; holding the dial while turning switches to coarse, whole-minute steps. */
	override onDialRotate(ev: DialRotateEvent<DialTimerSettings>): void {
		const instance = this.#instances.get(ev.action.id);
		if (instance === undefined) {
			return;
		}

		// A rotation is an adjustment, not a reset — cancel the pending long press so a
		// press-and-turn does not wipe the value the user is in the middle of setting.
		this.#cancelLongPress(instance);

		const step = ev.payload.pressed ? COARSE_STEP_SECONDS : FINE_STEP_SECONDS;
		instance.timer.adjust(ev.payload.ticks * step * 1000);

		// Only an idle timer writes back: while running the dial nudges the clock, not the preset.
		if (instance.timer.status !== "running") {
			instance.presets[instance.presetIndex] = {
				...instance.presets[instance.presetIndex],
				seconds: Math.round(instance.timer.durationMs / 1000)
			};
			this.#scheduleSave(instance);
		}

		this.#render(instance, true);
	}

	/** Starts the clock that decides whether this press is a start/pause or a reset. */
	override onDialDown(ev: DialDownEvent<DialTimerSettings>): void {
		const instance = this.#instances.get(ev.action.id);
		if (instance === undefined) {
			return;
		}

		instance.longPressFired = false;
		instance.longPressHandle = setTimeout(() => {
			instance.longPressFired = true;
			instance.longPressHandle = null;
			instance.timer.reset();
			this.#render(instance, true);
		}, LONG_PRESS_MS);
	}

	/** A release that beat the long-press threshold is a short press: start or pause. */
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

		instance.timer.toggle();
		this.#render(instance, true);
	}

	/** Tapping the touchscreen cycles to the next preset; holding the tap cycles backwards. */
	override onTouchTap(ev: TouchTapEvent<DialTimerSettings>): void {
		const instance = this.#instances.get(ev.action.id);
		if (instance === undefined) {
			return;
		}

		const step = ev.payload.hold ? -1 : 1;
		const count = instance.presets.length;
		instance.presetIndex = (instance.presetIndex + step + count) % count;
		instance.timer.setDuration(instance.presets[instance.presetIndex].seconds * 1000);

		this.#scheduleSave(instance);
		this.#render(instance, true);
	}

	/**
	 * Pushes the current state to the touchscreen. Identical frames are dropped so an idle timer
	 * costs nothing, which is what keeps the 4 Hz render loop comfortably inside Elgato's limit.
	 */
	#render(instance: Instance, force = false): void {
		const { timer } = instance;
		const preset = instance.presets[instance.presetIndex];
		const status = timer.status;

		const title = status === "elapsed" ? `${preset.label} · done` : preset.label;
		const value = formatDuration(timer.remainingMs);
		const indicator = Math.round(timer.progress * 100);

		const signature = `${title}|${value}|${indicator}|${status}`;
		if (!force && signature === instance.lastFeedback) {
			return;
		}
		instance.lastFeedback = signature;

		instance.action
			.setFeedback({
				title,
				value,
				indicator: {
					value: indicator,
					// Amber while paused, red once elapsed — status readable without reading the words.
					bar_fill_c: status === "elapsed" ? "#EB5757" : status === "paused" ? "#F2C94C" : "#2D9CDB"
				}
			})
			.catch((err) => streamDeck.logger.error("Failed to set feedback", err));
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
				.setSettings({ presets: instance.presets, presetIndex: instance.presetIndex })
				.catch((err) => streamDeck.logger.error("Failed to save settings", err));
		}, SETTINGS_DEBOUNCE_MS);
	}
}

function clearTimers(instance: Instance): void {
	for (const handle of [instance.renderHandle, instance.longPressHandle, instance.saveHandle]) {
		if (handle !== null) {
			clearTimeout(handle as NodeJS.Timeout);
		}
	}
	if (instance.renderHandle !== null) {
		clearInterval(instance.renderHandle);
	}
	instance.renderHandle = null;
	instance.longPressHandle = null;
	instance.saveHandle = null;
}

/** Guards against a hand-edited or empty preset list arriving from settings. */
function normalisePresets(presets: Preset[] | undefined): Preset[] {
	if (!Array.isArray(presets) || presets.length === 0) {
		return DEFAULT_PRESETS.map((preset) => ({ ...preset }));
	}

	const valid = presets
		.filter((preset): preset is Preset => typeof preset?.seconds === "number" && preset.seconds > 0)
		.map((preset) => ({ label: String(preset.label ?? "Timer"), seconds: Math.round(preset.seconds) }));

	return valid.length > 0 ? valid : DEFAULT_PRESETS.map((preset) => ({ ...preset }));
}

function clampIndex(index: number | undefined, length: number): number {
	if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= length) {
		return 0;
	}
	return index;
}
