#!/usr/bin/env node
/**
 * Turning a changelog entry into the notes a release needs, in two shapes.
 *
 * GitHub takes the entry whole. Marketplace takes a form field with a hard ceiling on it, so the
 * same entry has to come back **shorter without coming back mangled** — which is the part with any
 * judgement in it, and the part that fails quietly. It produces prose either way, so a bad reduction
 * does not throw; it just hands over a worse release note than the one that was written.
 *
 * That is exactly what happened once. The obvious implementation shortened every entry in lockstep,
 * looked entirely correct, and threw away two thirds of the budget: the step from "all in full" to
 * "all first sentences" jumped from over 1500 characters straight down to 332. Nothing catches that
 * but reading the output, or a test — see `test/release-notes.test.ts`, which backtests the whole of
 * `CHANGELOG.md` rather than one entry, because one document is not a rule.
 *
 * Pure, and separated from `tools/release.mjs` for that reason: nothing here spawns, reads or writes
 * anything.
 */

/**
 * The ceiling on the notes that go to Marketplace.
 *
 * A budget, not a truncation point: the reduction below drops whole sentences and whole bullets to
 * come in under it, so what is left is always something a person wrote and never a word cut in
 * half. See {@link fitNotes}.
 */
export const NOTES_LIMIT = 1500;

/**
 * Changelog headings the Marketplace notes leave out.
 *
 * *Internal* is where repo-only work goes — a refactor, a formatting fix, a tool. It belongs in the
 * changelog, because `docs/releasing.md` says repo-only work travels with the next release rather
 * than vanishing; it does not belong in front of somebody deciding whether to install an update.
 * The GitHub notes keep it, since that audience is the one it was written for.
 */
export const NOT_FOR_MARKETPLACE = ["Internal"];

/**
 * The version's own section of the changelog, verbatim.
 *
 * The changelog is already written for whoever installs the plugin — `docs/releasing.md` insists on
 * it — so it is the source rather than the git log, which is written for whoever maintains it.
 */
/**
 * @param {string} text
 * @param {string} forVersion
 * @returns {string | null}
 */
export function changelogSection(text, forVersion) {
	const start = text.indexOf(`## [${forVersion}]`);
	if (start === -1) {
		return null;
	}
	const next = text.indexOf("\n## ", start + 1);
	return text.slice(start, next === -1 ? undefined : next).trim();
}

/** Splits a changelog section into its `### Heading` groups and their bullets. */
/**
 * A heading and the entries under it. A bullet is its own array: the opening paragraph first, then
 * any indented continuation paragraphs, which only the fullest rendering ever reaches for.
 *
 * @typedef {{ heading: string | null, bullets: string[][] }} Group
 */

/**
 * @param {string} section
 * @returns {Group[]}
 */
export function parseSection(section) {
	const groups = [];
	let group = { heading: null, bullets: [] };

	for (const block of section.split(/\n\n+/).slice(1)) {
		const heading = block.match(/^### (.+)$/);
		if (heading !== null) {
			if (group.bullets.length > 0) {
				groups.push(group);
			}
			group = { heading: heading[1], bullets: [] };
			continue;
		}

		// The link-reference definitions at the foot of the file belong to no version. They sit after
		// the last heading with nothing to close the section, so they were being swept into the oldest
		// release as a 1195-character "entry" that was a wall of compare URLs. Keep a Changelog puts
		// them there by convention, so this is structural, not a quirk of this file.
		if (/^\[[^\]]+\]:\s*\S+$/m.test(block) && block.split("\n").every((line) => /^\[[^\]]+\]:|^$/.test(line))) {
			continue;
		}

		// A bullet's continuation paragraphs are indented; anything else is a note under the heading.
		if (block.startsWith("- ")) {
			group.bullets.push([block]);
		} else if (block.startsWith("  ") && group.bullets.length > 0) {
			group.bullets.at(-1).push(block);
		} else {
			group.bullets.push([`- ${block}`]);
		}
	}
	if (group.bullets.length > 0) {
		groups.push(group);
	}
	return groups;
}

/** Markdown to the plain text a form field wants: no bold markers, no links, no wrapping. */
/**
 * @param {string} markdown
 * @returns {string}
 */
