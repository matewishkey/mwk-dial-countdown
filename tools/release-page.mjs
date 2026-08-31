#!/usr/bin/env node
/**
 * Builds the release page for a version: the gates, their logs, and the notes to paste.
 *
 * Step 10 of `docs/releasing.md` is the one that cannot be automated — Marketplace submission is a
 * form a human fills in, through the Maker dashboard, with no API behind it. So the last thing this
 * project can usefully do for a release is hand that human everything the form wants, in a shape
 * that can be copied rather than retyped: the notes, already trimmed to the limit, and the evidence
 * that the build they describe actually passed.
 *
 * It runs the gates itself rather than trusting that someone ran them. Each one's **complete**
 * output is kept — `npm run check` prints 250-odd passing tests and nobody reads them, right up
 * until the release where one of them did not pass and the question is which. A log nobody reads is
 * not waste; it is the thing you need on the one day you need it.
 *
 *   node tools/release-page.mjs              # the version in package.json
 *   node tools/release-page.mjs --no-gates   # reuse the logs already in logs/, for a page re-run
 *   node tools/release-page.mjs --out <dir>  # somewhere other than the shared drive
 *
 * The page lands on the shared drive under `work/<own>-<repo>/<date>_v<version>/`, which `work.l`
 * serves — never in the repo, which is where code lives and outputs do not. Exits non-zero if a gate
 * failed, so it cannot quietly produce a page for a red build.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_UUID = "com.matewishkey.dial-countdown-v2";
const PACKAGE = `${PLUGIN_UUID}.streamDeckPlugin`;

/**
 * The ceiling on the notes that go to Marketplace.
 *
 * A budget, not a truncation point: the reduction below drops whole sentences and whole bullets to
 * come in under it, so what is left is always something a person wrote and never a word cut in
 * half. See {@link fitNotes}.
 */
const NOTES_LIMIT = 1500;

/**
 * Changelog headings the Marketplace notes leave out.
 *
 * *Internal* is where repo-only work goes — a refactor, a formatting fix, a tool. It belongs in the
 * changelog, because `docs/releasing.md` says repo-only work travels with the next release rather
 * than vanishing; it does not belong in front of somebody deciding whether to install an update.
 * The GitHub notes keep it, since that audience is the one it was written for.
 */
const NOT_FOR_MARKETPLACE = ["Internal"];

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
	const at = args.indexOf(`--${name}`);
	return at === -1 || at === args.length - 1 ? fallback : args[at + 1];
};

const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const version = value("version", pkg.version);
const today = new Date().toISOString().slice(0, 10);

/**
 * The gates, in the order `docs/releasing.md` runs them.
 *
 * `demo` is here and not only in CI because it is the one that drives the *built* plugin end to end
 * over a real WebSocket. The unit tests deliberately do not, so a bundle that fails to load at all
 * passes every one of them.
 */
const GATES = [
	{ id: "check", label: "npm run check", argv: ["npm", "run", "check"] },
	{ id: "version", label: `check-version v${version}`, argv: ["node", "tools/check-version.mjs", `v${version}`] },
	{ id: "validate", label: "streamdeck validate", argv: ["npx", "streamdeck", "validate", `${PLUGIN_UUID}.sdPlugin`] },
	{ id: "demo", label: "npm run demo", argv: ["npm", "run", "demo"] }
];

// ── Gates ────────────────────────────────────────────────────────────────────

const logDir = resolve(ROOT, "logs");
mkdirSync(logDir, { recursive: true });

