/**
 * @jsxImportSource @solidjs/web
 *
 * #4588: an `<Errored>` over a streamed `<Loading>` whose content reads an
 * async memo `a1` keyed by `s0`. The server streams the Loading's fallback,
 * then `a1` rejects and the fragment carries the Errored fallback with the
 * error at the Errored id. The client hydrates in that window and writes
 * `s0`, before or after the fragment arrives.
 *
 * `inside` (the issue): `a1` is created in the Loading's content, so it does
 * not exist until the boundary resumes. `shell`: `a1` is created in the
 * shell, outside both boundaries.
 *
 * Compiled with both generates: test/server/hydration-errored-write-4588.gen.spec.tsx
 * writes the chunks test/hydration/hydration-errored-write-4588.spec.tsx replays.
 */
import { createMemo, createSignal, Errored, Loading } from "solid-js";
import { isServer } from "@solidjs/web";

const RealPromise = Promise;

export type ErroredWriteShape = "shell" | "inside";
export const erroredWriteShapes: ErroredWriteShape[] = ["shell", "inside"];
export const erroredWriteName = (o: ErroredWriteShape) => `hydration-errored-write-4588-${o}`;

export function createErroredWriteApp(o: ErroredWriteShape) {
  const [s0, setS0] = createSignal(0);
  const asks: string[] = [];
  const flights = new Map<string, { p: Promise<number>; resolve: (v: number) => void }>();
  const ask = (key: string): Promise<number> => {
    // The server rejects the first key and answers 10 to any other.
    if (isServer)
      return new RealPromise((r, j) =>
        setTimeout(() => (key === "err:0" ? j(new Error(key)) : r(10)), 20)
      );
    if (Promise === RealPromise) asks.push(key);
    let f = flights.get(key);
    if (!f) {
      let resolve!: (v: number) => void;
      const p = new RealPromise<number>(r => (resolve = r));
      flights.set(key, (f = { p, resolve }));
    }
    return f.p;
  };
  function Content(props: { a1?: () => number }) {
    const a1 = props.a1 || createMemo(() => ask("err:" + s0()));
    return <p>a1={a1()}</p>;
  }
  function App() {
    const a1 = o === "shell" ? createMemo(() => ask("err:" + s0())) : undefined;
    return (
      <main>
        <Errored fallback={(e: any) => <p>{e().message}</p>}>
          <Loading fallback={<p>F0</p>}>
            <Content a1={a1} />
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
