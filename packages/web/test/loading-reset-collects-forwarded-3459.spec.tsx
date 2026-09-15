/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { createMemo, createSignal, flush, Loading } from "solid-js";
import { render } from "@solidjs/web";

const delay = <T = void,>(ms: number, value?: T) => new Promise<T>(r => setTimeout(r, ms, value));
function snapshot(div: HTMLElement) {
  return Array.from(div.querySelectorAll("p"))
    .map(p => p.textContent)
    .join(" | ");
}

// Exact port of https://s.olid.uk/id/Wa1D4spxSq6NeXRu1ee4Hg, 2000ms -> 200ms, 500ms -> 50ms.
function App() {
  const [a, setA] = createSignal(0);
  const [b, setB] = createSignal(0);
  const fast = createMemo(async () => a());
  const slow = createMemo(() => delay(200, b()));
  return (
    <>
      <button
        onClick={async () => {
          setB(1);
          await delay(50);
          setA(1);
        }}
      >
        Run
      </button>
      <p>B: {b()}</p>
      <Loading on={a()} fallback={<p>Loading</p>}>
        <p>Fast: {fast()}</p>
        <p>Slow: {slow()}</p>
      </Loading>
    </>
  );
}

describe("A15 / #3459 a Loading `on` reset keeps the fallback until every reader under it settles", () => {
  test("A15 / #3459 resetting `on` while slow is in flight never reveals Fast: 1 beside Slow: 0", async () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    const dispose = render(() => <App />, div);
    await delay(250);
    flush();
    expect(snapshot(div)).toBe("B: 0 | Fast: 0 | Slow: 0");
    div.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const log: string[] = [];
    for (let t = 0; t <= 300; t += 25) {
      flush();
      log.push(`t=${t}: ${snapshot(div)}`);
      await delay(25);
    }
    dispose();
    div.remove();
    // setB(1) is held by slow's flight until the reset; the reset commits it
    // and the boundary keeps its fallback until slow's b=1 answer lands.
    expect(log[0]).toBe("t=0: B: 0 | Fast: 0 | Slow: 0");
    for (const line of log) expect(line, line).not.toMatch(/Fast: 1 \| Slow: 0/);
    expect(log.find(l => l.startsWith("t=50:"))).toBe("t=50: B: 1 | Loading");
    expect(log.at(-1)).toBe("t=300: B: 1 | Fast: 1 | Slow: 1");
  });
});
