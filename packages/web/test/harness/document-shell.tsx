/**
 * @jsxImportSource @solidjs/web
 *
 * Shared source for the document-shell hydration pattern tests (#3000).
 *
 * The supported way to server-render a full document while the client
 * hydrates only the app subtree: the document shell opts out of hydration
 * with <NoHydration> and re-enters with <Hydration> at the island position,
 * giving the subtree an id namespace that matches the client's hydrate()
 * root. Without this, the app's hydration ids are allocated under the
 * document component's owner tree and the client walk can never claim them.
 *
 * Compiled with the ssr generate by test/server/document-shell.spec.tsx
 * (which asserts APP_ROOT_MARKUP is exactly what the server emits) and with
 * the dom generate by test/hydration/document-shell.spec.tsx (which hydrates
 * against that same markup) — so the constant can't drift from either side.
 */
import { createSignal, createMemo, Loading, NoHydration, Hydration, Show } from "solid-js";
import { useHead, type JSX } from "@solidjs/web";

export function App() {
  const [count, setCount] = createSignal(0);
  return (
    <button id="counter" type="button" onClick={() => setCount(count() + 1)}>
      count: {count()}
    </button>
  );
}

/**
 * Async island: proves <Hydration> resets the REACTIVE id namespace too, not
 * just element keys — the memo's serialized record must land under island
 * ids (the server spec pins `_$HY.r["0"]`) and a hydrating client must adopt
 * it by id instead of re-running the compute (`computeRuns.client` stays 0;
 * the adopted value is one the client compute could never produce).
 */
export const computeRuns = { client: 0 };

export function AsyncApp() {
  const data = createMemo(async () => {
    await Promise.resolve();
    if (typeof window !== "undefined") {
      computeRuns.client++;
      return "client-data";
    }
    return "server-data";
  });
  const [n, setN] = createSignal(0);
  return (
    <Loading fallback={<span>loading</span>}>
      <span id="data">{data()}</span>
      <button id="bump" onClick={() => setN(n() + 1)}>
        n: {n()}
      </button>
    </Loading>
  );
}

export function Document(props: { children: JSX.Element }) {
  return (
    <html>
      <head></head>
      <body>
        <div id="app-root">
          <Hydration>{props.children}</Hydration>
        </div>
      </body>
    </html>
  );
}

export function Shell(props: { children: JSX.Element }) {
  return (
    <NoHydration>
      <Document>{props.children}</Document>
    </NoHydration>
  );
}

/** What the server renders inside #app-root for <Shell><App /></Shell>. */
export const APP_ROOT_MARKUP = `<button _hk=0 id="counter" type="button">count: <!--$-->0<!--/--></button>`;

/**
 * Whole-document hydration with useHead + shell-authored <head> children
 * (issue #3081). The charset registration is emitted as a prelude tag
 * spliced AHEAD of the shell's own head children — the claim walk must step
 * over it or the whole document dies on an off-by-one. The title
 * registration rewrites the shell's static <title> IN PLACE (data-dh +
 * data-dhf) — that element keeps its position and the walk must still take
 * it.
 */
export const [headShellStarted, setHeadShellStarted] = createSignal(false);

function HeadRegistrar() {
  useHead([
    { tag: "meta", props: { charset: "utf-8" }, key: "charset" },
    { tag: "title", props: { children: "managed title" } }
  ]);
  return null;
}

export function HeadShellApp() {
  return (
    <html lang="en">
      <head>
        <meta name="shell-owned" content="first" />
        <HeadRegistrar />
        <Show when={true}>
          <meta name="shell-owned-dynamic" content="marker-range" />
        </Show>
        <title>shell fallback title</title>
      </head>
      <body class={headShellStarted() ? "started" : ""}>
        <main>
          <h1>hello</h1>
          <p id="status">{headShellStarted() ? "started" : "waiting"}</p>
        </main>
      </body>
    </html>
  );
}
