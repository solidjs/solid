// The router, in its own module so app.tsx (which renders it) and
// server-config.ts (which hands it to the flight collector) share one.
import { createRouter, defineRoute } from "@solidjs/router";
import Home from "~/routes/home";
import Thread from "~/routes/thread";

export const Router = createRouter({
  routes: [
    defineRoute({ path: "/", component: Home }),
    defineRoute({ path: "/t/:id", component: Thread })
  ]
});
