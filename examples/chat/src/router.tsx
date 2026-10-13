// The router, in its own module so app.tsx (which renders it) and
// server-config.ts (which hands it to the flight collector) share one.
//
// The sidebar's list lives here too, as the root preload: every route shows
// it, and when a message is sent the router asks for it again, so a new
// thread appears in the list with the response that created it.
import { createRouter, defineRoute, query } from "@solidjs/router";
import Home from "~/routes/home";
import Thread from "~/routes/thread";
import * as db from "~/server/db";

// The list of conversations, as server markup. An ordinary query, not a live
// one: it changes when this tab sends something, and the router refreshes it
// then. The router marks the link to the page you are on.
export const getThreads = query(async () => {
  "use server";
  const threads = await db.listThreads();
  return () => (
    <ul class="threads">
      {threads.map(thread => (
        <li>
          <a href={`/t/${thread.id}`}>{thread.title}</a>
        </li>
      ))}
    </ul>
  );
}, "threads");

export const Router = createRouter({
  routes: [
    defineRoute({ path: "/", component: Home }),
    defineRoute({ path: "/t/:id", component: Thread })
  ],
  preload: () => void getThreads()
});
