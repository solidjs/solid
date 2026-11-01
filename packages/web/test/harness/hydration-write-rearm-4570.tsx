/**
 * @jsxImportSource @solidjs/web
 *
 * #4570: a `<Loading on={s0()}>` nested in a streamed `<Loading>`. The
 * server streams the outer fallback and holds the stream open while `a1`
 * is out. The client hydrates in that window and writes `s0` before the
 * server's answer arrives.
 *
 * `shared` (the issue): the inner content reads `latest(a1)`, `a1` is keyed
 * by `s0` and also read in the outer boundary, outside the inner one.
 * `own`: `a1` is not keyed by `s0`; the inner content reads its own async
 * `a2` keyed by `s0`, which nothing outside the inner boundary reads.
 *
 * Compiled with both generates: test/server/hydration-write-rearm-4570.gen.spec.tsx
 * writes the chunks test/hydration/hydration-write-rearm-4570.spec.tsx replays.
 */
import { createMemo, createSignal, Errored, latest, Loading } from "solid-js";
import { isServer } from "@solidjs/web";

const RealPromise = Promise;

export type WriteRearmShape = "shared" | "own";
export const writeRearmShapes: WriteRearmShape[] = ["shared", "own"];
export const writeRearmName = (o: WriteRearmShape) => `hydration-write-rearm-4570-${o}`;

export function createWriteRearmApp(o: WriteRearmShape) {
  const [s0, setS0] = createSignal(0);
  const asks: string[] = [];
  const flights = new Map<string, { p: Promise<number>; resolve: (v: number) => void }>();
  const ask = (key: string): Promise<number> => {
    // The server answers 10 to everything; `a2` before `a1`, so the outer
    // boundary's fragment carries the inner content, not its fallback.
    if (isServer) return new RealPromise(r => setTimeout(() => r(10), key[1] === "2" ? 10 : 20));
    if (Promise === RealPromise) asks.push(key);
    let f = flights.get(key);
    if (!f) {
      let resolve!: (v: number) => void;
      const p = new RealPromise<number>(r => (resolve = r));
      flights.set(key, (f = { p, resolve }));
    }
    return f.p;
  };
  function App() {
    const a1 = createMemo(() => ask(o === "shared" ? "a1:" + s0() : "a1"));
    const a2 = o === "own" ? createMemo(() => ask("a2:" + s0())) : undefined;
    return (
      <main>
        <Errored fallback={<p>error</p>}>
          <Loading fallback={<p>F0</p>}>
            <Loading on={s0()} fallback={<p>F1</p>}>
              {a2 ? <i>La2={a2()}</i> : <i>La1={latest(a1)}</i>}
            </Loading>
            <p>a1={a1()}</p>
          </Loading>
        </Errored>
      </main>
    );
  }
  return {
    App,
    write: (v: number) => setS0(v),
    land: (key: string, v: number) => flights.get(key)?.resolve(v),
    asks: () => asks
  };
}
