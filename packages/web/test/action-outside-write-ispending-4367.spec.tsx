/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4367: `<Show when={isPending(s)}>` while an action holds a write to `s`,
// and `s` is also written outside it. The outside write that matches the
// action's value ends the pending verdict; `<Show>`'s condition memo leaves
// the verdict lane equal to its committed value. The screen must follow, as
// it does for the inline `{isPending(s) ? … : …}` — and once the action
// completes, the fallback shows for good.
import { expect, test } from "vitest";
import { Show, action, createSignal, flush, isPending } from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

for (const shape of ["Show", "inline"] as const)
  test(`isPending(s) settles after the action with an outside write (${shape})`, async () => {
    const [s, set] = createSignal(2);
    let release!: () => void;
    const act = action(function* (v: number) {
      set(v);
      yield new Promise<void>(r => (release = r));
    });
    const el = document.createElement("div");
    const dispose = render(
      () =>
        shape === "Show" ? (
          <Show when={isPending(s)} fallback="[F]">
            <span>pending</span>
          </Show>
        ) : (
          <>{isPending(s) ? <span>pending</span> : "[F]"}</>
        ),
      el
    );
    flush();
    expect(el.innerHTML).toBe("[F]");
    act(3);
    set(2);
    await tick();
    flush();
    expect(el.innerHTML).toBe("<span>pending</span>");
    set(3);
    flush();
    // Nothing differs from the action's write any more: not pending.
    expect(el.innerHTML).toBe("[F]");
    release();
    await tick();
    flush();
    expect(s()).toBe(3);
    expect(isPending(s)).toBe(false);
    expect(el.innerHTML).toBe("[F]");
    dispose();
  });
