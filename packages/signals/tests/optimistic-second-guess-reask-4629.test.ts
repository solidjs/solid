/**
 * #4629 (the memo half): an async list `issues`, a `createOptimistic` log of
 * assignments overlaid on it by a memo. Action 1 is accepted and its
 * `refresh(issues)` is in flight when action 2 guesses into the same log.
 *
 * `issues` is not derived from the guess, so F-6's lane hold does not apply:
 * what lane work displays is the screen plus the lane's own values, and a
 * plain read in lane work of a node the parent holds is the screen's value
 * (D-26, clarified 2026-10-28). Action 1's re-ask is a `refresh()`, which
 * re-asks the same question and holds nothing new (D-34, D-31). The two
 * guesses share the log slot, so they entangle (D-33): the log reverts only
 * when the last of them settles, and a rejected second action reverts only
 * its own guess.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray,
  refresh
} from "../src/index.js";

type Row = { id: number; a: string };

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

function run(guessFirst = false) {
  const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
  const settle = async (key: string, v: any, fail = false) => {
    const i = asks.findIndex(a => a.key === key);
    const a = asks.splice(i, 1)[0];
    fail ? a.rej(v) : a.res(v);
    await tick();
  };
  const server: Row[] = [
    { id: 3, a: "-" },
    { id: 4, a: "dana" }
  ];
  let screen = "";
  let assign!: (id: number) => any;
  createRoot(() => {
    const issues = createMemo<Row[]>(() => ask("issues"));
    const [truth] = createSignal<Row[]>(() => []);
    const [assigning, guess] = createOptimistic<Row[]>(() => truth());
    const overlay = createMemo(() => {
      const log = guessFirst ? assigning() : undefined;
      return issues().map(i => {
        const g = (log ?? assigning()).filter(x => x.id === i.id).pop();
        return g ? { ...i, a: g.a } : i;
      });
    });
    const rows = mapArray(overlay, (r: Row) => () => `[#${r.id} ${r.a}]`);
    createRenderEffect(
      () =>
        rows()
          .map(f => f())
          .join(""),
      v => void (screen = v)
    );
    assign = action(function* (id: number) {
      guess(xs => [...xs, { id, a: "guest" }]);
      try {
        yield ask(`assign:${id}`);
      } catch {
        return;
      }
      refresh(issues);
    });
  });
  return {
    get screen() {
      return screen;
    },
    settle,
    server,
    assign: (id: number) => assign(id),
    snap: () => server.map(x => ({ ...x }))
  };
}

async function toSecondGuess(guessFirst?: boolean) {
  const t = run(guessFirst);
  flush();
  await tick();
  await t.settle("issues", t.snap());
  expect(t.screen).toBe("[#3 -][#4 dana]");
  t.assign(3);
  await tick();
  expect(t.screen).toBe("[#3 guest][#4 dana]");
  t.server[0].a = "guest";
  await t.settle("assign:3", {});
  // action 1's refresh(issues) is in flight
  expect(t.screen).toBe("[#3 guest][#4 dana]");
  t.assign(4);
  await tick();
  return t;
}

describe("#4629: a second guess into a log beside the first action's re-ask (memo)", () => {
  it("the guess shows at once, beside the screen's issues (D-26), and stays", async () => {
    const t = await toSecondGuess();
    // (4)
    expect(t.screen).toBe("[#3 guest][#4 guest]");
    await t.settle("issues", t.snap());
    // (5) action 1's re-ask lands; action 2's guess still stands
    expect(t.screen).toBe("[#3 guest][#4 guest]");
    t.server[1].a = "guest";
    await t.settle("assign:4", {});
    await t.settle("issues", t.snap());
    // (6) both actions settled on the truth
    expect(t.screen).toBe("[#3 guest][#4 guest]");
  });

  // D-28: whether a read throws is the read's own — not the order of the
  // reads around it. Reading the log before `issues` showed the guess at
  // once already.
  it("either read order: the guess shows at once", async () => {
    for (const guessFirst of [false, true]) {
      const t = await toSecondGuess(guessFirst);
      expect(t.screen).toBe("[#3 guest][#4 guest]");
    }
  });

  it("a rejected second action reverts its row", async () => {
    const t = await toSecondGuess();
    expect(t.screen).toBe("[#3 guest][#4 guest]");
    await t.settle("issues", t.snap());
    expect(t.screen).toBe("[#3 guest][#4 guest]");
    await t.settle("assign:4", new Error("no"), true);
    expect(t.screen).toBe("[#3 guest][#4 dana]");
  });

  // D-33: the two guesses share the log slot, so the slot reverts only when
  // the last of the two actions settles — action 1 is out until its re-ask
  // lands (D-35: a plain load the action asked for is still in flight).
  it("a second action rejected before action 1's re-ask lands reverts with it", async () => {
    const t = await toSecondGuess();
    expect(t.screen).toBe("[#3 guest][#4 guest]");
    await t.settle("assign:4", new Error("no"), true);
    expect(t.screen).toBe("[#3 guest][#4 guest]");
    await t.settle("issues", t.snap());
    expect(t.screen).toBe("[#3 guest][#4 dana]");
  });
});
