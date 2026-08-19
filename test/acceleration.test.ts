import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	Accelerator,
	IDLE_RESET_MS,
	PRESSED_STEP_SECONDS,
	STEPS_SECONDS,
	UPSHIFT_DWELL_MS,
	UPSHIFT_TICKS_PER_SECOND
} from "../src/acceleration.ts";

/** Gap between rotations that produces a given rate, for one tick an event. */
function gapFor(ticksPerSecond: number): number {
	return 1000 / ticksPerSecond;
}

/** Turns the dial at a steady rate and hands back the last step and the time reached. */
function spin(
	accelerator: Accelerator,
	{ ticksPerSecond, events, ticks = 1, from = 0 }: { ticksPerSecond: number; events: number; ticks?: number; from?: number }
): { now: number; last: number } {
	const gap = gapFor(ticksPerSecond / ticks);
	let now = from;
	let last = 0;
	for (let i = 0; i < events; i++) {
		now += gap;
		last = accelerator.rotate(ticks, now);
	}
	return { now, last };
}

describe("Accelerator", () => {
	it("starts at one second per tick, so a single click is the finest nudge there is", () => {
		const accelerator = new Accelerator();
		assert.equal(accelerator.rotate(1, 0), 1);
		assert.equal(accelerator.rotate(-1, 10_000), -1, "a rotation after a long pause is fine again");
	});

	it("stays at one second however long a slow turn goes on — the whole point of reading speed", () => {
		// The bug this guards. The old accelerator counted ticks, so any sustained turn escalated and
		// there was no way to click out thirty seconds one second at a time.
		const accelerator = new Accelerator();
		const { last } = spin(accelerator, { ticksPerSecond: 5, events: 200 });

		assert.equal(accelerator.stepSeconds, 1, "a deliberate turn must never change gear on its own");
		assert.equal(last, 1);
	});

	it("ignores a single quick click, so a stray one cannot change gear", () => {
		const accelerator = new Accelerator();
		const gap = gapFor(UPSHIFT_TICKS_PER_SECOND * 1.5);

		accelerator.rotate(1, 0);
		accelerator.rotate(1, gap);
		assert.equal(accelerator.gear, 0, "one quick click is not a flick");

		accelerator.rotate(1, gap * 2);
		assert.equal(accelerator.gear, 1, "two in a row is");
	});

	it("changes up when the dial is turned fast", () => {
		const accelerator = new Accelerator();
		spin(accelerator, { ticksPerSecond: 20, events: 4 });

		assert.equal(accelerator.stepSeconds, 10, "a flick of the wrist is what asks for a coarser step");
	});

	it("holds the gear once you slow down, which is the reason for changing up at all", () => {
		const accelerator = new Accelerator();
		const { now } = spin(accelerator, { ticksPerSecond: 30, events: 20 });
		const reached = accelerator.stepSeconds;
		assert.ok(reached > 1, "precondition: the spin changed up");

		// Crawling along, well under the upshift rate but without ever letting go.
		const crawl = spin(accelerator, { ticksPerSecond: 3, events: 6, from: now });
		assert.equal(accelerator.stepSeconds, reached, "slowing down must not collapse the step back");
		assert.equal(crawl.last, reached, "so careful dialling happens at the coarse step you asked for");
	});

	it("keeps the gear through a reversal, so correcting an overshoot stays in the same unit", () => {
		const accelerator = new Accelerator();
		let { now } = spin(accelerator, { ticksPerSecond: 30, events: 20 });
		const reached = accelerator.stepSeconds;
		assert.ok(reached > 1, "precondition: the spin changed up");

		for (const ticks of [-1, 1, -1, 1]) {
			now += gapFor(4);
			assert.equal(accelerator.rotate(ticks, now), ticks * reached, "going back and forth is one gesture");
		}
	});

	it("drops back to the fine step only once the dial has been let go", () => {
		const accelerator = new Accelerator();
		const { now } = spin(accelerator, { ticksPerSecond: 30, events: 20 });
		assert.ok(accelerator.stepSeconds > 1, "precondition: the spin changed up");

		assert.equal(
			accelerator.rotate(1, now + IDLE_RESET_MS - 1),
			accelerator.stepSeconds,
			"a pause shorter than the timeout is still the same gesture"
		);

		assert.equal(accelerator.rotate(1, now + IDLE_RESET_MS * 3), 1, "and letting go puts it back to one second");
	});

	it("climbs a gear at a time and skips none", () => {
		const accelerator = new Accelerator();
		const seen: number[] = [];
		let now = 0;
		for (let i = 0; i < 40; i++) {
			now += gapFor(40);
			accelerator.rotate(1, now);
			if (seen.at(-1) !== accelerator.stepSeconds) {
				seen.push(accelerator.stepSeconds);
			}
		}
		assert.deepEqual(seen, [...STEPS_SECONDS], "every gear should be passed through on the way up");
	});

	it("will not climb the whole ladder inside one flick", () => {
		const accelerator = new Accelerator();
		let now = 0;
		let shiftedAt: number | null = null;

		// A hard spin, sampled until the moment it first changes up, then for the dwell after it.
		while (now < 3_000) {
			now += 5;
			accelerator.rotate(4, now);
			if (accelerator.gear > 0 && shiftedAt === null) {
				shiftedAt = now;
			}
			if (shiftedAt !== null && now - shiftedAt < UPSHIFT_DWELL_MS) {
				assert.equal(accelerator.gear, 1, "a second change of gear must wait out the dwell");
			}
			if (shiftedAt !== null && now - shiftedAt >= UPSHIFT_DWELL_MS) {
				break;
			}
		}
		assert.notEqual(shiftedAt, null, "precondition: a hard spin does change up");
	});

	it("tops out rather than running away", () => {
		const accelerator = new Accelerator();
		spin(accelerator, { ticksPerSecond: 120, ticks: 4, events: 400 });

		assert.equal(accelerator.gear, STEPS_SECONDS.length - 1);
		assert.equal(accelerator.stepSeconds, STEPS_SECONDS.at(-1));
	});

	it("reads a batch of ticks as the faster turn it is", () => {
		const batched = new Accelerator();
		const single = new Accelerator();

		// The same events at the same moments, one carrying four ticks apiece and one carrying one.
		let now = 0;
		for (let i = 0; i < 6; i++) {
			now += gapFor(4);
			batched.rotate(4, now);
			single.rotate(1, now);
		}

		assert.ok(batched.gear > single.gear, "a dial spun hard batches its ticks, and that is the signal");
		assert.equal(single.gear, 0, "while the same cadence a tick at a time is just a slow turn");
	});

	it("treats a held dial as a flat minute, never compounding with the gear", () => {
		const accelerator = new Accelerator();
		const { now } = spin(accelerator, { ticksPerSecond: 40, events: 30 });
		assert.equal(accelerator.stepSeconds, 600, "precondition: it is in top gear");

		assert.equal(accelerator.rotate(1, now + 50, true), PRESSED_STEP_SECONDS);
		assert.equal(accelerator.rotate(-2, now + 100, true), -2 * PRESSED_STEP_SECONDS);
	});

	it("keeps the sign of the rotation", () => {
		const accelerator = new Accelerator();
		assert.equal(accelerator.rotate(-3, 0), -3);
	});

	it("goes back to first gear when explicitly reset", () => {
		const accelerator = new Accelerator();
		const { now } = spin(accelerator, { ticksPerSecond: 30, events: 20 });
		assert.ok(accelerator.gear > 0, "precondition: the spin changed up");

		accelerator.reset();
		assert.equal(accelerator.gear, 0);
		assert.equal(accelerator.rotate(1, now + 20), 1, "after a reset the next turn is fine again");
	});
});
