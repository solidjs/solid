/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

// #3457: a memo wrapping isPending(copy) must agree with a direct
// isPending(copy) read in JSX while a sibling async memo holds the write.
import { describe, expect, test } from "vitest";
import { createMemo, createSignal, flush, isPending } from "solid-js";
import { render } from "@solidjs/web";

const delay = <T = void,>(ms: number, value?: T) =>
  new Promise<T>(r => setTimeout(r, ms, value as T));

function snap(div: HTMLElement) {
  return Array.from(div.querySelectorAll("p"))
    .map(p => p.textContent)
    .join(" | ");
}

function App() {
  const [count, setCount] = createSignal(0);
  const slow = createMemo(() => delay(100, count()));
  const copy = createMemo(() => count());
  const pending = createMemo(() => isPending(copy));
  return (
    <>
      <button onClick={() => setCount(1)}>Run</button>
      <p>Count: {count()}</p>
      <p>Slow: {slow()}</p>
      <p>Direct pending: {String(isPending(copy))}</p>
      <p>Memo pending: {String(pending())}</p>
    </>
  );
}

describe("memo-wrapped isPending agrees with a direct read through a hold (#3457)", () => {
  test("A10 / #3457 both probes read true for the whole hold, false after the reveal", async () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    const dispose = render(() => <App />, div);
    await delay(120);
    flush();
    expect(snap(div)).toBe("Count: 0 | Slow: 0 | Direct pending: false | Memo pending: false");

    div.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const log: string[] = [];
    for (let t = 0; t <= 140; t += 20) {
      flush();
      log.push(snap(div));
      await delay(20);
    }
    const held = log.filter(l => l.includes("Slow: 0"));
    expect(held.length).toBeGreaterThan(0);
    for (const l of held) {
      expect(l, l).toBe("Count: 0 | Slow: 0 | Direct pending: true | Memo pending: true");
    }
    expect(log[log.length - 1]).toBe(
      "Count: 1 | Slow: 1 | Direct pending: false | Memo pending: false"
    );

    dispose();
    div.remove();
  });
});
