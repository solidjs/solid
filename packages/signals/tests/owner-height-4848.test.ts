// #4848: the heap ordered a node only above its direct owner. When an owner
// further up was raised after the node's birth (its condition started reading
// a deeper memo, `adjustHeight`), a binding nested under it (in a `<For>`
// row, an inner branch, a memo the branch created) sat at or below that
// owner and ran first when the condition turned falsy: it read the closed
// branch's input ("Stale read from <Show>", or a TypeError from the ternary
// `<Show>` lowers to) and halted reactivity. A node is now placed above every
// owning computation. The `<Show>` versions are in
// packages/solid/test/show-owner-height-4848.spec.ts.
import { test, expect } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray
} from "../src/index.js";

test("#4848 a row binding under a ternary branch does not run before the branch closes", () => {
  const log: string[] = [];
  const [deeper, setDeeper] = createSignal(false);
  const [source, setSource] = createSignal<{ name: string } | undefined>({ name: "deep" });
  const shallow = { name: "shallow" };
  createRoot(() => {
    const deep = createMemo(createMemo(source));
    const when = () => (deeper() ? deep() : shallow);
    const open = createMemo(() => !!when());
    const shown = createMemo(() =>
      open()
        ? mapArray(
            () => ["row"],
            () => {
              createRenderEffect(
                () => when()!.name,
                name => void log.push(name)
              );
              return "row";
            }
          )()
        : "closed"
    );
    createRenderEffect(shown, () => {});
  });
  flush();
  setDeeper(true);
  flush();
  setSource(undefined);
  flush();
  expect(log).toEqual(["shallow", "deep"]);
});

test("#4848 a binding two owners below a raised branch memo does not run before it", () => {
  const log: string[] = [];
  const [deeper, setDeeper] = createSignal(false);
  const [source, setSource] = createSignal<{ name: string } | undefined>({ name: "deep" });
  createRoot(() => {
    const deep = createMemo(createMemo(source));
    const when = createMemo(() => (deeper() ? deep() : { name: "shallow" }));
    // The branch: a selection memo owning a memo that owns the binding.
    const branch = createMemo(() => {
      if (!when()) return "closed";
      createMemo(() => {
        createRenderEffect(
          () => when()!.name,
          name => void log.push(name)
        );
      });
      return "open";
    });
    createRenderEffect(branch, () => {});
  });
  flush();
  setDeeper(true);
  flush();
  setSource(undefined);
  flush();
  expect(log).toEqual(["shallow", "deep"]);
});
