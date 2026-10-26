import { describe, expect, it } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
  untrack
} from "../src/index.js";

// #4269 (D-30, S-37 row 2): a derived store's leaves report the derive's
// new-question refetch like any async memo — also when the verdict is read in
// the same computation as the value, under a boundary that has shown content.
describe("#4269 derived store per-key isPending under a revealed boundary", () => {
  const tick = async () => {
    await new Promise(r => setTimeout(r, 0));
    flush();
    await new Promise(r => setTimeout(r, 0));
    flush();
  };

  async function run(kind: "store" | "memo", where: "boundary" | "none") {
    const flights = new Map<string, { p: Promise<any>; resolve: (v: any) => void }>();
    const fetchKey = (key: string) => {
      if (!flights.has(key)) {
        let resolve!: (v: any) => void;
        const p = new Promise(r => (resolve = r));
        flights.set(key, { p, resolve });
      }
      return flights.get(key)!.p;
    };
    const land = async (key: string, v: any) => {
      flights.get(key)!.resolve(v);
      await tick();
    };
    let screen = "";
    const [id, setId] = createSignal(1);
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      let a: () => any;
      if (kind === "store") {
        const [state] = createStore<any>(async (draft: any) => {
          const v = await fetchKey("s:" + id());
          Object.assign(draft, v);
        }, {});
        a = () => state.a;
      } else {
        const m = createMemo(() => fetchKey("s:" + id()));
        a = () => (m() as any).a;
      }
      const view = () => `${a()} ${isPending(a) ? "pending" : "-"}`;
      const out =
        where === "boundary" ? untrack(() => createLoadingBoundary(view, () => "loading")) : view;
      createRenderEffect(
        () => out(),
        v => {
          screen = v as string;
        }
      );
    });
    flush();
    await tick();
    await land("s:1", { a: 1, b: 1 });
    expect(screen).toBe("1 -");
    setId(2);
    flush();
    await tick();
    const pending = screen;
    await land("s:2", { a: 2, b: 2 });
    const landed = screen;
    dispose();
    return [pending, landed];
  }

  it("store under a boundary reports pending on the re-ask", async () => {
    expect(await run("store", "boundary")).toEqual(["1 pending", "2 -"]);
  });
  it("memo under a boundary (control)", async () => {
    expect(await run("memo", "boundary")).toEqual(["1 pending", "2 -"]);
  });
  it("store without a boundary (control)", async () => {
    expect(await run("store", "none")).toEqual(["1 pending", "2 -"]);
  });
});
