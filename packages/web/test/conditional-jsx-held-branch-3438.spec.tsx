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

// Exact port of the issue's playground (https://s.olid.uk/id/LTuZMI4_S8SJuZxMpv8QSQ),
// timings scaled 1000/500 -> 100/50.
function InlineApp() {
  const [count, setCount] = createSignal(0);
  const [show, setShow] = createSignal(true);
  const delayedShow = createMemo(() => delay(100, show()));
  return (
    <>
      <button
        onClick={async () => {
          setShow(false);
          await delay(50);
          setCount(1);
        }}
      >
        Run
      </button>
      <p>Count: {count()}</p>
      <p>Show: {String(show())}</p>
      <p>Panel: {show() ? count() : "hidden"}</p>
      <p>Delayed show: {String(delayedShow())}</p>
    </>
  );
}

// Control: the same conditional wrapped in createMemo (the issue says this avoids it).
function MemoApp() {
  const [count, setCount] = createSignal(0);
  const [show, setShow] = createSignal(true);
  const delayedShow = createMemo(() => delay(100, show()));
  const panel = createMemo(() => (show() ? count() : "hidden"));
  return (
    <>
      <button
        onClick={async () => {
          setShow(false);
          await delay(50);
          setCount(1);
        }}
      >
        Run
      </button>
      <p>Count: {count()}</p>
      <p>Show: {String(show())}</p>
      <p>Panel: {panel()}</p>
      <p>Delayed show: {String(delayedShow())}</p>
    </>
  );
}

async function run(App: () => any, label: string) {
  const div = document.createElement("div");
  document.body.appendChild(div);
  const dispose = render(() => <App />, div);
  await delay(150);
  flush();
  expect(snapshot(div)).toBe("Count: 0 | Show: true | Panel: 0 | Delayed show: true");

  div.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const log: string[] = [];
  for (let t = 0; t <= 140; t += 20) {
    flush();
    log.push(`t=${t}: ${snapshot(div)}`);
    await delay(20);
  }
  process.stderr.write(`ISSUE-3438 ${label}\n${log.join("\n")}\n`);
  dispose();
  div.remove();

  expect(log.at(-1)).toBe("t=140: Count: 1 | Show: false | Panel: hidden | Delayed show: false");
  // While Show still reads true, Panel must agree with Count.
  for (const line of log) {
    const m = /Count: (\d) \| Show: true \| Panel: (\d)/.exec(line);
    if (m) expect(m[2], line).toBe(m[1]);
  }
}

describe("conditional JSX during a held branch change (#3438)", () => {
  test("inline `show() ? count() : 'hidden'`", () => run(InlineApp, "inline"));
  test("createMemo-wrapped conditional (control)", () => run(MemoApp, "memo"));
});
