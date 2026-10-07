import { describe, expect, it, vi } from "vitest";
import { attribution } from "../src/attribution.js";
import {
  createEffect,
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest,
  OBSERVE
} from "../src/index.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  flush();
}

describe("effect outcomes held by a rendered async sibling", () => {
  const cases = ["source", "memo", "async memo", "compute", "async compute", "equals"].flatMap(
    kind => ["value", "error"].map(outcome => ({ kind, outcome }))
  );
  it.each(cases)("reveals $kind's $outcome arm with the input frame", async ({ kind, outcome }) => {
    let request = deferred<number>();
    let siblingRequest = deferred<number>();
    const failure = new Error("failed for input 2");
    const shown: { input?: number; source?: unknown; sibling?: number } = {};
    const [count, setCount] = createSignal(1);
    const dispose = createRoot(dispose => {
      const source = createMemo(
        () => {
          count();
          return request.promise;
        },
        {
          equals: (prev, next) => {
            if (kind === "equals" && outcome === "error" && next === 2) throw failure;
            return prev === next;
          }
        }
      );
      const observed =
        kind === "source" || kind === "equals"
          ? source
          : createMemo(() => {
              const value = source();
              if (kind === "compute" && outcome === "error" && value === 2) throw failure;
              if (kind === "async compute" && outcome === "error" && value === 2)
                return Promise.reject(failure);
              return kind.startsWith("async") ? Promise.resolve(value) : value;
            });
      const sibling = createMemo(() => {
        count();
        return siblingRequest.promise;
      });
      createRenderEffect(
        count,
        value => {
          shown.input = value;
        },
        { schedule: true }
      );
      createRenderEffect(
        sibling,
        value => {
          shown.sibling = value;
        },
        { schedule: true }
      );
      createEffect(observed, {
        effect: value => {
          shown.source = value;
        },
        error: error => {
          shown.source = error;
        }
      });
      return dispose;
    });
    try {
      flush();
      request.resolve(1);
      siblingRequest.resolve(1);
      await settle();
      expect(shown).toEqual({ input: 1, source: 1, sibling: 1 });

      request = deferred<number>();
      siblingRequest = deferred<number>();
      setCount(2);
      flush();
      if (outcome === "error" && ["source", "memo", "async memo"].includes(kind))
        request.reject(failure);
      else request.resolve(2);
      await settle();
      expect(shown).toEqual({ input: 1, source: 1, sibling: 1 });

      siblingRequest.resolve(2);
      await settle();
      expect(shown).toEqual({ input: 2, source: outcome === "error" ? failure : 2, sibling: 2 });

      request = deferred<number>();
      siblingRequest = deferred<number>();
      setCount(3);
      flush();
      // Recover to the last good value as well as recovering status. An
      // equality-suppressed value notification must not leave an old error.
      request.resolve(1);
      await settle();
      expect(shown.input).toBe(2);
      expect(shown.source).toBe(outcome === "error" ? failure : 2);
      siblingRequest.resolve(3);
      await settle();
      expect(shown).toEqual({ input: 3, source: 1, sibling: 3 });
    } finally {
      dispose();
      flush();
    }
  });
});

it.each(["value", "error"])(
  "ignores a superseded flight's %s before the replacement flush",
  async outcome => {
    let request = deferred<number>();
    const [count, setCount] = createSignal(1);
    const shown: unknown[] = [];
    const dispose = createRoot(dispose => {
      const source = createMemo(() => {
        count();
        return request.promise;
      });
      const boundary = createErrorBoundary(source, error => error());
      createRenderEffect(
        boundary,
        value => {
          shown.push(value);
        },
        { schedule: true }
      );
      return dispose;
    });
    try {
      flush();
      request.resolve(1);
      await settle();
      request = deferred<number>();
      setCount(2);
      flush();
      const superseded = request;
      request = deferred<number>();
      // Queue the old answer first, then dirty its inputs. The old flight
      // callback runs before the scheduled flush replaces its identity.
      if (outcome === "error") superseded.reject(new Error("superseded"));
      else superseded.resolve(2);
      setCount(3);
      await settle();
      expect(shown).toEqual([1]);
      request.resolve(3);
      await settle();
      expect(shown).toEqual([1, 3]);
    } finally {
      dispose();
      flush();
    }
  }
);

