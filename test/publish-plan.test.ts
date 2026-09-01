/**
 * What publishing decides to do, and what it refuses.
 *
 * `npm run release` now tags, pushes and creates the GitHub release on its own, which means the
 * decision of *whether* to do each of those is code that runs unattended against a live remote. Every
 * refusal below is a case that must never be found out in production — moving a tag onto a different
 * commit, releasing a dirty tree, overwriting a release that carries a different build, cutting one
 * from a build the gates did not pass — and none of them can be tested by trying it.
 *
 * So the decision is pure and lives in `tools/publish-plan.mjs`, and this drives all of it with no
 * network, no remote and no repository.
 *
 * What it cannot cover is whether the state is gathered correctly, and that gap is not theoretical:
 * every case here passed while `remoteTagSha` was read with a pattern that matched no tag this tool
 * cuts, which made the "someone else cut this version" refusal below dead code. Gathering lives in
 * `tools/git-state.mjs` and is covered by `test/git-state.test.ts` against a scratch repository.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plan } from "../tools/publish-plan.mjs";

const HEAD = "1111111111111111111111111111111111111111";
const OTHER = "2222222222222222222222222222222222222222";
const BUILT = "aaaa000000000000000000000000000000000000";

/** Nothing published yet, a clean tree, and a build the gates passed — the state of a first release. */
const FRESH = {
	version: "9.9.9",
	clean: true,
	headSha: HEAD,
	localTagSha: null,
	remoteTagSha: null,
	releaseExists: false,
	releaseContentId: null,
	builtContentId: BUILT,
	gatesPassed: true
};

/** Everything published already, and the release carries this build. The state of a second run. */
const PUBLISHED = {
	...FRESH,
	localTagSha: HEAD,
	remoteTagSha: HEAD,
	releaseExists: true,
	releaseContentId: BUILT
};

describe("a first release", () => {
	it("does all four acts, in an order a tag can survive", () => {
		const { blocked, todo } = plan(FRESH);

		assert.equal(blocked, null);
		assert.deepEqual(todo, ["tag", "pushBranch", "pushTag", "createRelease"]);
	});

	it("pushes the branch before the tag, so the tag names a commit the remote has", () => {
		const { todo } = plan(FRESH);

		assert.ok(todo.indexOf("pushBranch") < todo.indexOf("pushTag"));
		assert.ok(todo.indexOf("pushTag") < todo.indexOf("createRelease"));
	});
});

describe("running it again", () => {
	it("does nothing when everything is already published", () => {
		const { blocked, todo, done } = plan({
			...FRESH,
			localTagSha: HEAD,
			remoteTagSha: HEAD,
			releaseExists: true,
			releaseContentId: BUILT
		});

		assert.equal(blocked, null);
		assert.deepEqual(todo, ["pushBranch"], "only the branch push, which is a no-op git reports as up to date");
		assert.deepEqual(done, ["tag", "pushTag", "createRelease"]);
	});

	it("finishes a half-done publish rather than starting over", () => {
		// The v3.2.0 shape exactly: tagged and pushed, no GitHub release. Idempotence is what lets the
		// same command be the fix for that as well as the thing that does it in the first place.
		const { blocked, todo } = plan({ ...FRESH, localTagSha: HEAD, remoteTagSha: HEAD });

		assert.equal(blocked, null);
		assert.deepEqual(todo, ["pushBranch", "createRelease"]);
	});

	it("pushes a tag that exists locally but never reached the remote", () => {
		const { todo } = plan({ ...FRESH, localTagSha: HEAD });

		assert.deepEqual(todo, ["pushBranch", "pushTag", "createRelease"]);
	});
});

describe("what it refuses to do", () => {
	it("will not publish a dirty tree", () => {
		const { blocked, todo } = plan({ ...FRESH, clean: false });

		assert.match(blocked as string, /uncommitted/);
		assert.deepEqual(todo, ["pushBranch"], "nothing that names this version — but the commits still go up");
	});

	it("will not move a tag that already names a different commit", () => {
		// Moving it rewrites which commit a released version *is*, for everyone who has fetched it.
		const { blocked } = plan({ ...FRESH, localTagSha: OTHER });

		assert.match(blocked as string, /already tags/);
		assert.match(blocked as string, /bump the version/);
	});

	it("will not move a tag someone else pushed to a different commit", () => {
		const { blocked } = plan({ ...FRESH, remoteTagSha: OTHER });

		assert.match(blocked as string, /someone else cut this version/);
	});

	it("will not carry on when the published release is a different build", () => {
		// The one that cannot be repaired: the packed file is gitignored, so once a release carries
		// the wrong build there is no copy of the right one left to put back.
		const { blocked } = plan({
			...FRESH,
			localTagSha: HEAD,
			remoteTagSha: HEAD,
			releaseExists: true,
			releaseContentId: "bbbb000000000000000000000000000000000000"
		});

		assert.match(blocked as string, /different build/);
	});

	it("names both ids when it refuses over a build mismatch, so the report is actionable", () => {
		const { blocked } = plan({
			...FRESH,
			releaseExists: true,
			releaseContentId: "bbbb000000000000000000000000000000000000"
		});

		assert.ok((blocked as string).includes("bbbb00000"));
		assert.ok((blocked as string).includes("aaaa00000"));
	});
});

