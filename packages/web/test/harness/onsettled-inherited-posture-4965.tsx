/**
 * @jsxImportSource @solidjs/web
 *
 * Fixture for solidjs/solid#4965: after hydration, a write made in
 * `onSettled` must land when a memo only inherits a `latest()` memo's
 * verdict posture and feeds a client-only async memo and a server-adopted
 * live memo rendered under nested `<Show>`s. Compiled with both generates:
 * test/server/onsettled-inherited-posture-4965.gen.spec.tsx writes the
 * chunks test/hydration/onsettled-inherited-posture-4965.spec.tsx replays.
 */
import { Show, createMemo, createSignal, latest, onSettled } from "solid-js";
import { isServer } from "@solidjs/web";

// A live source branded as @solidjs/router's liveQuery brands one: the server
// serializes its first value; after hydration the client re-runs the compute
// to continue it. This one answers once and stays open.
async function* gen<T>(value: T) {
  yield value;
  await new Promise(() => {});
}
function live<T>(value: T) {
  const it = gen(value);
  (it as any)[Symbol.for("solid.LiveSource")] = true;
  return it;
}

export function App() {
  const list = createMemo(() => live(["a"]));
  const activeId = createMemo(() => latest(list)?.[0]);
  const scope = createMemo(() => activeId());
  createMemo(() => (scope() ? live("rows") : undefined), { ssrSource: "client" });
  const overview = createMemo(() => (scope() ? live("free") : undefined));
  const [done, setDone] = createSignal(false);
  onSettled(() => {
    if (isServer) return;
    setDone(true);
  });
  return (
    <main>
      <p id="hydrated">{done() ? "yes" : "no"}</p>
      <Show when={overview()}>
        {at => {
          return (
            <section id="block">
              <Show when={latest(list)?.[0]}>{at()}</Show>
            </section>
          );
        }}
      </Show>
    </main>
  );
}
