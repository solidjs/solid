/**
 * @jsxImportSource @solidjs/web
 *
 * Fixture for the memo-shaped twin of solidjs/solid#3574: an
 * `ssrSource: "hybrid"` `createMemo` / function-form `createSignal` created
 * OUTSIDE a streamed `<Loading>` whose content reads it. The server suspends
 * the boundary (no loading window), flushes the fallback into the shell, and
 * streams the answer + fragment later. The client adopts the answer, hands
 * off to its own source (hydrateSignalLike, #2993), and the boundary resumes
 * to claim the fragment — the ordering #3574 is about, on the value-shaped
 * takeover instead of the store's.
 *
 * Shared by test/server/hybrid-memo-handoff.spec.tsx (ssr generate, writes
 * the chunk artifacts) and test/hydration/hybrid-memo-handoff.spec.tsx (dom
 * generate, replays them).
 *
 * `control` is the source's await points. On the server (and by default)
 * they are short timers so the stream settles on its own; the hydrate spec
 * swaps them for gates it releases, so every step of the handoff is observed
 * deterministically rather than raced against wall-clock.
 */
import { createMemo, createSignal, Loading } from "solid-js";

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export const control = {
  first: (): Promise<void> => sleep(5),
  second: (): Promise<void> => sleep(5),
  onStart: (): void => {}
};

async function* generatorSource() {
  control.onStart();
  await control.first();
  yield "true:0";
  await control.second();
  yield "true:10";
}

async function promiseSource() {
  control.onStart();
  await control.first();
  return "true:0";
}

function View(props: { value: () => string }) {
  return (
    <section>
      <Loading fallback={<span>loading</span>}>
        <span>{props.value()}</span>
      </Loading>
    </section>
  );
}

/** Memo over a generator: two yields, the first duplicating the server answer. */
export function MemoGeneratorApp() {
  const value = createMemo(generatorSource, { ssrSource: "hybrid" });
  return <View value={value} />;
}

/** Function-form signal over the same generator. */
export function SignalGeneratorApp() {
  const [value] = createSignal(generatorSource, { ssrSource: "hybrid" });
  return <View value={value} />;
}

/** Memo over a promise-shaped source: one answer. */
export function MemoPromiseApp() {
  const value = createMemo(promiseSource, { ssrSource: "hybrid" });
  return <View value={value} />;
}

/** Function-form signal over the promise-shaped source. */
export function SignalPromiseApp() {
  const [value] = createSignal(promiseSource, { ssrSource: "hybrid" });
  return <View value={value} />;
}

/**
 * `takeover`: whether the client source continues the adopted answer at its
 * landing. Generator-shaped hybrid computes hand off to the client iteration
 * (#2993); promise-shaped ones adopt the serialized value and do not hand off
 * (#2993 — a handoff would be a client refetch): for them "hybrid" is
 * identical to "server", and the client compute does not run until a
 * dependency changes or refresh() — not at the landing, not at hydration end.
 */
export const variants = [
  {
    name: "hybrid-memo-handoff-memo-generator",
    App: MemoGeneratorApp,
    steps: ["true:0", "true:10"],
    takeover: true
  },
  {
    name: "hybrid-memo-handoff-signal-generator",
    App: SignalGeneratorApp,
    steps: ["true:0", "true:10"],
    takeover: true
  },
  {
    name: "hybrid-memo-handoff-memo-promise",
    App: MemoPromiseApp,
    steps: ["true:0"],
    takeover: false
  },
  {
    name: "hybrid-memo-handoff-signal-promise",
    App: SignalPromiseApp,
    steps: ["true:0"],
    takeover: false
  }
] as const;
