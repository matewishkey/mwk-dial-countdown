# Versioning and releasing

The short version: **the version number describes the `.streamDeckPlugin` file, and nothing else.**

Everything below follows from that one sentence. If a change does not alter the packaged plugin, it
does not get a version — it goes in [CHANGELOG.md](../CHANGELOG.md) under *Unreleased* and travels
with the next real release.

## Why that rule and not "every push is a version"

Because this version number is not ours. It is shown to the user by the Stream Deck application, it
is what they quote when something is wrong, and on Marketplace every version is a submission that a
human at Elgato reviews.

So a version that ships nothing new costs a review cycle and tells every user that something changed
when nothing did. "Which build am I running" has to stay a question the number can answer — which is
exactly what broke before: the manifest sat at `0.1.0.0` through nine releases, so the application
reported the same version whichever build was installed.

Repo-only work is real work, and it is not invisible — it is in the git history and in the changelog.
It just is not a *release*, because nobody can install it.

## The three numbers

Ordinary semver, read from the user's side rather than the API's, because a plugin has no API.

| | When | Example |
| --- | --- | --- |
| **MAJOR** | The user has to relearn or reconfigure something. A gesture now does something different, settings do not survive the upgrade, an action is removed or its UUID changes. | `3.0.0` — the dial's press became start/pause, and the step stopped being a mode |
| **MINOR** | New behaviour the user would notice, and nothing they knew is now wrong. A new setting, a new gesture, a reworked control. | `1.1.0` — the dial changes gear on speed, and stops overwriting presets |
| **PATCH** | A fix, with no new behaviour to learn. | `3.0.1` — an action tooltip still described the old dial |

Two judgement calls worth writing down, because both have come up:

- **A behaviour change that is strictly a fix is still a MINOR** if the user will notice it and has to
  adjust. v1.1.0 fixed bugs, but the dial genuinely behaves differently now, so it was not a patch.
- **A rename is MINOR, not MAJOR**, as long as the UUID is unchanged. `MWK Dial Countdown` →
  `Dial Countdown` moved what the actions list says; it did not move anybody's buttons.

### Never change the UUID

`com.matewishkey.dial-countdown-v2` and the two action UUIDs under it are permanent. Elgato's guidelines
say so, and changing one orphans every existing install — the user's configured buttons stop
resolving to an action that exists. If an action ever has to change shape incompatibly, add a new one
and hide the old with `VisibleInActionsList: false`.

#### …which is why the `-v2` is there, and it is a warning

The original UUID was `com.matewishkey.dial-countdown`. It is unusable now, and not because anything
was wrong with it: **Marketplace keeps an identifier reserved after its listing is deleted.** The
listing was removed to re-upload from scratch, and the Maker dashboard then rejected the same UUID as
"not available or invalid". It was never invalid — it matches the manifest schema's own pattern
(`^([a-z0-9-]+)(\.[a-z0-9-]+)+$`) and `streamdeck validate` had always passed it. It was *taken*, by
the listing that had just been deleted.

So: **do not delete a Marketplace listing you intend to re-upload.** Update it in place. Deleting
costs the identifier permanently, and the identifier is the one thing that cannot be changed without
breaking every install. If a listing must go, treat the UUID as spent.

## The fourth number

Stream Deck's manifest wants four parts. There is no build counter in this project, so:

```
package.json   1.1.0        three parts
manifest.json  1.1.0.0      the same three, plus a 0
git tag        v1.1.0       the same three, plus a v
```

`npm run version:check` asserts it. Pass the tag to check that too:

```sh
npm run version:check              # the two files agree
node tools/check-version.mjs v1.2.0   # ...and match the tag about to be cut
```

## Is this change a release?

The honest test is not a judgement, it is a diff. Build and pack from `main`, then compare against
what is already published:

```sh
npm run build && npx streamdeck pack com.matewishkey.dial-countdown-v2.sdPlugin --force
npx prettier --write com.matewishkey.dial-countdown-v2.sdPlugin/manifest.json  # pack rewrites it
gh release download <last-tag> -D /tmp/released

node tools/package-id.mjs /tmp/released/com.matewishkey.dial-countdown-v2.streamDeckPlugin
node tools/package-id.mjs com.matewishkey.dial-countdown-v2.streamDeckPlugin
```

Two identical **content ids** mean nothing shipped, so there is no release to cut. `--list` prints
every file's own hash when they differ and the question is which.

### Why a content id and not `sha256sum` on the package

Because **the package's own hash is not reproducible, and cannot be made so.** `streamdeck pack`
writes the moment of packing into every zip entry, so two packs of a byte-identical tree produce two
different files. Measured: 21 of 21 entries with matching content, matching order and matching
compression, and 21 of 21 with differing timestamps. `touch`ing the source tree to a fixed date first
does not help — the stamp is the pack time, not the file's.

What *is* reproducible is everything that matters. `rollup` emits a byte-identical `bin/plugin.js`
from the same source, and **`npm run icons` is reproducible** too — headless Chromium writes no `tIME`
chunk, so re-running it on an unchanged mark produces byte-identical PNGs. If an icon's bytes moved,
its pixels moved.

