import streamDeck from "@elgato/streamdeck";

import { DialCountdown } from "./actions/dial-countdown";

streamDeck.logger.setLevel("trace");

streamDeck.actions.registerAction(new DialCountdown());

streamDeck.connect();
