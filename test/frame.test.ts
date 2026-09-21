/**
 * What the two controls actually put on screen.
 *
 * **This file exists because of a bug that shipped through a green suite and a green demo.** An
 * alert could sound with nothing on the screen to say so, twice over: the renderer was never told,
 * and even once it was, the frame would have been dropped as a duplicate. Neither half was
 * reachable by a test — the logic lived inside the actions, which carry an `@action` decorator that
 * Node's type stripping leaves standing — and neither was reachable by the scripted demo either,
 * because this box has no audio player, so no alert ever rings here.
 *
 * So the payloads moved into `src/frame.ts` and the assertions live here. The rule this file is
 * enforcing: **whether the user can see a thing is a claim, and it is tested against the frame
 * being sent, not against the flag behind it.**
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Countdown } from "../src/countdown.ts";
import { BAR_LAYOUT, dialFeedback, keyFace, RING_LAYOUT, valueFontSize } from "../src/frame.ts";
import { normaliseSettings } from "../src/settings.ts";

const NOW = 1_700_000_000_000;

/**
 * A countdown on a hand-driven clock.
 *
 * `started()` runs it and then steps a second past the gesture, because a toast owns the key's one
 * line for 900 ms and would otherwise be the caption under test. That is real behaviour, not a
 * quirk of the harness: for the second after a press, a key reports the press rather than
 * anything else. It does not hide a ringing alert in practice — an alert starts when a step runs
 * out, which is not a moment anybody just pressed anything.
 */
function fixture(overrides: Record<string, unknown> = {}): { countdown: Countdown; advance: (ms: number) => void } {
	let now = NOW;
	const settings = normaliseSettings({ presets: [1200], presetIndex: 0, soundId: "none", ...overrides });
	return { countdown: new Countdown(settings, () => now), advance: (ms) => (now += ms) };
}

/** A running countdown with no toast left on it. */
function started(overrides: Record<string, unknown> = {}): Countdown {
	const { countdown, advance } = fixture(overrides);
	countdown.apply("toggle");
	advance(1000);
	return countdown;
}

/** The bell's own opening curve. No other glyph has it. */
const BELL = "M12 3.4 C8.8 ";

/** Whatever the payload puts a picture in, decoded back to markup. */
function artwork(payload: Record<string, unknown>): string {
	const uri = (payload.ring ?? payload.glyph) as string;
	const [, encoded] = uri.split(",");
	return Buffer.from(encoded ?? "", "base64").toString("utf8");
}

describe("the touchscreen's frame", () => {
	it("draws the bell while an alert is sounding, on both layouts", () => {
		// The report: `40m, 10m, 10m` — the forty runs out, the alarm starts, and the first ten is
		// already counting. The timer is *running*, so the middle of the ring showed a play triangle
		// and the one thing worth knowing was nowhere on the screen.
		for (const layout of [RING_LAYOUT, BAR_LAYOUT]) {
			const countdown = started({ presets: [[1200, 600, 600]] });
			countdown.ringing = true;

			assert.ok(
				artwork(dialFeedback(countdown, layout, NOW)).includes(BELL),
				`${layout} drew no bell while an alert was sounding`
			);
		}
	});

	it("takes the bell away again the moment the sound stops", () => {
		// The positive control. Without it, a frame that always drew a bell would pass the test above.
		const countdown = started({ presets: [[1200, 600, 600]] });

		assert.ok(!artwork(dialFeedback(countdown, RING_LAYOUT, NOW)).includes(BELL));
	});

	it("sends a different frame when the only thing that changed is the sound", () => {
		// **The bug underneath the bug.** A frame used to be compared against a hand-written list of
		// the fields it depends on, and a sounding alert changes nothing else — the clock behind it
		// reads the same second — so the frame was judged identical and never sent. The bell was set
		// correctly and the screen never heard about it.
		const countdown = started({ presets: [[1200, 600, 600]] });

		const quiet = JSON.stringify(dialFeedback(countdown, RING_LAYOUT, NOW));
		countdown.ringing = true;
		const ringing = JSON.stringify(dialFeedback(countdown, RING_LAYOUT, NOW));

		assert.notEqual(ringing, quiet, "a frame that does not change cannot be drawn");
	});

	it("is otherwise stable, so the screen is not redrawn four times a second for nothing", () => {
		// The control for the test above: if every frame differed, "it changed" would prove nothing.
		const countdown = started();

		assert.equal(
			JSON.stringify(dialFeedback(countdown, RING_LAYOUT, NOW)),
			JSON.stringify(dialFeedback(countdown, RING_LAYOUT, NOW))
		);
	});

	it("puts the clock, the label and the finish line where the layout expects them", () => {
		const { countdown } = fixture({ title: "Tea" });
		const frame = dialFeedback(countdown, RING_LAYOUT, NOW) as Record<string, unknown>;

		assert.equal((frame.value as { value: string }).value, "20:00");
		assert.equal(frame.label, "Tea");
		assert.ok("ring" in frame && !("indicator" in frame), "the ring layout has no progress bar");
	});

	it("swaps the ring for a bar, and inverts what the number means", () => {
		const countdown = started();
		const frame = dialFeedback(countdown, BAR_LAYOUT, NOW) as Record<string, unknown>;

		assert.ok("glyph" in frame && !("ring" in frame), "the bar layout draws the glyph on its own");
		assert.equal((frame.indicator as { value: number }).value, 0, "nothing elapsed yet is a bar at zero");
	});

	it("shrinks the clock as it gets longer, rather than letting it overrun its box", () => {
		assert.ok(valueFontSize("1:10:10") < valueFontSize("5:00"));
		assert.equal(valueFontSize("0:00:00:00"), 18, "past the table, the floor");
	});
});

describe("the key's face", () => {
	it("says `ringing`, since its middle is taken by its own clock", () => {
		const countdown = started({ presets: [[1200, 600, 600]] });
		countdown.ringing = true;

		const svg = keyFace(countdown);
		assert.ok(svg.includes("ringing"), "the key never said an alert was sounding");
		assert.ok(!svg.includes(BELL), "and it must not draw the bell behind its digits");
	});

	it("gives the line back when the sound stops", () => {
		const countdown = started({ presets: [[1200, 600, 600]] });

		assert.ok(!keyFace(countdown).includes("ringing"));
	});

	it("sends a different face when the only thing that changed is the sound", () => {
		const countdown = started({ presets: [[1200, 600, 600]] });

		const quiet = keyFace(countdown);
		countdown.ringing = true;

		assert.notEqual(keyFace(countdown), quiet);
	});

	it("draws its clock into the face itself, not as a title", () => {
		// `setTitle` stops being honoured the moment the user types a title of their own, so the
		// digits are part of the image. `UserTitleEnabled` is false in the manifest for that reason.
		assert.ok(keyFace(fixture().countdown).includes("20:00"));
	});
});
