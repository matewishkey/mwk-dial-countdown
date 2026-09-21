/**
 * The two action subclasses themselves, driven through their own event handlers.
 *
 * **This file could not exist until today, and that gap cost a release.** Both classes carry an
 * `@action` decorator, and Node's type stripping erases types while leaving decorators standing —
 * so importing either one was a `SyntaxError`, and `onDialRotate`, `onDialUp`, `onTouchTap`,
 * `onKeyUp` and both `draw` methods were reachable by nothing but the scripted demo. That is how
 * 4.1.0 shipped with a ringing state the screen never showed.
 *
 * It was never a limit of the Stream Deck SDK: it imports in under a tenth of a second and needs
 * no connection. It was the transform. `test/ts-resolve.mjs` now compiles with TypeScript's own
 * compiler — the one rollup already uses — and the classes load like anything else.
 *
 * What is still out of reach is a *real* noise: this box has no audio player at all, so
 * `playSound` answers `null` and nothing downstream of a sounding alert would ever run. The
 * player is faked here, at the same `play()` seam `test/actions.test.ts` uses, which is what lets
 * the alert path be driven end to end without one.
 */

import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";

import { DialCountdown } from "../src/actions/dial-countdown.ts";
import { KeyCountdown } from "../src/actions/key-countdown.ts";
import { TOAST_MS } from "../src/feedback.ts";
import { DOUBLE_PRESS_MS, DOUBLE_TAP_MS, LONG_PRESS_MS } from "../src/gestures.ts";
import type { Playback } from "../src/sound.ts";

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/**
 * Past the toast, so the footer is reporting the clock rather than the gesture.
 *
 * The bottom line has two claimants and the gesture wins for 900 ms, which is the point of it —
 * so a test reading that line has to say which of the two it means.
 */
const settle = (): Promise<void> => wait(TOAST_MS + 200);

/** A control that records instead of drawing. Every call resolves — the code under test `.catch`es. */
function control(isDial: boolean): {
	action: Record<string, unknown>;
	frames: Record<string, unknown>[];
	images: string[];
	layouts: string[];
} {
	const frames: Record<string, unknown>[] = [];
	const images: string[] = [];
	const layouts: string[] = [];

	return {
		frames,
		images,
		layouts,
		action: {
			id: `live-${isDial ? "dial" : "key"}-${Math.random().toString(36).slice(2)}`,
			isDial: () => isDial,
			isKey: () => !isDial,
			setSettings: () => Promise.resolve(),
			setFeedback: (payload: Record<string, unknown>) => {
				frames.push(payload);
				return Promise.resolve();
			},
			setFeedbackLayout: (layout: string) => {
				layouts.push(layout);
				return Promise.resolve();
			},
			setImage: (image: string) => {
				images.push(image);
				return Promise.resolve();
			},
			showAlert: () => Promise.resolve()
		}
	};
}

/** A run of plays that makes no noise and remembers being stopped. */
type FakePlayback = Playback & { stops: number };

function fakePlayback(): FakePlayback {
	return {
		active: true,
		stops: 0,
		stop(this: FakePlayback): void {
			this.stops += 1;
			(this as { active: boolean }).active = false;
		}
	};
}

/** The real dial, with the OS player replaced at the seam the base class provides for it. */
class TestDial extends DialCountdown {
	readonly playbacks: FakePlayback[] = [];

	protected override play(): Playback | null {
		const playback = fakePlayback();
		this.playbacks.push(playback);
		return playback;
	}

	get sounding(): FakePlayback | undefined {
		return this.playbacks.at(-1);
	}
}

class TestKey extends KeyCountdown {
	readonly playbacks: FakePlayback[] = [];

	protected override play(): Playback | null {
		const playback = fakePlayback();
		this.playbacks.push(playback);
		return playback;
	}
}

/** The bell's own opening curve; no other glyph has it. */
const BELL = "M12 3.4 C8.8 ";

function drawsBell(frame: Record<string, unknown> | undefined): boolean {
	const uri = (frame?.ring ?? frame?.glyph) as string | undefined;
	if (typeof uri !== "string") {
		return false;
	}
	return Buffer.from(uri.split(",")[1] ?? "", "base64")
		.toString("utf8")
		.includes(BELL);
}

function decode(image: string | undefined): string {
	return Buffer.from((image ?? "").split(",")[1] ?? "", "base64").toString("utf8");
}

/**
 * Brings a dial up and registers its teardown.
 *
 * The teardown is `t.after` and not a line at the end of the body on purpose: the render loop is a
 * `setInterval`, and one left running holds the event loop open and hangs the whole suite with no
 * output. A failing assertion skips whatever follows it.
 */
