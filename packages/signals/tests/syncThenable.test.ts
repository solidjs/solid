import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  onCleanup,
  refresh,
  type SourceAccessor
} from "../src/index.js";

afterEach(() => flush());

// Helper to create a sync thenable that matches PromiseLike interface
function syncThenable<T>(value: T): PromiseLike<T> {
  return {
    then<R1 = T, R2 = never>(
      onfulfilled?: ((v: T) => R1 | PromiseLike<R1>) | null
    ): PromiseLike<R1 | R2> {
      return syncThenable(onfulfilled ? onfulfilled(value) : (value as any));
    }
  };
}

function syncRejectingThenable<T = never>(reason: unknown): PromiseLike<T> {
  return {
    then<R1 = T, R2 = never>(
      _onfulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
      onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
    ): PromiseLike<R1 | R2> {
      onrejected?.(reason);
      return syncThenable(undefined as R1 | R2);
    }
  };
}

function controlledThenable<T>() {
  let onfulfilled: ((value: T) => void) | undefined;
  let onrejected: ((reason: any) => void) | undefined;
  return {
    then<R1 = T, R2 = never>(
      fulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
      rejected?: ((reason: any) => R2 | PromiseLike<R2>) | null
    ): PromiseLike<R1 | R2> {
      onfulfilled = fulfilled ? (value: T) => void fulfilled(value) : undefined;
      onrejected = rejected ? (reason: any) => void rejected(reason) : undefined;
      return syncThenable(undefined as R1 | R2);
    },
    resolve(value: T) {
      onfulfilled?.(value);
    },
    reject(reason: any) {
      onrejected?.(reason);
    }
  } satisfies PromiseLike<T> & { resolve(value: T): void; reject(reason: any): void };
}

function doneResult<T>(): IteratorResult<T> {
  return { done: true, value: undefined } as IteratorResult<T>;
}

function observeAsyncIterable<T>(iterable: AsyncIterable<T>) {
  const state = {
    value: "not-read" as unknown,
    error: "not-called" as unknown,
    errorCalled: false
  };

  createRoot(() => {
    const value = createMemo(() => iterable);
    const boundary = createErrorBoundary(
      () =>
        createLoadingBoundary(
          () => value(),
          () => "loading"
        )(),
      caught => {
        state.errorCalled = true;
        state.error = caught();
        return "errored";
      }
    );
    createRenderEffect(
      () => (state.value = boundary()),
      () => {}
    );
  });

  flush();
  return state;
}

describe("sync thenable support", () => {
  it("should resolve sync thenable immediately without NotReadyError", () => {
    const value = createMemo(() => syncThenable(42));
    expect(value()).toBe(42); // No flush needed - resolved synchronously
  });

  it("should still handle native Promises as async", async () => {
    const effect = vi.fn();
    createRoot(() => {
      const value = createMemo(() => Promise.resolve(42));
      createRenderEffect(value, v => effect(v));
    });

    flush();
    expect(effect).toHaveBeenCalledTimes(0); // Not called yet - async

    await Promise.resolve();
    expect(effect).toHaveBeenCalledTimes(1);
    expect(effect).toHaveBeenCalledWith(42);
  });

  it("should handle sync thenable that resolves with complex value", () => {
    const obj = { foo: "bar", num: 123 };
    const value = createMemo(() => syncThenable(obj));
    expect(value()).toBe(obj);
  });

  it("should handle chained sync thenables", () => {
    let derived: () => number;
    createRoot(() => {
      const base = createMemo(() => syncThenable(10));
      derived = createMemo(() => base() * 2);
    });

    expect(derived!()).toBe(20);
  });

  it("should handle sync thenable returning undefined", () => {
    const value = createMemo(() => syncThenable(undefined));
    expect(value()).toBe(undefined);
  });

  it("should surface a synchronously-rejecting thenable to the error boundary (#2764)", () => {
    // A thenable (e.g. a cache that already knows it failed) that invokes its
    // rejection handler synchronously during `.then()` must settle the error,
    // not stay stuck on the pending path.
    const result = createRoot(() =>
      createErrorBoundary(
        () => {
          const value = createMemo(() => syncRejectingThenable(new Error("sync-reject")));
          return value();
        },
        err => `errored: ${(err() as Error).message}`
      )
    );

    expect(result()).toBe("errored: sync-reject");
  });

  it("should ignore stale thenable resolution during invalidation cleanup", () => {
    const pending = controlledThenable<number>();
    const [$source, setSource] = createSignal(0);
    const seen: number[] = [];
    let value!: () => number;

    createRoot(() => {
      value = createMemo(() => {
        if ($source() === 0) {
          onCleanup(() => pending.resolve(999));
          return pending;
        }
        return 2;
      });
      createRenderEffect(value, v => {
        seen.push(v);
      });
    });

    setSource(1);
    flush();

    expect(value()).toBe(2);
    expect(seen).toEqual([2]);
  });
});

