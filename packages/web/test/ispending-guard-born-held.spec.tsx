/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// D-23: `<input disabled={isPending(data)}>` over a memo born held never
// shows an enabled input before the hold commits — the reader is held with
// the change (or caught by a fresh boundary), so no `false` is ever seen.
import { expect, test } from "vitest";
import { Loading, Show, action, createMemo, createSignal, flush, isPending } from "solid-js";
import { render } from "../src/index.js";
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

for (const shape of ["show", "show+loading", "direct"] as const)
  test(`isPending guard on a born-held memo, ${shape}: no enabled input before the commit`, async () => {
    const container = document.createElement("div");
    const [x, setX] = createSignal(0);
    const [open, setOpen] = createSignal(shape === "direct");
    let mountDirect!: () => void;
    const [direct, setDirect] = createSignal(false);
    const Form = () => {
      const data = createMemo(() => x());
      return <input disabled={isPending(data)} value={String(data())} />;
    };
    render(
      () => (
        <main>
          <h1>{x()}</h1>
          {shape === "direct" ? (
            <Show when={direct()}>{(() => <Form />) as any}</Show>
          ) : (
            <Show when={open() && shape !== "direct"}>
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
    // Never an enabled input over a value with no verdict: the branch waits
    // for the commit (or shows the fallback), then appears settled.
    expect(mid).toBe(shape === "show+loading" ? "0fb" : "0");
    expect(end && [end.disabled, end.value]).toEqual([false, "1"]);
  });
