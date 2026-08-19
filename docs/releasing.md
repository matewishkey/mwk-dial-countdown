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
| **MAJOR** | The user has to relearn or reconfigure something. A gesture now does something different, settings do not survive the upgrade, an action is removed or its UUID changes. | `1.0.0` — the double tap stopped starting the timer |
| **MINOR** | New behaviour the user would notice, and nothing they knew is now wrong. A new setting, a new gesture, a reworked control. | `1.1.0` — the dial changes gear on speed, and stops overwriting presets |
| **PATCH** | A fix, with no new behaviour to learn. | `0.7.1` |

Two judgement calls worth writing down, because both have come up:

- **A behaviour change that is strictly a fix is still a MINOR** if the user will notice it and has to
  adjust. v1.1.0 fixed bugs, but the dial genuinely behaves differently now, so it was not a patch.
- **A rename is MINOR, not MAJOR**, as long as the UUID is unchanged. `MWK Dial Countdown` →
  `Dial Countdown` moved what the actions list says; it did not move anybody's buttons.

### Never change the UUID

`com.matewishkey.dial-countdown` and the two action UUIDs under it are permanent. Elgato's guidelines
say so, and changing one orphans every existing install — the user's configured buttons stop
resolving to an action that exists. If an action ever has to change shape incompatibly, add a new one
and hide the old with `VisibleInActionsList: false`.

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
npm run build && npx streamdeck pack com.matewishkey.dial-countdown.sdPlugin --force
gh release download <last-tag> -D /tmp/released
mkdir -p /tmp/a /tmp/b
( cd /tmp/a && unzip -oq /tmp/released/com.matewishkey.dial-countdown.streamDeckPlugin )
( cd /tmp/b && unzip -oq com.matewishkey.dial-countdown.streamDeckPlugin )
diff -rq /tmp/a /tmp/b
```

Identical means no release. Note that PNGs carry a creation timestamp, so a regenerated icon can
differ as bytes while being the same picture — `compare -metric AE old.png new.png null:` returns 0
when the pixels match.

What is packaged is `manifest.json`, `bin/`, `imgs/`, `layouts/`, `sounds/` and `ui/`. What is not:
`src/`, `test/`, `tools/`, `assets/`, `docs/`, and every file at the repo root except the manifest's
own tree. So a change confined to the second list is by definition not a release.

## Cutting one

1. **Decide the number** from the table above, against what is actually in the diff.
2. **Bump both files together** — `package.json` and `manifest.json`. Never one alone.
3. `npm test` and `npm run demo` — the demo drives the built plugin end to end, which the unit tests
   deliberately do not.
4. `npx streamdeck validate com.matewishkey.dial-countdown.sdPlugin`. Bear in mind this is a
   **structural** check: schema, file presence, sizes. It has never looked at icon colours, and it
   passed the build Elgato rejected for them. It is a floor, not a review.
5. `node tools/check-version.mjs v<version>`.
6. `npm run build` then `npx streamdeck pack … --force`.
7. Move the changelog's *Unreleased* entries under the new version, with today's date.
8. Commit, tag `v<version>`, push both.
9. `gh release create v<version> com.matewishkey.dial-countdown.streamDeckPlugin` with notes written
   from the changelog — what changed for the *user*, not what changed in the repo.
10. **Submit to Marketplace by hand**, through the Maker dashboard. There is no API for it, and it is
    the only step here that is not automatable.

The `.streamDeckPlugin` itself is gitignored. The GitHub release asset is the artefact of record.

## Changelog

[CHANGELOG.md](../CHANGELOG.md), [Keep a Changelog](https://keepachangelog.com) format. Every change
that lands on `main` gets a line under *Unreleased* when it happens, not reconstructed from git log
at release time — the reason for a change is clear the day it is made and gone a fortnight later.

Write entries for whoever installs the plugin. "The dial no longer overwrites your presets" belongs
there; "extracted `#load` from `cyclePreset`" does not, and is what the commit message is for.
