/**
 * #4629: an async list `issues`, a `createOptimistic` log of assignments
 * overlaid on it by a memo, shown directly or through a keyed projection.
 * Action 1 is accepted and its `refresh(issues)` is in flight when action 2
 * guesses into the same log.
 *
 * (4) The overlay's lane pass reads `issues`, which action 1's re-ask holds.
 * `issues` is not derived from the guess, so F-6's lane hold does not apply:
 * a plain read in lane work of a node the parent holds is the screen's value
 * (D-26, clarified 2026-10-28), and the lane displays the screen plus its own
 * guesses — `[#4 guest]` now, in both shapes. (Before #4637 both shapes held
 * the guess until action 1's re-ask landed: the overlay's pass threw on its
 * first, pending read before it reached the guess, D-28.)
 *
 * (5) Through the projection the guess never showed before the server's
 * answer: the derive's pass that ran as the landing's (the frame's) work and
 * was judged leaked wrote the row's leaf through the reconcile channel as a
 * staging of that frame, not as the lane's derivation; the lane's re-derive
 * then wrote an equal value, which staged nothing, and the screen kept the
 * committed `dana` until the frame landed. An adoption's leaf write in a lane
 * pass is now the lane's value, as the container's and a draft write's are.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createProjection,
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

function run(proj: boolean) {
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
    const overlay = createMemo(() =>
      issues().map(i => {
        const g = assigning()
          .filter(x => x.id === i.id)
          .pop();
        return g ? { ...i, a: g.a } : i;
      })
    );
    const shown: () => Row[] = proj
      ? (() => {
          const p = createProjection<Row[]>(() => overlay(), [], { key: "id" });
          return () => p;
        })()
      : overlay;
    const rows = mapArray(shown, (r: Row) => () => `[#${r.id} ${r.a}]`);
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

describe("#4629: a second guess into a log while the first action's refresh is in flight", () => {
  const frames = async (proj: boolean) => {
    const t = run(proj);
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
    t.assign(4);
    await tick();
    const f4 = t.screen;
    await t.settle("issues", t.snap());
    const f5 = t.screen;
    t.server[1].a = "guest";
    await t.settle("assign:4", {});
    await t.settle("issues", t.snap());
    const f6 = t.screen;
    return [f4, f5, f6];
  };

  for (const proj of [false, true]) {
    const name = proj ? "through a keyed projection" : "through the overlay memo";
    it(`${name}: the guess shows once action 1's re-ask lands`, async () => {
      const [, f5, f6] = await frames(proj);
      expect([f5, f6]).toEqual(["[#3 guest][#4 guest]", "[#3 guest][#4 guest]"]);
    });

    it(`${name}: the guess shows at once, beside the screen's issues (D-26)`, async () => {
      expect(await frames(proj)).toEqual([
        "[#3 guest][#4 guest]",
        "[#3 guest][#4 guest]",
        "[#3 guest][#4 guest]"
      ]);
    });
  }

  it("through a keyed projection: a rejected second action reverts its row", async () => {
    const t = run(true);
    flush();
    await tick();
    await t.settle("issues", t.snap());
    t.assign(3);
    await tick();
    t.server[0].a = "guest";
    await t.settle("assign:3", {});
    t.assign(4);
    await tick();
    await t.settle("issues", t.snap());
    expect(t.screen).toBe("[#3 guest][#4 guest]");
    await t.settle("assign:4", new Error("no"), true);
    expect(t.screen).toBe("[#3 guest][#4 dana]");
  });
});
