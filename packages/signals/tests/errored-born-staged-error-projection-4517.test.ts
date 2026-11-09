import { expect, it } from "vitest";
import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray,
  untrack
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

type Row = { id: number; name: string };

for (const keyed of [true, false])
  it(`an answer replaces the error a boundary was born with (projection: ${keyed}) (#4517)`, async () => {
    const asks: { key: string; res: (v: Row[]) => void }[] = [];
    const ask = (key: string) => new Promise<Row[]>(res => asks.push({ key, res }));
    const land = async (key: string, v: Row[]) => {
      for (const a of asks.filter(a => a.key === key)) {
        asks.splice(asks.indexOf(a), 1);
        a.res(v);
      }
      await tick();
    };
    const [q, setQ] = createSignal("");
    let screen: unknown;
    const dispose = createRoot(d => {
      const src = createMemo(() => {
        const s = q();
        if (s === "") return [] as Row[];
        if (s.length < 2) throw new Error("too short");
        return ask(`search:${s}`);
      });
      const results: () => Row[] = keyed
        ? (() => {
            const p = createProjection(() => src(), [] as Row[], { key: "id" });
            return () => p;
          })()
        : src;
      const show = createMemo(() => q() !== "");
      const out = createMemo(() => {
        if (!show()) return undefined;
        return untrack(() =>
          createErrorBoundary(
            () =>
              createLoadingBoundary(
                () => mapArray(results, r => r.name),
                () => "loading"
              ),
            e => `E:${(e() as Error).message}`
          )
        );
      });
      const resolve = (v: unknown): unknown =>
        typeof v === "function" ? resolve(v()) : Array.isArray(v) ? v.join("") : v;
      createRenderEffect(
        () => resolve(out()),
        v => void (screen = v)
      );
      return d;
    });
    await tick();
    expect(screen).toBe(undefined);
    setQ("a");
    await tick();
    expect(screen).toBe("E:too short");
    setQ("ap");
    await tick();
    expect(screen).toBe("E:too short");
    await land("search:ap", [
      { id: 1, name: "apple" },
      { id: 2, name: "apricot" }
    ]);
    expect(screen).toBe("appleapricot");
    dispose();
  });
