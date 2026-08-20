#!/usr/bin/env node
/**
 * Checks that the three places a version is written agree with each other.
 *
 * There are three, and they do not share a format:
 *
 * - `package.json` — `1.1.0`, three parts.
 * - `manifest.json` — `1.1.0.0`, four. This is the one the Stream Deck application shows the user.
 * - the git tag — `v1.1.0`.
 *
 * They have drifted before, and expensively: the manifest sat at `0.1.0.0` through nine releases, so
 * the application reported the same version whichever build was installed — the one question it is
 * ever asked. Nothing caught it, because nothing was looking.
 *
 *   node tools/check-version.mjs            # the two files must agree
 *   node tools/check-version.mjs v1.2.0     # ...and must match the tag you are about to cut
 *
 * Exits non-zero on a mismatch, so it can gate a release. See docs/releasing.md.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const read = (path) => JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));

const pkg = read("package.json").version;
const manifest = read("com.matewishkey.dial-countdown-v2.sdPlugin/manifest.json").Version;
const tag = process.argv[2];

const problems = [];

if (!/^\d+\.\d+\.\d+$/.test(pkg)) {
	problems.push(`package.json version "${pkg}" is not three numbers`);
}

// Stream Deck wants four parts. The fourth is a build number this project has no use for, so it is
// held at 0 and the first three mirror the tag — see docs/releasing.md.
if (manifest !== `${pkg}.0`) {
	problems.push(`manifest Version "${manifest}" should be "${pkg}.0", to match package.json`);
}

if (tag !== undefined && tag !== `v${pkg}`) {
	problems.push(`tag "${tag}" should be "v${pkg}", to match package.json`);
}

if (problems.length > 0) {
	console.error("✗ version mismatch\n");
	for (const problem of problems) {
		console.error(`  ${problem}`);
	}
	console.error("\n  Fix all three together: package.json, manifest.json, and the tag you cut.");
	process.exit(1);
}

console.log(`✔ ${pkg} — package.json ${pkg}, manifest ${manifest}${tag === undefined ? "" : `, tag ${tag}`}`);
