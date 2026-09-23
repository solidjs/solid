/**
 * @jsxImportSource @solidjs/web
 *
 * Fixture for solidjs/solid#3574: an `ssrSource: "hybrid"` store created
 * OUTSIDE a streamed `<Loading>` whose content reads it. The server suspends
 * the boundary (the store has no loading window), flushes the fallback into
 * the shell, and streams the answer + fragment later. The client adopts the
 * answer, hands off to its own source, and the boundary resumes to claim the
 * fragment — the ordering the issue is about.
 *
 * Shared by test/server/hybrid-store-handoff-3574.spec.tsx (ssr generate,
 * writes the chunk artifacts) and test/hydration/hybrid-store-handoff-3574
 * .spec.tsx (dom generate, replays them).
 *
 * `control` is the source's await points. On the server (and by default)
 * they are short timers so the stream settles on its own; the hydrate spec
 * swaps them for gates it releases, so every step of the handoff is observed
 * deterministically rather than raced against wall-clock.
 */
import { createStore, Loading } from "solid-js";

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export const control = {
  first: (): Promise<void> => sleep(5),
  second: (): Promise<void> => sleep(5),
  onStart: (): void => {}
};

type State = { ready: boolean; count: number };

/** Generator-shaped source: two yields, the first duplicating the server answer. */
export function GeneratorApp() {
  const [state] = createStore<State>(
    async function* (draft) {
      control.onStart();
      await control.first();
      draft.ready = true;
      draft.count = 0;
      yield;
      await control.second();
      draft.count = 10;
      yield;
    },
    { ready: false, count: -1 },
    { ssrSource: "hybrid", shallow: true }
  );
  return (
    <section>
      <Loading fallback={<span>loading</span>}>
        <span>{`${state.ready}:${state.count}`}</span>
      </Loading>
    </section>
  );
}

/** Promise-shaped (RETURN-style) source: one answer. */
export function PromiseApp() {
  const [state] = createStore<State>(
    async () => {
      control.onStart();
      await control.first();
      return { ready: true, count: 0 };
    },
    { ready: false, count: -1 },
    { ssrSource: "hybrid" }
  );
  return (
    <section>
      <Loading fallback={<span>loading</span>}>
        <span>{`${state.ready}:${state.count}`}</span>
      </Loading>
    </section>
  );
}

export const variants = [
  { name: "hybrid-store-handoff-3574-generator", App: GeneratorApp, steps: ["true:0", "true:10"] },
  { name: "hybrid-store-handoff-3574-promise", App: PromiseApp, steps: ["true:0"] }
] as const;
