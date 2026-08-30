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
	/**
	 * Which sound plays when the timer finishes, or {@link NO_SOUND} for none.
	 *
	 * There is no separate on/off switch. There was, and it was one switch too many: *Play a sound
	 * when done* and a *No sound* entry in the picker are two ways to say the same thing, and the
	 * combination they disagreed about — enabled, but set to no sound — is what raised Stream Deck's
	 * error triangle on every finish of a timer that was doing exactly as it was told. One control,
	 * one answer. See {@link normaliseSettings} for what becomes of the old flag.
	 */
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
		soundId: soundIdFrom(input),
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

	// Annotated, because `Array.isArray` narrows an `unknown` to `any[]` rather than `unknown[]` — so
	// without this every element below is an `any` and the sanitising this whole file exists to do is
	// unchecked exactly where it matters most.
	const items: unknown[] = raw;

	const seconds = items
		.map((preset) =>
			typeof preset === "object" && preset !== null ? (preset as { seconds?: unknown }).seconds : preset
		)
		.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)
		.map((value) => clamp(Math.round(value), MIN_PRESET_SECONDS, MAX_PRESET_SECONDS));

	return seconds.length > 0 ? seconds : [...DEFAULT_PRESETS];
}

/**
 * The chosen sound, honouring a switch that no longer exists.
 *
 * Builds before this one carried a separate `soundEnabled` flag. Settings outlive the build that
 * wrote them, so an install upgrading with the sound switched off would otherwise come back with it
 * switched on — the flag is gone, and nothing else in the stored settings says the user wanted
 * silence. `soundEnabled: false` therefore becomes `soundId: "none"`, which is the same instruction
 * in the vocabulary that survives.
 */
function soundIdFrom(input: Record<string, unknown>): string {
	if (input.soundEnabled === false) {
		return NO_SOUND;
	}
	return typeof input.soundId === "string" && input.soundId.length > 0 ? input.soundId : DEFAULTS.soundId;
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