So `tools/package-id.mjs` hashes the archive's *contents* — every entry's path and content, sorted,
with the timestamps that carry no meaning left out. Same tree in, same id out, on any machine at any
hour. The package's own sha256 is still worth recording, because it answers a narrower question:
whether the file that was uploaded is the file that was built.

(The recipe here used to unzip both builds into temp directories and `diff -rq` them. That needed
`unzip`, **which is not installed on this box** — and a `diff` of two directories that failed to
populate reports them as identical, so the check could not fail. It also used to say to compare
pixels with ImageMagick's `compare`, which is not installed either. A comparison that cannot run is
worse than no comparison, because it reports success.)

### If the icons changed, find out why before accepting it

`npm run icons` rasterises with the **headless Chromium in Playwright's cache**, not ImageMagick,
which is not installed on the dev box. That is not a preference — swapping the rasteriser is how a
long-standing bug was found, and the same trap is waiting for whoever swaps it again.

**The mark is 118 wide by 100 tall, and `bareMark` sizes by `viewBox` while the call site forces
`width` and `height` to the same number.** A rasteriser that honours `preserveAspectRatio` *fits* it;
ImageMagick *stretched* it to fill the square. Measured on the dial's icon: old ink bounding box
71×69, new 70×60. Every icon had been about 18% too tall since the files were created — in the Stream
Deck application and on both static key faces — and nobody spotted it because the shape was plausible.

So a diff that shows changed icons is a question, not a formality. Render the old and new side by
side and look, and check the ink bounding box if the difference is subtle. A rasteriser that silently
distorts artwork produces files that pass `streamdeck validate` and look wrong on the hardware.

What is packaged is `manifest.json`, `bin/`, `imgs/`, `layouts/`, `sounds/` and `ui/`. What is not:
`src/`, `test/`, `tools/`, `assets/`, `docs/`, and every file at the repo root except the manifest's
own tree. So a change confined to the second list is by definition not a release.

## Cutting one

1. **Decide the number** from the table above, against what is actually in the diff.
2. **Bump both files together** — `package.json` and `manifest.json`. Never one alone.
3. **Move the changelog's *Unreleased* entries** under the new version, with today's date.
4. **Commit.** The tree has to be clean, because the next step tags it and a tag naming a commit that
   is not what was built is worse than no tag.
5. **`npm run release`.** Everything else: check, build, pack, validate, demo, then tag, push, create
   the GitHub release, and verify that the published asset is this same build.
6. **Submit to Marketplace by hand**, through the Maker dashboard, with the notes from the page's
   first box. There is no API for it, and it is the only step here that is not automatable.

The `.streamDeckPlugin` itself is gitignored. The GitHub release asset is the artefact of record, and
the copy on the release page is the one to upload.

## What `npm run release` does

Step 5 of *Cutting one* used to be six commands typed by hand, and typing six commands by hand is
how they end up in a different order each time. It is one command now, and the order is code. The
phases below are the command's own; they are not the numbered steps above.

| | | |
| --- | --- | --- |
| **check** | `npm run check` | typecheck, lint, formatting, the tests, and the two version files agreeing |
| **version** | `check-version v<version>` | ...and the tag about to be cut, which `check` cannot know about |
| **build** | `npm run build` | rollup → `bin/` |
| **pack** | `streamdeck pack` **and** `prettier` | paired, because pack rewrites the manifest on its way past |
| **validate** | `streamdeck validate` | structural: schema, files, sizes. A floor, not a review |
| **demo** | `npm run demo` | the built plugin, end to end, over a real socket |
| **publish** | tag, push the branch, push the tag, create the release | ...then check that the published asset is this build |

The first failure stops the run, and the whole of every step's output is kept in `logs/` and copied
beside the page. `npm run check` prints 305 passing tests nobody reads — right up until the release
where one of them did not pass, and the question is which.

**`pack` is two commands on purpose.** `streamdeck pack` rewrites `manifest.json` in place as it
goes, re-emitting the JSON with `Controllers` inlined and no trailing newline, which is not the
formatting the repo keeps — so the commit being tagged fails CI on formatting. `build` and `validate`
leave it alone; only `pack` does this, and it is how v3.1.0 came to be tagged on a red build. Pairing
them here is what stops it depending on somebody remembering.

**`publish` is idempotent, and that is the whole design.** It is not a script that runs top to bottom;
it is a plan computed from the current state, where each act happens only if it has not happened.
Run it once and it publishes. Run it again and it does nothing and says so. That is what lets it live
inside `npm run release` rather than being a separate ceremony somebody has to remember not to
repeat — and it means a half-finished publish is fixed by running the same command again, which is
exactly the v3.2.0 shape: tagged and pushed, no GitHub release.

**It refuses rather than forces.** A dirty tree, a tag that already names a different commit, a tag
someone else pushed elsewhere, or a published release carrying a different build — each stops the run
and says which. None of them can be tested by trying it, so the decision is pure and lives in
`tools/publish-plan.mjs`, with `test/publish-plan.test.ts` driving every refusal against no network
and no repository.

