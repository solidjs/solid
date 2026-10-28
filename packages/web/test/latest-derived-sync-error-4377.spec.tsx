/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4377 (async-app generator, pair E9): `latest(m)` read in a memo shows
// `m`'s error as the same read at the leaf does. The signals-side pins are
// `packages/signals/tests/latest-derived-sync-error-4377.test.ts`.
import { describe, expect, test } from "vitest";
import { createMemo, createSignal, Errored, flush, latest } from "solid-js";
import { render } from "../src/index.js";

describe("a memo over latest(m) when m starts throwing (#4377)", () => {
  for (const shape of ["leaf", "derive"] as const)
    test(shape, () => {
      const div = document.createElement("div");
      const [a, setA] = createSignal(0);
      const dispose = render(() => {
        const m = createMemo(() => {
          if (a() === 1) throw new Error("boom");
          return a();
        });
        const d = createMemo(() => latest(m));
        return (
          <Errored fallback={() => "[ERR]"}>
            <span>{shape === "leaf" ? latest(m) : d()}</span>
          </Errored>
        );
      }, div);
      flush();
      expect(div.innerHTML).toBe("<span>0</span>");
      setA(1);
      flush();
      expect(div.innerHTML).toBe("[ERR]");
      dispose();
    });
});
