/**
 * @jsxImportSource @solidjs/web
 *
 * Three <Loading> boundaries whose content creates its own async reads, so
 * the shell carries each read's record still pending. The chunk at 5 ms
 * settles two of them: `b:fast` with its value, and `c:bad` with the
 * server's error, which an <Errored> inside C's content catches. The
 * fragments land at 40 ms, with the slow reads.
 *
 * Ending the document after that first chunk is a truncated stream: each
 * boundary's fragment is cut, and the client renders it fresh. The fresh
 * render adopts what the server sent (`b:fast`'s value, `c:bad`'s error)
 * and computes the reads the server never answered (the three slow ones).
 *
 * Compiled with both generates: test/server/truncated-fragment-fresh-render.gen.spec.tsx
 * writes the chunks test/hydration/truncated-fragment-fresh-render.spec.tsx replays.
 */
import { createMemo, Errored, Loading } from "solid-js";
import { isServer } from "@solidjs/web";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const RealPromise = Promise;

export function createTruncatedFragmentApp() {
  const asks: string[] = [];
  // A node adopting its record still runs its compute once, to track its
  // sources, under a mocked Promise: only a real ask counts.
  const ask = (name: string, ms: number) => {
    if (!isServer && Promise === RealPromise) asks.push(name);
    return sleep(ms).then(() => {
      if (isServer && name === "c:bad") throw new Error("c:bad failed");
      return name;
    });
  };
  function Read(props: { name: string; ms: number }) {
    const value = createMemo(() => ask(props.name, props.ms));
    return <span>{value()}</span>;
  }
  function App() {
    return (
      <main>
        <Loading fallback="[A]">
          <Read name="a:slow" ms={40} />
        </Loading>
        <Loading fallback="[B]">
          <Read name="b:fast" ms={5} />
          <Read name="b:slow" ms={40} />
        </Loading>
        <Loading fallback="[C]">
          <Errored fallback={(e: any) => <b>{e().message}</b>}>
            <Read name="c:bad" ms={5} />
          </Errored>
          <Read name="c:slow" ms={40} />
        </Loading>
      </main>
    );
  }
  return { App, asks: () => asks };
}
