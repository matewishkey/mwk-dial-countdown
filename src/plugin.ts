import streamDeck from "@elgato/streamdeck";

import { DialCountdown } from "./actions/dial-countdown";
import { KeyCountdown } from "./actions/key-countdown";

/** `true` in a development build. Substituted at build time by the `build-flags` rollup plugin. */
declare const __DEV__: boolean;

// Trace logging is a development tool. The render loop ticks 4 times a second per visible control,
// so shipping trace writes that to the user's disk for as long as the plugin is on a page.
streamDeck.logger.setLevel(__DEV__ ? "trace" : "info");

streamDeck.actions.registerAction(new DialCountdown());
streamDeck.actions.registerAction(new KeyCountdown());

// `on`, not `once`: the SDK installs its own handler with `process.once`, so after the first throw
// there is none left. A throw inside the 4 Hz render loop recurs 250 ms later, so a single-use
// handler would leave every control's countdown to die on the second tick. Both kinds are needed
// because Node's default `--unhandled-rejections=throw` raises a listener-less rejection here too.
process.on("uncaughtException", (err) => streamDeck.logger.error("Uncaught exception", err));
process.on("unhandledRejection", (reason) => streamDeck.logger.error("Unhandled rejection", reason));

// Logged rather than voided: the SDK's logger writes to a file under the plugin's own directory,
// not back down the socket, so a failed connection is still loggable.
streamDeck.connect().catch((err) => streamDeck.logger.error("Failed to connect to Stream Deck", err));
