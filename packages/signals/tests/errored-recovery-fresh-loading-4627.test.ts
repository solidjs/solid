import { expect, it } from "vitest";
import {
  action,
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest,
  refresh
} from "../src/index.js";

// #4627: `<Loading><Errored>[detail]<Loading>[related]</Loading></Errored></Loading>`
// with `related` a search keyed on the loaded `detail().title`. `detail`
// rejects and the error shows; `refresh(detail)` answers with a value.
// Ruled 2026-11-02 (D-39): while an `<Errored>` shows its fallback nothing
// under it is on screen, so its recovery re-arms the whole subtree — every
// `<Loading>` under it has not shown content, and catches what is still
// pending in the replacement frame (F-4, D-12: #3540, #3977):
// `[Crash][finding related]`, as a first load shows. The error stays while
// something no inner `Loading` catches still waits: the errored source's
// own re-ask, a pending read directly under the `Errored` (a pending is not
// a value), a recovery held with a write or action (D-41).
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

type Where = "outside" | "inside" | "control";

async function run(where: Where) {
  const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
  const settle = async (key: string, f: (a: (typeof asks)[number]) => void) => {
    const i = asks.findIndex(a => a.key === key);
    expect(i, `flight ${key}`).toBeGreaterThan(-1);
    f(asks.splice(i, 1)[0]);
    await tick();
  };
  const cells: { title?: unknown; related?: unknown } = {};
  let shown: unknown;
  const screen = () => {
    const outer = shown as any;
    if (typeof outer === "string") return outer;
    const [err, inner] = outer as [unknown, unknown];
    if (typeof err === "string") return err;
    return `[${cells.title}]${inner === "related" ? `[related ${cells.related}]` : inner}`;
  };
  let detail!: () => any;
  const dispose = createRoot(dispose => {
    detail = createMemo(() => ask("detail"));
    const outer = where === "outside" ? createMemo(() => ask(`search:${detail().title}`)) : null;
    const view = createLoadingBoundary(
      () =>
        createErrorBoundary(
          () => {
            createRenderEffect(
              () => detail().title,
              v => void (cells.title = v)
            );
            const inner = createLoadingBoundary(
              () => {
                const related = outer ?? createMemo(() => ask(`search:${detail().title}`));
                createRenderEffect(
                  () => related().length,
                  v => void (cells.related = v)
                );
                return "related";
              },
              () => "[finding related]"
            );
            return [null, inner] as const;
          },
          (e: any) => `[error ${e().message}]`
        ),
      () => "[loading detail]"
    );
    createRenderEffect(view, v => void (shown = v));
    return dispose;
  });
  const frames: string[] = [];
  await tick();
  frames.push(screen());
  if (where !== "control") {
    await settle("detail", a => a.rej(new Error("not found")));
    frames.push(screen());
    refresh(detail);
    await tick();
    frames.push(screen());
  }
  await settle("detail", a => a.res({ title: "Crash" }));
  frames.push(screen());
  await settle("search:Crash", a => a.res([1, 2]));
  frames.push(screen());
  dispose();
  return frames;
}

it("control: a first load shows the content with the inner fallback (#4627)", async () => {
  expect(await run("control")).toEqual([
    "[loading detail]",
    "[Crash][finding related]",
    "[Crash][related 2]"
  ]);
});

for (const where of ["outside", "inside"] as const)
  it(`recovery: the search memo created ${where} the inner Loading — its fresh fallback replaces the error (#4627)`, async () => {
    expect(await run(where)).toEqual([
      "[loading detail]",
      "[error not found]",
      "[error not found]",
      "[Crash][finding related]",
      "[Crash][related 2]"
    ]);
  });

