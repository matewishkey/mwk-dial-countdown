#!/usr/bin/env node
/**
 * The release, start to finish, in one command and one order.
 *
 *   npm run release              # build, pack, gate, verify, write the page
 *   npm run release -- --no-gates   # rebuild the page from logs/, when only wording changed
 *   npm run release -- --out <dir>  # somewhere other than the shared drive
 *
 * **It exists because a release done by hand is a release done in a different order each time.**
 * v3.2.0 proved it: the tag was pushed, the page was generated, the Marketplace submission went in
 * off that page — and `gh release create` was never run, so the version in front of Elgato had no
 * artefact of record. Nothing was broken and nothing complained, because each step succeeded on its
 * own. The steps were fine; the sequence was the bug.
 *
 * So the sequence is code now. Every step runs, in this order, and the first failure stops the run:
 *
 *   1. `npm run check`       typecheck, lint, format, tests, version agreement
 *   2. `check-version v…`    ...and the tag about to be cut, which `check` cannot know
 *   3. `npm run build`       rollup → bin/
 *   4. `streamdeck pack`     ...and `prettier`, because pack rewrites the manifest on its way past
 *   5. `streamdeck validate` structural: schema, files, sizes. A floor, not a review
 *   6. `npm run demo`        the built plugin, end to end, over a real socket
 *   7. `release`             is it published, and is it the same plugin? (see below)
 *
 * The whole of each step's output is kept in `logs/` and copied beside the page. `npm run check`
 * prints 289 passing tests nobody reads, right up until the release where one of them did not pass
 * and the question is which.
 *
 * ## What "deterministic" can and cannot mean here
 *
 * **The bundle is reproducible; the package is not, and cannot be made so.** `rollup` emits a
 * byte-identical `bin/plugin.js` from the same source. `streamdeck pack` then writes the moment of
 * packing into every zip entry, so two packs of that identical tree differ — measured at 21 of 21
 * entries with matching content and 21 of 21 with differing timestamps. Normalising the source
 * tree's mtimes first does not help: the stamp is the pack time, not the file's.
 *
 * So a release is identified by its **content id** — `tools/package-id.mjs`, a hash over every
 * entry's path and content with the meaningless timestamps left out. Same tree in, same id out. The
 * container's own sha256 is still recorded, because it answers a different and narrower question:
 * whether the *file* that was uploaded is the file that was built.
 *
 * ## Step 7, and why it is a gate rather than a note
 *
 * It asks GitHub two things: does a release exist for this version, and is its asset the same plugin
 * as the one just built. Three outcomes, not two — no release yet is the expected state on the first
 * run and is reported as work still to do, not as a failure; a release whose content id *differs* is
 * loud, because that one cannot be repaired after the fact. The packed file is gitignored, so once
 * the wrong build is the release asset there is no copy of the right one to put back.
 *
 * Needs `gh` and a network, so it degrades to "not checked" rather than failing an offline build.
 * Every other step is local, deliberately. And it verifies **GitHub, not Marketplace** — the listing
 * cannot be inspected from here at all, which is the whole reason the notes on the page are notes to
 * paste rather than something automated.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { contentId } from "./package-id.mjs";
import { changelogSection, fitNotes, NOT_FOR_MARKETPLACE, NOTES_LIMIT, parseSection } from "./release-notes.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_UUID = "com.matewishkey.dial-countdown-v2";
const PLUGIN_DIR = `${PLUGIN_UUID}.sdPlugin`;
const PACKAGE = `${PLUGIN_UUID}.streamDeckPlugin`;

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
 * The steps, in the order `docs/releasing.md` runs them.
 *
 * `demo` is here and not only in CI because it is the one that drives the *built* plugin end to end
 * over a real WebSocket. The unit tests deliberately do not, so a bundle that fails to load at all
 * passes every one of them.
 *
 * `pack` is two commands rather than one on purpose: it rewrites `manifest.json` in place as it
 * goes, re-emitting the JSON in formatting the repo does not keep, so the commit being tagged fails
 * CI on formatting. That is how v3.1.0 was tagged on a red build. Pairing them here is what stops it
 * depending on somebody remembering.
 */
const GATES = [
	{ id: "check", label: "npm run check", argv: ["npm", "run", "check"] },
	{ id: "version", label: `check-version v${version}`, argv: ["node", "tools/check-version.mjs", `v${version}`] },
	{ id: "build", label: "npm run build", argv: ["npm", "run", "build"] },
	{
		id: "pack",
		label: "streamdeck pack",
		argv: ["npx", "streamdeck", "pack", PLUGIN_DIR, "--force"],
		then: ["npx", "prettier", "--write", `${PLUGIN_DIR}/manifest.json`]
	},
	{ id: "validate", label: "streamdeck validate", argv: ["npx", "streamdeck", "validate", PLUGIN_DIR] },
	{ id: "demo", label: "npm run demo", argv: ["npm", "run", "demo"] }
];

// ── Gates ────────────────────────────────────────────────────────────────────

const logDir = resolve(ROOT, "logs");
mkdirSync(logDir, { recursive: true });

