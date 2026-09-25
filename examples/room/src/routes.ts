// The route tree, in its own module so both the app root and the
// server-function config (Phase B, when server components join the page)
// can share it. Today: `/live`, the live-sources page, and a stub home.
import { defineRoute, defineRoutes } from "@solidjs/router";
import Home from "~/routes/home";
import Live from "~/routes/live";

export const routes = defineRoutes([
  defineRoute({ path: "/", component: Home }),
  defineRoute({ path: "/live", component: Live })
]);
