/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

import { describe, expect, test } from "vitest";
import { createMemo, createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";

const delay = <T = void,>(ms: number, value?: T) =>
  new Promise<T>(r => setTimeout(r, ms, value as T));

function snapshot(div: HTMLElement) {
  return Array.from(div.querySelectorAll("p"))
    .map(p => p.textContent)
    .join(" | ");
}

// Exact port of the issue's playground (https://s.olid.uk/id/XOQbd6CFTfy2QhZK4EiQ7g),
// timings scaled 2000/500 -> 200/50.
function App(props: { asyncSelected: boolean }) {
  const [a, setA] = createSignal(0);
  const [b, setB] = createSignal(0);
  const slow = createMemo(() => delay(200, b()));
  const selected = props.asyncSelected
    ? createMemo(async () => (b() ? b() : a()))
    : createMemo(() => (b() ? b() : a()));
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
      <p>A: {a()}</p>
      <p>B: {b()}</p>
      <p>Slow: {slow()}</p>
      <p>Selected: {selected()}</p>
    </>
  );
}

async function run(asyncSelected: boolean) {
  const div = document.createElement("div");
  document.body.appendChild(div);
  const dispose = render(() => <App asyncSelected={asyncSelected} />, div);
  await delay(250);
  flush();
  expect(snapshot(div)).toBe("A: 0 | B: 0 | Slow: 0 | Selected: 0");

  div.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const log: string[] = [];
  for (let t = 0; t <= 300; t += 20) {
    flush();
    log.push(`t=${t}: ${snapshot(div)}`);
    await delay(20);
  }
  dispose();
  div.remove();

  expect(log.at(-1)).toBe("t=300: A: 1 | B: 1 | Slow: 1 | Selected: 1");
  // While B still reads 0, Selected (b() ? b() : a()) must agree with A: the
  // `a` write joins the hold rather than publishing beside the stale derivation.
  for (const line of log) {
    const m = /A: (\d) \| B: 0 \| Slow: 0 \| Selected: (\d)/.exec(line);
    if (m) expect(m[2], line).toBe(m[1]);
  }
}

describe("async conditional memo across a held branch change (#3461)", () => {
  test("A30 / #3461 `createMemo(async () => b() ? b() : a())`", () => run(true));
  test("plain createMemo conditional (control)", () => run(false));
});
