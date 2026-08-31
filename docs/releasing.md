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
mkdir -p /tmp/a /tmp/b
( cd /tmp/a && unzip -oq /tmp/released/com.matewishkey.dial-countdown-v2.streamDeckPlugin )
( cd /tmp/b && unzip -oq com.matewishkey.dial-countdown-v2.streamDeckPlugin )
diff -rq /tmp/a /tmp/b
```

Identical means no release, and a plain `sha256sum` settles it: **`npm run icons` is reproducible** —
headless Chromium writes no `tIME` chunk, so re-running it on an unchanged mark produces byte-identical
PNGs. If an icon's bytes moved, its pixels moved.

(This used not to hold. ImageMagick stamped a creation time into every PNG, so the advice here was to
compare pixels with `compare -metric AE old.png new.png null:` — which is now doubly wrong, since
ImageMagick is not installed on the dev box either.)

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
3. `npm run check` and `npm run demo`. `check` is typecheck, lint, formatting, the tests and
   `version:check` in one — and [CI](../.github/workflows/ci.yml) has already run all of it on the
   commit you are about to tag, so this is a confirmation rather than the first time of asking. The
   demo is the part CI does not do: it drives the *built* plugin end to end over a real WebSocket,
   which the unit tests deliberately do not.
4. `npx streamdeck validate com.matewishkey.dial-countdown-v2.sdPlugin`. Bear in mind this is a
   **structural** check: schema, file presence, sizes. It has never looked at icon colours, and it
   passed the build Elgato rejected for them. It is a floor, not a review.
5. `node tools/check-version.mjs v<version>` — with the tag, which is the part `npm run check`
   cannot do for you, since it does not know which tag you are about to cut.
6. `npm run build` then `npx streamdeck pack … --force`.

   **`pack` rewrites `manifest.json` in place** — it re-emits the JSON with `Controllers` arrays
   inlined and no trailing newline, which is not the formatting the repo keeps. `build` and
   `validate` leave it alone; only `pack` does this. So **run `npx prettier --write
   com.matewishkey.dial-countdown-v2.sdPlugin/manifest.json` after packing**, or the commit you tag
   fails CI on formatting — which is exactly how v3.1.0 was cut with a red build. The rewrite is
   whitespace only, so the packaged plugin is unaffected either way; it is the repo that ends up
   inconsistent with itself.
7. Move the changelog's *Unreleased* entries under the new version, with today's date.
8. Commit, tag `v<version>`, push both.
9. **`npm run release:page`** — see below. It re-runs every gate, keeps the logs, and writes the page
   that carries the notes for the two steps that follow.
10. `gh release create v<version> com.matewishkey.dial-countdown-v2.streamDeckPlugin` with the notes
    from the page's second box — the changelog entry in full.
11. **Submit to Marketplace by hand**, through the Maker dashboard, with the notes from the page's
    first box. There is no API for it, and it is the only step here that is not automatable.

The `.streamDeckPlugin` itself is gitignored. The GitHub release asset is the artefact of record, and
the copy on the release page is the one to upload.

## The release page

`npm run release:page` builds one page per version and puts it on the shared drive, under
`work/<own>-<repo>/<date>_v<version>/`. Open `report.html`; `README.md` beside it is what the folder
index shows.

It exists because **step 11 cannot be automated.** Marketplace submission is a form a human fills in,
and the last useful thing this repo can do is hand that human everything the form wants in a shape
that can be copied rather than retyped.

What it produces:

- **The Marketplace notes, at most 1500 characters.** Built from the version's changelog entry, which
  is already written for whoever installs the plugin. Over budget it shortens rather than truncates —
  each entry drops to its first sentence, then to its bold lead, and only then goes altogether, taking
  from the longest entry first so the budget is actually used. A word is never cut in half.
- **The GitHub notes** — the same entry in full, for `gh release create`.
- **Every gate, re-run, with the whole of its output kept** as a downloadable log: `npm run check`,
  `check-version` against the tag, `streamdeck validate`, and `npm run demo`. It exits non-zero if one
  failed, so it cannot quietly produce a page for a red build.
- **The packaged plugin and its sha256**, since the `.streamDeckPlugin` is gitignored and this copy
  and the GitHub asset are the only two that exist.

### `### Internal` is left out of the Marketplace notes

Repo-only work goes under an `### Internal` heading in the version's changelog entry — a refactor, a
formatting fix, a tool. It belongs in the changelog, because repo-only work travels with the next
release rather than vanishing; it does not belong in front of somebody deciding whether to install an
update. The generator drops that heading from the Marketplace notes and keeps it in the GitHub ones,
which is the audience it was written for.

`node tools/release-page.mjs --no-gates` rebuilds the page from the logs already in `logs/`, for when
it is the wording that changed and not the build. `--out <dir>` puts it somewhere other than the
shared drive.

## Changelog

[CHANGELOG.md](../CHANGELOG.md), [Keep a Changelog](https://keepachangelog.com) format. Every change
that lands on `main` gets a line under *Unreleased* when it happens, not reconstructed from git log
at release time — the reason for a change is clear the day it is made and gone a fortnight later.

Write entries for whoever installs the plugin. "The dial no longer overwrites your presets" belongs
there; "extracted `#load` from `cyclePreset`" does not, and is what the commit message is for.
