// The dashboard, rendered on the server (`/`) and, for comparison, in the
// browser from streamed data (`/spa`).
import { createRouter, defineRoute } from "@solidjs/router";
import Dashboard from "~/routes/dashboard";
import Spa from "~/routes/spa";

export const Router = createRouter({
  routes: [
    defineRoute({ path: "/", component: Dashboard }),
    defineRoute({ path: "/spa", component: Spa })
  ]
});
