/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #2829: the reported app shape — an async memo under <Loading>, rendered via
 * `latest(asyncValue)` with an `isPending(() => latest(asyncValue))` style
 * binding, plus an unrelated slower async memo that keeps the transition open.
 *
 * Pinned symptoms (all previously broken):
 * 1. after the initial load, `latest()` showed `undefined` instead of the value;
 * 2. the first click never turned `isPending(() => latest(x))` on;
 * 3. `latest()` shows the new value as soon as its own fetch resolves, even
 *    while the unrelated async keeps the transition open.
 *
 * Per-channel verdicts (A20 re-rule 2026-07-07c): `isPending(() => latest(x))`
 * follows x's OWN fetch — it turns off the moment that fetch resolves, even
 * while the unrelated async still holds the transition. Dimming therefore
 * always accompanies the stale value and lifts exactly when the fresh value
 * appears.
 */
import { expect, test } from "vitest";
import { createMemo, createSignal, isPending, latest, Loading, flush } from "solid-js";
import { render } from "../src/index.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  flush();
}

test("latest + isPending(latest) across refreshes under Loading (#2829)", async () => {
  const div = document.createElement("div");
  const [count, setCount] = createSignal(0);
  let cur1 = deferred<void>();
  let cur2 = deferred<void>();

  const dispose = render(() => {
    const asyncValue = createMemo(async () => {
      const c = count();
      await cur1.promise;
      return `Async Value ${c}`;
    });
    const asyncValue2 = createMemo(async () => {
      const c = count();
      await cur2.promise;
      return `Async Value 2 ${c}`;
    });
    return (
      <Loading fallback="Loading...">
        <p id="latest" style={{ opacity: isPending(() => latest(asyncValue)) ? 0.5 : 1 }}>
          {latest(asyncValue)}
        </p>
        <p id="av2" style={{ opacity: isPending(asyncValue2) ? 0.5 : 1 }}>
          {asyncValue2()}
        </p>
      </Loading>
    );
  }, div);

  const state = () => {
    const p = div.querySelector<HTMLParagraphElement>("#latest");
    if (!p) return `FALLBACK ${div.textContent}`;
    return `${p.textContent}|op=${p.style.opacity}`;
  };

  flush();
  expect(state()).toBe("FALLBACK Loading...");

  cur1.resolve();
  await settle();
  cur2.resolve();
  await settle();
  // Symptom 1: this used to read "undefined|op=1".
  expect(state()).toBe("Async Value 0|op=1");

  // Click 1: both fetches in flight. Symptom 2: opacity used to stay 1.
  cur1 = deferred<void>();
  cur2 = deferred<void>();
  setCount(1);
  flush();
  expect(state()).toBe("Async Value 0|op=0.5");

  // Fast fetch resolves; slow one still holds the transition. Symptom 3:
  // latest() already shows the new value — and its verdict settles with it
  // (own async done ⇒ not pending, even mid-transition).
  cur1.resolve();
  await settle();
  expect(state()).toBe("Async Value 1|op=1");

  cur2.resolve();
  await settle();
  expect(state()).toBe("Async Value 1|op=1");
  expect(div.querySelector("#av2")!.textContent).toBe("Async Value 2 1");

  // Click 2 behaves identically to click 1 (previously diverged).
  cur1 = deferred<void>();
  cur2 = deferred<void>();
  setCount(2);
  flush();
  expect(state()).toBe("Async Value 1|op=0.5");

  cur1.resolve();
  await settle();
  expect(state()).toBe("Async Value 2|op=1");

  cur2.resolve();
  await settle();
  expect(state()).toBe("Async Value 2|op=1");
  dispose();
});
