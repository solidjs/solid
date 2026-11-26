import { expect, test } from "vitest";
import {
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

// `p` creates an async memo per run, and a render effect reads `p()()` under an
// error boundary. A first write re-runs `p` and the reader parks on the new
// memo, still loading. A second write in the same hold re-runs `p` again: that
// memo is disposed while loading, and its replacement fails. The reader
// re-parks with the error staged, and must stop waiting on the disposed memo:
// no walk will settle it, and a disposed source holds nothing (F-3). The hold
// lands once the async it waits on has answered (F-2).
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

test.each([1, 2])(
  "an error staged after %i write(s) re-running the owner of a loading memo shows",
  async writes => {
    const asks = new Map<number, { res: (v: string[]) => void; rej: (e: Error) => void }>();
    const [rev, setRev] = createSignal(0);
    let screen = "";
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const p = createMemo(() => {
        const r = rev();
        return createMemo(() => new Promise<string[]>((res, rej) => asks.set(r, { res, rej })));
      });
      createRenderEffect(
        createErrorBoundary(
          () => `${p()().length} rows`,
          e => `err ${(e() as Error).message}`
        ),
        v => {
          screen = v;
        }
      );
    });
    flush();
    asks.get(0)!.res(["a"]);
    await tick();
    expect(screen).toBe("1 rows");

    for (let r = 3 - writes; r <= 2; r++) {
      setRev(r);
      flush();
    }
    asks.get(2)!.rej(new Error("bad filters"));
    await tick();
    expect(screen).toBe("err bad filters");
    dispose();
  }
);
