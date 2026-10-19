/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// D-23 with the guarded branch as the ONLY child of its parent (a
// single-child hole). Its normalized value is `undefined` while it renders
// nothing, which the insert read as "never ran": content arriving later ran
// its inner effect inline, mid-compute, and mounted ahead of the hold — an
// enabled, empty input before the commit. Same contract as the sibling form
// in ispending-guard-born-held.spec.tsx.
import { expect, test } from "vitest";
import { Loading, Show, action, createMemo, createSignal, flush, isPending } from "solid-js";
import { render } from "../src/index.js";
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

for (const shape of ["show", "show+loading", "direct"] as const)
  test(`isPending guard on a born-held memo, sole child, ${shape}: no enabled input before the commit`, async () => {
    const container = document.createElement("div");
    const [x, setX] = createSignal(0);
    const [open, setOpen] = createSignal(shape === "direct");
    const [direct, setDirect] = createSignal(false);
    const Form = () => {
      const data = createMemo(() => x());
      return <input disabled={isPending(data)} value={String(data())} />;
    };
    render(
      () => (
        <main>
          {shape === "direct" ? (
            <Show when={direct()}>{(() => <Form />) as any}</Show>
          ) : (
            <Show when={open()}>
              {
                (() =>
                  shape === "show+loading" ? (
                    <Loading fallback={<em>fb</em>}>
                      <Form />
                    </Loading>
                  ) : (
                    <Form />
                  )) as any
              }
            </Show>
          )}
        </main>
      ),
      container
    );
    flush();
    let release!: () => void;
    action(function* () {
      setX(1);
      yield new Promise<void>(r => (release = r));
    })();
    flush();
    if (shape === "direct") setDirect(true);
    else setOpen(true);
    flush();
    await tick();
    const input = container.querySelector("input");
    const mid = input
      ? `input disabled=${input.disabled} value=${input.value}`
      : container.textContent;
    release();
    await tick();
    const end = container.querySelector("input");
    expect(mid).toBe(shape === "show+loading" ? "fb" : "");
    expect(end && [end.disabled, end.value]).toEqual([false, "1"]);
  });
