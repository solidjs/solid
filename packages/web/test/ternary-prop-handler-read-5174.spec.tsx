/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #5174: an ownerless read of a ternary prop reads the screen instead of a fresh memo (F-1).
import { expect, test, vi } from "vitest";
import { Loading, action, createEffect, createSignal, flush, refresh } from "solid-js";
import { render } from "@solidjs/web";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

function mount(kind: string, Child: (props: { n: number }) => any) {
  const asks: ((v: number[]) => void)[] = [];
  let reask!: () => void;
  function App() {
    const [ans] = createSignal<number[] | null>(
      async () => await new Promise<number[]>(r => asks.push(r)),
      { loadingValue: null }
    );
    reask = action(function* () {
      refresh(ans);
    });
    return (
      <Loading fallback="L">
        <p>{ans() == null ? "loading" : ans()!.length}</p>
        {kind === "ternary" ? (
          <Child n={ans() == null ? -1 : ans()!.length} />
        ) : (
          <Child n={(ans() ?? []).length} />
        )}
      </Loading>
    );
  }
  const c = document.body.appendChild(document.createElement("div"));
  const dispose = render(() => <App />, c);
  return {
    c,
    land: (v: number[]) => asks.shift()!(v),
    reask: () => reask(),
    dispose: () => (dispose(), c.remove())
  };
}

for (const kind of ["ternary", "plain"])
  test(`#5174: a click handler reads a ${kind} prop over a loaded source while the source re-asks`, async () => {
    const got: unknown[] = [];
    const m = mount(kind, props => (
      <button
        onClick={() => {
          try {
            got.push(props.n);
          } catch (e: any) {
            got.push(e.constructor.name);
          }
        }}
      >
        go
      </button>
    ));
    await tick();
    m.land([1, 2]);
    await tick();
    const button = m.c.querySelector("button")!;
    button.click();
    m.reask();
    await tick();
    button.click();
    m.land([1, 2, 3]);
    await tick();
    button.click();
    expect(got).toEqual([2, 2, 3]);
    expect(m.c.querySelector("p")!.textContent).toBe("3");
    m.dispose();
  });

test("#5174: an effect callback reads a ternary prop without creating a memo", async () => {
  const got: unknown[] = [];
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const [t, setT] = createSignal(0);
  const m = mount("ternary", props => {
    createEffect(t, () => {
      try {
        got.push(props.n);
      } catch (e: any) {
        got.push(String(e.message).slice(0, 30));
      }
    });
    return null;
  });
  await tick();
  m.land([1, 2]);
  await tick();
  setT(1);
  await tick();
  expect(got).toEqual([-1, 2]);
  expect(error.mock.calls.join("\n")).not.toContain("PRIMITIVE_IN_EFFECT_CALLBACK");
  m.dispose();
  error.mockRestore();
  warn.mockRestore();
});

test("#5174: a conditional in a template created with no owner follows its condition and rebuilds its branch", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const [n, setN] = createSignal(1);
  const el = (<div>{n() > 0 ? <b>big {n()}</b> : <i>small</i>}</div>) as HTMLDivElement;
  flush();
  expect(el.innerHTML).toBe("<b>big 1</b>");
  const big = el.firstChild;
  setN(2);
  flush();
  expect(el.innerHTML).toBe("<b>big 2</b>");
  expect(el.firstChild).not.toBe(big);
  setN(0);
  flush();
  expect(el.innerHTML).toBe("<i>small</i>");
  setN(3);
  flush();
  expect(el.innerHTML).toBe("<b>big 3</b>");
  warn.mockRestore();
});
