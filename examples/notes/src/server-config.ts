// Evaluated in the server-function handler graph (see `serverFunctions.
// configure` in vite.config.ts), before any dispatch. Registering the
// router's flight collector is what turns mutations single-flight: when an
// action answers with `redirect()`, the runtime hands the target URL here,
// the collector reruns the matched routes' server calls and preloads (and the
// root preload) in data-only mode, and everything they collect —
// server-component markup as frame regions, plain values as data — folds into
// the mutation's own response. It takes the app's router, so the routes it
// reruns are the ones the client is showing.
import { configureServerFunctionsServer } from "@solidjs/web/server-functions/server";
import { createFlightDataCollector } from "@solidjs/router/server";
import { Router } from "./router";

configureServerFunctionsServer({
  collectFlightData: createFlightDataCollector(Router)
});
