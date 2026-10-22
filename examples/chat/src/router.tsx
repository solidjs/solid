// The router, in its own module so app.tsx (which renders it) and
// server-config.ts (which hands it to the flight collector) share one.
//
// The sidebar's list lives here too, as the root preload: every route shows
// it.
import { createMemo, onCleanup } from "solid-js";
import { getRequestEvent } from "@solidjs/web";
import { createRouter, defineRoute, liveQuery } from "@solidjs/router";
import Home from "~/routes/home";
import Thread from "~/routes/thread";
import * as db from "~/server/db";

// The list of conversations, as live server markup: newest first, with a
// mark on the ones where a reply is being written. It is live because it
// changes without this tab doing anything — another tab sends a message, a
// reply finishes, a thread is renamed or deleted. The router marks the link
// to the page you are on.
export const getThreads = liveQuery(async () => {
  "use server";
  return () => {
    const gone = new AbortController();
    onCleanup(() => gone.abort());
    getRequestEvent()?.request.signal.addEventListener("abort", () => gone.abort(), {
      once: true
    });
    const threads = createMemo(() => db.watchThreads(gone.signal));
    return (
      <ul class="threads">
        {threads().map(thread => {
          const writing = thread.generating ? "writing" : undefined;
          return (
            <li>
              <a href={`/t/${thread.id}`} class={writing}>
                {thread.title}
              </a>
            </li>
          );
        })}
      </ul>
    );
  };
}, "threads");

export const Router = createRouter({
  routes: [
    defineRoute({ path: "/", component: Home }),
    defineRoute({ path: "/t/:id", component: Thread })
  ],
  preload: () => void getThreads()
});
