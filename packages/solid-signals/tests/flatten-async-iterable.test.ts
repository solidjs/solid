import {
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  NotReadyError
} from "../src/index.js";

afterEach(() => flush());

const tick = () => new Promise<void>(r => setTimeout(r, 0));

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// A manually pumped AsyncIterable with an observable return() — the shape a
// live server stub's stream materializes as on the client.
function controlledIterable<T>() {
  type Waiter = (r: IteratorResult<T>) => void;
  const buffered: IteratorResult<T>[] = [];
  let waiter: Waiter | null = null;
  let returnCalls = 0;
  const push = (r: IteratorResult<T>) => {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(r);
    } else buffered.push(r);
  };
  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise<IteratorResult<T>>(res => {
          if (buffered.length) res(buffered.shift()!);
          else waiter = res;
        }),
      return: () => {
        returnCalls++;
        return Promise.resolve({ done: true as const, value: undefined });
      }
    })
  };
  return {
    iterable,
    yield: (value: T) => push({ done: false, value }),
    end: () => push({ done: true, value: undefined as any }),
    get returnCalls() {
      return returnCalls;
    }
  };
}

// Sync thenable (Promises/A+ shape, settles inside .then call) — exercises the
// live-flatten path where the promise resolves within the synchronous read.
function syncThenable<T>(value: T): PromiseLike<T> {
  return {
    then<R1 = T>(onfulfilled?: ((v: T) => R1 | PromiseLike<R1>) | null): PromiseLike<R1> {
      return syncThenable(onfulfilled ? onfulfilled(value) : (value as any)) as PromiseLike<R1>;
    }
  };
}

