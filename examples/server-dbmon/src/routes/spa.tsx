// The same dashboard the client-rendered way, for comparison: the server
// streams the databases as data after every tick, and the browser renders
// the table with keyed `<For>`s.
import { For, Loading, Show, createMemo, createSignal, onSettled } from "solid-js";
import { getRequestEvent } from "@solidjs/web";
import { live } from "@solidjs/web/server-functions";
import { watchDatabases, type Database } from "~/server/databases";

const getDatabaseData = live(async function* (): AsyncGenerator<Database[]> {
  "use server";
  yield* watchDatabases(getRequestEvent()?.request.signal);
});

export default function Spa() {
  // A client-rendered app: the page arrives empty and the browser fetches
  // and renders the data once it is running.
  const [running, setRunning] = createSignal(false);
  onSettled(() => {
    setRunning(true);
  });
  return (
    <Show when={running()}>
      <Table />
    </Show>
  );
}

function Table() {
  const databases = createMemo(() => getDatabaseData());
  return (
    <Loading fallback={<p>Loading…</p>}>
      <table class="table table-striped latest-data">
        <tbody>
          <For each={databases()} keyed={(db: Database) => db.id}>
            {row => (
              <tr>
                <td class="dbname">{row().name}</td>
                <td class="query-count">
                  <span class={row().countClass}>{row().count}</span>
                </td>
                <For each={row().top5} keyed={false}>
                  {query => (
                    <td class={"Query " + query().className}>
                      {query().formatted}
                      <div class="popover left">
                        <div class="popover-content">{query().text}</div>
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
    </Loading>
  );
}
