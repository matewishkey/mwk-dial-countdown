/**
 * What publishing decides to do, and what it refuses.
 *
 * `npm run release` now tags, pushes and creates the GitHub release on its own, which means the
 * decision of *whether* to do each of those is code that runs unattended against a live remote. Every
 * refusal below is a case that must never be found out in production — moving a tag onto a different
 * commit, releasing a dirty tree, overwriting a release that carries a different build — and none of
 * them can be tested by trying it.
 *
 * So the decision is pure and lives in `tools/publish-plan.mjs`, and this drives all of it with no
 * network, no remote and no repository.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plan } from "../tools/publish-plan.mjs";

const HEAD = "1111111111111111111111111111111111111111";
const OTHER = "2222222222222222222222222222222222222222";
const BUILT = "aaaa000000000000000000000000000000000000";

/** Nothing published yet, a clean tree, and a build in hand — the state of a first release. */
const FRESH = {
	version: "9.9.9",
	clean: true,
	headSha: HEAD,
	localTagSha: null,
	remoteTagSha: null,
	releaseExists: false,
	releaseContentId: null,
	builtContentId: BUILT
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
		assert.deepEqual(todo, [], "and it does nothing at all, rather than doing the harmless-looking half");
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
