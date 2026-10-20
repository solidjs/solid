import { describe, expect, it, vi } from "vitest";
import { createMemo, createRenderEffect, createRoot, createSignal, flush } from "../src/index.js";

// The held-derivation rule changes the updater's input frame, not its result:
// returning a function must store that function as data, as setSignal does.
describe("function-valued writes to a held writable memo", () => {
  for (const held of [false, true]) {
    for (const memo of [false, true]) {
      for (const outcome of ["value", "undefined", "throw"] as const) {
        it(`held=${held}, memo=${memo}, returned callback=${outcome}`, async () => {
          let release!: (value: number) => void;
          const request = new Promise<number>(resolve => {
            release = resolve;
          });
          const original = () => "original",
            derived = () => "derived";
          const replacement = vi.fn(() => {
            if (outcome === "throw") throw new Error("replacement was invoked");
            return outcome === "value" ? "replacement" : undefined;
          });
          const app = createRoot(dispose => {
            const [version, setVersion] = createSignal(0);
            const [callback, setCallback] = memo
              ? createSignal<(() => unknown) | undefined>(() => (version() ? derived : original))
              : createSignal<() => unknown>();
            const slow = createMemo(() => (held && version() ? request : 0));
            createRenderEffect(
              () => [version(), callback(), slow()],
              () => {}
            );
            return { dispose, setVersion, setCallback };
          });
          try {
            flush();
            app.setVersion(1);
            flush();
            let previous: unknown;
            const result = app.setCallback(value => {
              previous = value;
              return replacement;
            });
            expect(replacement).not.toHaveBeenCalled();
            expect(result).toBe(replacement);
            expect(previous).toBe(memo ? (held ? original : derived) : undefined);
          } finally {
            app.dispose();
            flush();
            release(1);
            await Promise.resolve();
            flush();
          }
        });
      }
    }
  }
});
