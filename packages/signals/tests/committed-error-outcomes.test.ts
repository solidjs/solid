import {
  createEffect,
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
  latest,
  NotReadyError,
  type SourceAccessor
} from "../src/index.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, bad) => {
    resolve = ok;
    reject = bad;
  });
  return { promise, resolve, reject };
}
const tick = async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  flush();
};

it.each(
  [undefined, null, false, new Error("failed")].flatMap(marker =>
    [false, true].map(projection => ({ marker, projection }))
  )
)(
  "outside reads retain the published outcome across rejection and recovery ($projection, $marker)",
  async ({ marker, projection }) => {
    let request = deferred<number>();
    let sibling = deferred<number>();
    let source!: () => number;
    const [count, setCount] = createSignal(1);
    const published: unknown[] = [];
    const dispose = createRoot(d => {
      if (projection) {
        const [store] = createStore(
          () => {
            count();
            return request.promise.then(answer => ({ answer }));
          },
          { answer: 1 }
        );
        source = () => store.answer;
      } else
        source = createMemo(() => {
          count();
          return request.promise;
        });
      const slow = createMemo(() => {
        count();
        return sibling.promise;
      });
      createRenderEffect(slow, () => {}, { schedule: true });
      createEffect(source, {
        effect: value => {
          published.push({ value });
        },
        error: error => {
          published.push({ error });
        }
      });
      return d;
    });
    try {
      flush();
      request.resolve(1);
      sibling.resolve(1);
      await tick();
      expect(source()).toBe(1);
      expect(published).toEqual([{ value: 1 }]);

      request = deferred<number>();
      sibling = deferred<number>();
      setCount(2);
      flush();
      request.reject(marker);
      await tick();
      expect(published).toEqual([{ value: 1 }]);
      expect(source()).toBe(1);
      expect(isPending(source)).toBe(true);
      expect(isPending(() => latest(source))).toBe(false);

      sibling.resolve(2);
      await tick();
      expect(published).toEqual([{ value: 1 }, { error: marker }]);
      expect(isPending(source)).toBe(false);
      const readError = () => {
        try {
          source();
          return { returned: true };
        } catch (error) {
          return { cause: (error as Error).cause };
        }
      };
      expect(readError()).toEqual({ cause: marker });

      request = deferred<number>();
      sibling = deferred<number>();
      setCount(3);
      flush();
      expect(readError()).toEqual({ cause: marker });
      request.resolve(1);
      await tick();
      expect(published).toEqual([{ value: 1 }, { error: marker }]);
      expect(readError()).toEqual({ cause: marker });
      expect(isPending(source)).toBe(true);
      expect(latest(source)).toBe(1);

      sibling.resolve(3);
      await tick();
      expect(source()).toBe(1);
      expect(published).toEqual([{ value: 1 }, { error: marker }, { value: 1 }]);
    } finally {
      dispose();
      flush();
    }
  }
);

it.each([false, true])(
  "publishes a born-held first rejection with its live birth frame ($0)",
  async releaseHoldFirst => {
    const request = deferred<number>();
    let sibling = deferred<number>();
    const marker = new Error("initial failure");
    const [count, setCount] = createSignal(1);
    let source!: SourceAccessor<number>;
    const published: unknown[] = [];
    const disposeSlow = createRoot(d => {
      const slow = createMemo(() => {
        count();
        return sibling.promise;
      });
      createRenderEffect(slow, () => {}, { schedule: true });
      return d;
    });
    flush();
    sibling.resolve(1);
    await tick();
    sibling = deferred<number>();
    setCount(2);
    flush();
    const dispose = createRoot(d => {
      source = createMemo(() => {
        count();
        return request.promise;
      });
      createEffect(source, {
        effect: () => {},
        error: e => {
          published.push(e);
        }
      });
      return d;
    });
    try {
      flush();
      if (releaseHoldFirst) {
        sibling.resolve(2);
        await tick();
        // The parent never waits for a slower first load created over it.
        expect(count()).toBe(2);
        expect(published).toEqual([]);
      }
      request.reject(marker);
      await tick();
      expect(() => latest(source)).toThrow("initial failure");
      if (!releaseHoldFirst) {
        expect(published).toEqual([]);
        expect(() => source()).toThrow(NotReadyError);
        sibling.resolve(2);
        await tick();
      }
      expect(published).toEqual([marker]);
      expect(() => source()).toThrow("initial failure");
    } finally {
      dispose();
      disposeSlow();
      flush();
    }
  }
);

