// The route tree, in its own module so both the app root and the
// server-function config can share it. `/` is the room as a live SERVER
// component (markup that keeps changing); `/live` is the same room from
// live DATA sources, rendered in the browser.
import { defineRoute, defineRoutes } from "@solidjs/router";
import Home from "~/routes/home";
import Live from "~/routes/live";

export const routes = defineRoutes([
  defineRoute({ path: "/", component: Home }),
  defineRoute({ path: "/live", component: Live })
]);
