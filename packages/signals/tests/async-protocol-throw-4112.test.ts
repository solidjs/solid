import {
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  flush
} from "../src/index.js";

// #4112: throws raised while Solid invokes the async-iterator / thenable
// protocol (not rejections delivered through it) must reach the owning memo's
// error handling, and error formatting must never replace the original error.

afterEach(() => flush());

const tick = () => new Promise<void>(r => setTimeout(r, 0));
const original = (e: any) => e?.cause ?? e;

describe("#4112 async protocol throws reach the memo", () => {
  let unhandled: unknown[];
  const onUnhandled = (e: unknown) => void unhandled.push(e);
  beforeEach(() => {
    unhandled = [];
    process.on("unhandledRejection", onUnhandled);
  });
  afterEach(() => void process.off("unhandledRejection", onUnhandled));

  // Yields 1 after a timer, then defers to `second` for the next pull.
  function iterableWith(second: () => any): AsyncIterable<number> {
    return {
      [Symbol.asyncIterator]() {
        let n = 0;
        return {
          next() {
            if (n++ === 0)
              return new Promise<IteratorResult<number>>(r =>
                setTimeout(() => r({ done: false, value: 1 }))
              );
            return second();
          }
        } as AsyncIterator<number>;
      }
    };
  }

  // Mirrors <Errored>{memo()}</Errored>: the boundary's fallback is where a
  // protocol failure must surface.
  async function run(source: () => any) {
    const shown: unknown[] = [];
    createRoot(() => {
      const memo = createMemo(source as () => number);
      const b = createErrorBoundary(
        () => memo(),
        err => original(err())
      );
      createRenderEffect(
        () => {
          try {
            return b();
          } catch {
            return "loading";
          }
        },
        v => void shown.push(v)
      );
    });
    flush();
    for (let i = 0; i < 4; i++) {
      await tick();
      flush();
    }
    return shown;
  }

  const last = (shown: unknown[]) => (shown[shown.length - 1] as any)?.message;

  it("control: later next() rejecting reaches the boundary", async () => {
    const shown = await run(() => iterableWith(() => Promise.reject(new Error("rejected"))));
    expect(last(shown)).toBe("rejected");
    expect(unhandled).toEqual([]);
  });

  it("later next() throwing synchronously reaches the boundary", async () => {
    const shown = await run(() =>
      iterableWith(() => {
        throw new Error("next failed");
      })
    );
    expect(last(shown)).toBe("next failed");
    expect(unhandled).toEqual([]);
  });

  it("next step's then() throwing reaches the boundary", async () => {
    const shown = await run(() =>
      iterableWith(() => ({
        then() {
          throw new Error("then failed");
        }
      }))
    );
    expect(last(shown)).toBe("then failed");
    expect(unhandled).toEqual([]);
  });

  it("deferred iterator factory throwing reaches the boundary", async () => {
    const shown = await run(() =>
      new Promise(r => setTimeout(r)).then(() => ({
        [Symbol.asyncIterator]() {
          throw new Error("iterator failed");
        }
      }))
    );
    expect(last(shown)).toBe("iterator failed");
    expect(unhandled).toEqual([]);
  });

  it("deferred first next() throwing reaches the boundary", async () => {
    const shown = await run(() =>
      new Promise(r => setTimeout(r)).then(() => ({
        [Symbol.asyncIterator]() {
          return {
            next() {
              throw new Error("first next failed");
            }
          };
        }
      }))
    );
    expect(last(shown)).toBe("first next failed");
    expect(unhandled).toEqual([]);
  });
});

describe("#4112 error formatting keeps the original error", () => {
  function create(thrown: unknown) {
    let memo!: () => unknown;
    expect(() =>
      createRoot(() => {
        memo = createMemo(() => {
          throw thrown;
        });
      })
    ).not.toThrow();
    let caught: unknown;
    try {
      memo();
    } catch (e) {
      caught = e;
    }
    expect(original(caught)).toBe(thrown);
  }

  it("unstringifiable thrown value does not escape createMemo", () => {
    create(Object.create(null));
  });

  it("throwing message getter does not escape createMemo", () => {
    const err = new Error("x");
    Object.defineProperty(err, "message", {
      get() {
        throw new Error("getter");
      }
    });
    create(err);
  });
});
