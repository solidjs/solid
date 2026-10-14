// The dashboard. The table is rendered on the server and stays live: the
// response stays open and the server sends what changed after every tick.
import { createMemo, For, Loading, onCleanup } from "solid-js";
import { dynamicComponent, getRequestEvent } from "@solidjs/web";
import { GET, live } from "@solidjs/web/server-functions";
import { liveQuery } from "@solidjs/router";
import { watchDatabases } from "~/server/databases";

const getDatabases = liveQuery(
  live(
    GET(async () => {
      "use server";
      return () => {
        const gone = new AbortController();
        onCleanup(() => gone.abort());
        getRequestEvent()?.request.signal.addEventListener("abort", () => gone.abort(), {
          once: true
        });
        const databases = createMemo(() => watchDatabases(gone.signal));
        return (
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
        );
      };
    })
  ),
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
