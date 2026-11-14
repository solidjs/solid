// #4848: a binding nested under a <Show> branch (under a memo the branch
// created, or a <For> row) ran before the Show once the condition started
// reading a deeper memo, and threw "Stale read from <Show>." when the
// condition turned falsy; the ternary <Show> lowers to failed with a
// TypeError. The signals version is
// packages/signals/tests/owner-height-4848.test.ts.
import { test, expect } from "vitest";
import {
  createSignal,
  createMemo,
  createRenderEffect,
  createRoot,
  Show,
  For,
  flush,
  flatten
} from "../src/index.js";

test("#4848 a binding under a Show branch's owned memo does not run before the Show", () => {
  const log: string[] = [];
  const [deeper, setDeeper] = createSignal(false);
  const [source, setSource] = createSignal<any>({ name: "deep" });
  createRoot(() => {
    const deep = createMemo(createMemo(source));
    const shown = Show({
      get when() {
        return deeper() ? deep() : { name: "shallow" };
      },
      children: (value: any) =>
        createMemo(() => {
          createRenderEffect(
            () => value().name,
            name => void log.push(name)
          );
        })
    } as any);
    createRenderEffect(
      () => flatten(shown as any),
      () => {}
    );
  });
  flush();
  setDeeper(true);
  flush();
  setSource(undefined);
  flush();
  expect(log).toEqual(["shallow", "deep"]);
});

test("#4848 a ternary branch's row binding does not run before the branch closes", () => {
  const log: string[] = [];
  const [deeper, setDeeper] = createSignal(false);
  const [source, setSource] = createSignal<any>({ name: "deep" });
  const shallow = { name: "shallow" };
  createRoot(() => {
    const deep = createMemo(createMemo(source));
    const when = () => (deeper() ? deep() : shallow);
    const open = createMemo(() => !!when());
    const shown = createMemo(() =>
      open()
        ? For({
            each: ["row"],
            children: () => {
              createRenderEffect(
                () => when().name,
                name => void log.push(name)
              );
              return "row";
            }
          } as any)
        : "closed"
    );
    createRenderEffect(
      () => flatten(shown as any),
      () => {}
    );
  });
  flush();
  setDeeper(true);
  flush();
  setSource(undefined);
  flush();
  expect(log).toEqual(["shallow", "deep"]);
});