describe("the branch push, which is not about this version", () => {
	it("still happens when publishing is refused", () => {
		// A run that correctly declines to move a tag must not also leave committed work unpushed —
		// that is the opposite of what asking for it to be automatic was for.
		for (const state of [
			{ ...FRESH, clean: false },
			{ ...FRESH, localTagSha: OTHER },
			{ ...FRESH, remoteTagSha: OTHER }
		]) {
			const { blocked, todo } = plan(state);

			assert.ok(blocked !== null, "precondition: this state is refused");
			assert.deepEqual(todo, ["pushBranch"]);
		}
	});

	it("is the only thing left once everything else is published", () => {
		const { todo } = plan({
			...FRESH,
			localTagSha: HEAD,
			remoteTagSha: HEAD,
			releaseExists: true,
			releaseContentId: BUILT
		});

		assert.deepEqual(todo, ["pushBranch"]);
	});
});

describe("a build the gates did not pass", () => {
	it("withholds everything that would cut a release, and says which", () => {
		// The bug this closes: the verdict used to be read *after* publishing, so a red test suite was
		// tagged, pushed and released and then told not to be. `--no-gates` arrives here too, having
		// never built the package it would have published.
		const { blocked, todo } = plan({ ...FRESH, gatesPassed: false });

		assert.match(blocked as string, /gates did not pass/);
		assert.match(blocked as string, /tag, pushTag, createRelease were withheld/);
		assert.deepEqual(todo, ["pushBranch"]);
	});

	it("still pushes the branch, on the same grounds as every other refusal", () => {
		const { todo } = plan({ ...FRESH, gatesPassed: false });

		assert.deepEqual(todo, ["pushBranch"], "committed work should not sit unpushed because a gate went red");
	});

	it("stays silent when there was nothing left to cut — the `--no-gates` page re-run", () => {
		// The flow docs/releasing.md prescribes: publish, then run again with --no-gates to refresh
		// the page so the publish check reads as done. Nothing is withheld because nothing is left,
		// and the run must come out green rather than reporting a refusal it did not make.
		const { blocked, todo } = plan({ ...PUBLISHED, gatesPassed: false });

		assert.equal(blocked, null);
		assert.deepEqual(todo, ["pushBranch"]);
	});

	it("names only the acts actually outstanding", () => {
		// Half published: the tag is up, the release is not. The withheld list is the remainder, not
		// the whole set, so the message says what this run would have done.
		const { blocked } = plan({ ...FRESH, gatesPassed: false, localTagSha: HEAD, remoteTagSha: HEAD });

		assert.match(blocked as string, /createRelease was withheld/);
	});

	it("does not mask a refusal that is about the version rather than the build", () => {
		// A dirty tree with red gates is still reported as the dirty tree: that refusal comes first
		// and is the more specific thing to fix.
		const { blocked } = plan({ ...FRESH, gatesPassed: false, clean: false });

		assert.match(blocked as string, /uncommitted/);
	});
});

describe("what it treats as unknown rather than as a conflict", () => {
	it("does not refuse because the published asset could not be read", () => {
		// A download that failed is not evidence the builds differ. Refusing here would let a flaky
		// network invent a conflict, and the whole point of running unattended is that it does not.
		const { blocked, todo } = plan({
			...FRESH,
			localTagSha: HEAD,
			remoteTagSha: HEAD,
			releaseExists: true,
			releaseContentId: null
		});

		assert.equal(blocked, null);
		assert.deepEqual(todo, ["pushBranch"]);
	});

	it("does not refuse when nothing was built to compare", () => {
		const { blocked } = plan({
			...FRESH,
			releaseExists: true,
			releaseContentId: "bbbb000000000000000000000000000000000000",
			builtContentId: null
		});

		assert.equal(blocked, null);
	});

	it("still refuses when both ids are known and differ", () => {
		// The positive control for the two above: with the unknowns removed, the refusal must fire.
		const { blocked } = plan({
			...FRESH,
			releaseExists: true,
			releaseContentId: "bbbb000000000000000000000000000000000000",
			builtContentId: BUILT
		});

		assert.match(blocked as string, /different build/);
	});
});

describe("what it says it is doing", () => {
	it("gives every act a reason, whether it will run or not", () => {
		const { reasons } = plan({ ...FRESH, localTagSha: HEAD });

		assert.match(reasons.tag, /already tags this commit/);
		assert.match(reasons.pushTag, /push v9\.9\.9/);
		assert.match(reasons.createRelease, /create the GitHub release/);
	});
});
