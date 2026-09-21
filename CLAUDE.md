# Working on this repo

A Stream Deck plugin: a countdown timer for dials and keys. Facts and constraints only — how it
behaves is [docs/how-it-works.md](docs/how-it-works.md), what changed is
[CHANGELOG.md](CHANGELOG.md), releasing is [docs/releasing.md](docs/releasing.md).

## Commands

| | |
| --- | --- |
| `npm run check` | typecheck, lint, format, tests, version agreement. The gate. |
| `npm test` | tests alone (~30s; `test/inspector.test.ts` drives headless Chromium) |
| `npm run build` | rollup → `com.matewishkey.dial-countdown-v2.sdPlugin/bin/` |
| `npm run demo` | scripted pass over a real socket against the **built** plugin (~130s) |
| `npm run mock` | drive the plugin by keyboard, no hardware |
| `npm run release -- --no-publish` | every gate, then writes the hand-over page; tags nothing |

There is no hardware on this box. `npm run demo` is the only thing that exercises the two action
subclasses end to end, so run it after touching anything in `src/actions/`.

## Layout

- `src/` — the plugin. Pure modules (`timer`, `countdown`, `settings`, `gestures`, `step`, `label`,
  `feedback`, `render`, `sound`) import no SDK and are tested directly.
- `src/actions/` — the SDK-facing half. `countdown-action.ts` is the shared base.
- `com.matewishkey.dial-countdown-v2.sdPlugin/` — what ships: manifest, `bin/`, `imgs/`, `layouts/`,
  `sounds/`, `ui/`. Everything else in the repo is not packaged.
- `…sdPlugin/ui/dial-countdown.html` — the property inspector, a plain page with inline JS.
- `tools/` — release, icons, mock host. Typechecked; JSDoc types required where a test imports one.

## Constraints

These are load-bearing and a tidy-up would undo them. The full list with reasons is in the README
under *How it fits together*; the short version:

- **Never change the plugin or action UUIDs.** A Marketplace identifier stays reserved after a
  listing is deleted, and changing one orphans every existing install.
- `setImage` takes a **data URI**, never raw SVG markup.
- Settings arriving from any build go through `normaliseSettings`; nothing else reads them raw.
- Frames are re-asserted every 2 s. Awaiting `setFeedbackLayout` does not help.
- A test **cannot import** `dial-countdown.ts` or `key-countdown.ts` — `@action` decorators survive
  type stripping. Test the base class, or put the logic in a pure module.
- The property inspector holds its own copy of the settings shape and clamps. If you change one in
  `src/settings.ts`, change it there too — `test/inspector.test.ts` asserts they agree.
- `src/sound.ts` resolves bundled sounds from `process.cwd()`.

## Tests

- **Every test in `test/actions.test.ts` must tear its instance down**, and register that teardown
  with `t.after` rather than at the end of the body. The render loop is a `setInterval`; one left
  running holds the event loop open and hangs the whole suite with no output.
- A guard is not proven by a green test. Break the code and confirm the test goes red — several
  tests here have been found asserting nothing, and two were asserting the wrong behaviour outright.
- Keep a **positive control** beside any test of an absence, or it passes just as well when the
  feature is removed entirely.

## Versioning

`package.json`, `manifest.json` (four parts) and the git tag move together; `npm run version:check`
asserts it. A change that does not alter the packaged plugin is not a release — it goes under
*Unreleased* in the changelog. Cut a release only when asked: build the `--no-publish` page and hand
over the link first, because the only person who can try it needs a build, not a tag.
