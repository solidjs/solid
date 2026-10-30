/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4355 — a derived store whose derive reads an async memo through
// `latest()`: once it resolves, a memo over the store sees what the derive
// wrote, never the seed, so a hole fed through that memo shows the same
// thing as a hole reading the store directly (D-30, D-3: JSX grouping does
// not change the result). The signals-side pins are
// `packages/signals/tests/derived-store-latest-seed-4355.test.ts`.
import { describe, expect, test } from "vitest";
import { createMemo, createStore, latest, Loading } from "solid-js";
import { render } from "../src/index.js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe("derived store over latest() of an async memo (#4355)", () => {
  for (const through of ["memo", "direct"] as const)
    test(`a hole reading the store ${through === "memo" ? "through a memo" : "directly"} never sees the seed`, async () => {
      const div = document.createElement("div");
      const seen: string[] = [];
      const dispose = render(() => {
        const record = createMemo(async () => {
          await sleep(10);
          return { name: "Hartford" };
        });
        const [state] = createStore<{ value?: { name: string } }>(d => {
          d.value = { name: latest(() => record().name) };
        }, {});
        // `state.value.name.trim()` throws on the seed: the report's form
        // component.
        const name =
          through === "memo"
            ? createMemo(() => state.value!.name.trim())
            : () => state.value!.name.trim();
        return (
          <Loading fallback={<p>Loading…</p>}>
            <p>{(seen.push(name()), name())}</p>
          </Loading>
        );
      }, div);
      expect(div.innerHTML).toBe("<p>Loading…</p>");
      await sleep(40);
      expect(div.innerHTML).toBe("<p>Hartford</p>");
      expect(seen.every(v => v === "Hartford")).toBe(true);
      dispose();
    });
});
