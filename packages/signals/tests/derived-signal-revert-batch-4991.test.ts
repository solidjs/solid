import { describe, expect, test } from "vitest";
import { createRenderEffect, createRoot, createSignal, flush } from "../src/index.js";

describe("#4991: a derived signal's write after another source reverts in the same batch", () => {
  test("the effect sees the derived write", () => {
    const [a, setA] = createSignal(false);
    const [b, setB] = createSignal(() => false);
    let seen: boolean | undefined;
    createRoot(() => {
      createRenderEffect(
        () => [a(), b()] as const,
        ([, bv]) => {
          seen = bv;
        }
      );
    });
    flush();
    setA(true);
    setA(false);
    setB(true);
    flush();
    expect(b()).toBe(true);
    expect(seen).toBe(true);
  });
});