it("retains loadingValue as successful prev history without resurfacing it after an error", async () => {
  const marker = new Error("seed request failed");
  let request = deferred<number>();
  const previous: (number | undefined)[] = [];
  const [count, setCount] = createSignal(0);
  let source!: SourceAccessor<number>;
  const dispose = createRoot(d => {
    source = createMemo(
      prev => {
        count();
        previous.push(prev);
        return request.promise;
      },
      { loadingValue: 42 }
    );
    createEffect(source, { effect: () => {}, error: () => {} });
    return d;
  });
  try {
    flush();
    expect(source()).toBe(42);
    request.reject(marker);
    await tick();
    expect(() => source()).toThrow("seed request failed");
    request = deferred<number>();
    setCount(1);
    flush();
    expect(previous).toEqual([42, 42]);
    expect(() => source()).toThrow("seed request failed");
    request.resolve(9);
    await tick();
    expect(source()).toBe(9);
    request = deferred<number>();
    setCount(2);
    flush();
    expect(previous).toEqual([42, 42, 9]);
    request.resolve(10);
    await tick();
  } finally {
    dispose();
    flush();
  }
});

it("ends the loadingValue window when the first synchronous failure publishes", async () => {
  const marker = new Error("first synchronous failure");
  const request = deferred<number>();
  const [retry, setRetry] = createSignal(false);
  let source!: SourceAccessor<number>;
  const dispose = createRoot(d => {
    source = createMemo(
      () => {
        if (!retry()) throw marker;
        return request.promise;
      },
      { loadingValue: 42 }
    );
    createEffect(source, { effect: () => {}, error: () => {} });
    return d;
  });
  try {
    expect(() => source()).toThrow("first synchronous failure");
    setRetry(true);
    flush();
    expect(isPending(source)).toBe(true);
    expect(() => source()).toThrow("first synchronous failure");
    request.resolve(9);
    await tick();
    expect(source()).toBe(9);
    expect(isPending(source)).toBe(false);
  } finally {
    dispose();
    flush();
  }
});

it.each([
  { fails: false, recoverBeforeFlush: false },
  { fails: true, recoverBeforeFlush: false },
  { fails: true, recoverBeforeFlush: true }
])(
  "keeps commit #0 when a born-held memo has a first answer ($fails, $recoverBeforeFlush)",
  async ({ fails, recoverBeforeFlush }) => {
    const marker = new Error("held first answer");
    let sibling = deferred<number>();
    const [fault, setFault] = createSignal(fails);
    const [count, setCount] = createSignal(1);
    const disposeSlow = createRoot(d => {
      const slow = createMemo(() => {
        count();
        return sibling.promise;
      });
      createRenderEffect(slow, () => {}, { schedule: true });
      return d;
    });
    flush();
    sibling.resolve(1);
    await tick();
    sibling = deferred<number>();
    setCount(2);
    flush();
    let source!: SourceAccessor<number>;
    const published: unknown[] = [];
    const dispose = createRoot(d => {
      source = createMemo(
        () => {
          count();
          if (fault()) throw marker;
          return 7;
        },
        { loadingValue: 42 }
      );
      createEffect(source, {
        effect: value => {
          published.push(value);
        },
        error: error => {
          published.push(error);
        }
      });
      return d;
    });
    try {
      if (recoverBeforeFlush) setFault(false);
      const finalFailure = fails && !recoverBeforeFlush;
      flush();
      expect(source()).toBe(42);
      expect(published).toEqual([]);
      expect(isPending(source)).toBe(true);
      if (finalFailure) expect(() => latest(source)).toThrow("held first answer");
      else expect(latest(source)).toBe(7);
      sibling.resolve(2);
      await tick();
      expect(published).toEqual([finalFailure ? marker : 7]);
      if (finalFailure) expect(source).toThrow("held first answer");
      else expect(source()).toBe(7);
      expect(isPending(source)).toBe(false);
    } finally {
      dispose();
      disposeSlow();
      flush();
    }
  }
);

