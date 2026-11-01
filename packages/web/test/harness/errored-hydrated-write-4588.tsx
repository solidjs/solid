/**
 * @jsxImportSource @solidjs/web
 *
 * #4588: an `<Errored>` the server drew as its fallback, its content
 * reading `a`, an async memo keyed by the shell's source `k`. `reject`: `a`
 * rejects on `k = 1`; otherwise a sync memo `b` over it throws then.
 * `shell`: the Errored sits in the shell and a sibling `<Loading>` keeps the
 * stream (and hydration) open; otherwise it sits inside the streamed
 * `<Loading>`, so no node reads `k` until the fragment arrives. `inside`:
 * the memos are created in the Errored's content; otherwise just outside
 * the Errored that catches them.
 *
 * Compiled with both generates: test/server/errored-hydrated-write-4588.gen.spec.tsx
 * writes the chunks test/hydration/errored-hydrated-write-before-chunks-4588.spec.tsx
 * replays.
 */
import { createMemo, createSignal, Errored, Loading } from "solid-js";
import { isServer } from "@solidjs/web";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const RealPromise = Promise;

export type HydratedWriteShape = {
  place: "shell" | "streamed" | "around";
  inside: boolean;
  reject: boolean;
};
export const hydratedWriteShapes: HydratedWriteShape[] = [];
for (const place of ["around", "streamed", "shell"] as const)
  for (const inside of [true, false])
    for (const reject of [false, true]) hydratedWriteShapes.push({ place, inside, reject });
export const hydratedWriteName = (o: HydratedWriteShape) =>
  `errored-hydrated-write-4588-${o.place}${o.inside ? "-inside" : "-outside"}${o.reject ? "-reject" : "-throw"}`;

export function createHydratedWriteApp(o: HydratedWriteShape) {
  const [k, setK] = createSignal(1);
  const asks: string[] = [];
  const memos = () => {
    const a = createMemo(async () => {
      const v = k();
      // The hydration dry run computes under a mock Promise: count real asks only.
      if (!isServer && Promise === RealPromise) asks.push(`err:${v}`);
      // In the shell, the server answers before the shell flushes.
      if (!(o.place === "shell" && isServer)) await sleep(10);
      if (o.reject && v === 1) throw new Error("boom");
      return v;
    });
    if (o.reject) return a;
    return createMemo(() => {
      if (a() === 1) throw new Error("boom");
      return a();
    });
  };
  function Content(props: { b?: () => number }) {
    const b = props.b || memos();
    return <span>{b()}</span>;
  }
  function Guarded() {
    const b = o.inside ? undefined : memos();
    return (
      <Errored fallback={(_e: unknown) => "[ERR]"}>
        <Content b={b} />
      </Errored>
    );
  }
  function Slow() {
    const slow = createMemo(async () => {
      await sleep(30);
      return "slow";
    });
    return <b>{slow()}</b>;
  }
  function App() {
    // The Errored around the streamed Loading: the fragment's failure
    // reaches it after the shell flushed.
    if (o.place === "around") {
      const b = o.inside ? undefined : memos();
      return (
        <main>
          <Errored fallback={(_e: unknown) => "[ERR]"}>
            <Loading fallback="[LOAD]">
              <Content b={b} />
              <i>sib</i>
            </Loading>
          </Errored>
        </main>
      );
    }
    if (o.place === "shell")
      return (
        <main>
          <Guarded />
          <Loading fallback="[LOAD]">
            <Slow />
          </Loading>
        </main>
      );
    return (
      <main>
        <Loading fallback="[LOAD]">
          <Guarded />
          <i>sib</i>
        </Loading>
      </main>
    );
  }
  return { App, write: (v: number) => setK(v), asks: () => asks };
}
