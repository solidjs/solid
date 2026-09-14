/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

import { describe, expect, test } from "vitest";
import { createMemo, createSignal, flush, isPending } from "solid-js";
import { render } from "@solidjs/web";

const delay = <T = void,>(ms: number, value?: T) =>
  new Promise<T>(r => setTimeout(r, ms, value as T));

function snapshot(div: HTMLElement) {
  return Array.from(div.querySelectorAll("p"))
    .map(p => p.textContent)
    .join(" | ");
}

// Exact port of https://s.olid.uk/id/P4Zyb5IlR_Gmz8H0dvcBUQ, 1000ms -> 100ms.
function App(props: { variant: "issue" | "no-pending" | "getter" }) {
  const [count, setCount] = createSignal(0);
  const slow = createMemo(() => delay(100, count()));
  const fast = createMemo(async () => count());
  const copy = props.variant === "getter" ? () => slow() : createMemo(() => slow());
  return (
    <>
      <button onClick={() => setCount(1)}>Run</button>
      {props.variant === "no-pending" ? (
        <p>Pending: n/a</p>
      ) : (
        <p>Pending: {String(isPending(() => [fast(), copy()]))}</p>
      )}
      <p>Fast: {fast()}</p>
      <p>Slow: {copy()}</p>
    </>
  );
}

async function run(variant: "issue" | "no-pending" | "getter") {
  const div = document.createElement("div");
  document.body.appendChild(div);
  const dispose = render(() => <App variant={variant} />, div);
  await delay(150);
  flush();
  const initial = snapshot(div);
  div.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const log: string[] = [];
  for (let t = 0; t <= 140; t += 20) {
    flush();
    log.push(`t=${t}: ${snapshot(div)}`);
    await delay(20);
  }
  process.stderr.write(`ISSUE-3442 ${variant}\ninitial: ${initial}\n${log.join("\n")}\n`);
  dispose();
  div.remove();
  expect(initial).toMatch(/Fast: 0 \| Slow: 0$/);
  expect(log.at(-1)).toMatch(/Fast: 1 \| Slow: 1$/);
  // Fast and Slow must never disagree in a published frame, and while they
  // are held the combined probe reports pending.
  for (const line of log) {
    expect(line, line).not.toMatch(/Fast: 1 \| Slow: 0/);
    if (variant !== "no-pending" && / Fast: 0 \| Slow: 0$/.test(line))
      expect(line, line).toMatch(/Pending: true/);
  }
}

describe("combined isPending read across two async memos (#3442)", () => {
  test("issue: isPending(() => [fast(), copy()]) with copy = createMemo(() => slow())", () =>
    run("issue"));
  test("control: no pending read", () => run("no-pending"));
  test("control: copy is a plain getter", () => run("getter"));
});
