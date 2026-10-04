/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #3726 — the report's shape: a derived `createStore` whose first run
// returns a pending promise, read by presence (`"length" in store`) inside
// `<Loading>` beside a read of the source; a timer callback writes the
// source (the derive lands synchronously) and resolves the superseded
// promise in the same tick. The presence hole stayed blank. The signals-side
// pin is `packages/signals/tests/store/derived-presence-async-3726.test.ts`.
import { describe, expect, test } from "vitest";
import { createSignal, createStore, Loading } from "solid-js";
import { render } from "../src/index.js";

const microtasks = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("presence read on an async derived store (#3726)", () => {
  test("shows `present` after the source resolves the derive synchronously", async () => {
    const div = document.createElement("div");
    let resolve!: (v: number[]) => void;
    let setSource!: (v: number[]) => void;
    const dispose = render(() => {
      const [source, set] = createSignal<number[] | null>(null);
      setSource = set;
      const [store] = createStore<number[]>(() => {
        const s = source();
        if (s) return s;
        return new Promise<number[]>(r => (resolve = r));
      }, []);
      return (
        <Loading fallback={<p>Loading</p>}>
          <p>Presence: {"length" in store ? "present" : "missing"}</p>
          <p>Source: {source() ? "resolved" : "pending"}</p>
        </Loading>
      );
    }, div);
    await microtasks();
    expect(div.innerHTML).toBe("<p>Loading</p>");

    await new Promise<void>(r =>
      setTimeout(() => {
        setSource([1]);
        resolve([1]);
        r();
      }, 0)
    );
    await microtasks();
    expect(div.innerHTML).toBe("<p>Presence: present</p><p>Source: resolved</p>");
    dispose();
  });
});
