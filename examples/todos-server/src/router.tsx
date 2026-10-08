// The router lives in its own module so app.tsx (render) and server-config.ts
// (the single-flight collector) share one instance. The collector reruns the
// matched route's preload for the page a mutation was posted from, which is
// how a toggle's response carries the list's fresh markup.
import { createRouter, defineRoute, intentPreload } from "@solidjs/router";
import Todos from "~/routes/todos";
import { getTodoList, parseFilter } from "~/todo-list";

export const Router = createRouter({
  preloadLinks: intentPreload(),
  routes: [
    defineRoute({
      path: "/",
      component: Todos,
      preload: ({ location }) => void getTodoList(parseFilter(location.query.filter))
    })
  ]
});