it("content an inner Loading chose behind the error has shown once the error gives way: a later re-ask holds it (F-4, #4627)", async () => {
  const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
  const settle = async (key: string, f: (a: (typeof asks)[number]) => void) => {
    const i = asks.findIndex(a => a.key === key);
    expect(i, `flight ${key}`).toBeGreaterThan(-1);
    f(asks.splice(i, 1)[0]);
    await tick();
  };
  const [k, setK] = createSignal(1);
  const cells: { title?: unknown; n?: unknown } = {};
  let shown: any;
  const screen = () =>
    typeof shown === "string"
      ? shown
      : typeof shown[0] === "string"
        ? shown[0]
        : `[${cells.title}]${shown[1] === "n" ? `[n ${cells.n}]` : shown[1]}`;
  let detail!: () => any;
  const dispose = createRoot(dispose => {
    detail = createMemo(() => ask("detail"));
    const n = createMemo(() => ask(`n:${k()}`));
    const view = createLoadingBoundary(
      () =>
        createErrorBoundary(
          () => {
            createRenderEffect(
              () => detail().title,
              v => void (cells.title = v)
            );
            const inner = createLoadingBoundary(
              () => {
                createRenderEffect(n, v => void (cells.n = v));
                return "n";
              },
              () => "[finding n]"
            );
            return [null, inner] as const;
          },
          (e: any) => `[error ${e().message}]`
        ),
      () => "[loading detail]"
    );
    createRenderEffect(view, v => void (shown = v));
    return dispose;
  });
  const frames: string[] = [];
  await tick();
  await settle("detail", a => a.rej(new Error("not found")));
  frames.push(screen());
  // The inner content is ready behind the error.
  await settle("n:1", a => a.res(1));
  frames.push(screen());
  refresh(detail);
  await tick();
  await settle("detail", a => a.res({ title: "Crash" }));
  frames.push(screen());
  // Shown now: a re-ask keeps the content on screen until it answers.
  setK(2);
  await tick();
  frames.push(screen());
  await settle("n:2", a => a.res(2));
  frames.push(screen());
  dispose();
  expect(frames).toEqual([
    "[error not found]",
    "[error not found]",
    "[Crash][n 1]",
    "[Crash][n 1]",
    "[Crash][n 2]"
  ]);
});

type Shape = "after-shown" | "no-inner-loading" | "action";

// The same tree, driven through the other recoveries the ruling names.
async function shape(kind: Shape) {
  const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
  const settle = async (key: string, f: (a: (typeof asks)[number]) => void) => {
    const i = asks.findIndex(a => a.key === key);
    expect(i, `flight ${key}`).toBeGreaterThan(-1);
    f(asks.splice(i, 1)[0]);
    await tick();
  };
  const [id, setId] = createSignal(0);
  const cells: { title?: unknown; related?: unknown } = {};
  let shown: any;
  const screen = () =>
    typeof shown === "string"
      ? shown
      : typeof shown[0] === "string"
        ? shown[0]
        : `[${cells.title}]${shown[1] === "related" ? `[related ${cells.related}]` : shown[1]}`;
  let detail!: () => any;
  let go!: () => void;
  const dispose = createRoot(dispose => {
    detail = createMemo(() => ask(`detail:${id()}`));
    const hold = action(function* () {
      setId(1);
      yield ask("action");
    });
    go = kind === "action" ? () => void hold() : () => refresh(detail);
    const view = createLoadingBoundary(
      () =>
        createErrorBoundary(
          () => {
            createRenderEffect(
              () => detail().title,
              v => void (cells.title = v)
            );
            const related = () => {
              const search = createMemo(() => ask(`search:${detail().title}`));
              createRenderEffect(
                () => search().length,
                v => void (cells.related = v)
              );
              return "related";
            };
            const inner =
              kind === "no-inner-loading"
                ? related()
                : createLoadingBoundary(related, () => "[finding related]");
            return [null, inner] as const;
          },
          (e: any) => `[error ${e().message}]`
        ),
      () => "[loading detail]"
    );
    createRenderEffect(view, v => void (shown = v));
    return dispose;
  });
  const frames: string[] = [];
  await tick();
  if (kind === "after-shown") {
    await settle("detail:0", a => a.res({ title: "Crash" }));
    await settle("search:Crash", a => a.res([1, 2]));
    frames.push(screen());
    refresh(detail);
    await tick();
  }
  await settle("detail:0", a => a.rej(new Error("not found")));
  frames.push(screen());
  go();
  await tick();
  frames.push(screen());
  const next = kind === "action" ? "detail:1" : "detail:0";
  await settle(next, a => a.res({ title: "Fix" }));
  frames.push(screen());
  if (kind === "action") {
    await settle("action", a => a.res(undefined));
    frames.push(screen());
  }
  await settle("search:Fix", a => a.res([1, 2, 3]));
  frames.push(screen());
  dispose();
  return frames;
}

