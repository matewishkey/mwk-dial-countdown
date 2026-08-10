import streamDeck from "@elgato/streamdeck";

import { DialTimer } from "./actions/dial-timer";

streamDeck.logger.setLevel("trace");

streamDeck.actions.registerAction(new DialTimer());

streamDeck.connect();
