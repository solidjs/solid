// A plain write from outside an action, made while a guess is out, whose
// derivation is lane work (a memo seated in the guess's lane) and needs a
// flight the write asked (F-2): the write is held until that flight lands and
// the screen keeps what it showed. A lane breaks out of its parent's hold and
// is served the committed value of the parent's flight (A31), but that read
// still derives from the flight: the reader is the flight's stale reader
// (A15, #3494), so the frame holds on it and re-derives it at the landing.
// Served the committed value without being one, the lane pass paired the new
// filter with the old fetch ("closed" beside the open rows) and the frame
// landed it (F-1). The same steps run against the source and each built tier.
import { describe, expect, test } from "vitest";
import * as source from "../src/index.js";

const cores: Record<string, () => Promise<any>> = {
  source: async () => source,
  prod: () => import("../dist/prod/index.js"),
  observe: () => import("../dist/observe/index.js"),
  dev: () => import("../dist/dev.js")
};

type Variant = "ternary" | "guess read first" | "effect reads the view only" | "no guess";

async function run(core: any, variant: Variant): Promise<string[]> {
  const {
    action,
    createMemo,
    createOptimistic,
    createRenderEffect,
    createRoot,
    createSignal,
    flush
  } = core;
  const tick = async () => {
    for (let i = 0; i < 4; i++) {
      await new Promise(r => setTimeout(r, 0));
      flush();
    }
  };
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const pick = (key: string) => {
    const i = asks.findIndex(a => a.key === key);
    expect(i, `${key} asked`).not.toBe(-1);
    return asks.splice(i, 1)[0];
  };
  const ids = (rows: { id: number }[]) => rows.map(r => r.id).join(",");
  let close!: (id: number) => Promise<void>, setFilter!: (f: string) => void;
  const log: string[] = [];
  createRoot(() => {
    const [filter, sf] = createSignal("open");
    setFilter = sf;
    const server = createMemo(() => ask(`fetch:${filter()}`));
    const [closingTruth] = createSignal(() => [] as number[]);
    const [closing, guessClose] = createOptimistic(() => closingTruth());
    const view = createMemo(() => {
      if (variant === "guess read first") {
        const c = closing();
        return filter() === "open" ? server().filter((r: any) => !c.includes(r.id)) : server();
      }
      return filter() === "open"
        ? server().filter((r: any) => !closing().includes(r.id))
        : server();
    });
    close = action(function* (id: number) {
      guessClose((xs: number[]) => [...xs, id]);
      yield ask(`close:${id}`);
    });
    createRenderEffect(
      () => (variant === "effect reads the view only" ? ids(view()) : `${filter()}:${ids(view())}`),
      (v: string) => void log.push(v)
    );
  });
  await tick();
  pick("fetch:open").res([{ id: 1 }, { id: 3 }, { id: 4 }]);
  await tick();
  if (variant !== "no guess") {
    close(4);
    await tick();
  }
  setFilter("closed");
  await tick();
  log.push("| switched");
  pick("fetch:closed").res([{ id: 2 }]);
  await tick();
  log.push("| landed");
  if (variant !== "no guess") {
    pick("close:4").res(undefined);
    await tick();
  }
  return log;
}

const expected: Record<Variant, string[]> = {
  "no guess": ["open:1,3,4", "| switched", "closed:2", "| landed"],
  ternary: ["open:1,3,4", "open:1,3", "| switched", "closed:2", "| landed"],
  // The lane pass re-derives on the committed world when the frame parks (the
  // seam's repair): the effect runs again with what it showed.
  "guess read first": ["open:1,3,4", "open:1,3", "open:1,3", "| switched", "closed:2", "| landed"],
  "effect reads the view only": ["1,3,4", "1,3", "| switched", "2", "| landed"]
};

for (const [tier, load] of Object.entries(cores))
  describe(`a write under a guess holds on the flight its lane work needs (${tier})`, () => {
    for (const variant of Object.keys(expected) as Variant[])
      test(variant, async () => {
        expect(await run(await load(), variant)).toEqual(expected[variant]);
      });
  });
