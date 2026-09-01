#!/usr/bin/env node
/**
 * What is left to do to publish a version — decided here, done in `tools/release.mjs`.
 *
 * Publishing is four acts across two systems: a tag, a branch push, a tag push, and a GitHub
 * release. **They can each succeed while the release as a whole is half done**, which is not
 * hypothetical — v3.2.0 was tagged and pushed and reached Marketplace with no GitHub release behind
 * it, and nothing complained, because every individual step had worked.
 *
 * So the sequence is not a script that runs top to bottom. It is a **plan computed from the current
 * state**: each act is done only if it is not already done, which makes the whole thing idempotent.
 * Run it once and it publishes; run it again and it does nothing and says so. That is what lets it
 * be part of `npm run release` rather than a separate ceremony somebody has to remember not to
 * repeat.
 *
 * It is split out and pure for one reason: the alternative is testing it by publishing things. Every
 * refusal below is a case that must never be discovered in production — force-pushing a tag onto a
 * different commit, releasing a dirty tree, overwriting a release that carries a different build,
 * cutting one from a build the gates did not pass. `test/publish-plan.test.ts` drives all of them
 * with no network and no repository.
 *
 * Pure is not the same as covered, though, and the gap between the two hid a bug for a release:
 * `remoteTagSha` was gathered with a pattern that only matched annotated tags while `publish` cuts
 * lightweight ones, so the "someone else cut this version" refusal below was unreachable and every
 * test still passed. Nothing here can be right about a value it is handed wrongly — which is what
 * `tools/git-state.mjs` and `test/git-state.test.ts` now exist to cover.
 */

/**
 * Everything the decision depends on, gathered by the caller.
 *
 * `null` means *absent* throughout — no tag, no release, nothing published — never *unknown*. The
 * caller resolves unknowns before asking, because a plan built on "I could not tell" is a plan that
 * guesses at exactly the moment guessing is most expensive.
 *
 * @typedef {object} State
 * @property {string} version
 * @property {boolean} clean whether the working tree has no uncommitted changes
 * @property {string} headSha the commit being released
 * @property {string | null} localTagSha what `v<version>` points at locally, if it exists
 * @property {string | null} remoteTagSha what `v<version>` points at on the remote, if it exists
 * @property {boolean} releaseExists whether a GitHub release exists for the tag
 * @property {string | null} releaseContentId the published asset's content id, if one could be read
 * @property {string | null} builtContentId the content id of the package just built
 * @property {boolean} gatesPassed whether the gates ran in this invocation and every one of them passed
 */

/**
 * The acts, in the order they have to happen. A tag before its push; a push before the release that
 * refers to it.
 */
const ACTS = ["tag", "pushBranch", "pushTag", "createRelease"];

/**
 * @param {State} state
 * @returns {{ blocked: string | null, todo: string[], done: string[], reasons: Record<string, string> }}
 */
export function plan(state) {
	const blocked = refusal(state);
	const reasons = /** @type {Record<string, string>} */ ({});

	// **The branch push survives every refusal.** It is the one act that is not about this version at
	// all: it puts committed work on the remote, which is wanted whether or not a release is due, and
	// it is safely repeatable — git says "up to date" and exits zero. Blocking it along with the rest
	// meant a run that correctly declined to move a tag also quietly left the commits unpushed, which
	// is the opposite of what "push it for me" is for.
	reasons.pushBranch = "push the branch, so the tag refers to a commit the remote has";

	if (blocked !== null) {
		return { blocked, todo: ["pushBranch"], done: [], reasons };
	}

	const needed = {
		// A tag that already points at this commit is this tag. Re-tagging would be a no-op at best
		// and a moved tag at worst, and the refusals above have already established it is not moved.
		tag: state.localTagSha === null,

		// Always — see above. Skipping it on the belief that it must already be pushed is also how a
		// tag ends up on the remote pointing at a commit that is on no branch there.
		pushBranch: true,

		pushTag: state.remoteTagSha === null,
		createRelease: !state.releaseExists
	};

	reasons.tag = needed.tag ? `create v${state.version}` : `v${state.version} already tags this commit`;
	reasons.pushTag = needed.pushTag ? `push v${state.version}` : `v${state.version} is already on the remote`;
	reasons.createRelease = needed.createRelease
		? `create the GitHub release for v${state.version}`
		: "the GitHub release already exists";

	const todo = ACTS.filter((act) => needed[act]);
	const done = ACTS.filter((act) => !needed[act]);

	// **Nothing is released that the gates did not just pass.** There are two ways to arrive here
	// without that: `--no-gates`, which reuses whatever package happens to be on disk, and a run
	// where a gate failed. The second was the worse one — `release.mjs` published first and read the
	// verdict forty lines later, so a red test suite was tagged, pushed and released, and *then* told
	// "do not cut this". Both are one mistake, publishing a build nothing stands behind, so both are
	// one flag.
	//
	// It withholds rather than refusing outright, because the documented `--no-gates` re-run — the
	// one that rebuilds the page after publishing so this very check goes green — has nothing left to
	// do and must still come out green. Withholding an empty list is silence; withholding a real one
	// is loud. And the branch push is exempt on the same grounds as every other refusal: it is not
	// about this version, and committed work should not sit unpushed because a gate went red.
	if (!state.gatesPassed) {
		const withheld = todo.filter((act) => act !== "pushBranch");
		if (withheld.length > 0) {
			return {
				blocked: `the gates did not pass on this build, so ${withheld.join(", ")} ${withheld.length === 1 ? "was" : "were"} withheld`,
				todo: ["pushBranch"],
				done,
				reasons
			};
		}
	}

	return { blocked: null, todo, done, reasons };
}

/**
 * Why this must not be published, or `null`.
 *
 * Every one of these is a case where doing the obvious thing loses work that cannot be recovered, so
 * the answer is always to stop and say which, never to force.
 *
 * @param {State} state
 * @returns {string | null}
 */
function refusal(state) {
	if (!state.clean) {
		return "the working tree has uncommitted changes — a tag would name a commit that is not what was built";
	}

	// A tag already pointing elsewhere means the version was cut before, from different code. Moving
	// it silently rewrites which commit a released version *is*, for everybody who has fetched it.
	if (state.localTagSha !== null && state.localTagSha !== state.headSha) {
		return `v${state.version} already tags ${short(state.localTagSha)}, not ${short(state.headSha)} — bump the version rather than moving the tag`;
	}

	if (state.remoteTagSha !== null && state.remoteTagSha !== state.headSha) {
		return `v${state.version} on the remote points at ${short(state.remoteTagSha)}, not ${short(state.headSha)} — someone else cut this version`;
	}

	// The one that cannot be repaired afterwards. The packed file is gitignored, so once a release
	// carries the wrong build there is no copy of the right one left to put back.
	if (
		state.releaseExists &&
		state.releaseContentId !== null &&
		state.builtContentId !== null &&
		state.releaseContentId !== state.builtContentId
	) {
		return `the published v${state.version} is a different build (${short(state.releaseContentId)} published, ${short(state.builtContentId)} built)`;
	}

	return null;
}

/** @param {string} sha */
function short(sha) {
	return sha.slice(0, 9);
}
