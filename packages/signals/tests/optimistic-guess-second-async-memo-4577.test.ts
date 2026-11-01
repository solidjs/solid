import { expect, test } from "vitest";
import {
  action,
  createErrorBoundary,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  refresh
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

test("F-1 in the #4577 shape: one memo's readers agree, a memo is whole, the screen settles as one", async () => {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const settle = async (key: string, v: any) => {
    const i = asks.findIndex(a => a.key === key);
    asks.splice(i, 1)[0].res(v);
    await tick();
  };
  const frames: string[] = [];
  let f = "",
    a = "",
    b = "",
    s = "",
    o = "";
  let q = false;
  const snap = () => {
    if (!q) {
      q = true;
      queueMicrotask(() => {
        q = false;
        frames.push(`${f}|${a}|${b}|${s}|${o}`);
      });
    }
  };
  let setFilter!: (v: string) => void, closeOne!: (id: number) => unknown, dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const [filter, sf] = createSignal("open");
    setFilter = sf;
    const [issues, set] = createOptimisticStore<{ id: number }[]>(
      () => ask(`issues:${filter()}`),
      [],
      { key: "id" }
    );
    const other = createMemo(() => (issues.length, ask(`other:${filter()}`)));
    closeOne = action(function* (id: number) {
      set(l => {
        const i = l.findIndex(r => r.id === id);
        if (i >= 0) l.splice(i, 1);
      });
      yield ask(`close:${id}`);
      refresh(issues);
    });
    const list = createMemo(() => issues.map(r => `[#${r.id}]`).join(""));
    const shared = createMemo(() => `${filter()}:${issues.map(r => `[#${r.id}]`).join("")}`);
    createRenderEffect(filter, v => {
      f = v;
      snap();
    });
    createRenderEffect(
      () => list(),
      v => {
        a = v;
        snap();
      }
    );
    createRenderEffect(
      () => list(),
      v => {
        b = v;
        snap();
      }
    );
    createRenderEffect(shared, v => {
      s = v;
      snap();
    });
    createRenderEffect(
      createErrorBoundary(
        () => other(),
        () => "ERR"
      ) as any,
      (v: any) => {
        o = v;
        snap();
      }
    );
  });
  await tick();
  await settle("issues:open", [{ id: 1 }, { id: 3 }, { id: 4 }]);
  await settle("other:open", "O-open");
  setFilter("closed");
  await tick();
  closeOne(1);
  await tick();
  await settle("issues:closed", [{ id: 1 }, { id: 2 }]);
  await settle("other:closed", "O-closed");
  await settle("close:1", {});
  await settle("issues:closed", [{ id: 2 }]);
  for (let k = 0; k < 10 && asks.length; k++) {
    const x = asks.shift()!;
    x.key.startsWith("other")
      ? x.res("O-" + x.key.split(":")[1])
      : x.key.startsWith("issues:closed")
        ? x.res([{ id: 2 }])
        : x.res({});
    await tick();
  }
  for (let i = 0; i < 5; i++) await tick();
  for (const fr of frames) {
    const [F, A, B, S, O] = fr.split("|");
    if (!A) continue;
    expect(A, fr).toBe(B);
    expect(S.split(":")[0], fr).toBe(F);
    expect(O === "O-closed", fr).toBe(F === "closed");
  }
  dispose();
});
