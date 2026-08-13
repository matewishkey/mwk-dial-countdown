import streamDeck from "@elgato/streamdeck";

import { DialCountdown } from "./actions/dial-countdown";
import { KeyCountdown } from "./actions/key-countdown";

streamDeck.logger.setLevel("trace");

streamDeck.actions.registerAction(new DialCountdown());
streamDeck.actions.registerAction(new KeyCountdown());

streamDeck.connect();