**What it will not treat as a conflict is an unknown.** If the published asset cannot be downloaded,
that is not evidence the builds differ, and refusing there would let a flaky network invent a
conflict. `null` means *do not compare*, never *they differ*.

It needs `gh` and a network; without them publishing is skipped with that as its reason and the rest
of the run still stands, because every other step is local by design. And it publishes to **GitHub,
not Marketplace** — the listing cannot be reached from here at all, which is exactly why the notes on
the page are notes to paste.

### Flags

| | |
| --- | --- |
| `--no-gates` | Rebuild the page from the logs already in `logs/`, for when it is the wording that changed and not the build. |
| `--no-publish` | Run everything and touch nothing outward-facing. |
| `--version <v>` | Read another version's changelog entry, to see the notes it would produce. **Implies `--no-publish`** — see below. |
| `--out <dir>` | Put the page somewhere other than the shared drive. |

`--version` is an inspection flag and is forced read-only, because it stopped being harmless the day
`publish` started tagging. It was added when this tool only wrote a page, where naming another
version merely read a different changelog section. Left alone it would now offer to tag and publish
whatever it was handed — and while the refusals catch the dangerous half of that (a version already
tagged elsewhere is refused), a version that has *never* been cut would sail straight through and be
released. A flag whose only use is looking must not be able to publish.

### A pushed tag is not a release — which is why `publish` does both

`git push --tags` publishes a tag; `gh release create` publishes a release. They are two acts on two
systems with nothing linking them, and **a tag with no release is invisible to both tools** — it
looks identical to every other tag in `git ls-remote --tags origin`, and `gh release list` simply
does not mention it. No error anywhere, because nothing is wrong from either one's point of view.

It happened. v3.2.0 was tagged and pushed, the release page was generated, and the Marketplace
submission went in off that page while `gh release create` had never run — so the version in front of
Elgato had no artefact of record. The submission never depended on the release: the package it needs
exists as soon as the pack step has run, so a human working off the page can do the manual step and
skip the automatable one in front of it.

That gap is closed by doing both in one step rather than by remembering. What remains worth knowing
is the check underneath it: the package passes through three places, and `npm run release` compares
the **content id** of the one it built against the one it downloads back off the release. Identical
means Elgato has what the repo has. A difference is unrecoverable after the fact — the packed file is
gitignored, so there is no copy of the right build left to put back.

## The release page

`npm run release` puts one page per version on the shared drive, under
`work/<own>-<repo>/<date>_v<version>/`. Open `report.html`; `README.md` beside it is what the folder
index shows.

It exists because **the last step cannot be automated.** Marketplace submission is a form a human
fills in, and the last useful thing this repo can do is hand that human everything the form wants in
a shape that can be copied rather than retyped.

- **The Marketplace notes, at most 1500 characters**, in a box with a Copy button. Built from the
  version's changelog entry, which is already written for whoever installs the plugin. Over budget it
  shortens rather than truncates — see below.
- **The GitHub notes** — the same entry in full, for `gh release create`.
- **Every step's whole output**, downloadable, and the release check's verdict.
- **The packaged plugin, its content id and its sha256.**

### How the notes are cut to 1500 characters

Never mid-word. Every entry starts in full; while the text is over budget the **longest** entry that
can still be shortened gives up a step — a paragraph, then three sentences, two, one, then its bold
lead alone — and only when nothing is left to shorten does an entry go altogether. Then a promotion
pass walks back up, restoring whatever fits, because greedy shortening overshoots.

Two things about that are worth keeping.

**Coverage beats detail.** Eight headlines are a better answer to *what changed* than three full
paragraphs and silence about the rest.

**The budget is meant to be used.** The first version shortened every entry in lockstep, looked
entirely correct, and threw away two thirds of the room: the step from "all in full" to "all first
sentences" jumped past the ceiling from over 1500 characters straight down to 332. It produces prose
either way, so nothing catches that but reading the output — which is why `test/release-notes.test.ts`
backtests every entry in `CHANGELOG.md` and asserts the property rather than a number: **the room
left over must be less than the cheapest remaining improvement.** A threshold was tried first and was
wrong, because entries whose sentences are lumpy cannot always reach the ceiling, and you cannot
invent text.

### `### Internal` is left out of the Marketplace notes

Repo-only work goes under an `### Internal` heading in the version's changelog entry — a refactor, a
formatting fix, a tool. It belongs in the changelog, because repo-only work travels with the next
release rather than vanishing; it does not belong in front of somebody deciding whether to install an
update. The generator drops that heading from the Marketplace notes and keeps it in the GitHub ones,
which is the audience it was written for.

## Changelog

[CHANGELOG.md](../CHANGELOG.md), [Keep a Changelog](https://keepachangelog.com) format. Every change
that lands on `main` gets a line under *Unreleased* when it happens, not reconstructed from git log
at release time — the reason for a change is clear the day it is made and gone a fortnight later.

Write entries for whoever installs the plugin. "The dial no longer overwrites your presets" belongs
there; "extracted `#load` from `cyclePreset`" does not, and is what the commit message is for.