function appearDial(t: TestContext, settings: Record<string, unknown>): ReturnType<typeof control> & { a: TestDial } {
	const c = control(true);
	const a = new TestDial();
	a.onWillAppear({ action: c.action, payload: { settings } } as never);
	t.after(() => a.onWillDisappear({ action: c.action, payload: { settings } } as never));
	return { ...c, a };
}

function appearKey(t: TestContext, settings: Record<string, unknown>): ReturnType<typeof control> & { a: TestKey } {
	const c = control(false);
	const a = new TestKey();
	a.onWillAppear({ action: c.action, payload: { settings } } as never);
	t.after(() => a.onWillDisappear({ action: c.action, payload: { settings } } as never));
	return { ...c, a };
}

const BASE = { presets: [1200], presetIndex: 0, soundId: "none" };

describe("the dial, driven by its own events", () => {
	it("loads its layout and draws as soon as it appears", (t) => {
		const { layouts, frames } = appearDial(t, BASE);

		assert.deepEqual(layouts, ["layouts/ring.json"]);
		assert.ok(frames.length > 0, "a control that appears and draws nothing looks dead");
	});

	it("takes the bar layout when the settings ask for it", (t) => {
		const { layouts, frames } = appearDial(t, { ...BASE, layout: "bar" });

		assert.deepEqual(layouts, ["layouts/bar.json"]);
		assert.ok("indicator" in (frames.at(-1) ?? {}), "the bar layout sends a progress indicator");
	});

	it("adds a second a click, and a minute a click with the knob pushed in", (t) => {
		const { a, action, frames } = appearDial(t, BASE);

		a.onDialRotate({ action, payload: { settings: BASE, ticks: 5, pressed: false } } as never);
		assert.equal((frames.at(-1)?.value as { value: string }).value, "20:05");

		a.onDialRotate({ action, payload: { settings: BASE, ticks: 1, pressed: true } } as never);
		assert.equal((frames.at(-1)?.value as { value: string }).value, "21:05");
	});

	it("does not start the clock when the press was the one that did the turning", async (t) => {
		// `turnedWhileDown`. Pushing the knob in is how minutes are asked for, so the release that
		// ends a wind must not also read as a press — that started the clock under your hand.
		const { a, action, frames } = appearDial(t, BASE);

		a.onDialDown({ action, payload: { settings: BASE } } as never);
		a.onDialRotate({ action, payload: { settings: BASE, ticks: 1, pressed: true } } as never);
		a.onDialUp({ action, payload: { settings: BASE } } as never);
		await settle();

		assert.equal((frames.at(-1)?.value as { value: string }).value, "21:00", "the minute is kept");
		assert.equal(frames.at(-1)?.finish, "", "and nothing was started, so there is no finish time");
	});

	it("starts the clock on a press that did not turn", async (t) => {
		// The positive control for the test above.
		const { a, action, frames } = appearDial(t, { ...BASE, showFinishTime: true });

		a.onDialDown({ action, payload: { settings: BASE } } as never);
		a.onDialUp({ action, payload: { settings: BASE } } as never);
		await settle();

		assert.match(String(frames.at(-1)?.finish), /^ends /, "a running clock says when it ends");
	});

	it("ignores a release it never saw the press for", async (t) => {
		// A page flip mid-press rebuilds the action with its latches clear. The trade is a swallowed
		// press, which fails as "press it again" rather than as a clock moving unasked.
		const { a, action, frames } = appearDial(t, { ...BASE, showFinishTime: true });

		a.onDialUp({ action, payload: { settings: BASE } } as never);
		await settle();

		assert.equal(frames.at(-1)?.finish, "", "nothing should have started");
	});

	it("reads a long hold on the knob as putting the clock right", async (t) => {
		// Measured on release, never by a timer running while the finger is down: a timer firing
		// mid-press would go off in the pause between pushing in and starting to turn.
		const { a, action, frames } = appearDial(t, BASE);

		a.onDialDown({ action, payload: { settings: BASE } } as never);
		a.onDialRotate({ action, payload: { settings: BASE, ticks: 3, pressed: false } } as never);
		a.onDialDown({ action, payload: { settings: BASE } } as never);
		await wait(LONG_PRESS_MS + 40);
		a.onDialUp({ action, payload: { settings: BASE } } as never);

		assert.equal((frames.at(-1)?.value as { value: string }).value, "20:00", "back to the top of the preset");
	});

	it("passes a tap on the glass through as a press", async (t) => {
		const { a, action, frames } = appearDial(t, { ...BASE, showFinishTime: true });

		a.onTouchTap({ action, payload: { settings: BASE, hold: false } } as never);

		// The glass waits `DOUBLE_TAP_MS` for a partner before a single tap means anything, so the
		// toast does not even begin until then — settling from the tap itself lands inside it.
		await wait(DOUBLE_TAP_MS);
		await settle();

		assert.match(String(frames.at(-1)?.finish), /^ends /);
	});
});

