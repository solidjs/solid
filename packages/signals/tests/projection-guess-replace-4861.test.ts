// #4861: a keyed row that replaces a guessed row in one commit. The action's
// write lands while its guess is still out, so the guess lane's pass builds
// the new row (`a-two`) and its memo; the action's end then corrects the
// lane (the guess reverts). The memo was born in the lane: its only value
// was the lane's staging, which the correction voids — and nothing in the
// truth notifies it (its row's fields are the truth already). It re-derives
// on the truth at the correction (D-34, F-1). The DOM version (a `<Show>`
// per row) is packages/web/test/projection-guess-replace-4861.spec.tsx.
import { test, expect } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

test.each(["memo", "plain"])("#4861 a %s row replacing a guessed row renders", async mode => {
  let res!: (v: string) => void;
  const [items, setItems] = createSignal<string[]>(["one"]);
  const [adding, guessAdding] = createOptimistic<string[]>(() => []);
  const src = createMemo(() => [
    ...items().map(t => ({ k: `a-${t}`, t, adding: false })),
    ...adding().map(t => ({ k: `b-${t}`, t, adding: true }))
  ]);
  const add = action(function* (t: string) {
    guessAdding(xs => [...xs, t]);
    const r: string = yield new Promise<string>(r => (res = r));
    setItems(xs => [...xs, r]);
  });
  let out = "";
  createRoot(() => {
    const rows = createProjection(() => src() as any, [] as any, { key: "k" } as any) as any;
    const label = (r: any) => () => `[${r.t}${r.adding ? "+" : ""}]`;
    const mapped = mapArray(
      () => rows,
      (r: any) => (mode === "memo" ? createMemo(label(r)) : label(r))
    );
    createRenderEffect(
      () =>
        mapped()
          .map((f: any) => f())
          .join(""),
      v => {
        out = v;
      }
    );
  });
  flush();
  expect(out).toBe("[one]");
  add("two");
  await tick();
  expect(out).toBe("[one][two+]");
  res("two");
  await tick();
  expect(out).toBe("[one][two]");
});
