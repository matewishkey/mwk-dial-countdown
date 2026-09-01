#!/usr/bin/env node
/**
 * The local git facts a publish decision is made from — here, rather than inline, so they can be
 * tested against a real repository.
 *
 * `tools/publish-plan.mjs` is pure and `test/publish-plan.test.ts` drives every refusal it can
 * reach. All of them passed, and one of them could never fire: the remote tag was read with
 * `git ls-remote --tags origin "v<version>^{}"`, and `^{}` matches only the peeled ref that an
 * **annotated** tag has. `publish` cuts lightweight tags, so the answer was always empty, the plan
 * always read "no tag on the remote", and the refusal for a version someone else had already cut was
 * unreachable. Nothing failed, because a pure function cannot be wrong about a value it is handed —
 * the bug was in the untested glue that handed it one.
 *
 * So this half runs against a real repository too. `test/git-state.test.ts` builds one — a working
 * tree and a bare remote in a temp dir — instead of mocking git; a bare repo on disk is a real
 * remote as far as `ls-remote` is concerned, so none of it needs a network.
 *
 * The GitHub half of the state — whether a release exists and what it carries — genuinely does need
 * `gh` and a network, and stays in `tools/release.mjs`.
 */

import { spawnSync } from "node:child_process";

/** Runs a git command in `cwd`, returning its trimmed stdout, or `null` if it failed. */
function git(cwd, ...argv) {
	const result = spawnSync("git", argv, { cwd, encoding: "utf8" });
	return result.status === 0 ? (result.stdout ?? "").trim() : null;
}

/**
 * What `v<version>` points at on the remote, or `null` when it is not there.
 *
 * Asked with both patterns because the two kinds of tag answer differently. An annotated tag has a
 * tag object *and* a peeled `^{}` ref, and it is the peeled one that names the commit; a lightweight
 * tag has only itself, and that already names the commit. Taking the peeled line where there is one
 * and the plain line otherwise resolves both kinds to the commit — which is what gets compared
 * against HEAD, so anything else is comparing a sha to a different kind of sha.
 *
 * Measured on this repo: v3.1.0 is annotated and answers twice, `b8df444` for the tag object and
 * `c7eff94` for the commit, and `git rev-list -n 1 v3.1.0` is `c7eff94`. v3.3.0 is lightweight and
 * answers once.
 *
 * @param {string} cwd
 * @param {string} version
 * @returns {string | null}
 */
export function remoteTagSha(cwd, version) {
	const lines = git(cwd, "ls-remote", "--tags", "origin", `v${version}`, `v${version}^{}`);
	if (lines === null || lines === "") {
		return null;
	}

	const rows = lines.split("\n").map((line) => line.split(/\s+/));
	const peeled = rows.find((row) => row[1] !== undefined && row[1].endsWith("^{}"));

	return (peeled ?? rows[0])[0];
}

/**
 * The local half of the state `plan()` decides from, plus the branch to push.
 *
 * Every `null` here means *absent* — no tag, no commit — never *unknown*: a failed git call and an
 * empty answer are the same thing to the caller, and the plan reads absence as "this act is still to
 * do". The one exception is `clean`, where a git that failed answers `false` and so refuses, because
 * being unable to tell whether the tree is dirty is not a reason to tag it.
 *
 * @param {string} cwd
 * @param {string} version
 */
export function gitState(cwd, version) {
	return {
		branch: git(cwd, "rev-parse", "--abbrev-ref", "HEAD") ?? "HEAD",
		clean: git(cwd, "status", "--porcelain") === "",
		headSha: git(cwd, "rev-parse", "HEAD") ?? "",
		localTagSha: git(cwd, "rev-list", "-n", "1", `v${version}`),
		remoteTagSha: remoteTagSha(cwd, version)
	};
}