it("reveals an error without waiting for a disjoint pending frame", async () => {
  const requests = [deferred<number>(), deferred<number>()];
  const setters: Array<(value: number) => void> = [];
  const shown: Array<{ input?: number; outcome?: unknown }> = [{}, {}];
  const failure = new Error("first frame failed");
  const dispose = createRoot(dispose => {
    for (let i = 0; i < 2; i++) {
      const [count, setCount] = createSignal(1);
      setters.push(setCount);
      const source = createMemo(() => {
        count();
        return requests[i].promise;
      });
      const boundary = createErrorBoundary(source, error => error());
      createRenderEffect(
        count,
        value => {
          shown[i].input = value;
        },
        { schedule: true }
      );
      createRenderEffect(
        boundary,
        value => {
          shown[i].outcome = value;
        },
        { schedule: true }
      );
    }
    return dispose;
  });
  try {
    flush();
    requests.forEach(request => request.resolve(1));
    await settle();
    expect(shown).toEqual([
      { input: 1, outcome: 1 },
      { input: 1, outcome: 1 }
    ]);
    requests[0] = deferred<number>();
    setters[0](2);
    flush();
    requests[1] = deferred<number>();
    setters[1](2);
    flush();
    requests[0].reject(failure);
    await settle();
    expect(shown).toEqual([
      { input: 2, outcome: failure },
      { input: 1, outcome: 1 }
    ]);
    requests[1].resolve(2);
    await settle();
    expect(shown).toEqual([
      { input: 2, outcome: failure },
      { input: 2, outcome: 2 }
    ]);
  } finally {
    dispose();
    flush();
  }
});

it("drops an error that recovers before the held frame reveals", async () => {
  let request = deferred<number>();
  let siblingRequest = deferred<number>();
  const [count, setCount] = createSignal(1);
  const outcomes: unknown[] = [];
  const dispose = createRoot(dispose => {
    const source = createMemo(() => {
      count();
      return request.promise;
    });
    const sibling = createMemo(() => {
      count();
      return siblingRequest.promise;
    });
    createRenderEffect(sibling, () => {}, { schedule: true });
    createEffect(source, {
      effect: value => {
        outcomes.push(value);
      },
      error: error => {
        outcomes.push(error);
      }
    });
    return dispose;
  });
  try {
    flush();
    request.resolve(1);
    siblingRequest.resolve(1);
    await settle();
    const oldSibling = siblingRequest;
    request = deferred<number>();
    siblingRequest = deferred<number>();
    setCount(2);
    flush();
    request.reject(new Error("superseded"));
    await settle();
    expect(outcomes).toEqual([1]);
    const supersededSibling = siblingRequest;

    request = deferred<number>();
    siblingRequest = deferred<number>();
    setCount(3);
    flush();
    request.resolve(1);
    await settle();
    expect(outcomes).toEqual([1]);
    supersededSibling.resolve(2);
    oldSibling.resolve(1);
    await settle();
    expect(outcomes).toEqual([1]);
    siblingRequest.resolve(3);
    await settle();
    expect(outcomes).toEqual([1, 1]);
  } finally {
    dispose();
    flush();
  }
});

it("keeps latest outcomes in their reveal lane instead of holding them with ordinary effects", async () => {
  let request = deferred<number>();
  let siblingRequest = deferred<number>();
  const [count, setCount] = createSignal(1);
  const failure = new Error("failed");
  const shown: { ordinary?: unknown; latest?: unknown; sibling?: number } = {};
  const dispose = createRoot(dispose => {
    const source = createMemo(() => {
      count();
      return request.promise;
    });
    const verdict = createMemo(() => latest(source));
    const sibling = createMemo(() => {
      count();
      return siblingRequest.promise;
    });
    for (const [key, accessor] of [
      ["ordinary", source],
      ["latest", verdict]
    ] as const) {
      createEffect(accessor, {
        effect: value => {
          shown[key] = value;
        },
        error: error => {
          shown[key] = error;
        }
      });
    }
    createRenderEffect(
      sibling,
      value => {
        shown.sibling = value;
      },
      { schedule: true }
    );
    return dispose;
  });
  try {
    flush();
    request.resolve(1);
    siblingRequest.resolve(1);
    await settle();
    expect(shown).toEqual({ ordinary: 1, latest: 1, sibling: 1 });
    request = deferred<number>();
    siblingRequest = deferred<number>();
    setCount(2);
    flush();
    request.reject(failure);
    await settle();
    expect(shown).toEqual({ ordinary: 1, latest: failure, sibling: 1 });
    siblingRequest.resolve(2);
    await settle();
    expect(shown).toEqual({ ordinary: failure, latest: failure, sibling: 2 });
  } finally {
    dispose();
    flush();
  }
});

