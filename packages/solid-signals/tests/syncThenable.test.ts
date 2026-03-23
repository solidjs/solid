import {
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  onCleanup
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
        return syncThenable({ value: undefined as number, done: true });
      },
      [Symbol.asyncIterator]() {
        return this as any;
      }
    } as AsyncIterable<number> & { nextCalls: number; return(): PromiseLike<IteratorResult<number>> };

    const secondIterator = {
      nextCalls: 0,
      next() {
        this.nextCalls++;
        return this.nextCalls === 1
          ? syncThenable({ value: 2, done: false })
          : syncThenable({ value: undefined as number, done: true });
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
        return syncThenable({ value: undefined as number, done: true });
      },
      [Symbol.asyncIterator]() {
        return this as any;
      }
    } as AsyncIterable<number> & { nextCalls: number; return(): PromiseLike<IteratorResult<number>> };

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
        return syncThenable({ value: undefined as number, done: true });
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
          : syncThenable({ value: undefined as number, done: true });
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
    let signal: () => number;

    createRoot(() => {
      signal = createMemo(() => fromObservable(subject));
      createRenderEffect(signal, () => {}); // keep alive
    });

    expect(signal!()).toBe(1);

    // Update the subject, then refresh the memo to resubscribe
    subject.next(2);
    // Refresh triggers recomputation -> resubscribes -> gets current value
    const { refresh } = await import("../src/index.js");
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
      createRenderEffect(signal, () => {}, undefined, {});
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
