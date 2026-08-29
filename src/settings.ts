/**
 * Settings, and the one place they are made safe.
 *
 * Stream Deck keeps an action's settings across an uninstall and reinstall, so a build will be
 * handed settings written by an older build — with fields that have since changed shape, been
 * renamed, or been dropped. Every read therefore goes through {@link normaliseSettings}, which
 * rebuilds a known-good object from whatever arrived rather than trusting it. Anything unrecognised
 * is discarded, so a stale key cannot survive to be shown back to the user as nonsense.
 */

export type Preset = number;

export type DialCountdownSettings = {
	presets: Preset[];
	presetIndex: number;
	layout: "ring" | "bar";
	theme: string;
	showLogo: boolean;
	showTitle: boolean;
	showFinishTime: boolean;
	warnEnabled: boolean;
	warnSeconds: number;
	repeat: boolean;
	/**
	 * How many times an auto-repeating timer runs **in total** before it stops for good.
	 *
	 * A total, not a number of repeats. Reading it as repeats is what made a setting of 3 run four
	 * times: the third repeat was still under the limit.
	 */
	repeatCount: number;
	soundEnabled: boolean;
	soundId: string;
	customSoundPath: string;
	volume: number;
	/** How many times the alert sound plays when the timer finishes. */
	soundRepeat: number;
};

/** Plays the bundled chime; resolved at playback time, since its path is only known at runtime. */
export const DEFAULT_SOUND = "default";
export const NO_SOUND = "none";
export const CUSTOM_SOUND = "custom";

export const DEFAULT_PRESETS: Preset[] = [5 * 60, 20 * 60, 30 * 60, 40 * 60];

const MIN_PRESET_SECONDS = 1;
export const MAX_PRESET_SECONDS = 24 * 60 * 60;

export const MAX_SOUND_REPEAT = 10;

/** A repeating timer is deliberately bounded: nothing here should still be going tomorrow. */
export const MAX_REPEAT_COUNT = 10;

export const DEFAULTS: DialCountdownSettings = {
	presets: DEFAULT_PRESETS,
	presetIndex: 0,
	layout: "ring",
	theme: "default",
	showLogo: true,
	showTitle: true,
	showFinishTime: false,
	warnEnabled: false,
	warnSeconds: 60,
	repeat: false,
	repeatCount: 3,
	soundEnabled: true,
	soundId: DEFAULT_SOUND,
	customSoundPath: "",
	volume: 100,
	soundRepeat: 1
};

/** Rebuilds a complete, valid settings object from anything at all. Never throws. */
export function normaliseSettings(raw: unknown): DialCountdownSettings {
	const input = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

	const presets = normalisePresets(input.presets);

	return {
		presets,
		presetIndex: clampIndex(input.presetIndex, presets.length),
		layout: input.layout === "bar" ? "bar" : "ring",
		theme: typeof input.theme === "string" && input.theme.length > 0 ? input.theme : DEFAULTS.theme,
		showLogo: bool(input.showLogo, DEFAULTS.showLogo),
		showTitle: bool(input.showTitle, DEFAULTS.showTitle),
		showFinishTime: bool(input.showFinishTime, DEFAULTS.showFinishTime),
		warnEnabled: bool(input.warnEnabled, DEFAULTS.warnEnabled),
		warnSeconds: int(input.warnSeconds, DEFAULTS.warnSeconds, 1, MAX_PRESET_SECONDS),
		repeat: bool(input.repeat, DEFAULTS.repeat),
		repeatCount: int(input.repeatCount, DEFAULTS.repeatCount, 1, MAX_REPEAT_COUNT),
		soundEnabled: bool(input.soundEnabled, DEFAULTS.soundEnabled),
		soundId: typeof input.soundId === "string" && input.soundId.length > 0 ? input.soundId : DEFAULTS.soundId,
		customSoundPath: typeof input.customSoundPath === "string" ? input.customSoundPath : "",
		volume: int(input.volume, DEFAULTS.volume, 0, 100),
		soundRepeat: int(input.soundRepeat, DEFAULTS.soundRepeat, 1, MAX_SOUND_REPEAT)
	};
}

/**
 * Presets are plain durations in seconds. Older builds stored `{ label, seconds }` objects, so those
 * are unwrapped rather than discarded — the durations are the part worth keeping.
 */
export function normalisePresets(raw: unknown): Preset[] {
	if (!Array.isArray(raw)) {
		return [...DEFAULT_PRESETS];
	}

	const seconds = raw
		.map((preset) => (typeof preset === "object" && preset !== null ? (preset as { seconds?: unknown }).seconds : preset))
		.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)
		.map((value) => clamp(Math.round(value), MIN_PRESET_SECONDS, MAX_PRESET_SECONDS));

	return seconds.length > 0 ? seconds : [...DEFAULT_PRESETS];
}

function bool(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function int(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	return clamp(Math.round(value), min, max);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function clampIndex(value: unknown, length: number): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= length) {
		return 0;
	}
	return value;
}
