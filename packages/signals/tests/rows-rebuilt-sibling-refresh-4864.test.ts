// #4864: a guess (`moving`) whose action re-asks two answers in a nested
// action. The todo re-ask lands first and rebuilds the todo rows in the
// guess lane; their bindings read `intoDoing`, a lane member waiting on the
// doing re-ask only. A re-ask holds nothing new (D-34 ¶3): that member keeps
// what it shows, and the rows' bindings read that, beside the text showing
// it (F-1). They threw instead, and the new rows showed unbound. The DOM
// version is packages/web/test/rows-rebuilt-sibling-refresh-4864.spec.tsx.
import { test, expect } from "vitest";
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

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

test("#4864 rows rebuilt while a sibling refresh is out read a memo with the action's guess", async () => {
  const fl: Record<string, ((v: any) => void)[]> = {};
  const ask = (k: string) => new Promise<any>(r => (fl[k] ??= []).push(r));
  const land = (k: string, v: any) => {
    const rs = fl[k];
    fl[k] = [];
    rs.forEach(r => r(structuredClone(v)));
  };
  const [todoAns] = createSignal<any>(() => ask("todo"), {
    loadingValue: null,
    name: "todoAns"
  } as any);
  const [doingAns] = createSignal<any>(() => ask("doing"), {
    loadingValue: null,
    name: "doingAns"
  } as any);
  const [moving, guessMoving] = createOptimistic<number[]>(() => [], { name: "moving" } as any);
  const todoRows = createMemo(
    () => {
      const a = todoAns();
      return a == null
        ? []
        : a.filter((id: number) => !moving().includes(id)).map((id: number) => ({ id }));
    },
    { name: "todoRows" } as any
  );
  const doingRows = createMemo(
    () => {
      const a = doingAns();
      return a == null ? null : [...a, ...moving()];
    },
    { name: "doingRows" } as any
  );
  const doingUp = createMemo(() => doingRows() != null, { name: "doingUp" } as any);
  const intoDoing = createMemo(() => doingRows() != null && doingRows()!.length < 3, {
    name: "intoDoing"
  } as any);
  const reask = action(function* () {
    refresh(todoAns);
    refresh(doingAns);
  });
  const move = action(function* (id: number) {
    guessMoving(ms => [...ms, id]);
    yield ask("move");
    yield reask();
  });
  // A row is what the DOM's button is: built `false`, its binding sets it.
  let shown: { id: number; disabled: boolean }[] = [];
  let up = "",
    t1 = "",
    t2 = "";
  createRoot(() => {
    const mapped = mapArray(todoRows, (r: any) => {
      const row = { id: r.id, disabled: false };
      createRenderEffect(
        () => !intoDoing(),
        v => {
          row.disabled = v;
        }
      );
      return row;
    });
    createRenderEffect(
      () => mapped(),
      v => {
        shown = v;
      }
    );
    createRenderEffect(
      () => (doingUp() ? "up" : "down"),
      v => {
        up = v;
      }
    );
    createRenderEffect(
      () => String(doingRows()?.length),
      v => {
        t1 = v;
      }
    );
    createRenderEffect(
      () => String(intoDoing()),
      v => {
        t2 = v;
      }
    );
  });
  const state = () =>
    `${shown.map(r => r.id + (r.disabled ? "x" : "")).join(",")} doing=${t1} into=${t2}`;
  land("doing", [3, 4]);
  land("todo", [1, 2, 5]);
  await tick();
  expect(state()).toBe("1,2,5 doing=2 into=true");
  move(5);
  await tick();
  expect(state()).toBe("1x,2x doing=3 into=false");
  land("move", {});
  await tick();
  expect(state()).toBe("1x,2x doing=3 into=false");
  // The todo re-ask lands while the doing one is still out: the rebuilt rows
  // read `intoDoing` as it shows, beside the text that shows it.
  land("todo", [1, 2, 5]);
  await tick();
  expect(state()).toBe("1x,2x doing=3 into=false");
  // The doing re-ask lands and the action ends: the answers are the truth
  // (this fake server leaves card 5 in todo).
  land("doing", [3, 4, 5]);
  await tick();
  expect(state()).toBe("1x,2x,5x doing=3 into=false");
  expect(up).toBe("up");
});
