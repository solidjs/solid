import { afterEach, describe, expect, it } from "vitest";
import {
  createDeferred,
  createMemo,
  createRoot,
  createSignal,
  flush,
  resetErrorHalt
} from "../src/index.js";

// The ordinary consumer also supports bare buffered IteratorResults (see
// syncThenable.test.ts). TypeScript's AsyncIterator requires Promise results.
function buffered(value: number, complete = false): AsyncIterable<number> {
  let first = true;
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (first) {
            first = false;
            return { value, done: false };
          }
          if (complete) return { value: undefined, done: true };
          return new Promise<IteratorResult<number>>(() => {});
        }
      };
    }
  } as unknown as AsyncIterable<number>;
}

afterEach(() => {
  resetErrorHalt();
  flush();
});

describe("synchronous iterator results in createDeferred", () => {
  for (const seeded of [false, true]) {
    for (const complete of [false, true]) {
      it(`keeps first and later buffered values (seeded=${seeded}, complete=${complete})`, () => {
        let dispose!: () => void;
        let setVersion!: (value: number) => unknown;
        let value!: () => number;
        createRoot(d => {
          dispose = d;
          const [version, set] = createSignal(0);
          setVersion = set;
          value = createDeferred(
            () => {
              const current = version();
              return buffered(current, complete);
            },
            seeded ? { loadingValue: -1 } : undefined
          );
        });
        try {
          flush();
          expect(value()).toBe(0);
          setVersion(1);
          flush();
          expect(value()).toBe(1);
          setVersion(2);
          flush();
          expect(value()).toBe(2);
        } finally {
          dispose();
        }
      });
    }

    it(`ordinary memo control (seeded=${seeded})`, () => {
      let dispose!: () => void;
      let setVersion!: (value: number) => unknown;
      let value!: () => number;
      createRoot(d => {
        dispose = d;
        const [version, set] = createSignal(0);
        setVersion = set;
        value = createMemo(
          () => {
            const current = version();
            return buffered(current);
          },
          seeded ? { loadingValue: -1 } : undefined
        );
      });
      try {
        flush();
        expect(value()).toBe(0);
        setVersion(1);
        flush();
        expect(value()).toBe(1);
      } finally {
        dispose();
      }
    });

    it(`promise iterator control (seeded=${seeded})`, async () => {
      let dispose!: () => void;
      let setVersion!: (value: number) => unknown;
      let value!: () => number;
      createRoot(d => {
        dispose = d;
        const [version, set] = createSignal(0);
        setVersion = set;
        value = createDeferred(
          () => {
            const current = version();
            return (async function* () {
              yield current;
            })();
          },
          seeded ? { loadingValue: -1 } : undefined
        );
      });
      try {
        for (let i = 0; i < 4; i++) await Promise.resolve();
        flush();
        expect(value()).toBe(0);
        setVersion(1);
        flush();
        for (let i = 0; i < 4; i++) await Promise.resolve();
        flush();
        expect(value()).toBe(1);
      } finally {
        dispose();
      }
    });
  }
});
