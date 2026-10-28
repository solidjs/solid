/**
 * @jsxImportSource @solidjs/web
 *
 * #4375: an async memo `m0` the server answers with a rejection, read only
 * through a dependent async memo `m1` whose pending state the page shows
 * (`isPending(m1)`), so no Errored ever sees the error. `m0` reads its
 * input `s` both through `latest(s)` and `s()`. The server streams `m0`'s
 * rejection with the Loading's fragment; the hydrating client claims it and
 * never asks `m0` (or `m1`) again until `s` changes.
 *
 * Compiled with both generates: test/server/errored-pending-reask-4375.gen.spec.tsx
 * writes the chunks test/hydration/errored-pending-reask-4375.spec.tsx replays.
 */
import { createMemo, createSignal, Errored, isPending, latest, Loading, Show } from "solid-js";
import { isServer } from "@solidjs/web";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const RealPromise = Promise;

/**
 * `latest`: `m0` reads `latest(s)` beside `s()` (the issue; without it, the
 * control). `inside`: the memos are created in the Loading's content, not
 * the shell. `slow`: a second Loading, still streaming, keeps hydration open
 * past the first boundary's resume (the spec writes `s` then).
 */
export type PendingReaskShape = {
  latest: boolean;
  inside?: boolean;
  slow?: boolean;
  show?: boolean;
};
export const pendingReaskShapes: PendingReaskShape[] = [
  { latest: true },
  { latest: false },
  { latest: true, inside: true },
  { latest: true, slow: true },
  { latest: true, show: true },
  { latest: true, inside: true, show: true }
];
export const pendingReaskName = (o: PendingReaskShape) =>
  `errored-pending-reask-4375${o.latest ? "-latest" : ""}${o.inside ? "-inside" : ""}${o.slow ? "-slow" : ""}${o.show ? "-show" : ""}`;

export function createPendingReaskApp(o: PendingReaskShape) {
  const [s, setS] = createSignal(1);
  const asks: string[] = [];
  const ask = (name: string, v: number) => {
    if (!isServer && Promise === RealPromise) asks.push(`${name}:${v}`);
    return sleep(10).then(() => {
      if (v === 3) throw new Error(`${name}:${v}`);
      return v;
    });
  };
  const memos = () => {
    const m0 = createMemo(() => ask("m0", 1 + (o.latest ? latest(s) : s()) + s()));
    return createMemo(() => ask("m1", 1 + m0()));
  };
  function Pending(props: { m1?: () => number }) {
    const m1 = props.m1 || memos();
    return <span>{String(isPending(m1))}</span>;
  }
  function App() {
    const m1 = o.inside ? undefined : memos();
    const slow = createMemo(async () => {
      await sleep(o.slow ? 60 : 0);
      return "slow";
    });
    return (
      <main>
        <Errored fallback={(_e: unknown) => "[ROOT-E]"}>
          <Loading fallback="[ROOT-L]">
            {o.show ? (
              <Show when={true}>
                <Pending m1={m1} />
              </Show>
            ) : (
              <Pending m1={m1} />
            )}
          </Loading>
          {o.slow && (
            <Loading fallback="[SLOW-L]">
              <b>{slow()}</b>
            </Loading>
          )}
        </Errored>
      </main>
    );
  }
  return { App, write: (v: number) => setS(v), asks: () => asks };
}
