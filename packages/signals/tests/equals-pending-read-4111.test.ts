/**
 * #4111 — a user `equals` comparator that reads a pending async source.
 *
 * A memo returns an object whose getter reads an async memo the object owns;
 * the comparator reads that getter on the new object while its async memo is
 * still uninitialized, so the read throws NotReadyError. The comparator did not
 * show the values equal, so the value is a change: the reader that
 * dereferences the getter in its own tracked context suspends under its
 * Loading boundary and recovers when the async work lands. Before the fix the
 * memo stored the NotReadyError as its error, nothing tracked the inner memo,
 * and the UI stayed on the previous value.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

const tick = () => new Promise<void>(r => setTimeout(r, 0));

describe("equals reading a pending getter (#4111)", () => {
  let errorSpy!: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  function setup(asyncOuter: boolean) {
    const log: unknown[] = [];
    const [n, setN] = createSignal(0);
    const [beat, setBeat] = createSignal(0);
    const resolvers: (() => void)[] = [];

    createRoot(() => {
      const obj = createMemo(
        () => {
          const v = n();
          const inner = createMemo(() => new Promise<number>(r => resolvers.push(() => r(v))));
          const o = {
            get value() {
              return inner();
            }
          };
          return asyncOuter && v !== 0 ? Promise.resolve().then(() => o) : o;
        },
        { equals: (a, b) => a.value === b.value }
      );
      const view = createLoadingBoundary(
        () => `Value: ${obj().value}`,
        () => "loading"
      );
      createRenderEffect(view, v => {
        log.push(v);
      });
      createRenderEffect(beat, v => {
        log.push(`beat=${v}`);
      });
    });
    return { log, setN, setBeat, resolvers };
  }

  for (const asyncOuter of [false, true])
    it(`${asyncOuter ? "async landing" : "sync recompute"}: the UI reaches the resolved value`, async () => {
      const { log, setN, setBeat, resolvers } = setup(asyncOuter);
      flush();
      resolvers.splice(0).forEach(r => r());
      await tick();
      flush();
      expect(log.at(-1)).toBe("Value: 0");

      setN(2);
      flush();
      await tick();
      flush();
      // Pending, not errored: the boundary keeps the previous frame.
      expect(log.at(-1)).toBe("Value: 0");
      expect(errorSpy).not.toHaveBeenCalled();

      resolvers.splice(0).forEach(r => r());
      await tick();
      flush();
      expect(log.at(-1)).toBe("Value: 2");

      // The scheduler is alive.
      setBeat(1);
      flush();
      expect(log.at(-1)).toBe("beat=1");
      expect(errorSpy).not.toHaveBeenCalled();
    });
});
