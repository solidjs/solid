// Evaluated in the server-function handler graph before any dispatch (see
// `serverFunctions.configure` in vite.config.ts).
import { configureServerFunctionsServer } from "@solidjs/web/server-functions/server";
import { createFlightDataCollector } from "@solidjs/router/server";
import { Router } from "./router";

configureServerFunctionsServer({
  collectFlightData: createFlightDataCollector(Router)
});