describe("a step running out, on the real dial", () => {
	const RINGS = { presets: [[1, 600]], presetIndex: 0, soundId: "chime", volume: 100, soundRepeat: 20 };

	it("shows the bell while the next step counts, and gives the press to the sound", async (t) => {
		// **The bug report, end to end.** `40m, 10m, 10m` with the forty shortened to a second: the
		// step runs out, the alarm starts, the next step is already counting — so the clock's own
		// state is `running` and until 4.2.0 the screen showed a play triangle and nothing else.
		const { a, action, frames } = appearDial(t, RINGS);

		a.onDialDown({ action, payload: { settings: RINGS } } as never);
		a.onDialUp({ action, payload: { settings: RINGS } } as never);
		await wait(1500);

		assert.ok(drawsBell(frames.at(-1)), "no bell while the alert was sounding");
		assert.equal(a.sounding?.stops, 0, "and it should still be playing");

		a.onDialDown({ action, payload: { settings: RINGS } } as never);
		a.onDialUp({ action, payload: { settings: RINGS } } as never);
		await wait(400);

		assert.equal(a.sounding?.stops, 1, "the press should have stopped the sound");
		assert.ok(!drawsBell(frames.at(-1)), "and taken the bell away with it");
		assert.equal(frames.at(-1)?.finish, "silenced");

		// The half he had to report twice: the step that was already running must be untouched.
		const value = (frames.at(-1)?.value as { value: string }).value;
		await wait(1200);
		assert.notEqual((frames.at(-1)?.value as { value: string }).value, value, "the running step was paused");
	});

	it("draws no bell when nothing is sounding", async (t) => {
		// The positive control. A bell painted on every frame would pass the test above.
		const { a, action, frames } = appearDial(t, RINGS);

		a.onDialDown({ action, payload: { settings: RINGS } } as never);
		a.onDialUp({ action, payload: { settings: RINGS } } as never);
		await wait(300);

		assert.ok(!drawsBell(frames.at(-1)));
	});
});

describe("the key, driven by its own events", () => {
	it("draws its whole face as one image, clock included", (t) => {
		const { images } = appearKey(t, BASE);

		assert.ok(images.length > 0, "a key that draws nothing shows the manifest's static image");
		assert.match(images.at(-1) ?? "", /^data:image\/svg\+xml;base64,/, "raw markup is dropped by setImage");
		assert.ok(decode(images.at(-1)).includes("20:00"));
	});

	it("starts on a press, once its own double-press window has closed", async (t) => {
		// A key waits `DOUBLE_PRESS_MS` for a second press before deciding a single one was meant —
		// it has travel and glass does not, so a deliberate double-press used to arrive as two
		// singles. Nothing happens on the key until that window shuts.
		const { a, action, images } = appearKey(t, BASE);

		a.onKeyDown({ action, payload: { settings: BASE } } as never);
		a.onKeyUp({ action, payload: { settings: BASE } } as never);

		assert.ok(!decode(images.at(-1)).includes("start"), "nothing decided yet");

		await wait(DOUBLE_PRESS_MS + 150);
		assert.ok(decode(images.at(-1)).includes("start"));
	});

	it("puts the clock right on a hold, timed while the finger is still down", async (t) => {
		// A key has travel and glass does not, so the threshold fires on the way down rather than
		// waiting for a release that would make the feedback arrive after the fact.
		const { a, action, images } = appearKey(t, BASE);

		a.onKeyDown({ action, payload: { settings: BASE } } as never);
		a.onKeyUp({ action, payload: { settings: BASE } } as never);
		a.onKeyDown({ action, payload: { settings: BASE } } as never);
		await wait(LONG_PRESS_MS + 60);

		assert.ok(decode(images.at(-1)).includes("20:00"), "a hold returns to the top of the preset");
		a.onKeyUp({ action, payload: { settings: BASE } } as never);
	});

	it("says `ringing` on its one line while an alert sounds", async (t) => {
		const settings = { presets: [[1, 600]], presetIndex: 0, soundId: "chime", volume: 100, soundRepeat: 20 };
		const { a, action, images } = appearKey(t, settings);

		a.onKeyDown({ action, payload: { settings } } as never);
		a.onKeyUp({ action, payload: { settings } } as never);
		await wait(DOUBLE_PRESS_MS + 1500);

		const face = decode(images.at(-1));
		assert.ok(face.includes("ringing"), "the key never said an alert was sounding");
		assert.ok(!face.includes(BELL), "and it must not draw the bell behind its digits");
	});
});
