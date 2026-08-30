import streamDeck from "@elgato/streamdeck";

import { DialCountdown } from "./actions/dial-countdown";
import { KeyCountdown } from "./actions/key-countdown";

/**
 * `true` in a development build, `false` in a release one. Substituted at build time by rollup — see
 * the `build-flags` plugin in `rollup.config.mjs` — so the branch below is resolved before the
 * bundle is written and neither level survives into the other build.
 */
declare const __DEV__: boolean;

/**
 * TRACE is a development tool, not something to ship.
 *
 * It used to be set unconditionally, which meant every user got trace-level logging written to their
 * own disk behind a render loop that ticks four times a second *per control* — on a plugin whose
 * entire job is to sit on a page for hours. `npm run watch` still gets the trace, because that is
 * where it is worth having.
 */
streamDeck.logger.setLevel(__DEV__ ? "trace" : "info");

streamDeck.actions.registerAction(new DialCountdown());
streamDeck.actions.registerAction(new KeyCountdown());

streamDeck.connect();
