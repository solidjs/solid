// The dashboard. The table is rendered on the server and stays live: the
// response stays open and the server sends what changed after every tick.
// Every tab sees the same table, so it is a `broadcast`: one render on the
// server, however many tabs are watching.
import { createMemo, For, Loading, onCleanup } from "solid-js";
import { dynamicComponent } from "@solidjs/web";
import { broadcast } from "@solidjs/web/server-functions";
import { liveQuery } from "@solidjs/router";
import { watchDatabases } from "~/server/databases";
import { watchStats } from "~/server/stats";

const getDatabases = liveQuery(
  broadcast(async () => {
    "use server";
    return () => {
      const gone = new AbortController();
      onCleanup(() => gone.abort());
      const databases = createMemo(() => watchDatabases(gone.signal));
      const stats = createMemo(() => watchStats(gone.signal));
      return (
        <>
          <p class="stats">
            {stats().viewers !== undefined ? `${stats().viewers} watching · ` : ""}
            server CPU {stats().cpu ?? "…"} ms/s
          </p>
          <table class="table table-striped latest-data">
            <tbody>
              <For each={databases()}>
                {db => (
                  <tr>
                    <td class="dbname">{db.name}</td>
                    <td class="query-count">
                      <span class={db.countClass}>{db.count}</span>
                    </td>
                    <For each={db.top5}>
                      {query => (
                        <td class={"Query " + query.className}>
                          {query.formatted}
                          <div class="popover left">
                            <div class="popover-content">{query.text}</div>
                            <div class="arrow" />
                          </div>
                        </td>
                      )}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </>
      );
    };
  }),
  "databases"
);

export default function Dashboard() {
  const Databases = dynamicComponent(() => getDatabases());
  return (
    <Loading fallback={<p>Loading…</p>}>
      <Databases />
    </Loading>
  );
}
