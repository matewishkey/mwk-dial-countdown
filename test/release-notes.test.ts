/**
 * The reduction that fits a changelog entry into the Marketplace budget.
 *
 * It is the part of the release tooling with judgement in it, and the part that fails **quietly** —
 * it produces prose either way, so a bad reduction is not a crash but a worse release note than the
 * one somebody wrote. The first implementation shortened every entry in lockstep, looked entirely
 * correct, and threw away two thirds of the budget: 1500 characters of room, 332 used.
 *
 * So the important test here is not a fixture but the **backtest** — every section in the real
 * `CHANGELOG.md`, checked for the properties that must hold whatever the input. One document is not
 * a rule, and the entry that broke the first version was the long one, not the one being looked at.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
	changelogSection,
	firstSentence,
	fitNotes,
	lead,
	NOTES_LIMIT,
	NOT_FOR_MARKETPLACE,
	parseSection,
	plain
} from "../tools/release-notes.mjs";

const CHANGELOG = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");

/** Every released version in the changelog, so the backtest cannot go stale as versions are added. */
const VERSIONS: string[] = [...CHANGELOG.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]);

const notesFor = (version: string, limit = NOTES_LIMIT): ReturnType<typeof fitNotes> => {
	const section = changelogSection(CHANGELOG, version);
	assert.ok(section !== null, `no section for ${version}`);
	return fitNotes(parseSection(section), limit);
};

describe("the changelog it reads", () => {
	it("finds a version's own section and stops at the next one", () => {
		const section = changelogSection(CHANGELOG, VERSIONS[0]);

		assert.ok(section !== null);
		assert.ok(section.startsWith(`## [${VERSIONS[0]}]`));
		assert.equal(section.match(/^## \[/gm)?.length, 1, "one heading, so the next version is not swept in");
	});

	it("answers null for a version that is not there, rather than guessing", () => {
		assert.equal(changelogSection(CHANGELOG, "99.0.0"), null);
	});

	it("has something to test against", () => {
		// The positive control for every backtest below. If this file ever stops being parseable, the
		// loops would pass vacuously and report a clean bill over nothing at all.
		assert.ok(VERSIONS.length >= 5, `only ${VERSIONS.length} versions parsed out of CHANGELOG.md`);
		for (const version of VERSIONS) {
			assert.ok(parseSection(changelogSection(CHANGELOG, version) as string).length > 0, `${version} parsed empty`);
		}
	});
});

describe("fitting the notes to the budget", () => {
	it("never exceeds the budget, for any entry in the changelog", () => {
		for (const version of VERSIONS) {
			const { text } = notesFor(version);
			assert.ok(text.length <= NOTES_LIMIT, `${version} produced ${text.length} characters`);
		}
	});

	it("never cuts a word in half", () => {
		// Every reduction step drops a whole sentence or a whole entry. Nothing should end mid-token,
		// and nothing should carry the ellipsis of a naive truncation.
		for (const version of VERSIONS) {
			const { text } = notesFor(version);
			assert.ok(!text.includes("…"), `${version} looks truncated rather than reduced`);
			for (const line of text.split("\n").filter((line: string) => line.startsWith("• "))) {
				assert.match(line, /[.!?:]$|\)$/, `${version}: "${line.slice(-40)}" does not end on a sentence`);
			}
		}
	});

	it("uses the budget — the result is maximal, not merely sufficient", () => {
		// The bug this file exists for, stated as the property rather than as a number. "Within 75% of
		// the ceiling" was the first attempt and it was wrong: with two entries whose sentences are
		// lumpy you cannot always land near the budget, because you cannot invent text.
		//
		// What can always be demanded is that **nothing more fits** — the room left over must be less
		// than the cheapest remaining improvement. The lockstep version failed this by a mile: it left
		// 1168 characters spare with promotions available that cost far less.
		const reduced = VERSIONS.map((v) => ({ version: v, ...notesFor(v) })).filter((n) => n.nextStep !== null);
		assert.ok(reduced.length > 0, "positive control: at least one changelog entry must have room to improve");

		for (const { version, text, nextStep } of reduced) {
			const spare = NOTES_LIMIT - text.length;
			assert.ok(
				spare < (nextStep as number),
				`${version}: ${spare} characters spare and the next improvement costs only ${nextStep} — ` +
					`the reduction stepped over the budget rather than filling it`
			);
		}
	});

	it("reports no further improvement when everything is already in full", () => {
		const groups = parseSection("## [x]\n\n### Added\n\n- **A thing.** It does a thing.\n");
		assert.equal(fitNotes(groups, NOTES_LIMIT).nextStep, null);
	});

	it("keeps the changelog's link-reference block out of the notes", () => {
		// Keep a Changelog puts `[1.2.0]: https://…/compare/…` definitions at the foot of the file.
		// They sit after the last heading with nothing to close the section, so the OLDEST version was
		// getting them as a 1195-character entry that was a wall of compare URLs. It never showed up
		// because nobody re-releases the oldest version — which is exactly why it is worth a test.
		const oldest = VERSIONS.at(-1) as string;
		const { text } = notesFor(oldest);

		assert.ok(!text.includes("https://github.com"), `the oldest entry (${oldest}) swept up the link block`);
		assert.ok(!/\[[^\]]+\]:\s/.test(text), "no link-reference definitions anywhere in the notes");
		assert.ok(text.length > 0, "positive control: the section still produced notes");
	});

	it("keeps every entry it can, and shortens before it drops", () => {
		for (const version of VERSIONS) {
			const section = changelogSection(CHANGELOG, version) as string;
			const total = parseSection(section).reduce((n, g) => n + g.bullets.length, 0);
			const { text, dropped } = notesFor(version);
			assert.ok(dropped < total, `${version} dropped all ${total} entries`);
			assert.equal(text.split("\n").filter((line: string) => line.startsWith("• ")).length, total - dropped);
		}
	});

	it("leaves everything in full when there is room", () => {
		const groups = parseSection("## [x]\n\n### Added\n\n- **A thing.** It does a thing.\n");
		const { text, level, dropped } = fitNotes(groups, NOTES_LIMIT);

		assert.equal(level, "in full");
		assert.equal(dropped, 0);
		assert.equal(text, "Added:\n• A thing. It does a thing.");
	});

	it("reaches an entry's continuation paragraphs when there is room for them", () => {
		// The *why* under an entry's opening line is the useful half, and it was unreachable: the
		// fullest rendering only ever read the first paragraph. v3.3.0's notes came to 154 characters
		// of 1500 with nothing else competing for the room.
		const groups = parseSection(
			"## [x]\n\n### Changed\n\n- **A thing.** The opening line.\n\n  The reason it changed.\n"
		);
		const { text } = fitNotes(groups, NOTES_LIMIT);

		assert.ok(text.includes("The opening line."));
		assert.ok(text.includes("The reason it changed."), "the paragraph under it is part of the entry");
	});

	it("gives up the continuation paragraphs first, before touching the opening line", () => {
		// The positive control for the level above: it has to be the *first* thing dropped, not a
		// rendering that is either all or nothing.
		const groups = parseSection(
			"## [x]\n\n### Changed\n\n- **A thing.** The opening line.\n\n  The reason it changed.\n"
		);
		const { text } = fitNotes(groups, 40);

		assert.ok(text.includes("The opening line."));
		assert.ok(!text.includes("The reason it changed."));
	});

	it("shortens the longest entry first, so the reduction stays even", () => {
		const long = "x".repeat(300);
		const groups = parseSection(
			`## [x]\n\n### Added\n\n- **Short.** Tiny.\n\n- **Long.** ${long}. And a second sentence.\n`
		);
		const { text } = fitNotes(groups, 120);

		assert.ok(text.includes("Short. Tiny."), "the short entry keeps its body; it was never the problem");
		assert.ok(!text.includes(long), "the long one gave up its body");
	});

	it("drops entries only once nothing is left to shorten", () => {
		const groups = parseSection(
			"## [x]\n\n### Added\n\n- **One.** Body one.\n\n- **Two.** Body two.\n\n- **Three.** Body three.\n"
		);
		const roomy = fitNotes(groups, 200);
		const tight = fitNotes(groups, 20);

		assert.equal(roomy.dropped, 0);
		assert.ok(tight.dropped > 0, "at 20 characters something has to go");
		assert.ok(tight.text.includes("One."), "and it is the last entry that goes, not the first");
	});

	it("says how it reduced, rather than presenting a trim as the whole story", () => {
		const groups = parseSection("## [x]\n\n### Added\n\n- **A.** Short.\n");
		assert.equal(fitNotes(groups, NOTES_LIMIT).level, "in full");
		assert.match(fitNotes(groups, 12).level, /headline|shortened|nothing kept/);
	});
});

