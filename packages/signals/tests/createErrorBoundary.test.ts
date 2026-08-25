import {
  action,
  clearSnapshots,
  createEffect,
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  getOwner,
  isPending,
  markSnapshotScope,
  resetErrorHalt,
  setSnapshotCapture,
  untrack
} from "../src/index.js";

it("should let errors bubble up when not handled", () => {
  const error = new Error();
  let caught: any;
  try {
    createRoot(() => {
      createRenderEffect(
        () => {
          throw error;
        },
        () => {}
      );
    });
    flush();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeDefined();
  expect(caught.cause ?? caught).toBe(error);
  resetErrorHalt();
});

it("should handle error", () => {
  const error = new Error();

  const b = createRoot(() =>
    createErrorBoundary(
      () => {
        throw error;
      },
      () => "errored"
    )
  );

  expect(b()).toBe("errored");
});

it("should forward error to another handler", () => {
  const error = new Error();

  const b = createRoot(() =>
    createErrorBoundary(
      () => {
        const inner = createErrorBoundary(
          () => {
            throw error;
          },
          e => {
            expect(e()).toBe(error);
            throw e();
          }
        );
        createRenderEffect(inner, () => {});
      },
      () => "errored"
    )
  );

  expect(b()).toBe("errored");
});

it("should not duplicate error handler", () => {
  const error = new Error(),
    handler = vi.fn((_: unknown) => "errored");

  let [$x, setX] = createSignal(0),
    shouldThrow = false;

  createRoot(() => {
    const b = createErrorBoundary(
      () => {
        $x();
        if (shouldThrow) throw error;
      },
      err => handler(err())
    );
    createRenderEffect(b, () => {});
  });

  setX(1);
  flush();

  shouldThrow = true;
  setX(2);
  flush();
  expect(handler).toHaveBeenCalledTimes(1);
});

it("should not trigger wrong handler", () => {
  const error = new Error(),
    rootHandler = vi.fn((_: unknown) => "errored"),
    handler = vi.fn((_: unknown) => "errored");

  let [$x, setX] = createSignal(0),
    shouldThrow = false;

  createRoot(() => {
    const b = createErrorBoundary(
      () => {
        createRenderEffect(
          () => {
            $x();
            if (shouldThrow) throw error;
          },
          () => {}
        );

        const b2 = createErrorBoundary(
          () => {
            // no-op
          },
          err => handler(err())
        );
        createRenderEffect(b2, () => {});
      },
      err => rootHandler(err())
    );
    createRenderEffect(b, () => {});
  });

  expect(rootHandler).toHaveBeenCalledTimes(0);
  shouldThrow = true;
  setX(1);
  flush();

  expect(rootHandler).toHaveBeenCalledTimes(1);
  expect(handler).not.toHaveBeenCalledWith(error);
});

it("should throw error if there are no handlers left", () => {
  const error = new Error(),
    handler = vi.fn(e => {
      throw e();
    });

  createRoot(() => {
    let caught: any;
    try {
      createErrorBoundary(() => {
        createErrorBoundary(() => {
          throw error;
        }, handler)();
      }, handler)();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught.cause ?? caught).toBe(error);
  });

  expect(handler).toHaveBeenCalledTimes(2);
  resetErrorHalt();
});

it("should handle errors when the effect is on the outside", async () => {
  const error = new Error(),
    rootHandler = vi.fn();

  const [$x, setX] = createSignal(0);

  createRoot(() => {
    const b = createErrorBoundary(
      () => {
        if ($x()) throw error;
        createErrorBoundary(
          () => {
            throw error;
          },
          e => {
            expect(e()).toBe(error);
          }
        );
      },
      err => rootHandler(err())
    );
    createRenderEffect(
      () => b(),
      () => {}
    );
  });
  expect(rootHandler).toHaveBeenCalledTimes(0);
  setX(1);
  flush();
  expect(rootHandler).toHaveBeenCalledWith(error);
  expect(rootHandler).toHaveBeenCalledTimes(1);
});

it("should handle errors when the effect is on the outside and memo in the middle", async () => {
  const error = new Error(),
    rootHandler = vi.fn((_: unknown) => "errored");

  createRoot(() => {
    const b = createErrorBoundary(
      () =>
        createMemo(() => {
          throw error;
        }),
      err => rootHandler(err())
    );
    createRenderEffect(b, () => {});
  });
  expect(rootHandler).toHaveBeenCalledTimes(1);
});

it("should hold error boundary during transition when signal change clears error", async () => {
  const error = new Error("test error");
  const [$shouldError, setShouldError] = createSignal(true);
  let result: any;

  createRoot(() => {
    const b = createErrorBoundary(
      () => {
        if ($shouldError()) throw error;
        return "content";
      },
      () => "error"
    );
    createRenderEffect(
      () => (result = b()),
      () => {}
    );
  });

  flush();
  expect(result).toBe("error");

  // Start a transition that clears the error
  const myAction = action(function* () {
    setShouldError(false);
    yield Promise.resolve();
  });

  myAction();
  flush();
  // Transition in progress - boundary should still show error (held)
  expect(result).toBe("error");

  await Promise.resolve();
  // Transition complete - boundary should now show content
  expect(result).toBe("content");
});

it("should hold error boundary during transition when reset is called", async () => {
  const error = new Error("test error");
  let shouldError = true;
  let result: any;
  let resetFn!: () => void;

  createRoot(() => {
    const b = createErrorBoundary(
      () => {
        if (shouldError) throw error;
        return "content";
      },
      (err, reset) => {
        resetFn = reset;
        return "error";
      }
    );
    createRenderEffect(
      () => (result = b()),
      () => {}
    );
  });

  flush();
  expect(result).toBe("error");
  expect(resetFn).toBeDefined();

  // Start a transition that resets the error boundary
  const myAction = action(function* () {
    shouldError = false;
    resetFn();
    yield Promise.resolve();
  });

  myAction();
  flush();
  // Transition in progress - boundary should still show error (held)
  expect(result).toBe("error");

  await Promise.resolve();
  // Transition complete - boundary should now show content
  expect(result).toBe("content");
});

it("should catch errors thrown in render effect callbacks (back half)", () => {
  const error = new Error("effect callback error");
  const handler = vi.fn();

  createRoot(() => {
    const b = createErrorBoundary(
      () => {
        createRenderEffect(
          () => "value",
          () => {
            throw error;
          }
        );
        return "content";
      },
      err => {
        handler(err());
        return "errored";
      }
    );
    createRenderEffect(b, () => {});
  });

  flush();
  expect(handler).toHaveBeenCalledTimes(1);
  expect(handler).toHaveBeenCalledWith(error);
});

it("should catch errors thrown in user effect callbacks (back half)", () => {
  const error = new Error("user effect callback error");
  const handler = vi.fn();
  let result: any;

  createRoot(() => {
    const b = createErrorBoundary(
      () => {
        createEffect(
          () => "value",
          () => {
            throw error;
          }
        );
        return "content";
      },
      err => {
        handler(err());
        return "errored";
      }
    );
    createRenderEffect(
      () => (result = b()),
      () => {}
    );
  });

  flush();
  expect(handler).toHaveBeenCalledTimes(1);
  expect(handler).toHaveBeenCalledWith(error);
  expect(result).toBe("errored");
});

it("should catch errors thrown in effect cleanup functions (#2813)", () => {
  const [n, setN] = createSignal(0);
  const handler = vi.fn();
  let result: any;

  createRoot(() => {
    const b = createErrorBoundary(
      () => {
        createEffect(n, v => {
          return () => {
            if (v === 0) throw new Error("cleanup boom");
          };
        });
        return "content";
      },
      err => {
        handler(err());
        return "errored";
      }
    );
    createRenderEffect(
      () => (result = b()),
      () => {}
    );
  });
  flush();

  setN(1);
  flush();
  expect(handler).toHaveBeenCalledTimes(1);
  expect(String(handler.mock.calls[0][0])).toContain("cleanup boom");
  expect(result).toBe("errored");
});

it("should catch errors thrown in user effect callbacks with error handler (back half)", () => {
  const error = new Error("user effect bundle error");
  const handler = vi.fn();
  const errorHandler = vi.fn();
  let result: any;

  createRoot(() => {
    const b = createErrorBoundary(
      () => {
        createEffect(() => "value", {
          effect: () => {
            throw error;
          },
          error: errorHandler
        });
        return "content";
      },
      err => {
        handler(err());
        return "errored";
      }
    );
    createRenderEffect(
      () => (result = b()),
      () => {}
    );
  });

  flush();
  expect(handler).toHaveBeenCalledTimes(1);
  expect(handler).toHaveBeenCalledWith(error);
  expect(result).toBe("errored");
});

it("should recover from effect callback error after reset", () => {
  const error = new Error("effect callback error");
  let shouldThrow = true;
  let result: any;
  let resetFn!: () => void;

  createRoot(() => {
    const b = createErrorBoundary(
      () => {
        createRenderEffect(
          () => "value",
          () => {
            if (shouldThrow) throw error;
          }
        );
        return "content";
      },
      (err, reset) => {
        resetFn = reset;
        return "errored";
      }
    );
    createRenderEffect(
      () => (result = b()),
      () => {}
    );
  });

  flush();
  expect(result).toBe("errored");
  expect(resetFn).toBeDefined();

  shouldThrow = false;
  resetFn();
  flush();
  expect(result).toBe("content");
});

it("should throw effect callback errors when no boundary exists", () => {
  const error = new Error("uncaught effect error");

  expect(() => {
    createRoot(() => {
      createRenderEffect(
        () => "value",
        () => {
          throw error;
        }
      );
    });
    flush();
  }).toThrowError(error);
  resetErrorHalt();
});

it("should recover when async memo errors then dependency changes and boundary resets", async () => {
  const [$id, setId] = createSignal("bad");
  let result: any;
  let resetFn!: () => void;

  createRoot(() => {
    const data = createMemo(async () => {
      const id = $id();
      await Promise.resolve();
      if (id !== "1") throw new Error(`Item ${id} not found`);
      return { title: "Test Item" };
    });

    const boundary = createErrorBoundary(
      () =>
        createLoadingBoundary(
          () => data().title,
          () => "loading"
        )(),
      (err, reset) => {
        resetFn = reset;
        return "error: " + (err() as Error).message;
      }
    );

    createRenderEffect(
      () => (result = boundary()),
      () => {}
    );
  });

  flush();
  await Promise.resolve();
  await Promise.resolve();
  flush();
  expect(result).toBe("error: Item bad not found");

  setId("1");
  resetFn();
  flush();

  await Promise.resolve();
  await Promise.resolve();
  flush();
  expect(result).toBe("Test Item");
});

it("should recover when sync memo errors then dependency changes and boundary resets", () => {
  const [$id, setId] = createSignal("bad");
  let result: any;
  let resetFn!: () => void;

  createRoot(() => {
    const data = createMemo(() => {
      const id = $id();
      if (id !== "1") throw new Error(`Item ${id} not found`);
      return "ok";
    });

    const boundary = createErrorBoundary(
      () => data(),
      (err, reset) => {
        resetFn = reset;
        return "error";
      }
    );

    createRenderEffect(
      () => (result = boundary()),
      () => {}
    );
  });

  flush();
  expect(result).toBe("error");

  setId("1");
  resetFn();
  flush();
  expect(result).toBe("ok");
});

it("should not infinite loop when errored async memo is heap-queued and then re-read", async () => {
  const [$id, setId] = createSignal("bad");
  let result: any;
  let resetFn!: () => void;

  createRoot(() => {
    const data = createMemo(async () => {
      const id = $id();
      await Promise.resolve();
      if (id !== "1") throw new Error("not found");
      return "resolved";
    });

    const boundary = createErrorBoundary(
      () =>
        createLoadingBoundary(
          () => data(),
          () => "loading"
        )(),
      (err, reset) => {
        resetFn = reset;
        return "error";
      }
    );

    createRenderEffect(
      () => (result = boundary()),
      () => {}
    );
  });

  flush();
  await Promise.resolve();
  await Promise.resolve();
  flush();
  expect(result).toBe("error");

  // Signal change queues the memo in the dirty heap, then reset triggers re-read.
  // Before the fix, this caused an infinite loop in runHeap because the memo's
  // IN_HEAP flag was cleared by updateIfNecessary but the node was still in the
  // physical heap, and recompute(el, true) skipped deleteFromHeap.
  setId("1");
  resetFn();
  flush();

  await Promise.resolve();
  await Promise.resolve();
  flush();
  expect(result).toBe("resolved");
});

/**
 * #2790: `isPending(data)` inside a `<Show>`-shaped condition in an `<Errored>`
 * fallback, where the async `data` fails again after `reset()`.
 *
 * The fix has three layered, orthogonal parts:
 *
 *   1. Async propagation: the link an `isPending` read creates is tagged as a
 *      pending-observer; on a STATUS_ERROR notification `notifyStatus` re-runs the
 *      reader (so `isPending` re-evaluates to not-pending) instead of forwarding
 *      the error, which would otherwise escape the fallback (a boundary cannot
 *      catch an error from its own fallback) as an unhandled rejection. The
 *      end-to-end rejection assertion lives in the matching solid-web test.
 *
 *   2. `isPending` probe observation: `read`'s errored-retry is gated behind
 *      `!pendingCheckActive`. The real #2790 read is owned/tracked, so this is the
 *      load-bearing gate there — a pending-check observes the errored status
 *      (throws the stored error, which `isPending` swallows -> `false`) and never
 *      re-fetches. Handling this in `isPending`'s catch instead does NOT work: the
 *      re-fetch happens during the read, before the catch runs, so the source is
 *      already pending again and `isPending` would return `true`.
 *
 *   3. Owned-scope retry policy: `read`'s errored-retry is additionally gated
 *      behind `tracking`. An errored async source only retries when re-read from
 *      an owned/tracked scope (a reactive recomputation) in a later cycle. A
 *      naked/ownerless read — events, `untrack`, an effect's side-effect phase —
 *      surfaces the stored error without re-fetching.
 *
 * Combined retry condition in `read`: `tracking && !pendingCheckActive && el._time < clock`.
 */
it("isPending inside Loading > Errored fallback does not loop when the source re-errors after reset (#2790)", async () => {
  function deferred<T = void>() {
    let resolve!: (value: T) => void;
    let reject!: (error?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  // Mirror solid-js `<Show when={isPending(data)}>` exactly: a `condition value`
  // memo running the `when` expression, a `sync: true` `condition` memo, then the
  // value memo that consumes `condition()`. The intermediate links are normal
  // (untagged); only `data -> condition value` is the pending-observer link.
  function showShaped(when: () => unknown, children: () => unknown) {
    const conditionValue = createMemo(when);
    const condition = createMemo(conditionValue, {
      equals: (a, b) => !a === !b,
      sync: true
    });
    return createMemo(() => (condition() ? untrack(children) : undefined), { sync: true });
  }

  let result: any;
  let resetFn: (() => void) | undefined;
  const [$count, setCount] = createSignal(0);
  let current = deferred<number>();
  let data!: () => number;

  // guard: a runaway re-render of the fallback throws instead of hanging
  let fallbackRuns = 0;

  createRoot(() => {
    data = createMemo(async () => {
      $count();
      await current.promise;
      return 10;
    });

    const boundary = createLoadingBoundary(
      () =>
        createErrorBoundary(
          () => ["data: ", data()],
          (err, reset) => {
            resetFn = reset;
            if (++fallbackRuns > 50) throw new Error("INFINITE_LOOP: fallback ran " + fallbackRuns);
            return [
              "error",
              showShaped(
                () => isPending(data),
                () => " (resetting)"
              )
            ];
          }
        )(),
      () => "loading"
    );

    createRenderEffect(
      () => (result = boundary()),
      () => {}
    );
  });

  flush();
  expect(result).toBe("loading");

  // first failure -> Errored fallback
  current.reject(new Error("boom 1"));
  await Promise.resolve();
  await Promise.resolve();
  flush();
  expect(Array.isArray(result) ? result[0] : result).toBe("error");

  // reset; the refetch fails again
  current = deferred<number>();
  setCount(1);
  resetFn!();
  flush();

  current.reject(new Error("boom 2"));
  await Promise.resolve();
  await Promise.resolve();
  flush();

  expect(fallbackRuns).toBeLessThan(50);
  expect(Array.isArray(result) ? result[0] : result).toBe("error");

  // ASYNC semantic: the `isPending(data)` standing observer in the fallback
  // settled to not-pending (the `showShaped` `when` resolved false), so the
  // "(resetting)" branch is absent — the errored source was swallowed, not
  // forwarded as an error.
  expect(JSON.stringify(result)).not.toContain("resetting");

  // Concern 3 negative path: a naked/untracked `isPending` read of an errored
  // source returns false and does not re-fetch. `setCount(2)` is a genuine
  // dependency change, so it *does* refetch (the source goes pending, then
  // settles back to the same error since `current` is still rejected) and also
  // advances the clock — leaving the source errored and stale (el._time < clock),
  // the case the read-time retry would otherwise fire on. Because the read is
  // untracked (`tracking === false`) and a pending-check, the retry is suppressed:
  // the read surfaces the stored error, which `isPending` swallows -> false.
  setCount(2);
  flush();
  await Promise.resolve();
  await Promise.resolve();
  flush();
  let syncThrew = false;
  let syncVal: boolean | undefined;
  try {
    syncVal = untrack(() => isPending(() => data()));
  } catch {
    syncThrew = true;
  }
  expect(syncThrew).toBe(false);
  expect(syncVal).toBe(false);

  // Concern 3 positive path: the `tracking` gate must not break legitimate
  // recovery. A dependency change + reset, with the refetch now succeeding,
  // recovers through the boundary's tracked read.
  current = deferred<number>();
  setCount(3);
  resetFn!();
  flush();
  current.resolve(10);
  await Promise.resolve();
  await Promise.resolve();
  flush();
  expect(result).toEqual(["data: ", 10]);
});

/**
 * #2809: `Loading > Errored > <async memo read>` infinite-looped. The boundary
 * tree used to keep the foreign PENDING status reader-visible; reading it across
 * the `Errored` re-threw NotReady into the outer `Loading`'s ambient context and
 * linked unrelated computeds, looping on every settle. A boundary now handles its
 * own status type and notifies the rest through its queue chain — it never
 * re-throws a foreign status to reactive readers.
 */
it("does not loop when an async memo is read inside Loading > Errored (#2809)", async () => {
  const resolved = Promise.resolve({ id: 1 });
  const rejected = Promise.reject(new Error("posts failed"));
  rejected.catch(() => {});

  let ok: any;
  let bad: any;
  createRoot(() => {
    function App(source: Promise<{ id: number }>) {
      const posts = createMemo(() => source);
      return createLoadingBoundary(
        () =>
          createErrorBoundary(
            () => posts().id,
            err => "caught: " + (err() as Error).message
          ),
        () => "loading"
      );
    }
    ok = App(resolved);
    bad = App(rejected);
  });

  const unwrap = (v: any) => {
    while (typeof v === "function") v = v();
    return v;
  };

  flush();
  expect(unwrap(ok)).toBe("loading");
  expect(unwrap(bad)).toBe("loading");

  await Promise.resolve();
  await Promise.resolve();
  flush();

  expect(unwrap(ok)).toBe(1);
  expect(unwrap(bad)).toBe("caught: posts failed");
});

/**
 * #2809 fallout — the `Errored > Loading > Errored > content` composition
 * escape: a sync error from the content must be caught by the INNER `Errored`,
 * the boundary between the `Loading` and the throwing content. When the inner
 * boundary catches, it consumes the ERROR dimension from the notification mask
 * and forwards only the PENDING remainder up the queue chain — but the
 * `Loading` queue's notify-through remap keyed off the node's raw status flags
 * instead of the mask, resurrecting the already-caught error and routing it to
 * the OUTER boundary, whose fallback then replaced the whole subtree (and with
 * no outer boundary, reactivity halted). This broke the React-style
 * `Suspense > ErrorBoundary > content` nesting that TanStack Router mirrors.
 * The remap now fires only while the ERROR dimension is still live in the mask.
 */
function mountNestedComposition(content: () => string) {
  let rendered: unknown;
  const dispose = createRoot(dispose => {
    const outer = createErrorBoundary(
      () =>
        createLoadingBoundary(
          () => createErrorBoundary(content, () => "inner caught")(),
          () => "loading"
        )(),
      () => "outer caught"
    );
    createRenderEffect(
      () => (rendered = outer()),
      () => {}
    );
    return dispose;
  });
  return { rendered: () => rendered, dispose };
}

it("catches at the inner Errored when content throws in the mounting flush (Errored > Loading > Errored)", () => {
  const { rendered, dispose } = mountNestedComposition(() => {
    throw new Error("boom on mount");
  });
  flush();
  expect(rendered()).toBe("inner caught");
  dispose();
});

it("catches at the inner Errored when content throws reactively after a healthy commit (Errored > Loading > Errored)", () => {
  const [$boom, setBoom] = createSignal(false);
  const { rendered, dispose } = mountNestedComposition(() => {
    if ($boom()) throw new Error("boom");
    return "ok";
  });
  flush();
  expect(rendered()).toBe("ok");

  setBoom(true);
  flush();
  expect(rendered()).toBe("inner caught");
  dispose();
});

it("catches an async rejection at the inner Errored (Errored > Loading > Errored)", async () => {
  const rejected = Promise.reject(new Error("boom async"));
  rejected.catch(() => {});

  let rendered: unknown;
  const dispose = createRoot(dispose => {
    // The memo lives outside the boundary computes (component-body shape); a
    // memo created inside the inner boundary's fn would be recreated on every
    // re-run and refetch forever.
    const data = createMemo(() => rejected);
    const outer = createErrorBoundary(
      () =>
        createLoadingBoundary(
          () =>
            createErrorBoundary(
              () => `value: ${data()}`,
              () => "inner caught"
            )(),
          () => "loading"
        )(),
      () => "outer caught"
    );
    createRenderEffect(
      () => (rendered = outer()),
      () => {}
    );
    return dispose;
  });
  flush();
  expect(rendered).toBe("loading");

  await Promise.resolve();
  await Promise.resolve();
  flush();
  expect(rendered).toBe("inner caught");
  dispose();
});

/**
 * Dimension-independent routing pins (remap removal follow-up to #2856): a sync
 * error inside a `Loading` with NO inner `Errored` must forward on the ERROR
 * dimension past the `Loading` to the outer `Errored` natively — the queue
 * chain consumes only each boundary's own dimension, so no explicit
 * notify-through rule is needed. Pinned for both the uninitialized boundary
 * (throw in the mounting flush) and the committed one (reactive throw), the two
 * paths the old remap intercepted.
 */
it("routes a sync mount error past a Loading to the outer Errored (Errored > Loading > content)", () => {
  let rendered: unknown;
  const dispose = createRoot(dispose => {
    const outer = createErrorBoundary(
      () =>
        createLoadingBoundary(
          () => {
            throw new Error("boom on mount");
          },
          () => "loading"
        )(),
      () => "outer caught"
    );
    createRenderEffect(
      () => (rendered = outer()),
      () => {}
    );
    return dispose;
  });
  flush();
  expect(rendered).toBe("outer caught");
  dispose();
});

it("routes a reactive sync error past a committed Loading to the outer Errored (Errored > Loading > content)", () => {
  const [$boom, setBoom] = createSignal(false);
  let rendered: unknown;
  const dispose = createRoot(dispose => {
    const outer = createErrorBoundary(
      () =>
        createLoadingBoundary(
          () => {
            if ($boom()) throw new Error("boom");
            return "ok";
          },
          () => "loading"
        )(),
      () => "outer caught"
    );
    createRenderEffect(
      () => (rendered = outer()),
      () => {}
    );
    return dispose;
  });
  flush();
  expect(rendered).toBe("ok");

  setBoom(true);
  flush();
  expect(rendered).toBe("outer caught");
  dispose();
});

/**
 * #2809 hydration interaction: with snapshot capture active (as during
 * `hydrate()`), boundary computeds must not become snapshot sources. The tree no
 * longer carries the foreign PENDING flag (see above), so capture can't rely on
 * it to skip mid-async boundary nodes — they are excluded explicitly via
 * `_noSnapshot`. Regression shape: the resolved value stayed frozen at the
 * captured `undefined` after settling.
 */
it("reveals resolved content under snapshot capture (Loading > Errored > async)", async () => {
  const resolved = Promise.resolve({ title: "Test Item" });

  setSnapshotCapture(true);
  try {
    let result: any;
    createRoot(() => {
      markSnapshotScope(getOwner()!);
      const item = createMemo(() => resolved);
      // Boundary wrapped in a memo with children built in the boundary body —
      // the shape hydration's Loading wrapper produces.
      const props = {
        get children() {
          return createErrorBoundary(
            () => item().title,
            err => "caught: " + String(err())
          );
        }
      };
      result = createMemo(() =>
        createLoadingBoundary(
          () => props.children,
          () => "loading"
        )
      );
    });

    const unwrap = (v: any) => {
      while (typeof v === "function") v = v();
      return v;
    };

    flush();
    expect(unwrap(result)).toBe("loading");

    await Promise.resolve();
    await Promise.resolve();
    flush();

    expect(unwrap(result)).toBe("Test Item");
  } finally {
    clearSnapshots();
  }
});