describe("sync async iterator support", () => {
  it("should settle an async iterator that completes without yielding", async () => {
    const state = observeAsyncIterable((async function* () {})());
    expect(state.value).toBe("loading");

    await Promise.resolve();
    flush();
    expect(state.value).toBe(undefined);
  });

  it("should preserve the last value when an async iterator completes", async () => {
    const state = observeAsyncIterable(
      (async function* () {
        yield 1;
        yield 2;
      })()
    );
    expect(state.value).toBe("loading");

    for (let i = 0; i < 4; i++) await Promise.resolve();
    flush();
    expect(state.value).toBe(2);
  });

  it("should preserve a synchronous yield when completion is asynchronous", async () => {
    const completion = controlledThenable<IteratorResult<number>>();
    let nextCalls = 0;
    const iterator = {
      next() {
        nextCalls++;
        return nextCalls === 1 ? syncThenable({ value: 1, done: false }) : completion;
      },
      [Symbol.asyncIterator]() {
        return this as any;
      }
    } as AsyncIterable<number>;
    const state = observeAsyncIterable(iterator);
    expect(state.value).toBe(1);
    completion.resolve(doneResult());
    await Promise.resolve();
    flush();
    expect(state.value).toBe(1);
  });

  it("should surface an async iterator rejection delivered synchronously", () => {
    const error = new Error("iterator failed");
    const iterator = {
      next: () => syncRejectingThenable<IteratorResult<number>>(error),
      [Symbol.asyncIterator]() {
        return this as any;
      }
    } as AsyncIterable<number>;
    const state = observeAsyncIterable(iterator);
    expect(state.value).toBe("errored");
    expect(state.error).toBe(error);
  });

  it("should surface a synchronous rejection after synchronously yielded values", () => {
    const error = new Error("iterator failed during initial drain");
    let nextCalls = 0;
    const iterator = {
      next() {
        nextCalls++;
        return nextCalls === 1
          ? syncThenable({ value: 1, done: false })
          : syncRejectingThenable<IteratorResult<number>>(error);
      },
      [Symbol.asyncIterator]() {
        return this as any;
      }
    } as AsyncIterable<number>;
    const state = observeAsyncIterable(iterator);
    expect(state.value).toBe("errored");
    expect(state.error).toBe(error);
  });

  it("should surface a nullish synchronous iterator rejection", () => {
    // Reachability only: the exact err() identity for nullish rejections
    // (undefined, not the internal wrapper) is the #2866 unwrap contract.
    const iterator = {
      next: () => syncRejectingThenable<IteratorResult<number>>(undefined),
      [Symbol.asyncIterator]() {
        return this as any;
      }
    } as AsyncIterable<number>;
    const state = observeAsyncIterable(iterator);
    expect(state.value).toBe("errored");
    expect(state.errorCalled).toBe(true);
  });

  it("should surface a synchronous rejection after an asynchronous yield", async () => {
    const error = new Error("iterator failed after yield");
    let resolveFirst!: (result: IteratorResult<number>) => void;
    let nextCalls = 0;
    const iterator = {
      next() {
        nextCalls++;
        if (nextCalls === 1) {
          return new Promise<IteratorResult<number>>(resolve => {
            resolveFirst = resolve;
          });
        }
        return syncRejectingThenable<IteratorResult<number>>(error);
      },
      [Symbol.asyncIterator]() {
        return this as any;
      }
    } as AsyncIterable<number>;
    const state = observeAsyncIterable(iterator);
    expect(state.value).toBe("loading");

    resolveFirst({ value: 1, done: false });
    await Promise.resolve();
    flush();
    expect(state.value).toBe("errored");
    expect(state.error).toBe(error);
  });

  it("should drain sync values from async iterator", () => {
    const values = [1, 2, 3];
    const syncIterator = {
      next() {
        const value = values.shift();
        return syncThenable({ value: value!, done: value === undefined });
      },
      [Symbol.asyncIterator]() {
        return this as any;
      }
    } as AsyncIterable<number>;

    const value = createMemo(() => syncIterator);
    expect(value()).toBe(3); // Last sync value
  });

  it("should handle sync iterator that is immediately done", () => {
    const syncIterator = {
      next() {
        return syncThenable({ value: undefined as any, done: true });
      },
      [Symbol.asyncIterator]() {
        return this as any;
      }
    } as AsyncIterable<number>;

    const value = createMemo(() => syncIterator);
    expect(value()).toBe(undefined);
  });

  it("should handle mixed sync/async iterator", async () => {
    let asyncResolve: (r: IteratorResult<number>) => void;
    let callCount = 0;

    const mixedIterator = {
      next(): PromiseLike<IteratorResult<number>> {
        callCount++;
        if (callCount <= 2) {
          // First two are sync
          return syncThenable({ value: callCount, done: false });
        }
        // Third is async
        return new Promise<IteratorResult<number>>(r => {
          asyncResolve = r;
        });
      },
      [Symbol.asyncIterator]() {
        return this as any;
      }
    } as AsyncIterable<number>;

    let value: () => number;
    createRoot(() => {
      value = createMemo(() => mixedIterator);
      createRenderEffect(value, () => {}); // keep alive
    });

    expect(value!()).toBe(2); // Sync values drained

    asyncResolve!({ value: 3, done: false });
    await Promise.resolve();
    flush();
    expect(value!()).toBe(3); // Async value arrived
  });

  it("should drain a next() that returns a bare IteratorResult (no thenable)", () => {
    // The async iterator protocol says next() returns a promise, but real
    // producers cheat: seroval's deserialized streams hand back the buffered
    // IteratorResult BARE when a value is already queued (a promise-free fast
    // path — `for await` tolerates it because `await` unwraps values and
    // thenables alike). The iterate loop must extend the same tolerance
    // instead of calling `.then` on a plain object and halting the graph.
    const values = [1, 2, 3];
    const bareIterator = {
      next() {
        const value = values.shift();
        return (
          value === undefined
            ? new Promise<IteratorResult<number>>(() => {})
            : { value, done: false }
        ) as any;
      },
      [Symbol.asyncIterator]() {
        return this as any;
      }
    } as AsyncIterable<number>;

    let value!: () => number;
    createRoot(() => {
      value = createMemo(() => bareIterator);
      createRenderEffect(value, () => {});
    });
    expect(value()).toBe(3); // Bare sync values drained, pending tail holds the last
  });

  it("should settle a bare done result and later bare yields after an async gap", async () => {
    // The seroval mid-stream shape: buffered values come back bare, a drained
    // buffer returns a real promise, and post-gap values are bare again.
    let resolveGap!: (r: IteratorResult<number>) => void;
    let calls = 0;
    const iterator = {
      next(): any {
        calls++;
        if (calls === 1) return { value: 1, done: false };
        if (calls === 2) return new Promise<IteratorResult<number>>(r => (resolveGap = r));
        if (calls === 3) return { value: 3, done: false };
        return { value: undefined, done: true };
      },
      [Symbol.asyncIterator]() {
        return this as any;
      }
    } as AsyncIterable<number>;

    let value!: () => number;
    createRoot(() => {
      value = createMemo(() => iterator);
      createRenderEffect(value, () => {});
    });
    expect(value()).toBe(1);

    resolveGap({ value: 2, done: false });
    await Promise.resolve();
    flush();
    // The post-gap pulls (bare 3, bare done) drain through the async write path.
    expect(value()).toBe(3);
  });

  it("should call async iterator return when invalidated", () => {
    let returnCalls = 0;
    const [$source, setSource] = createSignal(0);

    const firstIterator = {
      nextCalls: 0,
      next() {
        this.nextCalls++;
        if (this.nextCalls === 1) return syncThenable({ value: 1, done: false });
        return new Promise<IteratorResult<number>>(() => {});
      },
      return() {
        returnCalls++;
        return syncThenable(doneResult<number>());
      },
      [Symbol.asyncIterator]() {
        return this as any;
      }
    } as AsyncIterable<number> & {
      nextCalls: number;
      return(): PromiseLike<IteratorResult<number>>;
    };

    const secondIterator = {
      nextCalls: 0,
      next() {
        this.nextCalls++;
        return this.nextCalls === 1
          ? syncThenable({ value: 2, done: false })
          : syncThenable(doneResult<number>());
      },
      [Symbol.asyncIterator]() {
        return this as any;
      }
    } as AsyncIterable<number> & { nextCalls: number };

    let value!: () => number;
    createRoot(() => {
      value = createMemo(() => ($source() === 0 ? firstIterator : secondIterator));
      createRenderEffect(value, () => {});
    });

    expect(value()).toBe(1);
    expect(firstIterator.nextCalls).toBe(2);

    setSource(1);
    flush();

    expect(returnCalls).toBe(1);
    expect(value()).toBe(2);
  });

  it("should call async iterator return when disposed", () => {
    let returnCalls = 0;
    const iterator = {
      nextCalls: 0,
      next() {
        this.nextCalls++;
        if (this.nextCalls === 1) return syncThenable({ value: 1, done: false });
        return new Promise<IteratorResult<number>>(() => {});
      },
      return() {
        returnCalls++;
        return syncThenable(doneResult<number>());
      },
      [Symbol.asyncIterator]() {
        return this as any;
      }
    } as AsyncIterable<number> & {
      nextCalls: number;
      return(): PromiseLike<IteratorResult<number>>;
    };

    let dispose!: () => void;
    let value!: () => number;
    createRoot(disposer => {
      dispose = disposer;
      value = createMemo(() => iterator);
      createRenderEffect(value, () => {});
    });

    expect(value()).toBe(1);
    expect(iterator.nextCalls).toBe(2);

    dispose();

    expect(returnCalls).toBe(1);
  });

  it("should stop stale iteration immediately during invalidation cleanup", () => {
    const pending = controlledThenable<IteratorResult<number>>();
    const [$source, setSource] = createSignal(0);
    let returnCalls = 0;
    let oldNextCalls = 0;

    const firstIterator = {
      next() {
        oldNextCalls++;
        if (oldNextCalls === 1) return syncThenable({ value: 1, done: false });
        if (oldNextCalls === 2) return pending;
        return syncThenable({ value: 999, done: false });
      },
      return() {
        returnCalls++;
        pending.resolve({ value: 999, done: false });
        return syncThenable(doneResult<number>());
      },
      [Symbol.asyncIterator]() {
        return this as any;
      }
    } as AsyncIterable<number> & { return(): PromiseLike<IteratorResult<number>> };

    const secondIterator = {
      nextCalls: 0,
      next() {
        this.nextCalls++;
        return this.nextCalls === 1
          ? syncThenable({ value: 2, done: false })
          : syncThenable(doneResult<number>());
      },
      [Symbol.asyncIterator]() {
        return this as any;
      }
    } as AsyncIterable<number> & { nextCalls: number };

    let value!: () => number;
    createRoot(() => {
      value = createMemo(() => ($source() === 0 ? firstIterator : secondIterator));
      createRenderEffect(value, () => {});
    });

    expect(value()).toBe(1);
    expect(oldNextCalls).toBe(2);

    setSource(1);
    flush();

    expect(returnCalls).toBe(1);
    expect(oldNextCalls).toBe(2);
    expect(value()).toBe(2);
  });
});

