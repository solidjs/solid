import { createSignal, Errored, For, Show } from "solid-js";
import { Typeahead } from "./typeahead";
import { Checkout } from "./checkout";
import { clearLog, logEntries } from "./log";
import { createRuntime, RuntimeContext } from "./solid-effect";
import { SearchConfigLive } from "./api";

type Tab = "typeahead" | "checkout";

function LogPanel() {
  return (
    <aside class="log-panel">
      <header>
        <h2>Fiber events</h2>
        <button onClick={clearLog}>Clear</button>
      </header>
      <Show
        when={logEntries.length > 0}
        fallback={<p class="empty">Interact to see fiber lifecycle events.</p>}
      >
        <ul>
          <For each={[...logEntries].reverse()}>
            {entry => (
              <li class={`log-${entry.kind}`}>
                <span class="log-time">{entry.time}</span>
                <span class="log-kind">{entry.kind}</span>
                <span class="log-msg">{entry.message}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </aside>
  );
}

export function App() {
  const [tab, setTab] = createSignal<Tab>("typeahead");
  return (
    <Errored
      fallback={(err, reset) => (
        <div class="error-box app-error">
          <p>Something went wrong: {String(err())}</p>
          <button onClick={reset}>Reset</button>
        </div>
      )}
    >
      {/* Effect's R channel rides Solid context: this ManagedRuntime provides
          SearchConfig to every Effect forked below it, and its Layer scope is
          disposed when this subtree unmounts. */}
      <RuntimeContext value={createRuntime(SearchConfigLive)}>
        <div class="app">
          <header class="app-header">
            <h1>
              Solid 2.0 <span class="times">×</span> Effect
            </h1>
            <p>
              Two demos, one tiny integration (<code>src/solid-effect.ts</code>): Effects as
              interruptible async sources on the read path, Effect sagas as transaction steps on the
              action path, services provided through Solid context.
            </p>
            <nav class="tabs">
              <button
                class={{ selected: tab() === "typeahead" }}
                onClick={() => setTab("typeahead")}
              >
                Typeahead <small>read path</small>
              </button>
              <button class={{ selected: tab() === "checkout" }} onClick={() => setTab("checkout")}>
                Checkout <small>action path</small>
              </button>
            </nav>
          </header>
          <main>
            <Show when={tab() === "typeahead"} fallback={<Checkout />}>
              <Typeahead />
            </Show>
            <LogPanel />
          </main>
        </div>
      </RuntimeContext>
    </Errored>
  );
}