/** Runs one gate, keeping every line of it. `stdio: pipe` merges the two streams in order. */
function runGate(gate) {
	const started = Date.now();
	const run = spawnSync(gate.argv[0], gate.argv.slice(1), { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	const output = `$ ${gate.argv.join(" ")}\n\n${run.stdout ?? ""}${run.stderr ?? ""}`;
	const path = resolve(logDir, `${gate.id}.log`);
	writeFileSync(path, output);

	return { ...gate, path, passed: run.status === 0, seconds: Math.round((Date.now() - started) / 100) / 10 };
}

const gates = GATES.map((gate) => {
	if (flag("no-gates")) {
		const path = resolve(logDir, `${gate.id}.log`);
		if (!existsSync(path)) {
			console.error(`✗ --no-gates, but logs/${gate.id}.log does not exist — run once without it first`);
			process.exit(1);
		}
		return { ...gate, path, passed: null, seconds: null };
	}

	process.stdout.write(`  ${gate.label} … `);
	const result = runGate(gate);
	console.log(result.passed ? `✔ ${result.seconds}s` : `✗ ${result.seconds}s — see logs/${gate.id}.log`);
	return result;
});

// ── Notes ────────────────────────────────────────────────────────────────────

/**
 * The version's own section of the changelog, verbatim.
 *
 * The changelog is already written for whoever installs the plugin — `docs/releasing.md` insists on
 * it — so it is the source rather than the git log, which is written for whoever maintains it.
 */
function changelogSection(text, forVersion) {
	const start = text.indexOf(`## [${forVersion}]`);
	if (start === -1) {
		return null;
	}
	const next = text.indexOf("\n## ", start + 1);
	return text.slice(start, next === -1 ? undefined : next).trim();
}

/** Splits a changelog section into its `### Heading` groups and their bullets. */
function parseSection(section) {
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
function plain(markdown) {
	return markdown
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/[_*`]/g, "")
		.replace(/\s*\n\s*/g, " ")
		.replace(/\s{2,}/g, " ")
		.trim();
}

/** The first sentence of a bullet — up to the first full stop that ends one. */
function firstSentence(text) {
	const end = text.search(/\.(?=\s|$)/);
	return end === -1 ? text : text.slice(0, end + 1);
}

/** The bold lead a changelog bullet opens with, or its first sentence when it has none. */
function lead(bulletMarkdown) {
	const bold = bulletMarkdown.match(/^- \*\*(.+?)\*\*([.,]?)/s);
	return bold === null ? firstSentence(plain(bulletMarkdown.replace(/^- /, ""))) : `${plain(bold[1])}.`;
}

/**
 * How a single entry can be rendered, fullest first.
 *
 * The last of the three is the changelog's own shape rather than a guess — every entry opens with a
 * bold summary precisely so it can be read at a glance, which makes "the top of it" something the
 * format already knows how to give.
 */
const RENDERINGS = [
	(bullet) => plain(bullet[0].replace(/^- /, "")),
	(bullet) => firstSentence(plain(bullet[0].replace(/^- /, ""))),
	(bullet) => lead(bullet[0])
];

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
function fitNotes(groups, limit) {
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

	const kept = entries.filter((entry) => !entry.dropped);
	return {
		text,
		level: describe(kept.map((entry) => entry.level)),
		dropped: entries.length - kept.length
	};
}

/** Says how the entries were rendered, in the plainest terms that are still true. */
function describe(levels) {
	const names = ["in full", "shortened", "headline only"];
	const counts = names.map((_, level) => levels.filter((value) => value === level).length);

	if (levels.length === 0) {
		return "nothing kept";
	}
	if (counts.filter((count) => count > 0).length === 1) {
		return names[counts.findIndex((count) => count > 0)];
	}
	return counts
		.map((count, level) => (count === 0 ? null : `${count} ${names[level]}`))
		.filter((part) => part !== null)
		.join(", ");
}

function format(groups) {
	return groups
		.map((group) => [group.heading === null ? null : `${group.heading}:`, ...group.lines.map((l) => `• ${l}`)])
		.flat()
		.filter((line) => line !== null)
		.join("\n");
}

const changelog = readFileSync(resolve(ROOT, "CHANGELOG.md"), "utf8");
const section = changelogSection(changelog, version);

if (section === null) {
	console.error(`✗ CHANGELOG.md has no "## [${version}]" section — move the Unreleased entries under it first`);
	process.exit(1);
}

const groups = parseSection(section);
const forListing = groups.filter((group) => !NOT_FOR_MARKETPLACE.includes(group.heading));
const notes = fitNotes(forListing, NOTES_LIMIT);
const full = section.split("\n").slice(1).join("\n").trim();

// ── The page ─────────────────────────────────────────────────────────────────

/** `matewishkey/mwk-dial-countdown` → `mat-mwk-dial-countdown`, the shared drive's own layout. */
function shareFolder() {
	const remote = spawnSync("git", ["remote", "get-url", "origin"], { cwd: ROOT, encoding: "utf8" }).stdout ?? "";
	const match = remote.trim().match(/[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
	if (match === null) {
		throw new Error(`cannot read owner and repo from origin: "${remote.trim()}"`);
	}
	return `${match[1].slice(0, 3).toLowerCase()}-${match[2]}`;
}

const out = resolve(value("out", resolve(homedir(), "share/work", shareFolder(), `${today}_v${version}`)));
mkdirSync(out, { recursive: true });

/** Everything downloadable, copied beside the page rather than linked into a directory that moves. */
const files = [];

for (const gate of gates) {
	const name = `${gate.id}.log`;
	copyFileSync(gate.path, resolve(out, name));
	files.push({ name, label: gate.label, bytes: statSync(gate.path).size, gate });
}

const packaged = resolve(ROOT, PACKAGE);
const hasPackage = existsSync(packaged);
if (hasPackage) {
	copyFileSync(packaged, resolve(out, PACKAGE));
}
const sha = hasPackage ? createHash("sha256").update(readFileSync(packaged)).digest("hex") : null;

const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const kb = (bytes) => `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} kB`;
const failed = gates.filter((gate) => gate.passed === false);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dial Countdown v${version}</title>
<style>
	:root { color-scheme: dark; }
	body { background: #131316; color: #d8d8d8; font: 15px/1.6 system-ui, sans-serif; margin: 0; padding: 32px 24px 64px; }
	main { max-width: 860px; margin: 0 auto; }
	h1 { font-size: 30px; margin: 0 0 4px; letter-spacing: -0.01em; }
	h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #808088;
	     border-top: 1px solid #2a2a30; padding-top: 14px; margin: 40px 0 14px; }
	.sub { color: #808088; margin: 0 0 8px; }
	.verdict { display: inline-block; border-radius: 999px; padding: 3px 12px; font-size: 13px; font-weight: 600; }
	.pass { background: #10331f; color: #4ade80; }
	.fail { background: #3a1418; color: #f87171; }
	table { border-collapse: collapse; width: 100%; }
	td, th { text-align: left; padding: 8px 12px 8px 0; border-bottom: 1px solid #232329; font-size: 14px; }
	th { color: #808088; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
	a { color: #56b6f0; }
	.box { position: relative; background: #1c1c21; border: 1px solid #2c2c34; border-radius: 8px; padding: 16px 16px 14px; }
	.box pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: 13px/1.55 ui-monospace, monospace; color: #e4e4e8; }
	/* The full entry runs to thousands of characters and would otherwise bury the gates below it. */
	.box pre.long { max-height: 340px; overflow: auto; }
	.boxbar { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
	.count { color: #808088; font-size: 12px; font-variant-numeric: tabular-nums; }
	.over { color: #f87171; }
	button { background: #2d6cae; border: 0; border-radius: 5px; color: #fff; font: inherit; font-size: 13px;
	         padding: 5px 14px; cursor: pointer; }
	button:hover { background: #3a83cc; }
	button.done { background: #10331f; color: #4ade80; }
	code { background: #1c1c21; border-radius: 4px; padding: 1px 5px; font-size: 13px; }
	.hint { color: #808088; font-size: 13px; }
	.sha { font: 12px ui-monospace, monospace; color: #808088; word-break: break-all; }
</style>
</head>
<body>
<main>

<h1>Dial Countdown v${version}</h1>
<p class="sub">${today} · <span class="verdict ${failed.length === 0 ? "pass" : "fail"}">${
	failed.length === 0 ? "all gates passed" : `${failed.length} gate${failed.length === 1 ? "" : "s"} failed`
}</span></p>

<h2>Marketplace release notes — ${NOTES_LIMIT} characters</h2>
<p class="hint">Paste into the Maker dashboard. ${escape(
	`Reduced to ${notes.level}${notes.dropped > 0 ? `, ${notes.dropped} entr${notes.dropped === 1 ? "y" : "ies"} dropped` : ""}.`
)} ${
	groups.length === forListing.length
		? ""
		: `The <em>${NOT_FOR_MARKETPLACE.join("</em>, <em>")}</em> section is left out. `
}The full text is below and in the changelog.</p>
<div class="box">
	<div class="boxbar">
		<button data-copy="notes">Copy</button>
		<span class="count" id="notes-count"></span>
	</div>
	<pre id="notes">${escape(notes.text)}</pre>
</div>

<h2>GitHub release notes — the whole entry</h2>
<p class="hint">For <code>gh release create v${version}</code>. Markdown, no limit.</p>
<div class="box">
	<div class="boxbar">
		<button data-copy="full">Copy</button>
		<span class="count" id="full-count"></span>
	</div>
	<pre id="full" class="long">${escape(full)}</pre>
</div>

<h2>Gates</h2>
<table>
	<tr><th>Gate</th><th>Result</th><th>Log</th></tr>
	${gates
		.map((gate, index) => {
			const file = files[index];
			const result =
				gate.passed === null
					? '<span class="hint">not re-run</span>'
					: gate.passed
						? `<span style="color:#4ade80">✔</span> <span class="hint">${gate.seconds}s</span>`
						: '<span style="color:#f87171">✗ failed</span>';
			return `<tr><td><code>${escape(gate.label)}</code></td><td>${result}</td><td><a href="${file.name}" download>${file.name}</a> <span class="hint">${kb(file.bytes)}</span></td></tr>`;
		})
		.join("\n\t")}
</table>

<h2>The package</h2>
${
	hasPackage
		? `<p><a href="${PACKAGE}" download>${PACKAGE}</a> <span class="hint">${kb(statSync(packaged).size)}</span></p>
<p class="sha">sha256 ${sha}</p>
<p class="hint">This is the file that goes to Marketplace, and the one to attach to the GitHub release. The <code>.streamDeckPlugin</code> is gitignored, so this copy and the release asset are the only ones there are.</p>`
		: `<p class="hint">Not built. Run <code>npm run build &amp;&amp; npx streamdeck pack ${PLUGIN_UUID}.sdPlugin --force</code>, then this page again.</p>`
}

<h2>What is left to do by hand</h2>
<ol>
	<li>Tag and push — <code>git tag v${version} &amp;&amp; git push --tags</code>.</li>
	<li><code>gh release create v${version} ${PACKAGE}</code>, notes from the second box above.</li>
	<li>Submit to Marketplace through the Maker dashboard, notes from the first box. There is no API for this step, which is the reason this page exists.</li>
</ol>

</main>
<script>
	for (const pre of document.querySelectorAll("pre")) {
		const count = document.getElementById(pre.id + "-count");
		if (count === null) continue;
		const n = pre.textContent.length;
		count.textContent = n + " characters" + (pre.id === "notes" ? " of ${NOTES_LIMIT}" : "");
		if (pre.id === "notes" && n > ${NOTES_LIMIT}) count.className = "count over";
	}

	// Plain text, so a paste into a form or into Gmail arrives clean. execCommand is the fallback for
	// a context where the async clipboard is unavailable; it is deprecated and it still works.
	for (const button of document.querySelectorAll("[data-copy]")) {
		button.addEventListener("click", async () => {
			const text = document.getElementById(button.dataset.copy).textContent;
			try {
				await navigator.clipboard.writeText(text);
			} catch {
				const area = document.createElement("textarea");
				area.value = text;
				document.body.append(area);
				area.select();
				document.execCommand("copy");
				area.remove();
			}
			button.textContent = "Copied";
			button.classList.add("done");
			setTimeout(() => { button.textContent = "Copy"; button.classList.remove("done"); }, 1600);
		});
	}
</script>
</body>
</html>
`;

writeFileSync(resolve(out, "report.html"), html);

const readme = `# Dial Countdown v${version} — release page :package:

${failed.length === 0 ? ":white_check_mark: All gates passed." : `:x: ${failed.length} gate(s) failed: ${failed.map((g) => g.label).join(", ")}.`}

**:point_right: [report.html](report.html)** — the notes to paste, with a Copy button on each, and the gate results.

| | |
| --- | --- |
${files.map((f) => `| [${f.name}](${f.name}) | \`${f.label}\` — ${kb(f.bytes)} |`).join("\n")}
${hasPackage ? `| [${PACKAGE}](${PACKAGE}) | The packaged plugin — ${kb(statSync(packaged).size)} |` : ""}

Marketplace notes came to **${notes.text.length} of ${NOTES_LIMIT} characters** (${notes.level}${notes.dropped > 0 ? `, ${notes.dropped} dropped` : ""}).

Generated by \`node tools/release-page.mjs\`; see [docs/releasing.md](https://github.com/matewishkey/mwk-dial-countdown/blob/main/docs/releasing.md).
`;

writeFileSync(resolve(out, "README.md"), readme);

console.log(
	`\n  notes    ${notes.text.length}/${NOTES_LIMIT} characters — ${notes.level}${notes.dropped > 0 ? `, ${notes.dropped} dropped` : ""}`
);
console.log(`  page     ${resolve(out, "report.html")}`);

if (failed.length > 0) {
	console.error(`\n✗ ${failed.map((gate) => gate.label).join(", ")} failed — the page says so, but do not cut this`);
	process.exit(1);
}

console.log(`\n✔ v${version} — every gate passed`);
