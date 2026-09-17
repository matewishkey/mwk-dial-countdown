import streamDeck from "@elgato/streamdeck";

import { DialCountdown } from "./actions/dial-countdown";
import { startHealthLog } from "./health";
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

// One line a minute saying what this plugin is costing the machine, and a warning the moment the
// event loop runs late enough to change what a gesture means. See `./health`.
// The probe asks for the GLOBAL settings, which this plugin never uses — so the reply reaches none
// of its handlers, and timing it cannot change what it is measuring. See `./health`.
startHealthLog(streamDeck.logger, { probe: () => streamDeck.settings.getGlobalSettings() });

streamDeck.actions.registerAction(new DialCountdown());
streamDeck.actions.registerAction(new KeyCountdown());

/**
 * **The process's own safety net, because the SDK's is a single use.**
 *
 * `@elgato/streamdeck` installs its uncaught-exception handler with `process.once`, so the first
 * throw anywhere in the plugin logs a line and *removes* it. Everything after that is unhandled. That
 * matters here more than in most plugins: the render loop is a 4 Hz `setInterval` per visible
 * control, so a deterministic throw inside it recurs 250 ms later with no handler left and takes
 * every control's countdown down with it — a timer losing its count being the single worst thing this
 * plugin can do.
 *
 * `on`, not `once`, and both kinds: under Node's default `--unhandled-rejections=throw` a rejection
 * with no listener is raised as an uncaught exception, so the two share one budget.
 */
process.on("uncaughtException", (err) => streamDeck.logger.error("Uncaught exception", err));
process.on("unhandledRejection", (reason) => streamDeck.logger.error("Unhandled rejection", reason));

// **Logged, not swallowed.** This used to be a bare `void` on the reasoning that a failed connection
// leaves nothing useful to do "including logging, which goes back down the same pipe". That is not
// where logging goes: the SDK writes to a file target under the plugin's own directory, and only adds
// a console target in debug mode. A connect failure was perfectly loggable and was going unlogged —
// and, before the handlers above, was also spending the process's one free pass.
streamDeck.connect().catch((err) => streamDeck.logger.error("Failed to connect to Stream Deck", err));
