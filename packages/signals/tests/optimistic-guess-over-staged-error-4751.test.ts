// #4751: two actions guess on one `createOptimistic` (same slot: their holds
// entangle, D-33), and a refresh one of them made fails while the other's
// guess is out. The failure lands on a held node: it is staged with the hold
// (D-41), and the screen keeps the guesses (F-11, D-34). A reader of the guess
// in the guess's own lane reads the guess, not the truth staged beneath it;
// marking it with the staged error let the lane's seam publish the error now,
// beside readers that kept the guesses (a torn screen, F-1). The same steps
// run against the source and each built tier: the dev build used to show the
// error early where the production build did not.
import { describe, expect, test } from "vitest";
import * as source from "../src/index.js";

const cores: Record<string, () => Promise<any>> = {
  source: async () => source,
  prod: () => import("../dist/prod/index.js"),
  observe: () => import("../dist/observe/index.js"),
  dev: () => import("../dist/dev.js")
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function run(core: any, finalRejects: boolean): Promise<string[]> {
  const {
    action,
    createErrorBoundary,
    createLoadingBoundary,
    createMemo,
    createOptimistic,
    createRenderEffect,
    createRoot,
    createSignal,
    mapArray,
    refresh
  } = core;
  const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
  const pick = (key: string) => {
    const i = asks.findIndex(a => a.key === key);
    expect(i, `${key} asked`).not.toBe(-1);
    return asks.splice(i, 1)[0];
  };
  const seen: string[] = [];
  let list = "",
    count = "";
  let assign!: (id: number) => any, close!: (id: number) => any;
  const dispose = createRoot((dispose: () => void) => {
    const [filter] = createSignal("open");
    const issues = createMemo(() => ask(`fetch:${filter()}`));
    const [truth] = createSignal(() =>
      (issues() as any[]).map(x => ({ id: x.id, assignee: x.assignee, closed: false }))
    );
    const [rows, setRows] = createOptimistic(() => truth());
    assign = action(function* (id: number) {
      setRows((rs: any[]) => rs.map(r => (r.id === id ? { ...r, assignee: "guest" } : r)));
      yield ask(`assign:${id}`);
      refresh(issues);
      refresh(truth);
    });
    close = action(function* (id: number) {
      setRows((rs: any[]) => rs.map(r => (r.id === id ? { ...r, closed: true } : r)));
      yield ask(`close:${id}`);
      refresh(issues);
      refresh(truth);
    });
    const open = () => (rows() as any[]).filter(r => !r.closed);
    // `<Loading on><Errored><For>` around the list ...
    const out = createLoadingBoundary(
      () =>
        createErrorBoundary(
          () => {
            const mapped = mapArray(
              open,
              (r: any) => `#${r.id}${r.assignee ? `(${r.assignee})` : ""}`
            );
            return createMemo(() => mapped().join(" "));
          },
          (e: any) => `error: ${e().message}`
        ),
      () => "loading",
      { on: filter }
    );
    createRenderEffect(out, (v: any) => void (list = String(typeof v === "function" ? v() : v)));
    // ... and a count of the same rows shown elsewhere, behind its own boundaries.
    const n = createLoadingBoundary(
      () =>
        createErrorBoundary(
          () => createMemo(() => String(open().length)),
          (e: any) => `error: ${e().message}`
        ),
      () => "loading"
    );
    createRenderEffect(n, (v: any) => void (count = String(typeof v === "function" ? v() : v)));
    return dispose;
  });
  const step = async (fn: () => void) => {
    fn();
    await sleep(5);
    seen.push(`${list} | ${count}`);
  };
  await step(() => {});
  await step(() => pick("fetch:open").res([{ id: 1 }, { id: 3 }, { id: 4 }]));
  await step(() => assign(4));
  await step(() => pick("assign:4").res({}));
  await step(() => close(1));
  await step(() => pick("fetch:open").rej(new Error("down")));
  await step(() => close(4));
  await step(() => pick("close:1").res({}));
  await step(() => pick("fetch:open").rej(new Error("down again")));
  await step(() => pick("close:4").res({}));
  await step(() =>
    finalRejects ? pick("fetch:open").rej(new Error("final")) : pick("fetch:open").res([{ id: 3 }])
  );
  dispose();
  return seen;
}

const held = [
  "loading | loading",
  "#1 #3 #4 | 3",
  "#1 #3 #4(guest) | 3",
  "#1 #3 #4(guest) | 3",
  "#3 #4(guest) | 2",
  // The refresh failed while close(1)'s guess is out: staged with the hold.
  "#3 #4(guest) | 2",
  "#3 | 1",
  "#3 | 1",
  "#3 | 1",
  "#3 | 1"
];

describe.each(Object.keys(cores))("%s", tier => {
  test("a failure staged under a guess waits with the hold; the list and the count agree", async () => {
    expect(await run(await cores[tier](), false)).toEqual([...held, "#3 | 1"]);
  });

  test("a failure that is the answer when the hold commits shows on both readers", async () => {
    expect(await run(await cores[tier](), true)).toEqual([...held, "error: final | error: final"]);
  });
});
