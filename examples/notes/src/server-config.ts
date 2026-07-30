// Evaluated in the server-function handler graph (see `serverFunctions.
// configure` in vite.config.ts), before any dispatch. Registering the
// router's flight collector is what turns mutations single-flight: when an
// action answers with `redirect()`, the runtime hands the target URL here,
// the collector reruns the matched routes' preloads in data-only mode, and
// everything they collect — server-component markup as frame regions, plain
// values as data — folds into the mutation's own response.
import { configureServerFunctionsServer } from "@solidjs/web/server-functions/server";
import { createFlightDataCollector } from "@solidjs/router/server";
import { preload, routes } from "./routes";

configureServerFunctionsServer({
  collectFlightData: createFlightDataCollector({ routes, rootPreload: preload })
});
