/**
 * The visible acknowledgement of a gesture.
 *
 * There is no haptic feedback to be had: `@elgato/streamdeck` exposes no such command, and the
 * hardware has no motor to drive if it did. So a gesture is confirmed by sight instead, in two ways
 * that do different jobs. A word on the bottom line says exactly what happened — `+10s`, `pause`,
 * `next · 20m` — for anyone who looks. A brief pulse of the ring says only that *something*
 * happened, which is the part that registers without being read, and is what a dial being wound
 * needs: you cannot read a word per tick, but you can see the ring answer every one of them.
 */

import { formatPresetLabel } from "./timer";

/** How long the word stays on screen. Long enough to read, short enough not to hide the clock. */
export const TOAST_MS = 900;

/**
 * How long the ring pulses. Deliberately shorter than the 250 ms render interval, so a pulse is
 * cleared by the very next frame and rapid gestures read as separate flashes rather than one glow.
 */
export const FLASH_MS = 200;

/** Signed step, in the dial's own units: `+1s`, `-10s`, `+1m`, `+10m`. */
export function formatDelta(seconds: number): string {
	const sign = seconds < 0 ? "-" : "+";
	return `${sign}${formatPresetLabel(Math.abs(seconds) * 1000)}`;
}

/**
 * A word, and when it was said.
 *
 * Held as a timestamp rather than a countdown so it expires on its own: the render loop compares it
 * against the clock it already has, and nothing has to be ticked down or cleaned up.
 */
export type Acknowledgement = {
	text: string;
	at: number;
};

/** The word to show, or `""` once it has had its time. */
export function toastText(ack: Acknowledgement | null, nowMs: number): string {
	if (ack === null || nowMs - ack.at >= TOAST_MS) {
		return "";
	}
	return ack.text;
}

/** Whether the ring should be drawn pulsing. */
export function isFlashing(ack: Acknowledgement | null, nowMs: number): boolean {
	return ack !== null && nowMs - ack.at < FLASH_MS;
}