// Test helper for Observable integration pattern
interface Subscribable<T> {
  subscribe(observer: {
    next: (value: T) => void;
    error?: (err: any) => void;
    complete?: () => void;
  }): { unsubscribe: () => void };
}

function fromObservable<T>(obs$: Subscribable<T>): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      const queue: T[] = [];
      let nextResolve: ((result: IteratorResult<T>) => void) | null = null;
      let errorReject: ((err: any) => void) | null = null;
      let done = false;
      let error: any = null;

      const sub = obs$.subscribe({
        next: v => {
          if (nextResolve) {
            nextResolve({ value: v, done: false });
            nextResolve = null;
            errorReject = null;
          } else {
            queue.push(v);
          }
        },
        complete: () => {
          done = true;
          if (nextResolve) {
            nextResolve({ value: undefined as T, done: true });
            nextResolve = null;
          }
        },
        error: e => {
          error = e;
          done = true;
          if (errorReject) {
            errorReject(e);
            errorReject = null;
            nextResolve = null;
          }
        }
      });

      return {
        next(): PromiseLike<IteratorResult<T>> {
          // Return a THENABLE, not a Promise - enables sync detection
          if (error) {
            return Promise.reject(error);
          } else if (queue.length) {
            return syncThenable({ value: queue.shift()!, done: false });
          } else if (done) {
            return syncThenable({ value: undefined as T, done: true });
          } else {
            // Async case - store resolvers and return a pending promise
            return new Promise((res, rej) => {
              nextResolve = res;
              errorReject = rej;
            });
          }
        },
        return(): PromiseLike<IteratorResult<T>> {
          sub.unsubscribe();
          done = true;
          return syncThenable({ value: undefined as T, done: true });
        }
      } as AsyncIterator<T>;
    }
  };
}

