/**
 * The git half of the publish state, against a real repository.
 *
 * `test/publish-plan.test.ts` drives every refusal the plan can reach and all of them pass — but a
 * plan is only ever as right as the state it is handed, and the state was gathered by glue nothing
 * tested. That is where the bug was: the remote tag was read with a `^{}` pattern, which matches
 * only the peeled ref an *annotated* tag has, while `publish` cuts lightweight ones. The refusal for
 * "someone else cut this version" was unreachable for every tag this tool creates, and the suite
 * stayed green throughout, because the pure part was correct about a value that was always `null`.
 *
 * So this builds a working tree and a bare remote in a temp dir and runs the real commands against
 * them. A bare repo on disk is a real remote as far as `ls-remote` is concerned, so nothing here
 * touches the network — the same reason the plan is tested with no repository at all.
 *
 * The cases run in order and share the fixture, because what is being tested is a sequence a
 * repository actually goes through: tag, push, commit past it.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";

import { gitState, remoteTagSha } from "../tools/git-state.mjs";

let dir: string;
let work: string;
let firstCommit: string;

function git(cwd: string, ...argv: string[]): string {
	return execFileSync("git", argv, { cwd, encoding: "utf8" }).trim();
}

before(() => {
	dir = mkdtempSync(resolve(tmpdir(), "dial-git-state-"));
	work = resolve(dir, "work");

	git(dir, "init", "--bare", "--initial-branch=main", "origin.git");
	git(dir, "init", "--initial-branch=main", "work");
	git(work, "remote", "add", "origin", resolve(dir, "origin.git"));
	git(work, "config", "user.email", "test@example.com");
	git(work, "config", "user.name", "Test");

	writeFileSync(resolve(work, "a.txt"), "one\n");
	git(work, "add", "a.txt");
	git(work, "commit", "-m", "one");
	git(work, "push", "-q", "origin", "main");

	firstCommit = git(work, "rev-parse", "HEAD");
});

after(() => rmSync(dir, { recursive: true, force: true }));

describe("the remote tag", () => {
	it("is absent when the version has never been cut", () => {
		assert.equal(remoteTagSha(work, "1.0.0"), null);
	});

	it("resolves a lightweight tag — the kind `publish` cuts", () => {
		git(work, "tag", "v1.0.0");
		git(work, "push", "-q", "origin", "v1.0.0");

		assert.equal(remoteTagSha(work, "1.0.0"), firstCommit);
	});

	it("resolves an annotated tag to its commit, not to the tag object", () => {
		git(work, "tag", "-a", "v2.0.0", "-m", "two");
		git(work, "push", "-q", "origin", "v2.0.0");

		// The whole reason both patterns are asked for: an annotated tag's own sha is not the commit,
		// and the commit is what gets compared against HEAD. Reading the wrong line here compares a
		// tag object to a commit and concludes they differ, forever.
		assert.notEqual(git(work, "rev-parse", "v2.0.0"), firstCommit);
		assert.equal(remoteTagSha(work, "2.0.0"), firstCommit);
	});

	it("is not confused by a version whose name is a prefix of another", () => {
		assert.equal(remoteTagSha(work, "1.0"), null);
	});
});

describe("the state the plan is handed", () => {
	it("sees a remote tag naming a different commit — the refusal that could not fire", () => {
		writeFileSync(resolve(work, "a.txt"), "two\n");
		git(work, "commit", "-am", "two");

		const state = gitState(work, "1.0.0");

		assert.equal(state.headSha, git(work, "rev-parse", "HEAD"));
		assert.equal(state.remoteTagSha, firstCommit);
		assert.notEqual(state.remoteTagSha, state.headSha);
	});

	it("reads a local tag as the commit it names", () => {
		assert.equal(gitState(work, "1.0.0").localTagSha, firstCommit);
		assert.equal(gitState(work, "2.0.0").localTagSha, firstCommit);
	});

	it("names the branch the tag will need pushed", () => {
		assert.equal(gitState(work, "1.0.0").branch, "main");
	});

	it("reports a clean tree, then a dirty one", () => {
		assert.equal(gitState(work, "1.0.0").clean, true);

		writeFileSync(resolve(work, "a.txt"), "uncommitted\n");
		assert.equal(gitState(work, "1.0.0").clean, false);

		git(work, "checkout", "--", "a.txt");
	});
});