describe("promise-of-AsyncIterable flattening (deferred posture)", () => {
  it("consumes the stream instead of settling on the iterable object", async () => {
    const gate = deferred();
    const stream = controlledIterable<number>();
    const values: number[] = [];
    createRoot(() => {
      const memo = createMemo(() => gate.promise.then(() => stream.iterable) as unknown as number);
      createEffect(memo, v => void values.push(v as number));
    });
    flush();
    expect(values).toEqual([]);

    // Promise resolves to the iterable: still pending — the stream, not the
    // iterable object, is the value.
    gate.resolve();
    await tick();
    flush();
    expect(values).toEqual([]);

    stream.yield(1);
    await tick();
    flush();
    expect(values).toEqual([1]);

    stream.yield(2);
    await tick();
    flush();
    expect(values).toEqual([1, 2]);

    // Completion holds the latest value.
    stream.end();
    await tick();
    flush();
    expect(values).toEqual([1, 2]);
  });

  it("reads NotReady until the first yield, settled between yields", async () => {
    const gate = deferred();
    const stream = controlledIterable<string>();
    let memo!: () => string;
    createRoot(() => {
      memo = createMemo(() => gate.promise.then(() => stream.iterable) as unknown as string);
      createRenderEffect(
        () => memo(),
        () => {}
      );
    });
    flush();
    expect(() => memo()).toThrow(NotReadyError);

    gate.resolve();
    await tick();
    flush();
    // Resolved to the stream, but no first yield: the read is still not ready
    // — the stream, not the iterable object, is the value.
    expect(() => memo()).toThrow(NotReadyError);

    stream.yield("a");
    await tick();
    flush();
    expect(memo()).toBe("a");
    expect(isPending(memo)).toBe(false);

    // Between yields: settled on the latest value.
    stream.yield("b");
    await tick();
    flush();
    expect(memo()).toBe("b");
    expect(isPending(memo)).toBe(false);
  });

  it("closes the inner iterator on dispose", async () => {
    const gate = deferred();
    const stream = controlledIterable<number>();
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const memo = createMemo(() => gate.promise.then(() => stream.iterable) as unknown as number);
      createRenderEffect(
        () => memo(),
        () => {}
      );
    });
    flush();
    gate.resolve();
    await tick();
    stream.yield(1);
    await tick();
    flush();
    expect(stream.returnCalls).toBe(0);

    dispose();
    flush();
    expect(stream.returnCalls).toBe(1);
  });

  it("closes the superseded iterator and ignores its late yields on recompute", async () => {
    const gateA = deferred();
    const streamA = controlledIterable<string>();
    const streamB = controlledIterable<string>();
    const [source, setSource] = createSignal(0);
    const values: string[] = [];
    createRoot(() => {
      const memo = createMemo(
        () =>
          (source() === 0
            ? gateA.promise.then(() => streamA.iterable)
            : Promise.resolve(streamB.iterable)) as unknown as string
      );
      createEffect(memo, v => void values.push(v as string));
    });
    flush();
    gateA.resolve();
    await tick();
    streamA.yield("a1");
    await tick();
    flush();
    expect(values).toEqual(["a1"]);

    // New flight supersedes: old iterator must close, its yields must not land.
    setSource(1);
    flush();
    expect(streamA.returnCalls).toBe(1);
    streamA.yield("a2-stale");
    await tick();
    flush();
    expect(values).toEqual(["a1"]);

    streamB.yield("b1");
    await tick();
    flush();
    expect(values).toEqual(["a1", "b1"]);
  });

  it("does not start a pump when the promise resolves to an iterable after disposal", async () => {
    const gate = deferred();
    const stream = controlledIterable<number>();
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const memo = createMemo(() => gate.promise.then(() => stream.iterable) as unknown as number);
      createRenderEffect(
        () => memo(),
        () => {}
      );
    });
    flush();
    dispose();
    flush();

    gate.resolve();
    await tick();
    stream.yield(1);
    await tick();
    flush();
    // Nothing consumed it: a disposed node's disposal list already ran, so a
    // pump could never be closed — it must never start.
    expect(stream.returnCalls).toBe(0);
  });

  it("settles undefined when the promise resolves to an empty stream", async () => {
    const gate = deferred();
    const stream = controlledIterable<number>();
    let memo!: () => number | undefined;
    createRoot(() => {
      memo = createMemo(
        () => gate.promise.then(() => stream.iterable) as unknown as number | undefined
      );
      createRenderEffect(
        () => memo(),
        () => {}
      );
    });
    flush();
    gate.resolve();
    await tick();
    stream.end();
    await tick();
    flush();
    expect(isPending(memo)).toBe(false);
    expect(memo()).toBe(undefined);
  });

  it("surfaces a stream error through the memo", async () => {
    const gate = deferred();
    let memo!: () => number;
    const failing: AsyncIterable<number> = {
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.reject(new Error("stream boom"))
      })
    };
    createRoot(() => {
      memo = createMemo(() => gate.promise.then(() => failing) as unknown as number);
      createEffect(
        () => memo(),
        () => {},
        { error: () => {} }
      );
    });
    flush();
    gate.resolve();
    await tick();
    flush();
    expect(() => memo()).toThrow("stream boom");
  });

  it("flattens for the setter path (projection-style) too", async () => {
    // handleAsync with a setter is exercised via createMemo here; the store
    // projection path shares the same code. This guards the shared behavior.
    const gate = deferred();
    const stream = controlledIterable<{ n: number }>();
    const seen: number[] = [];
    createRoot(() => {
      const memo = createMemo(
        () => gate.promise.then(() => stream.iterable) as unknown as { n: number }
      );
      createEffect(memo, v => void seen.push((v as { n: number }).n));
    });
    flush();
    gate.resolve();
    await tick();
    stream.yield({ n: 1 });
    await tick();
    flush();
    stream.yield({ n: 2 });
    await tick();
    flush();
    expect(seen).toEqual([1, 2]);
  });
});

describe("promise-of-AsyncIterable flattening (live posture: sync thenable)", () => {
  it("a sync-resolved thenable holding a sync-yielding iterable serves the read synchronously", () => {
    const iterable: AsyncIterable<number> = {
      [Symbol.asyncIterator]: () => {
        let sent = false;
        return {
          next: () =>
            (sent
              ? new Promise<IteratorResult<number>>(() => {})
              : ((sent = true), syncThenable({ done: false as const, value: 7 }))) as Promise<
              IteratorResult<number>
            >
        };
      }
    };
    createRoot(() => {
      const memo = createMemo(() => syncThenable(iterable) as unknown as number);
      const values: number[] = [];
      createRenderEffect(
        () => memo(),
        v => void values.push(v)
      );
      flush();
      expect(values).toEqual([7]);
    });
  });

  it("a sync-resolved thenable holding a pending iterable reads NotReady, then lands", async () => {
    const stream = controlledIterable<number>();
    let memo!: () => number;
    createRoot(() => {
      memo = createMemo(() => syncThenable(stream.iterable) as unknown as number);
      createRenderEffect(
        () => memo(),
        () => {}
      );
    });
    flush();
    expect(() => memo()).toThrow(NotReadyError);

    stream.yield(42);
    await tick();
    flush();
    expect(memo()).toBe(42);
    expect(isPending(memo)).toBe(false);
  });
});
