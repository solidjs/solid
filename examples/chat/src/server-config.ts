// Evaluated in the server-function handler graph before any dispatch (see
// `serverFunctions.configure` in vite.config.ts).
//
// The flight collector is what lets the first message's response carry its
// own destination: the action answers with a redirect to the new thread, and
// the collector renders that route into the same response.
//
// CHAOS_EVERY=<ms> is a dev knob: the server ends every live response after
// that long, as a dying connection would, so the reconnect path runs without
// a network to break. It does nothing outside the dev build.
import { configureServerFunctionsServer } from "@solidjs/web/server-functions/server";
import { createFlightDataCollector } from "@solidjs/router/server";
import { Router } from "./router";

configureServerFunctionsServer({
  chaosReconnectEvery: Number(process.env.CHAOS_EVERY || 0),
  collectFlightData: createFlightDataCollector(Router)
});
