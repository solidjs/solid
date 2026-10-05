/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { expect, test } from "vitest";
import { createDeferred, createMemo, createSignal, flush, Loading } from "solid-js";
import { render } from "@solidjs/web";

/**
 * mizulu's report on #3710 — exact port of the playground
 * (https://s.olid.uk/id/Lr5tYDWOTW2PD3JSHCdwbA), timings scaled 3000 -> 60.
 * A plain async memo `m1` over a deferred `d1` over a signal `count`, under
 * `<Loading>`; the button outside reads `count`. "Click before m1:exec and
 * the button goes freely; m1:exec shown but m1:done not yet, and every click
 * in that period is blocked."
 *
 * D11 (create-deferred.md §7, ruled 2026-10-04): a held deferred node's
 * re-pass joins nothing, so the click's tick stays mainline — the button and
 * the `signal` hole repaint; the `deferred` and `m1` holes are stale readers
 * of `m1`'s hold (A15) and catch up at its landing; `m1` runs once per
 * landed input and no landing is dropped. The `{}` holes are render effects,
 * which is what makes the graph mainline: a derivation reading `m1()` in
 * between would join by ruling 3 (signals: `tests/createDeferred.test.ts`).
 */
const sleep = (ms = 60) => new Promise<void>(r => setTimeout(r, ms));

function makeApp(log: string[]) {
  return function App() {
    const [count, setCount] = createSignal(0);
    const d1 = createDeferred(async () => {
      const c = count();
      await sleep();
      log.push(`d1:done(${c * 2})`);
      return c * 2;
    });
    const m1 = createMemo(async () => {
      log.push("m1:exec");
      const d = d1();
      await sleep();
      log.push(`m1:done(${d})`);
      return d;
    });
    return (
      <div>
        <Loading fallback={<i>loading...</i>}>
          <p id="s">signal {count()}</p>
          <p id="d">deferred {d1()}</p>
          <p id="m">m1 {m1()}</p>
        </Loading>
        <button onClick={() => setCount(v => v + 1)}>Count: {count()}</button>
      </div>
    );
  };
}

const text = (root: HTMLElement) =>
  `${root.querySelector("i") ? "loading " : ""}[${["s", "d", "m"]
    .map(id => root.querySelector("#" + id)?.textContent ?? "-")
    .join(" | ")}] ${root.querySelector("button")!.textContent}`;

test("the button never waits on m1's flight; the holes of the flight hold as stale readers; m1 lands with the input it was asked with", async () => {
  const log: string[] = [];
  const App = makeApp(log);
  const root = document.createElement("div");
  document.body.appendChild(root);
  const dispose = render(() => <App />, root);
  flush();
  const click = () => {
    root.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    flush();
  };
  expect(text(root)).toBe("loading [- | - | -] Count: 0");
  await sleep(150); // d1(0), then m1(0), land
  flush();
  expect(text(root)).toBe("[signal 0 | deferred 0 | m1 0] Count: 0");

  // Click while d1 is in flight: free (D1), the deferred lags.
  click();
  expect(text(root)).toBe("[signal 1 | deferred 0 | m1 0] Count: 1");

  // d1(1) lands -> m1 re-runs and holds the frame; the landing is staged with it.
  await sleep(80);
  flush();
  expect(text(root)).toBe("[signal 1 | deferred 0 | m1 0] Count: 1");
  expect(log.at(-1)).toBe("m1:exec");

  // Clicks while m1 is in flight — the report. Mainline (D11): the button
  // and the `signal` hole repaint; `deferred`/`m1` keep the committed frame.
  click();
  expect(text(root)).toBe("[signal 2 | deferred 0 | m1 0] Count: 2");
  click();
  expect(text(root)).toBe("[signal 3 | deferred 0 | m1 0] Count: 3");

  // m1(2) lands: the hold reveals the landing it staged; the stale readers
  // catch up on it.
  await sleep(80);
  flush();
  expect(text(root)).toBe("[signal 3 | deferred 2 | m1 2] Count: 3");

  // d1(3)=6 lands -> m1 asks 6 -> lands. m1 ran for 0, 2 and 6: once per
  // landed input, nothing against a stale one, no landing dropped.
  await sleep(300);
  flush();
  expect(text(root)).toBe("[signal 3 | deferred 6 | m1 6] Count: 3");
  expect(log.filter(l => l === "m1:exec").length).toBe(4); // mount + 3 landings (0, 2, 6)
  expect(log.filter(l => l.startsWith("m1:done"))).toEqual([
    "m1:done(0)",
    "m1:done(2)",
    "m1:done(6)"
  ]);
  dispose();
});