/** Runs one step, keeping every line of it. `stdio: pipe` merges the two streams in order. */
function runGate(gate) {
	const started = Date.now();
	const runs = [gate.argv, ...(gate.then === undefined ? [] : [gate.then])];

	let output = "";
	let status = 0;

	for (const argv of runs) {
		const run = spawnSync(argv[0], argv.slice(1), { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
		output += `$ ${argv.join(" ")}\n\n${run.stdout ?? ""}${run.stderr ?? ""}\n`;
		status = run.status ?? 1;
		if (status !== 0) {
			break;
		}
	}

	writeFileSync(resolve(logDir, `${gate.id}.log`), output);
	return {
		...gate,
		path: resolve(logDir, `${gate.id}.log`),
		passed: status === 0,
		seconds: Math.round((Date.now() - started) / 100) / 10
	};
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

// ── The package, and what identifies it ──────────────────────────────────────

const packaged = resolve(ROOT, PACKAGE);
const hasPackage = existsSync(packaged);
const packageBytes = hasPackage ? readFileSync(packaged) : null;
const sha = hasPackage ? createHash("sha256").update(packageBytes).digest("hex") : null;
const id = hasPackage ? contentId(packageBytes) : null;

if (hasPackage) {
	console.log(`  content id      ${id}`);
	console.log(`  file sha256     ${sha}`);
}

// ── Step 7: is it published, and is it this build? ───────────────────────────

/**
 * Compares the published release against what was just built.
 *
 * @returns `state` of `"none"` (nothing published yet — expected, and work still to do), `"match"`,
 * `"differs"` (loud: unrepairable, since the packed file is gitignored), or `"unchecked"` when `gh`
 * or the network is unavailable and the run must not fail for it.
 */
function checkPublished() {
	if (!hasPackage) {
		return { state: "unchecked", detail: "nothing packed to compare against" };
	}

	const view = spawnSync("gh", ["release", "view", `v${version}`, "--json", "tagName"], {
		cwd: ROOT,
		encoding: "utf8"
	});

	if (view.status !== 0) {
		const stderr = view.stderr ?? "";
		if (/release not found/i.test(stderr)) {
			return { state: "none", detail: `no GitHub release for v${version} yet` };
		}
		return { state: "unchecked", detail: stderr.trim().split("\n")[0] || "gh unavailable" };
	}

	const into = resolve(logDir, "published");
	mkdirSync(into, { recursive: true });
	const got = spawnSync("gh", ["release", "download", `v${version}`, "-D", into, "--clobber"], {
		cwd: ROOT,
		encoding: "utf8"
	});

	const asset = resolve(into, PACKAGE);
	if (got.status !== 0 || !existsSync(asset)) {
		return { state: "unchecked", detail: "the release exists but its asset could not be downloaded" };
	}

	const publishedId = contentId(readFileSync(asset));
	return publishedId === id
		? { state: "match", detail: publishedId }
		: { state: "differs", detail: `published ${publishedId}, built ${id}` };
}

const published = flag("no-gates") ? { state: "unchecked", detail: "--no-gates" } : checkPublished();

const PUBLISHED_WORDING = {
	none: ["✗", "not published yet — `gh release create` has not run"],
	match: ["✔", "published, and the same plugin as this build"],
	differs: ["✗", "PUBLISHED RELEASE IS A DIFFERENT BUILD"],
	unchecked: ["·", "not checked"]
};

console.log(`  ${PUBLISHED_WORDING[published.state][0]} release       ${PUBLISHED_WORDING[published.state][1]}`);

// ── Notes ────────────────────────────────────────────────────────────────────

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

if (hasPackage) {
	copyFileSync(packaged, resolve(out, PACKAGE));
}

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
<table>
	<tr><td><strong>content id</strong><br><span class="hint">what plugin this is — reproducible</span></td><td class="sha">${id}</td></tr>
	<tr><td><strong>file sha256</strong><br><span class="hint">what file this is — changes on every pack</span></td><td class="sha">${sha}</td></tr>
	<tr><td><strong>published</strong></td><td>${
		{
			match: '<span style="color:#4ade80">\u2714</span> the release carries this same plugin',
			none: `<span style="color:#f87171">\u2718</span> no GitHub release for v${version} yet \u2014 <code>gh release create v${version} ${PACKAGE}</code>`,
			differs: `<span style="color:#f87171">\u2718 the published release is a DIFFERENT build</span><br><span class="hint">${escape(published.detail)}</span>`,
			unchecked: `<span class="hint">not checked \u2014 ${escape(published.detail)}</span>`
		}[published.state]
	}</td></tr>
</table>
<p class="hint"><strong>Two hashes, two questions.</strong> The content id is a hash over every file inside the package, ignoring timestamps \u2014 the same source always gives the same id, so it answers <em>is this the same plugin</em>. The file's own sha256 changes on every pack, because <code>streamdeck pack</code> stamps the moment of packing into all 21 entries; it answers only <em>is this the same file I uploaded</em>. The <code>.streamDeckPlugin</code> is gitignored, so this copy and the release asset are the only ones that exist.</p>`
		: `<p class="hint">Not built. Run <code>npm run build &amp;&amp; npx streamdeck pack ${PLUGIN_UUID}.sdPlugin --force</code>, then this page again.</p>`
}

<h2>What is left to do by hand</h2>
<ol>
	<li>Tag and push — <code>git tag v${version} &amp;&amp; git push --tags</code>.</li>
	<li>${
		published.state === "match"
			? `<s>gh release create</s> \u2014 done, and verified as this build.`
			: `<code>gh release create v${version} ${PACKAGE}</code>, notes from the second box above. <strong>Do this before the next one</strong>, not after: the two are separate acts on separate systems with nothing linking them, and v3.2.0 reached Marketplace while this step had never run.`
	}</li>
	<li>Submit to Marketplace through the Maker dashboard, notes from the first box. There is no API for this step, which is the reason this page exists \u2014 and no way to check it from here, so nothing above says anything about the listing.</li>
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
