/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

import { describe, expect, test } from "vitest";
import { createMemo, createSignal, flush, isPending } from "solid-js";
import { render } from "@solidjs/web";

const delay = <T,>(value: T, ms: number): Promise<T> =>
  new Promise(resolve => setTimeout(() => resolve(value), ms));
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

// Port of https://s.olid.uk/id/lg40u1dpQkC5mIUmTn_Grw, delays divided by 10.
describe("#3766 memo over isPending read beside a second async memo", () => {
  test("mounts once both first flights land", async () => {
    const div = document.createElement("div");
    const dispose = render(() => {
      const source = createMemo(() => delay(10, 10));
      const gate = createMemo(() => delay(100, 20));
      const pending = createMemo(() => isPending(source));
      return <p>{`${pending()} | ${gate()}`}</p>;
    }, div);
    await wait(100);
    flush();
    expect(div.querySelector("p")?.textContent).toBe("false | 100");
    dispose();
  });

  test("two readers of gate never disagree across an update", async () => {
    const div = document.createElement("div");
    let setCount!: (v: number) => void;
    const dispose = render(() => {
      const [count, set] = createSignal(1);
      setCount = set;
      const source = createMemo(() => delay(count(), 10));
      const gate = createMemo(() => delay(count() * 100, 20));
      const pending = createMemo(() => isPending(source));
      const slow = createMemo(() => {
        const value = pending();
        return delay(value, value ? 30 : 300);
      });
      return (
        <>
          <p id="status">{`${pending()} | ${gate()}`}</p>
          <p id="slow">{`${slow()} | ${gate()}`}</p>
        </>
      );
    }, div);
    const rows = () => Array.from(div.querySelectorAll("p")).map(p => p.textContent!.split(" | "));
    await wait(400);
    flush();
    expect(rows()).toEqual([
      ["false", "100"],
      ["false", "100"]
    ]);
    setCount(2);
    flush();
    for (let i = 0; i < 50; i++) {
      await wait(10);
      const [a, b] = rows();
      expect(a[1]).toBe(b[1]);
    }
    expect(rows()).toEqual([
      ["false", "200"],
      ["false", "200"]
    ]);
    dispose();
  });
});