describe("what goes to Marketplace and what does not", () => {
	it("leaves the Internal heading out, and keeps every other one", () => {
		const section = `## [x]

### Added

- **A user thing.** Visible on the hardware.

### Internal

- **A repo thing.** A refactor nobody installs.
`;
		const groups = parseSection(section);
		const listing = groups.filter((group) => group.heading === null || !NOT_FOR_MARKETPLACE.includes(group.heading));

		assert.equal(fitNotes(listing, NOTES_LIMIT).text.includes("A repo thing"), false);
		assert.ok(fitNotes(listing, NOTES_LIMIT).text.includes("A user thing"), "positive control: the rest survives");
		assert.ok(
			fitNotes(groups, NOTES_LIMIT).text.includes("A repo thing"),
			"and it is only the filter doing it — unfiltered, the entry is there"
		);
	});
});

describe("the pieces the reduction is built from", () => {
	it("strips markdown down to what a form field can hold", () => {
		assert.equal(plain("**Bold** and `code` and [a link](https://example.com)"), "Bold and code and a link");
		assert.equal(plain("wrapped\n  across\n  lines"), "wrapped across lines");
	});

	it("takes a first sentence without being fooled by a decimal", () => {
		assert.equal(firstSentence("One. Two."), "One.");
		assert.equal(firstSentence("No full stop"), "No full stop");
		assert.equal(firstSentence("Fixed in 3.1.0 exactly. Then more."), "Fixed in 3.1.0 exactly.");
	});

	it("reads the bold lead a changelog entry opens with", () => {
		assert.equal(lead("- **A title.** Name a timer."), "A title.");
		assert.equal(lead("- **Clear itself**, after a wait."), "Clear itself.");
	});

	it("falls back to the first sentence for an entry written without a lead", () => {
		// Nothing enforces the `- **Lead.**` convention, so an entry without one must degrade to
		// something rather than to an empty line.
		assert.equal(lead("- Just a plain sentence. And another."), "Just a plain sentence.");
	});
});