it("reveals an error fallback with the same frame as a fulfilled answer", async () => {
  const marker = new Error("failed");
  let request = deferred<number>();
  let sibling = deferred<number>();
  let source!: SourceAccessor<number>;
  const [count, setCount] = createSignal(1);
  let displayed: number | string = "mounting";
  let displayedSibling = 0;
  const dispose = createRoot(d => {
    source = createMemo(() => {
      count();
      return request.promise;
    });
    const slow = createMemo(() => {
      count();
      return sibling.promise;
    });
    const boundary = createErrorBoundary(source, error => {
      expect(error()).toBe(marker);
      return "failed";
    });
    createRenderEffect(
      boundary,
      value => {
        displayed = value;
      },
      { schedule: true }
    );
    createRenderEffect(
      slow,
      value => {
        displayedSibling = value;
      },
      { schedule: true }
    );
    return d;
  });
  try {
    flush();
    request.resolve(1);
    sibling.resolve(1);
    await tick();
    expect([displayed, displayedSibling]).toEqual([1, 1]);
    request = deferred<number>();
    sibling = deferred<number>();
    setCount(2);
    flush();
    request.reject(marker);
    await tick();
    expect([displayed, displayedSibling]).toEqual([1, 1]);
    expect(source()).toBe(1);
    sibling.resolve(2);
    await tick();
    expect([displayed, displayedSibling]).toEqual(["failed", 2]);
    expect(() => source()).toThrow("failed");
  } finally {
    dispose();
    flush();
  }
});

it("retains the first published failure while a different failure is held", async () => {
  const first = new Error("first failure");
  const second = new Error("second failure");
  let request = deferred<number>();
  let sibling = deferred<number>();
  const [count, setCount] = createSignal(0);
  let source!: SourceAccessor<number>;
  const published: unknown[] = [];
  const dispose = createRoot(d => {
    source = createMemo(() => {
      count();
      return request.promise;
    });
    const slow = createMemo(() => {
      count();
      return sibling.promise;
    });
    createRenderEffect(slow, () => {}, { schedule: true });
    createEffect(source, {
      effect: () => {},
      error: error => {
        published.push(error);
      }
    });
    return d;
  });
  try {
    flush();
    request.reject(first);
    sibling.resolve(0);
    await tick();
    expect(() => source()).toThrow("first failure");
    request = deferred<number>();
    sibling = deferred<number>();
    setCount(1);
    flush();
    request.reject(second);
    await tick();
    expect(published).toEqual([first]);
    expect(() => source()).toThrow("first failure");
    expect(() => latest(source)).toThrow("second failure");
    expect(isPending(source)).toBe(true);
    sibling.resolve(1);
    await tick();
    expect(published).toEqual([first, second]);
    expect(() => source()).toThrow("second failure");
    expect(isPending(source)).toBe(false);
  } finally {
    dispose();
    flush();
  }
});

it("does not coalesce synchronous same-value recovery with a held outcome transition", async () => {
  const marker = new Error("failed");
  let sibling = deferred<number>();
  const [count, setCount] = createSignal(0);
  let source!: SourceAccessor<number>;
  const published: unknown[] = [];
  const dispose = createRoot(d => {
    source = createMemo(() => {
      if (count() === 1) throw marker;
      return 1;
    });
    const slow = createMemo(() => {
      count();
      return sibling.promise;
    });
    createRenderEffect(slow, () => {}, { schedule: true });
    createEffect(source, {
      effect: value => {
        published.push(value);
      },
      error: error => {
        published.push(error);
      }
    });
    return d;
  });
  try {
    flush();
    sibling.resolve(0);
    await tick();
    sibling = deferred<number>();
    setCount(1);
    flush();
    expect(source()).toBe(1);
    sibling.resolve(1);
    await tick();
    expect(() => source()).toThrow("failed");
    sibling = deferred<number>();
    setCount(2);
    flush();
    expect(() => source()).toThrow("failed");
    expect(published).toEqual([1, marker]);
    expect(isPending(source)).toBe(true);
    sibling.resolve(2);
    await tick();
    expect(source()).toBe(1);
    expect(published).toEqual([1, marker, 1]);
  } finally {
    dispose();
    flush();
  }
});