export function plain(markdown) {
	return markdown
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/[_*`]/g, "")
		.replace(/\s*\n\s*/g, " ")
		.replace(/\s{2,}/g, " ")
		.trim();
}

/** The first sentence of a bullet — up to the first full stop that ends one. */
/**
 * @param {string} text
 * @returns {string}
 */
export function firstSentence(text) {
	const end = text.search(/\.(?=\s|$)/);
	return end === -1 ? text : text.slice(0, end + 1);
}

/** The bold lead a changelog bullet opens with, or its first sentence when it has none. */
/**
 * @param {string} bulletMarkdown
 * @returns {string}
 */
export function lead(bulletMarkdown) {
	const bold = bulletMarkdown.match(/^- \*\*(.+?)\*\*([.,]?)/s);
	if (bold === null) {
		return firstSentence(plain(bulletMarkdown.replace(/^- /, "")));
	}

	// Only when the lead does not already carry one. Entries are written both ways — `- **A title.**`
	// and `- **Clear itself**,` — and appending blindly turned the first into `A title..`, in notes
	// that go to a public listing. Nothing had ever run the headline level against a real entry.
	return `${plain(bold[1]).replace(/[.,;:]+$/, "")}.`;
}

/**
 * How a single entry can be rendered, fullest first.
 *
 * The last of the three is the changelog's own shape rather than a guess — every entry opens with a
 * bold summary precisely so it can be read at a glance, which makes "the top of it" something the
 * format already knows how to give.
 */
const RENDERINGS = [
	(bullet) => bullet.map((paragraph) => plain(paragraph.replace(/^- /, ""))).join(" "),
	(bullet) => sentences(bullet, Infinity),
	(bullet) => sentences(bullet, 3),
	(bullet) => sentences(bullet, 2),
	(bullet) => sentences(bullet, 1),
	(bullet) => lead(bullet[0])
];

/**
 * The first `count` sentences of an entry's opening paragraph.
 *
 * The intermediate steps are what make the budget reachable. With only *whole paragraph* and *first
 * sentence* to choose between, one long entry fell from over the ceiling to 420 characters of a 1500
 * budget in a single step — nothing was wrong with the greedy loop, it simply had nowhere to stand
 * between the two. Three, two and one give it somewhere.
 *
 * Above all of them sits the entry **whole**, continuation paragraphs included. Without it a rich
 * entry could not spend the budget at all: v3.3.0's notes came to 154 characters of 1500 with nothing
 * competing for the room, because the *why* under an entry's opening line was never reachable.
 */
/**
 * @param {string[]} bullet
 * @param {number} count
 * @returns {string}
 */
function sentences(bullet, count) {
	const text = plain(bullet[0].replace(/^- /, ""));
	if (count === Infinity) {
		return text;
	}

	let taken = "";
	let rest = text;
	for (let index = 0; index < count && rest.length > 0; index++) {
		const one = firstSentence(rest);
		taken += (taken === "" ? "" : " ") + one.trim();
		rest = rest.slice(one.length).trim();
	}
	return taken;
}

/**
 * The notes, reduced until they fit — a phrase at a time, and from the entry that can best spare it.
 *
 * Every entry starts in full. While the text is over budget, the **longest** entry that can still be
 * shortened is shortened by one step, and only when nothing is left to shorten does an entry go
 * altogether. Two things follow from doing it that way.
 *
 * **Coverage survives detail.** Eight headlines beat three full paragraphs: a release note that
 * mentions everything briefly is a better answer to *what changed* than one that describes most of
 * it well and is silent about the rest.
 *
 * **The budget is actually used.** Shortening every entry in lockstep was the obvious way to write
 * this and it wasted two thirds of the limit — the step from "all in full" to "all first sentences"
 * jumped straight past it, from over 1500 characters to 332. Demoting one entry at a time lands on
 * the budget instead of vaulting it, so the long entry that needed the room keeps it and the short
 * one that did not gives it up.
 *
 * A word is never cut. Sentences go and whole entries go; nothing here ends mid-phrase.
 *
 * @returns The notes, how each entry was rendered, and how many went — so the page can say so rather
 * than presenting a silent trim as the whole story.
 */
/**
 * @param {Group[]} groups
 * @param {number} limit
 * @returns {{ text: string, level: string, dropped: number, nextStep: number | null }}
 */
export function fitNotes(groups, limit) {
	// One flat list of entries, each knowing which group it belongs to, so demoting can look across
	// the whole release rather than one heading at a time.
	const entries = groups.flatMap((group, groupIndex) =>
		group.bullets.map((bullet) => ({ groupIndex, bullet, level: 0, dropped: false }))
	);

	const render = () =>
		format(
			groups
				.map((group, groupIndex) => ({
					heading: group.heading,
					lines: entries
						.filter((entry) => entry.groupIndex === groupIndex && !entry.dropped)
						.map((entry) => RENDERINGS[entry.level](entry.bullet))
				}))
				.filter((group) => group.lines.length > 0)
		);

	let text = render();

	while (text.length > limit) {
		const live = entries.filter((entry) => !entry.dropped);
		if (live.length === 0) {
			break;
		}

		const demotable = live.filter((entry) => entry.level < RENDERINGS.length - 1);
		if (demotable.length === 0) {
			// Nothing left to shorten. The last entry goes, which is the least important of them:
			// Keep a Changelog orders its headings that way, and so does every entry under one.
			live.at(-1).dropped = true;
		} else {
			// The longest one gives up a step. Taking from the longest is what keeps the reduction even
			// — always demoting the first would leave one entry a headline beside three paragraphs.
			demotable.sort((a, b) => RENDERINGS[b.level](b.bullet).length - RENDERINGS[a.level](a.bullet).length);
			demotable[0].level += 1;
		}

		text = render();
	}

	// Greedy demotion overshoots: it takes from the longest entry, which can free far more room than
	// was needed, and the loop stops the moment it fits rather than the moment it fits best. So walk
	// back up — restore a dropped entry, or give an entry a fuller rendering — for as long as the
	// result still fits. Without this the reduction was merely *sufficient*; with it, it is maximal,
	// which is the property `test/release-notes.test.ts` actually asserts.
	for (let improved = true; improved;) {
		improved = false;

		for (const entry of entries) {
			const wasDropped = entry.dropped;
			const wasLevel = entry.level;

			if (wasDropped) {
				entry.dropped = false;
				entry.level = RENDERINGS.length - 1;
			} else if (entry.level > 0) {
				entry.level -= 1;
			} else {
				continue;
			}

			const candidate = render();
			if (candidate.length <= limit) {
				text = candidate;
				improved = true;
			} else {
				entry.dropped = wasDropped;
				entry.level = wasLevel;
			}
		}
	}

	const kept = entries.filter((entry) => !entry.dropped);

	return {
		text,
		level: describe(kept.map((entry) => entry.level)),
		dropped: entries.length - kept.length,
		nextStep: cheapestPromotion(entries, render, text.length)
	};
}

/**
 * What the smallest remaining improvement would cost, in characters, or `null` when there is none.
 *
 * This is what makes "the notes are as full as they can be" checkable instead of a matter of
 * opinion. The leftover headroom on its own says nothing — 34 characters spare is a perfect result
 * if the cheapest thing still available costs 120, and a bad one if it costs 12. The two numbers
 * together are the whole statement, and `test/release-notes.test.ts` asserts the relation between
 * them rather than a threshold. A threshold was the first attempt: "within 75% of the budget" fails
 * honestly-reduced entries whose source sentences are simply lumpy, because you cannot invent text.
 */
/**
 * @param {{ groupIndex: number, bullet: string[], level: number, dropped: boolean }[]} entries
 * @param {() => string} render
 * @param {number} current
 * @returns {number | null}
 */
function cheapestPromotion(entries, render, current) {
	let cheapest = null;

	for (const entry of entries) {
		const wasDropped = entry.dropped;
		const wasLevel = entry.level;

		if (wasDropped) {
			entry.dropped = false;
			entry.level = RENDERINGS.length - 1;
		} else if (entry.level > 0) {
			entry.level -= 1;
		} else {
			continue;
		}

		const cost = render().length - current;
		entry.dropped = wasDropped;
		entry.level = wasLevel;

		if (cost > 0 && (cheapest === null || cost < cheapest)) {
			cheapest = cost;
		}
	}

	return cheapest;
}

/** Says how the entries were rendered, in the plainest terms that are still true. */
/**
 * @param {number[]} levels
 * @returns {string}
 */
export function describe(levels) {
	const names = ["in full", "shortened", "shortened", "shortened", "shortened", "headline only"];
	if (levels.length === 0) {
		return "nothing kept";
	}

	// Counted by name, not by level: several levels share a name, and reporting "2 shortened,
	// 1 shortened" would be an implementation detail leaking into a sentence a person reads.
	const order = [...new Set(names)];
	const counts = order.map((name) => levels.filter((level) => names[level] === name).length);

	if (counts.filter((count) => count > 0).length === 1) {
		return order[counts.findIndex((count) => count > 0)];
	}
	return counts
		.map((count, index) => (count === 0 ? null : `${count} ${order[index]}`))
		.filter((part) => part !== null)
		.join(", ");
}

/**
 * @param {{ heading: string | null, lines: string[] }[]} groups
 * @returns {string}
 */
export function format(groups) {
	return groups
		.map((group) => [group.heading === null ? null : `${group.heading}:`, ...group.lines.map((l) => `• ${l}`)])
		.flat()
		.filter((line) => line !== null)
		.join("\n");
}
