/**
 * Settings, and the one place they are made safe.
 *
 * Stream Deck keeps an action's settings across an uninstall, so a build will be handed settings
 * written by an older one. Every read goes through {@link normaliseSettings}, which rebuilds a
 * known-good object from whatever arrived; anything unrecognised is discarded.
 */

/**
 * A preset is the list of stages it runs, in seconds — `[2400, 600, 600]` for forty minutes then
 * ten then ten. A plain countdown is a preset with one stage.
 */
export type Preset = number[];

export type DialCountdownSettings = {
	presets: Preset[];
	presetIndex: number;
	layout: "ring" | "bar";
	theme: string;
	/**
	 * A name for this timer, drawn on the label line — `Tea` rather than `20m`.
	 *
	 * The plugin's own field rather than Stream Deck's Title box, which stays off in the manifest:
	 * both controls draw their own text, so a native title had nowhere to land on a dial and could
	 * only land on top of the clock on a key. Empty means unnamed.
	 */
	title: string;
	showLogo: boolean;
	/**
	 * Whether the line under the clock is drawn at all — the title or stage length, and the tally.
	 * Stored as `showTitle` by builds before 3.6.0; {@link normaliseSettings} carries that across.
	 */
	showLabel: boolean;
	showFinishTime: boolean;
	warnEnabled: boolean;
	warnSeconds: number;
	/** Whether a timer that has finished for good puts itself back to the start after a while. */
	autoResetEnabled: boolean;
	/** How long a finished timer waits before it resets itself, in seconds. */
	autoResetSeconds: number;
	/**
	 * Which sound plays when the timer finishes, or {@link NO_SOUND} for none. There is no separate
	 * on/off switch: *No sound* in the picker is how it is turned off, so the two cannot disagree.
	 */
	soundId: string;
	customSoundPath: string;
	volume: number;
	/**
	 * How many times the alert sound plays at the end of a stage, one after the other.
	 *
	 * Set it high for the alert you must not miss; a press silences whatever is playing, so there is
	 * no separate "keep ringing" mode.
	 */
	soundRepeat: number;
	/** Whether the later plays drop to half volume. `FADE_AFTER_PLAYS` in `./sound` is the figure. */
	fadeRepeats: boolean;
};

/** Plays the bundled chime; resolved at playback time, since its path is only known at runtime. */
export const DEFAULT_SOUND = "default";
export const NO_SOUND = "none";
export const CUSTOM_SOUND = "custom";

export const DEFAULT_PRESETS: Preset[] = [[5 * 60], [20 * 60], [30 * 60], [40 * 60]];

const MIN_PRESET_SECONDS = 1;
export const MAX_PRESET_SECONDS = 24 * 60 * 60;

/** Most times one alert may play. Safe to be large because a press silences whatever is playing. */
export const MAX_SOUND_REPEAT = 60;

/**
 * Longest title kept, in characters. Not a display limit — both controls degrade a long title on
 * their own — but a limit on what is *stored*.
 */
export const MAX_TITLE_LENGTH = 32;

/** Most stages one preset may hold. Four rounds of `25m, 5m` is eight, so twenty is room enough. */
export const MAX_STAGES = 20;

export const DEFAULTS: DialCountdownSettings = {
	presets: DEFAULT_PRESETS,
	presetIndex: 0,
	layout: "ring",
	theme: "default",
	title: "",
	showLogo: true,
	showLabel: true,
	showFinishTime: false,
	warnEnabled: false,
	warnSeconds: 60,
	autoResetEnabled: false,
	autoResetSeconds: 60,
	soundId: DEFAULT_SOUND,
	customSoundPath: "",
	volume: 100,
	soundRepeat: 1,
	fadeRepeats: false
};