it("an inner Loading that showed content before the error shows its fallback on recovery (#4627)", async () => {
  expect(await shape("after-shown")).toEqual([
    "[Crash][related 2]",
    "[error not found]",
    "[error not found]",
    "[Fix][finding related]",
    "[Fix][related 3]"
  ]);
});

it("a pending read directly under the Errored, no inner Loading, keeps the error up (D-39: a pending is not a value)", async () => {
  expect(await shape("no-inner-loading")).toEqual([
    "[error not found]",
    "[error not found]",
    "[error not found]",
    "[Fix][related 3]"
  ]);
});

it("a recovery held by an action reveals with its commit, the inner fallback beside it (D-41, #4627)", async () => {
  expect(await shape("action")).toEqual([
    "[error not found]",
    "[error not found]",
    // The recovery's answer is in, but the action holds it: the error stays.
    "[error not found]",
    "[Fix][finding related]",
    "[Fix][related 3]"
  ]);
});

// async-gen seed 3289 #122: the recovery is written in the tick an action
// opened, so it is the action's (O1) and held with it (D-41), and the error
// stays up. The errored memo reads `latest()`, so its recovery runs in the
// frame's verdict lane and the error boundary saw its source settled; the
// re-armed inner Loading caught the pending render effect, but its swap to
// the fallback was staged in the action's hold, and the error boundary's own
// swap ran mainline the next round: the content attached with the Loading's
// committed value and the render effect's run parked, a bare `content` with
// no value (F-1). The error now stays until the hold reveals the Loading's
// fallback, which then shows beside the recovered content (F-4).
it("a recovery in an action's tick keeps the error up until the action ends, then shows the inner fallback (D-41, F-1, async-gen 3289 #122)", async () => {
  const asks: { key: string; res: () => void }[] = [];
  const settle = async (key: string) => {
    const i = asks.findIndex(a => a.key === key);
    expect(i, `flight ${key}`).toBeGreaterThan(-1);
    asks.splice(i, 1)[0].res();
    await tick();
  };
  const [s, setS] = createSignal(3);
  let cell: unknown;
  let shown: unknown;
  const dispose = createRoot(dispose => {
    const check = createMemo(() => {
      const v = s() + latest(s);
      if (v % 4 === 2) throw new Error("bad");
      return v;
    });
    const data = createMemo(() => {
      const v = s();
      return new Promise<number>(res => asks.push({ key: `data:${v}`, res: () => res(v) }));
    });
    const view = createErrorBoundary(
      () =>
        createLoadingBoundary(
          () => {
            createRenderEffect(
              () => `${check()}/${data()}`,
              v => void (cell = v)
            );
            return "content";
          },
          () => "[L]"
        ),
      () => "[E]"
    );
    createRenderEffect(view, v => void (shown = v));
    return dispose;
  });
  const act = action(function* () {
    yield new Promise<void>(res => asks.push({ key: "act", res }));
  });
  const screen = () => (shown === "content" ? `content ${cell}` : String(shown));
  const frames: string[] = [];
  flush();
  frames.push(screen());
  act();
  setS(0);
  flush();
  frames.push(screen());
  await tick();
  frames.push(screen());
  await settle("act");
  frames.push(screen());
  await settle("data:0");
  frames.push(screen());
  dispose();
  expect(frames).toEqual(["[E]", "[E]", "[E]", "[L]", "content 0/0"]);
});
