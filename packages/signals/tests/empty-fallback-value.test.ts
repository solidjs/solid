import { describe, expect, it } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray,
  onCleanup,
  repeat,
  type Accessor,
  type Setter
} from "../src/index.js";

for (const helper of ["mapArray", "repeat"] as const) {
  describe(`${helper} empty fallback values`, () => {
    it.each([0, false, null, undefined, "", 1, "empty"])(
      "retains a successful %s fallback while the list stays empty",
      value => {
        let created = 0;
        let cleaned = 0;
        let setItems!: Setter<number[]>;
        let view!: Accessor<number[]>;
        const dispose = createRoot(dispose => {
          const [items, set] = createSignal<number[]>([]);
          setItems = set;
          const fallback = () => {
            created++;
            onCleanup(() => cleaned++);
            return value;
          };
          view =
            helper === "mapArray"
              ? mapArray(items, item => item, { fallback })
              : repeat(
                  () => items().length,
                  index => index,
                  { fallback }
                );
          return dispose;
        });

        try {
          flush();
          const initial = view();
          expect(initial).toEqual([value]);
          for (let i = 0; i < 2; i++) {
            setItems([]);
            flush();
            expect(view()).toBe(initial);
            expect([created, cleaned]).toEqual([1, 0]);
          }

          setItems([1]);
          flush();
          expect(view()).toHaveLength(1);
          expect([created, cleaned]).toEqual([1, 1]);

          setItems([]);
          flush();
          expect(view()).toEqual([value]);
          expect([created, cleaned]).toEqual([2, 1]);
          setItems([]);
          flush();
          expect([created, cleaned]).toEqual([2, 1]);
        } finally {
          dispose();
          flush();
        }
        expect(cleaned).toBe(created);
      }
    );

    it("retries a suspended fallback, then retains its successful zero result", async () => {
      let resolve!: (value: number) => void;
      const pending = new Promise<number>(done => (resolve = done));
      let created = 0;
      let cleaned = 0;
      let screen: unknown;
      let setItems!: Setter<number[]>;
      const dispose = createRoot(dispose => {
        const [items, set] = createSignal<number[]>([]);
        setItems = set;
        const value = createMemo(() => pending);
        const fallback = () => {
          created++;
          onCleanup(() => cleaned++);
          return value();
        };
        const view =
          helper === "mapArray"
            ? mapArray(items, item => item, { fallback })
            : repeat(
                () => items().length,
                index => index,
                { fallback }
              );
        const boundary = createLoadingBoundary(
          () => view().join(","),
          () => "loading"
        );
        createRenderEffect(boundary, value => {
          screen = value;
        });
        return dispose;
      });

      try {
        flush();
        expect(screen).toBe("loading");
        resolve(0);
        await new Promise(done => setTimeout(done, 0));
        flush();
        expect(screen).toBe("0");
        expect(created - cleaned).toBe(1);
        const settled = [created, cleaned];

        setItems([]);
        flush();
        expect(screen).toBe("0");
        expect([created, cleaned]).toEqual(settled);
      } finally {
        dispose();
        flush();
      }
      expect(cleaned).toBe(created);
    });
  });
}