describe("fromObservable pattern", () => {
  // Mock BehaviorSubject - emits current value on subscribe
  function createBehaviorSubject<T>(initial: T) {
    let value = initial;
    const subs = new Set<{
      next: (v: T) => void;
      error?: (e: any) => void;
      complete?: () => void;
    }>();
    return {
      subscribe(observer: {
        next: (v: T) => void;
        error?: (e: any) => void;
        complete?: () => void;
      }) {
        observer.next(value); // Emit immediately
        subs.add(observer);
        return { unsubscribe: () => subs.delete(observer) };
      },
      next(v: T) {
        value = v;
        subs.forEach(obs => obs.next(v));
      },
      complete() {
        subs.forEach(obs => obs.complete?.());
      },
      error(e: any) {
        subs.forEach(obs => obs.error?.(e));
      }
    };
  }

  it("should get initial value synchronously from BehaviorSubject-like", () => {
    const subject = createBehaviorSubject(42);
    const signal = createMemo(() => fromObservable(subject));

    expect(signal()).toBe(42); // Sync - no flush needed!
  });

  it("should handle subsequent async Observable emissions via refresh", async () => {
    // For ongoing async updates, use refresh() to trigger recomputation
    // which resubscribes and gets the latest value
    const subject = createBehaviorSubject(1);
    let signal: SourceAccessor<number>;

    createRoot(() => {
      signal = createMemo(() => fromObservable(subject));
      createRenderEffect(signal, () => {}); // keep alive
    });

    expect(signal!()).toBe(1);

    // Update the subject, then refresh the memo to resubscribe
    subject.next(2);
    // Refresh triggers recomputation -> resubscribes -> gets current value
    refresh(signal!);
    flush();
    expect(signal!()).toBe(2);

    subject.next(3);
    refresh(signal!);
    flush();
    expect(signal!()).toBe(3);
  });

  it("should handle Observable that emits multiple sync values", () => {
    // Observable that emits 3 values synchronously on subscribe
    const multiEmitObservable = {
      subscribe(observer: { next: (v: number) => void }) {
        observer.next(1);
        observer.next(2);
        observer.next(3);
        return { unsubscribe: () => {} };
      }
    };

    const signal = createMemo(() => fromObservable(multiEmitObservable));
    expect(signal()).toBe(3); // Last sync value
  });

  it("should handle async-only Observable", async () => {
    let emit: (v: number) => void;
    const asyncObservable = {
      subscribe(observer: { next: (v: number) => void }) {
        emit = observer.next;
        return { unsubscribe: () => {} };
      }
    };

    let signal: () => number | undefined;
    let caught = false;

    createRoot(() => {
      signal = createMemo(() => fromObservable(asyncObservable));
      createRenderEffect(signal, () => {}, {});
    });

    // Initial read throws NotReadyError (caught by boundary)
    // The memo is pending

    emit!(1);
    await Promise.resolve();
    flush();
    expect(signal!()).toBe(1);
  });

  it("should handle Observable completion", () => {
    const subject = createBehaviorSubject(42);
    const signal = createMemo(() => fromObservable(subject));

    expect(signal()).toBe(42);

    subject.complete();
    // Should handle gracefully - value remains
    expect(signal()).toBe(42);
  });
});