/** Rebuilds a complete, valid settings object from anything at all. Never throws. */
export function normaliseSettings(raw: unknown): DialCountdownSettings {
	const input = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

	const presets = normalisePresets(input.presets, repeatFactor(input));

	return {
		presets,
		presetIndex: clampIndex(input.presetIndex, presets.length),
		layout: input.layout === "bar" ? "bar" : "ring",
		theme: typeof input.theme === "string" && input.theme.length > 0 ? input.theme : DEFAULTS.theme,
		title: title(input.title),
		showLogo: bool(input.showLogo, DEFAULTS.showLogo),
		// The old name is honoured, since settings outlive the build that wrote them: an install that
		// had the label switched off must not come back with it switched on.
		showLabel: bool(input.showLabel, bool(input.showTitle, DEFAULTS.showLabel)),
		showFinishTime: bool(input.showFinishTime, DEFAULTS.showFinishTime),
		warnEnabled: bool(input.warnEnabled, DEFAULTS.warnEnabled),
		warnSeconds: int(input.warnSeconds, DEFAULTS.warnSeconds, 1, MAX_PRESET_SECONDS),
		autoResetEnabled: bool(input.autoResetEnabled, DEFAULTS.autoResetEnabled),
		autoResetSeconds: int(input.autoResetSeconds, DEFAULTS.autoResetSeconds, 1, MAX_PRESET_SECONDS),
		soundId: soundIdFrom(input),
		customSoundPath: typeof input.customSoundPath === "string" ? input.customSoundPath : "",
		volume: int(input.volume, DEFAULTS.volume, 0, 100),
		soundRepeat: int(input.soundRepeat, DEFAULTS.soundRepeat, 1, MAX_SOUND_REPEAT),
		fadeRepeats: bool(input.fadeRepeats, DEFAULTS.fadeRepeats)
	};
}

/**
 * Presets are lists of stage durations in seconds. Three shapes have been stored and all three are
 * read: a list of stages, a bare number, and `{ label, seconds }`.
 *
 * @param repeats How many times each preset used to run — see {@link repeatFactor}.
 */
export function normalisePresets(raw: unknown, repeats = 1): Preset[] {
	if (!Array.isArray(raw)) {
		return defaults();
	}

	// Annotated, because `Array.isArray` narrows an `unknown` to `any[]` rather than `unknown[]` — so
	// without this every element below is an `any` and the sanitising this whole file exists to do is
	// unchecked exactly where it matters most.
	const items: unknown[] = raw;

	const presets = items
		.map((preset) => normalisePreset(preset, repeats))
		.filter((preset): preset is Preset => preset !== null);

	return presets.length > 0 ? presets : defaults();
}

/** One preset's stages, or `null` when nothing usable survived. */
function normalisePreset(raw: unknown, repeats: number): Preset | null {
	const items: unknown[] = Array.isArray(raw) ? raw : [raw];

	const stages = items
		.map((stage) => (typeof stage === "object" && stage !== null ? (stage as { seconds?: unknown }).seconds : stage))
		.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)
		.map((value) => clamp(Math.round(value), MIN_PRESET_SECONDS, MAX_PRESET_SECONDS));

	if (stages.length === 0) {
		return null;
	}

	// Flattened rather than nested: a preset that ran three times *is* three stages, and expressing it
	// as one is what lets the tally, the stopping rule and the label all stay single-minded.
	const repeated = Array.from({ length: repeats }, () => stages).flat();
	return repeated.slice(0, MAX_STAGES);
}

/**
 * How many times each preset used to run, for settings written before stages existed.
 * `repeat: true, repeatCount: 3` on a 20 minute preset becomes three stages of twenty minutes.
 */
function repeatFactor(input: Record<string, unknown>): number {
	if (input.repeat !== true) {
		return 1;
	}
	if (typeof input.repeatCount !== "number" || !Number.isFinite(input.repeatCount)) {
		return 1;
	}
	return clamp(Math.round(input.repeatCount), 1, MAX_STAGES);
}

/** A fresh copy every time — the defaults are shared, and a preset list is edited in place. */
function defaults(): Preset[] {
	return DEFAULT_PRESETS.map((preset) => [...preset]);
}

/**
 * The chosen sound, honouring the `soundEnabled` flag that builds before 3.4.0 carried:
 * `soundEnabled: false` becomes `soundId: "none"`, so an install that wanted silence keeps it.
 */
function soundIdFrom(input: Record<string, unknown>): string {
	if (input.soundEnabled === false) {
		return NO_SOUND;
	}
	return typeof input.soundId === "string" && input.soundId.length > 0 ? input.soundId : DEFAULTS.soundId;
}

/** A title, trimmed and capped. Trimmed so a title of only spaces does not win the label line. */
function title(value: unknown): string {
	if (typeof value !== "string") {
		return DEFAULTS.title;
	}
	return value.trim().slice(0, MAX_TITLE_LENGTH);
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