it("holds logging an unhandled compute error like an error callback", async () => {
  let request = deferred<number>();
  let siblingRequest = deferred<number>();
  const [count, setCount] = createSignal(1);
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const dispose = createRoot(dispose => {
    const source = createMemo(() => {
      count();
      return request.promise;
    });
    const sibling = createMemo(() => {
      count();
      return siblingRequest.promise;
    });
    createEffect(source, () => {});
    createRenderEffect(sibling, () => {}, { schedule: true });
    return dispose;
  });
  try {
    flush();
    request.resolve(1);
    siblingRequest.resolve(1);
    await settle();
    request = deferred<number>();
    siblingRequest = deferred<number>();
    setCount(2);
    flush();
    request.reject(undefined);
    await settle();
    expect(errorSpy).not.toHaveBeenCalled();
    siblingRequest.resolve(2);
    await settle();
    expect(errorSpy).toHaveBeenCalledExactlyOnceWith(undefined);
  } finally {
    dispose();
    flush();
    errorSpy.mockRestore();
  }
});

it.each([false, true])(
  "preserves cleanup ownership across error and recovery (manual: %s)",
  manual => {
    const [count, setCount] = createSignal(0);
    const log: string[] = [];
    const dispose = createRoot(dispose => {
      createEffect(
        () => {
          const value = count();
          if (value === 1) throw new Error("failed");
          return value;
        },
        {
          effect: value => {
            log.push(`effect ${value}`);
            return () => {
              log.push(`cleanup ${value}`);
            };
          },
          error: (_error, cleanup) => {
            log.push("error");
            if (manual) {
              cleanup();
              cleanup();
            }
          }
        }
      );
      return dispose;
    });
    try {
      flush();
      setCount(1);
      flush();
      expect(log).toEqual(manual ? ["effect 0", "error", "cleanup 0"] : ["effect 0", "error"]);
      setCount(2);
      flush();
      expect(log).toEqual(["effect 0", "error", "cleanup 0", "effect 2"]);
    } finally {
      dispose();
      flush();
    }
    expect(log).toEqual(["effect 0", "error", "cleanup 0", "effect 2", "cleanup 2"]);
  }
);

it("treats a fulfilled Error object as a value, not a rejection", async () => {
  const request = deferred<Error>();
  const value = new Error("ordinary data");
  const successes: unknown[] = [];
  const errors: unknown[] = [];
  const dispose = createRoot(dispose => {
    const source = createMemo(() => request.promise);
    createEffect(source, {
      effect: value => {
        successes.push(value);
      },
      error: error => {
        errors.push(error);
      }
    });
    return dispose;
  });
  try {
    flush();
    request.resolve(value);
    await settle();
    expect(successes).toEqual([value]);
    expect(errors).toEqual([]);
  } finally {
    dispose();
    flush();
  }
});

it("records the error callback in the same effect scope as the success callback", () => {
  const records: string[] = [];
  attribution.enable({ log: false, hotTime: false });
  const off = OBSERVE!.records.subscribe("effect", event => {
    records.push(event.nodeName);
  });
  const [count, setCount] = createSignal(0);
  const [message, setMessage] = createSignal("");
  const dispose = createRoot(dispose => {
    createEffect(
      () => {
        if (count()) throw new Error("failed");
        return 0;
      },
      {
        effect: () => {},
        error: error => {
          setMessage((error as Error).message);
        }
      },
      { name: "outcome" }
    );
    return dispose;
  });
  try {
    flush();
    expect(records).toEqual(["outcome"]);
    setCount(1);
    flush();
    expect(message()).toBe("failed");
    expect(records).toEqual(["outcome", "outcome"]);
  } finally {
    dispose();
    off();
    attribution.disable();
    flush();
  }
});
