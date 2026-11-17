/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4966: a value read for the first time behind an `isPending(...)` check in
// a mounted binding updates while the fetch is in flight, as it does when it
// is read before the check (F-6, D-23: either read order).
import { test, expect } from "vitest";
import { Loading, createProjection, createSignal, isPending, flush } from "solid-js";
import { render } from "../src/index.js";
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const order of ["after", "before"] as const)
  test(`a first read behind isPending is not held (#4966, read ${order} the check)`, async () => {
    const asks: (() => void)[] = [];
    const [v, setV] = createSignal(0);
    const mutable = { dir: undefined as string | undefined };
    function Page() {
      const store = createProjection<{ value: number }>(
        () => {
          const n = v();
          return new Promise(r => asks.push(() => r({ value: n })));
        },
        {} as { value: number }
      );
      const flag =
        order === "after"
          ? () => isPending(() => store.value) && (v(), mutable.dir === "back")
          : () => {
              v();
              return isPending(() => store.value) && mutable.dir === "back";
            };
      return (
        <div>
          value={store.value} flag={String(flag())}
        </div>
      );
    }
    const c = document.createElement("div");
    const dispose = render(
      () => (
        <Loading fallback="loading">
          <Page />
        </Loading>
      ),
      c
    );
    await tick();
    asks.shift()!();
    await tick();
    expect(c.textContent).toBe("value=0 flag=false");
    mutable.dir = "back";
    setV(1);
    await tick();
    expect(c.textContent).toBe("value=0 flag=true");
    asks.shift()!();
    await tick();
    expect(c.textContent).toBe("value=1 flag=false");
    dispose();
  });
