// The client shell of a compiled server-component page, shared by
// sc-base.jsx and sc-live.jsx: what surrounds the server component on a page
// an application actually ships. The hand-written sc-base-app.js /
// sc-live-app.js keep the same runtime pieces alive as values and never
// compile a template, so the attribute runtime a compiled template imports
// — `className`, `style`, `setAttribute`, `addEvent`, `delegateEvents` —
// reaches those pages only through the bind tier's `assign` edge, and a
// change that "removes" it there removes nothing from a real one. Here it
// is reached the way compiled templates reach it. Each construct is here
// because a real page has it:
//
// - a nav of links: `href` from a prop (`setAttribute`), `class` and `style`
//   as dynamic values rather than object literals (the `className` / `style`
//   runtime, not the compiler's static `classList.toggle` /
//   `setStyleProperty` forms), the click handler passed through as a prop
//   (`addEvent`: the compiler cannot see that `props.onSelect` is a function,
//   so it defers the delegated/direct decision to the runtime);
// - a search input with a `value` binding (`setProperty`) and a delegated
//   `onInput`;
// - a `<For>` over the tabs and a `<Show>` with a function child;
// - the client signal + memo the hand-written pages keep (`d`), `<Errored>`
//   and `<Loading>` around the server component, a `lazy()` child under its
//   own `<Loading>` (the lazy chunk is reported, not counted).
//
// NO element spread (maintainer's ruling, 2026-10-07: most server-component
// apps do not have client element spreads — the compiled baseline must not
// carry one). `spread` / `assign` / `assignProp` and the store `merge` /
// `omit` view records `spread` reads a source through must be absent from
// these pages; the ledger in scenarios.js records the check.
//
// The server component itself is `props.children` — mounted by the entry
// through `dynamicComponent()` over a server-function reference, as the
// hand-written pages mount it.
import { createMemo, createSignal, lazy } from "solid-js";

const Comments = lazy(() => import("./sc-comments.jsx"));

function Tab(props) {
  return (
    <a href={props.href} class={props.class} style={props.style} onClick={props.onSelect}>
      {props.children}
    </a>
  );
}

const TABS = ["Top", "New", "Ask"];

export default function Shell(props) {
  const [tab, setTab] = createSignal(0);
  const [query, setQuery] = createSignal("");
  const label = createMemo(() => TABS[tab()]);
  return (
    <main class="page">
      <nav class="tabs">
        <For each={TABS}>
          {(name, i) => (
            <Tab
              href={`/${name.toLowerCase()}`}
              class={tab() === i() ? "tab active" : "tab"}
              style={{ "--i": i() }}
              onSelect={() => setTab(i())}
            >
              {name}
            </Tab>
          )}
        </For>
        <input
          type="search"
          placeholder="Search"
          value={query()}
          onInput={e => setQuery(e.target.value)}
        />
      </nav>
      <Show when={query()} fallback={<h1>{label()}</h1>}>
        {q => <h1>Results for “{q()}”</h1>}
      </Show>
      <Errored fallback={err => <p class="error">{err().message}</p>}>
        <Loading fallback={<p>Loading story…</p>}>{props.children}</Loading>
      </Errored>
      <Loading fallback={<p>Loading comments…</p>}>
        <Comments id={props.id} />
      </Loading>
    </main>
  );
}
