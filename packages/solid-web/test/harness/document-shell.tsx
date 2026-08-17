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
import { createSignal, NoHydration, Hydration, type JSX } from "solid-js";

export function App() {
  const [count, setCount] = createSignal(0);
  return (
    <button id="counter" type="button" onClick={() => setCount(count() + 1)}>
      count: {count()}
    </button>
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
