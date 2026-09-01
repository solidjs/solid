// Read path: an Effect program consumed directly by a memo.
//
// There is no integration code in this file beyond `runEffect`. The memo
// returns an AsyncIterable and Solid does the rest: pending flows to
// <Loading>, exhausted retries flow to <Errored>, `latest`/`isPending` give
// stale-while-revalidate. Type fast and watch the event log: every
// superseded keystroke's fiber — including its pending retries — is
// interrupted by Solid closing the flight's iterator. No debounce, no
// AbortController, no request bookkeeping anywhere in this component.

import { createMemo, createSignal, Errored, For, isPending, latest, Loading, Show } from "solid-js";
import { searchPackages, type Package } from "./api";
import { runEffect } from "./solid-effect";

function formatDownloads(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return Math.round(n / 1_000) + "k";
  return String(n);
}

function Results(props: { results: () => Package[]; query: string }) {
  const list = () => latest(props.results);
  return (
    <div class={{ results: true, stale: isPending(props.results) }}>
      <Show
        when={list().length > 0}
        fallback={
          <p class="empty">
            {isPending(props.results) ? "Searching…" : `No packages match “${props.query}”.`}
          </p>
        }
      >
        <ul>
          <For each={list()}>
            {pkg => (
              <li>
                <div>
                  <span class="pkg-name">{pkg.name}</span>
                  <span class="pkg-desc">{pkg.description}</span>
                </div>
                <span class="pkg-downloads">{formatDownloads(pkg.downloads)}/wk</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

export function Typeahead() {
  const [query, setQuery] = createSignal("");

  // The whole data layer. searchPackages carries retry w/ backoff, timeout,
  // typed transient errors, and interruption finalizers — declared over
  // there, invisible here.
  const results = createMemo<Package[]>(() => {
    const q = query().trim();
    if (!q) return [];
    return runEffect(searchPackages(q));
  });

  return (
    <section class="panel">
      <header>
        <h2>Typeahead search</h2>
        <p>
          Each keystroke starts an Effect fiber (retry ×3 w/ exponential backoff, 4s timeout, ~35%
          transient failure rate). Superseded flights are <em>interrupted</em>, not ignored — Solid
          closes the stale iterator, <code>runEffect</code> interrupts the fiber.
        </p>
      </header>
      <input
        type="search"
        placeholder="Search packages… (try typing “solid” quickly)"
        value={query()}
        onInput={e => setQuery(e.currentTarget.value)}
        autofocus
      />
      <Show when={query().trim()}>
        {q => (
          <Errored
            fallback={(err, reset) => (
              <div class="error-box">
                <p>Search gave up after retries: {String(err())}</p>
                <button onClick={reset}>Try again</button>
              </div>
            )}
          >
            <Loading fallback={<p class="loading">Searching…</p>}>
              <Results results={results} query={q()} />
            </Loading>
          </Errored>
        )}
      </Show>
    </section>
  );
}
