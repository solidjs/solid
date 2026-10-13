// Evaluated in the server-function handler graph (see `serverFunctions.
// configure` in vite.config.ts), before any dispatch. Registering the
// router's flight collector is what makes a mutation single-flight: when an
// action answers without a redirect, the collector reruns the route of the
// page the form was posted from in data-only mode, and the list's fresh
// markup folds into the mutation's own response.
import { configureServerFunctionsServer } from "@solidjs/web/server-functions/server";
import { createFlightDataCollector } from "@solidjs/router/server";
import { Router } from "./router";

configureServerFunctionsServer({
  collectFlightData: createFlightDataCollector(Router)
});
