import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRevealOrder as baseCreateRevealOrder,
  createRoot,
  createSignal,
  flush,
  mapArray,
  type RevealOrder
} from "../src/index.js";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  flush();
}

function materialize(value: any): any {
  if (typeof value === "function" && value.length === 0) return materialize(value());
  if (Array.isArray(value)) return value.map(materialize);
  return value;
}

function createRevealOrder<T>(
  fn: () => T,
  options?: { order?: RevealOrder; collapsed?: boolean }
): T {
  return baseCreateRevealOrder(fn, {
    order: () => options?.order ?? "sequential",
    collapsed: () => (typeof options?.collapsed === "boolean" ? options.collapsed : true)
  });
}

describe("createRevealOrder", () => {
  it("defaults to non-collapsed sequential fallbacks", () => {
    let result: any[] = [];
    const first = deferred<number>();
    const second = deferred<number>();

    createRoot(() => {
      const a = createMemo(async () => {
        await first.promise;
        return 1;
      });
      const b = createMemo(async () => {
        await second.promise;
        return 2;
      });

      const ordered = baseCreateRevealOrder(() => [
        createLoadingBoundary(
          () => a(),
          () => "l1"
        ),
        createLoadingBoundary(
          () => b(),
          () => "l2"
        )
      ]);

      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(result).toEqual(["l1", "l2"]);
  });

  it("sequential mode collapses tail and cascades frontier", async () => {
    let result: any[] = [];
    const first = deferred<number>();
    const second = deferred<number>();
    const third = deferred<number>();

    createRoot(() => {
      const a = createMemo(async () => {
        await first.promise;
        return 1;
      });
      const b = createMemo(async () => {
        await second.promise;
        return 2;
      });
      const c = createMemo(async () => {
        await third.promise;
        return 3;
      });

      const ordered = createRevealOrder(() => [
        createLoadingBoundary(
          () => a(),
          () => "l1"
        ),
        createLoadingBoundary(
          () => b(),
          () => "l2"
        ),
        createLoadingBoundary(
          () => c(),
          () => "l3"
        )
      ]);

      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(result).toEqual(["l1", undefined, undefined]);

    second.resolve(2);
    await settle();
    expect(result).toEqual(["l1", undefined, undefined]);

    first.resolve(1);
    await settle();
    expect(result).toEqual([1, 2, "l3"]);

    third.resolve(3);
    await settle();
    expect(result).toEqual([1, 2, 3]);
  });

  it("together mode keeps all fallbacks visible until all are ready", async () => {
    let result: any[] = [];
    const first = deferred<number>();
    const second = deferred<number>();
    const third = deferred<number>();

    createRoot(() => {
      const a = createMemo(async () => {
        await first.promise;
        return 1;
      });
      const b = createMemo(async () => {
        await second.promise;
        return 2;
      });
      const c = createMemo(async () => {
        await third.promise;
        return 3;
      });

      const ordered = createRevealOrder(
        () => [
          createLoadingBoundary(
            () => a(),
            () => "l1"
          ),
          createLoadingBoundary(
            () => b(),
            () => "l2"
          ),
          createLoadingBoundary(
            () => c(),
            () => "l3"
          )
        ],
        { order: "together", collapsed: false }
      );

      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(result).toEqual(["l1", "l2", "l3"]);

    first.resolve(1);
    await settle();
    expect(result).toEqual(["l1", "l2", "l3"]);

    second.resolve(2);
    await settle();
    expect(result).toEqual(["l1", "l2", "l3"]);

    third.resolve(3);
    await settle();
    expect(result).toEqual([1, 2, 3]);
  });

  it("together ignores collapsed and keeps fallbacks visible until group is ready", async () => {
    let result: any[] = [];
    const first = deferred<number>();
    const second = deferred<number>();

    createRoot(() => {
      const a = createMemo(async () => {
        await first.promise;
        return 1;
      });
      const b = createMemo(async () => {
        await second.promise;
        return 2;
      });

      const ordered = baseCreateRevealOrder(
        () => [
          createLoadingBoundary(
            () => a(),
            () => "l1"
          ),
          createLoadingBoundary(
            () => b(),
            () => "l2"
          )
        ],
        { order: () => "together", collapsed: () => true }
      );

      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(result).toEqual(["l1", "l2"]);

    first.resolve(1);
    await settle();
    expect(result).toEqual(["l1", "l2"]);

    second.resolve(2);
    await settle();
    expect(result).toEqual([1, 2]);
  });

  it("sequential + collapsed false keeps later pending fallbacks visible", async () => {
    let result: any[] = [];
    const first = deferred<number>();
    const second = deferred<number>();
    const third = deferred<number>();

    createRoot(() => {
      const a = createMemo(async () => {
        await first.promise;
        return 1;
      });
      const b = createMemo(async () => {
        await second.promise;
        return 2;
      });
      const c = createMemo(async () => {
        await third.promise;
        return 3;
      });

      const ordered = createRevealOrder(
        () => [
          createLoadingBoundary(
            () => a(),
            () => "l1"
          ),
          createLoadingBoundary(
            () => b(),
            () => "l2"
          ),
          createLoadingBoundary(
            () => c(),
            () => "l3"
          )
        ],
        { collapsed: false }
      );

      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(result).toEqual(["l1", "l2", "l3"]);

    second.resolve(2);
    await settle();
    expect(result).toEqual(["l1", "l2", "l3"]);

    first.resolve(1);
    await settle();
    expect(result).toEqual([1, 2, "l3"]);
  });

  it("supports direct nested reveal as a composite slot", async () => {
    let outer: any[] = [];
    const aReady = deferred<number>();
    const b1Ready = deferred<number>();
    const b2Ready = deferred<number>();
    const cReady = deferred<number>();

    createRoot(() => {
      const a = createMemo(async () => {
        await aReady.promise;
        return "A";
      });
      const b1 = createMemo(async () => {
        await b1Ready.promise;
        return "B1";
      });
      const b2 = createMemo(async () => {
        await b2Ready.promise;
        return "B2";
      });
      const c = createMemo(async () => {
        await cReady.promise;
        return "C";
      });

      const ordered = createRevealOrder(() => [
        createLoadingBoundary(
          () => a(),
          () => "la"
        ),
        createRevealOrder(
          () => [
            createLoadingBoundary(
              () => b1(),
              () => "lb1"
            ),
            createLoadingBoundary(
              () => b2(),
              () => "lb2"
            )
          ],
          { order: "together", collapsed: false }
        ),
        createLoadingBoundary(
          () => c(),
          () => "lc"
        )
      ]);

      createRenderEffect(
        () => (outer = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(outer).toEqual(["la", [undefined, undefined], undefined]);

    aReady.resolve(1);
    await settle();
    expect(outer).toEqual(["A", ["lb1", "lb2"], undefined]);

    b1Ready.resolve(1);
    await settle();
    expect(outer).toEqual(["A", ["lb1", "lb2"], undefined]);

    b2Ready.resolve(1);
    await settle();
    expect(outer).toEqual(["A", ["B1", "B2"], "lc"]);

    cReady.resolve(1);
    await settle();
    expect(outer).toEqual(["A", ["B1", "B2"], "C"]);
  });

  it("together outer holds nested sequential until every direct slot is minimally ready", async () => {
    // Outer together forces its direct slots (la, nested, lc) onto their fallbacks
    // until each is minimally ready. For a nested sequential slot, "minimally ready"
    // means its first registered slot (lb1) is resolved. While the outer is holding,
    // no inner children reveal — the hold propagates through the nested Reveal.
    let result: any[] = [];
    const aReady = deferred<number>();
    const b1Ready = deferred<number>();
    const b2Ready = deferred<number>();
    const cReady = deferred<number>();

    createRoot(() => {
      const a = createMemo(async () => {
        await aReady.promise;
        return "A";
      });
      const b1 = createMemo(async () => {
        await b1Ready.promise;
        return "B1";
      });
      const b2 = createMemo(async () => {
        await b2Ready.promise;
        return "B2";
      });
      const c = createMemo(async () => {
        await cReady.promise;
        return "C";
      });

      const ordered = createRevealOrder(
        () => [
          createLoadingBoundary(
            () => a(),
            () => "la"
          ),
          createRevealOrder(() => [
            createLoadingBoundary(
              () => b1(),
              () => "lb1"
            ),
            createLoadingBoundary(
              () => b2(),
              () => "lb2"
            )
          ]),
          createLoadingBoundary(
            () => c(),
            () => "lc"
          )
        ],
        { order: "together", collapsed: false }
      );

      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    // All held: nested propagates the hold to both children.
    expect(result).toEqual(["la", ["lb1", "lb2"], "lc"]);

    aReady.resolve(1);
    await settle();
    // la minimally ready, nested and lc not yet — still held.
    expect(result).toEqual(["la", ["lb1", "lb2"], "lc"]);

    b1Ready.resolve(1);
    await settle();
    // Nested's first slot is now ready (nested minimally ready), but lc still pending.
    // Outer still holds the whole group; no inner children reveal under the hold.
    expect(result).toEqual(["la", ["lb1", "lb2"], "lc"]);

    cReady.resolve(1);
    await settle();
    // Every direct slot is minimally ready → outer releases. Nested's own sequential
    // order now applies: lb1 revealed, lb2 still its frontier fallback.
    expect(result).toEqual(["A", ["B1", "lb2"], "C"]);

    b2Ready.resolve(1);
    await settle();
    expect(result).toEqual(["A", ["B1", "B2"], "C"]);
  });

  it("handles dynamic add/remove with mapArray", async () => {
    let result: any[] = [];
    const [$items, setItems] = createSignal<number[]>([1, 2]);
    const pending = new Map([
      [1, deferred<number>()],
      [2, deferred<number>()],
      [3, deferred<number>()]
    ]);

    createRoot(() => {
      const ordered = createRevealOrder(() => {
        const rows = mapArray($items, item => {
          const value = createMemo(async () => {
            const id = item();
            await pending.get(id)!.promise;
            return `v${id}`;
          });
          return createLoadingBoundary(
            () => value(),
            () => `l${item()}`
          );
        });
        return rows;
      });
      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(result).toEqual(["l1", undefined]);

    pending.get(2)!.resolve(2);
    await settle();
    expect(result).toEqual(["l1", undefined]);

    setItems([1, 2, 3]);
    flush();
    expect(result).toEqual(["l1", undefined, undefined]);

    setItems([2, 3]);
    flush();
    expect(result).toEqual(["v2", "l3"]);

    pending.get(3)!.resolve(3);
    await settle();
    expect(result).toEqual(["v2", "v3"]);
  });

  it("remains stable under rapid add/remove/reorder churn while pending", async () => {
    let result: any[] = [];
    const [$items, setItems] = createSignal<number[]>([1, 2, 3]);
    const pending = new Map([
      [1, deferred<number>()],
      [2, deferred<number>()],
      [3, deferred<number>()],
      [4, deferred<number>()]
    ]);

    createRoot(() => {
      const ordered = createRevealOrder(() => {
        const rows = mapArray(
          $items,
          item => {
            const value = createMemo(async () => {
              const id = item();
              await pending.get(id)!.promise;
              return `v${id}`;
            });
            return createLoadingBoundary(
              () => value(),
              () => `l${item()}`
            );
          },
          { keyed: true }
        );
        return rows;
      });
      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(result).toEqual(["l1", undefined, undefined]);

    pending.get(3)!.resolve(3);
    await settle();
    expect(result).toEqual(["l1", undefined, undefined]);

    setItems([3, 1, 4, 2]);
    flush();
    expect(result).toContain("l1");
    expect(result.filter(v => v !== undefined)).toHaveLength(1);

    pending.get(1)!.resolve(1);
    await settle();
    expect(result).toContain("v1");
    expect(result).not.toContain("v3");
    expect(result.filter(v => typeof v === "string" && v.startsWith("l"))).toHaveLength(1);

    setItems([4, 2]);
    flush();
    expect(result.filter(v => typeof v === "string" && v.startsWith("l"))).toHaveLength(1);
    expect(result.filter(v => v === undefined)).toHaveLength(1);

    pending.get(4)!.resolve(4);
    await settle();
    expect(result).not.toContain("v4");
    expect(result.filter(v => typeof v === "string" && v.startsWith("l"))).toHaveLength(1);
  });

  it("unregisters disposed nested composite slots and advances frontier", async () => {
    let result: any[] = [];
    const [$slots, setSlots] = createSignal<("a" | "nested" | "c")[]>(["a", "nested", "c"]);
    const aReady = deferred<number>();
    const b1Ready = deferred<number>();
    const b2Ready = deferred<number>();
    const cReady = deferred<number>();

    createRoot(() => {
      const ordered = createRevealOrder(() => {
        const rows = mapArray($slots, slot => {
          const id = slot();
          if (id === "a") {
            const a = createMemo(async () => {
              await aReady.promise;
              return "A";
            });
            return createLoadingBoundary(
              () => a(),
              () => "la"
            );
          }
          if (id === "nested") {
            const b1 = createMemo(async () => {
              await b1Ready.promise;
              return "B1";
            });
            const b2 = createMemo(async () => {
              await b2Ready.promise;
              return "B2";
            });
            return createRevealOrder(
              () => [
                createLoadingBoundary(
                  () => b1(),
                  () => "lb1"
                ),
                createLoadingBoundary(
                  () => b2(),
                  () => "lb2"
                )
              ],
              { order: "together", collapsed: false }
            );
          }
          const c = createMemo(async () => {
            await cReady.promise;
            return "C";
          });
          return createLoadingBoundary(
            () => c(),
            () => "lc"
          );
        });
        return rows;
      });

      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(result).toEqual(["la", [undefined, undefined], undefined]);

    aReady.resolve(1);
    await settle();
    expect(result).toEqual(["A", ["lb1", "lb2"], undefined]);

    setSlots(["a", "c"]);
    flush();
    expect(result).toEqual(["A", "lc"]);

    cReady.resolve(1);
    await settle();
    expect(result).toEqual(["A", "C"]);
  });

  it("advances reveal order when first slot errors inside error boundary", async () => {
    let result: any[] = [];
    const first = deferred<number>();
    const second = deferred<number>();

    createRoot(() => {
      const a = createMemo(async () => {
        await first.promise;
        return "A";
      });
      const b = createMemo(async () => {
        await second.promise;
        return "B";
      });

      const ordered = createRevealOrder(() => [
        createErrorBoundary(
          () =>
            createLoadingBoundary(
              () => a(),
              () => "la"
            )(),
          () => "ea"
        ),
        createLoadingBoundary(
          () => b(),
          () => "lb"
        )
      ]);

      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(result).toEqual(["la", "lb"]);

    first.reject(new Error("boom"));
    await settle();
    expect(result).toEqual(["ea", "lb"]);

    second.resolve(1);
    await settle();
    expect(result).toEqual(["ea", "B"]);
  });

  it("nested on-reset does not re-gate revealed outer siblings", async () => {
    let result: any[] = [];
    const [$id, setId] = createSignal(0);
    const aReady = deferred<number>();
    const cReady = deferred<number>();
    let current = deferred<number>();

    createRoot(() => {
      const a = createMemo(async () => {
        await aReady.promise;
        return "A";
      });
      const b1 = createMemo(async () => {
        const id = $id();
        await current.promise;
        return `B1-${id}`;
      });
      const b2 = createMemo(() => "B2");
      const c = createMemo(async () => {
        await cReady.promise;
        return "C";
      });

      const ordered = createRevealOrder(() => [
        createLoadingBoundary(
          () => a(),
          () => "la"
        ),
        createRevealOrder(() => [
          createLoadingBoundary(
            () => b1(),
            () => "lb1",
            { on: $id }
          ),
          createLoadingBoundary(
            () => b2(),
            () => "lb2"
          )
        ]),
        createLoadingBoundary(
          () => c(),
          () => "lc"
        )
      ]);

      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(result).toEqual(["la", [undefined, undefined], undefined]);

    aReady.resolve(1);
    await settle();
    // Outer advances frontier to the nested composite and releases it to run its
    // own sequential order locally. Nested's own collapsed=true applies, so b1 is
    // the nested frontier (shows its fallback) and b2 is tail-collapsed.
    expect(result).toEqual(["A", ["lb1", undefined], undefined]);

    current.resolve(1);
    await settle();
    expect(result).toEqual(["A", ["B1-0", "B2"], "lc"]);

    cReady.resolve(1);
    await settle();
    expect(result).toEqual(["A", ["B1-0", "B2"], "C"]);

    current = deferred<number>();
    setId(1);
    flush();
    expect(result).toEqual(["A", ["lb1", "B2"], "C"]);

    current.resolve(1);
    await settle();
    expect(result).toEqual(["A", ["B1-1", "B2"], "C"]);
  });

  it("reactively unregisters nested composite and advances following frontier", async () => {
    let result: any[] = [];
    const [$slots, setSlots] = createSignal<("a" | "nested" | "c")[]>(["a", "nested", "c"]);
    const aReady = deferred<number>();
    const b1Ready = deferred<number>();
    const b2Ready = deferred<number>();
    const cReady = deferred<number>();

    createRoot(() => {
      const ordered = createRevealOrder(() => {
        const rows = mapArray(
          $slots,
          slot => {
            const id = slot();
            if (id === "a") {
              const a = createMemo(async () => {
                await aReady.promise;
                return "A";
              });
              return createLoadingBoundary(
                () => a(),
                () => "la"
              );
            }
            if (id === "nested") {
              const b1 = createMemo(async () => {
                await b1Ready.promise;
                return "B1";
              });
              const b2 = createMemo(async () => {
                await b2Ready.promise;
                return "B2";
              });
              return createRevealOrder(
                () => [
                  createLoadingBoundary(
                    () => b1(),
                    () => "lb1"
                  ),
                  createLoadingBoundary(
                    () => b2(),
                    () => "lb2"
                  )
                ],
                { order: "together", collapsed: false }
              );
            }
            const c = createMemo(async () => {
              await cReady.promise;
              return "C";
            });
            return createLoadingBoundary(
              () => c(),
              () => "lc"
            );
          },
          { keyed: true }
        );
        return rows;
      });

      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(result).toEqual(["la", [undefined, undefined], undefined]);

    aReady.resolve(1);
    await settle();
    expect(result).toEqual(["A", ["lb1", "lb2"], undefined]);

    setSlots(["a", "c"]);
    flush();
    expect(result).toEqual(["A", "lc"]);

    cReady.resolve(1);
    await settle();
    expect(result).toEqual(["A", "C"]);
  });

  it("promotes next pending slot when head slot is removed", async () => {
    let result: any[] = [];
    const [$items, setItems] = createSignal<number[]>([1, 2]);
    const pending = new Map([
      [1, deferred<number>()],
      [2, deferred<number>()]
    ]);

    createRoot(() => {
      const ordered = createRevealOrder(() => {
        const rows = mapArray(
          $items,
          item => {
            const value = createMemo(async () => {
              const id = item();
              await pending.get(id)!.promise;
              return `v${id}`;
            });
            return createLoadingBoundary(
              () => value(),
              () => `l${item()}`
            );
          },
          { keyed: true }
        );
        return rows;
      });
      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(result).toEqual(["l1", undefined]);

    setItems([2]);
    flush();
    expect(result).toEqual(["l2"]);

    pending.get(1)!.resolve(1);
    await settle();
    expect(result).toEqual(["l2"]);

    pending.get(2)!.resolve(2);
    await settle();
    expect(result).toEqual(["v2"]);
  });

  it("handles multi-remove in one flush and promotes correct frontier", async () => {
    let result: any[] = [];
    const [$items, setItems] = createSignal<number[]>([1, 2, 3, 4]);
    const pending = new Map([
      [1, deferred<number>()],
      [2, deferred<number>()],
      [3, deferred<number>()],
      [4, deferred<number>()]
    ]);

    createRoot(() => {
      const ordered = createRevealOrder(() => {
        const rows = mapArray(
          $items,
          item => {
            const value = createMemo(async () => {
              const id = item();
              await pending.get(id)!.promise;
              return `v${id}`;
            });
            return createLoadingBoundary(
              () => value(),
              () => `l${item()}`
            );
          },
          { keyed: true }
        );
        return rows;
      });
      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(result).toEqual(["l1", undefined, undefined, undefined]);

    // Remove head (1) and middle (3) in one update.
    setItems([2, 4]);
    flush();
    expect(result).toEqual(["l2", undefined]);

    pending.get(4)!.resolve(4);
    await settle();
    // 4 is resolved but gated behind 2.
    expect(result).toEqual(["l2", undefined]);

    pending.get(2)!.resolve(2);
    await settle();
    expect(result).toEqual(["v2", "v4"]);
  });

  it("appending after graduation starts a fresh frontier", async () => {
    let result: any[] = [];
    const [$items, setItems] = createSignal<number[]>([1, 2]);
    const pending = new Map([
      [1, deferred<number>()],
      [2, deferred<number>()],
      [3, deferred<number>()],
      [4, deferred<number>()]
    ]);

    createRoot(() => {
      const ordered = createRevealOrder(() => {
        const rows = mapArray(
          $items,
          item => {
            const value = createMemo(async () => {
              const id = item();
              await pending.get(id)!.promise;
              return `v${id}`;
            });
            return createLoadingBoundary(
              () => value(),
              () => `l${item()}`
            );
          },
          { keyed: true }
        );
        return rows;
      });
      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(result).toEqual(["l1", undefined]);

    pending.get(1)!.resolve(1);
    await settle();
    expect(result).toEqual(["v1", "l2"]);

    pending.get(2)!.resolve(2);
    await settle();
    expect(result).toEqual(["v1", "v2"]);

    // All initial slots graduated; new pending slots should become a fresh sequence.
    setItems([1, 2, 3, 4]);
    flush();
    expect(result).toEqual(["v1", "v2", "l3", undefined]);

    pending.get(4)!.resolve(4);
    await settle();
    // 4 remains gated until 3 resolves.
    expect(result).toEqual(["v1", "v2", "l3", undefined]);

    pending.get(3)!.resolve(3);
    await settle();
    expect(result).toEqual(["v1", "v2", "v3", "v4"]);
  });

  it("handles three-level nested reveal progression", async () => {
    let result: any[] = [];
    const aReady = deferred<number>();
    const bReady = deferred<number>();
    const cReady = deferred<number>();
    const dReady = deferred<number>();

    createRoot(() => {
      const a = createMemo(async () => {
        await aReady.promise;
        return "A";
      });
      const b = createMemo(async () => {
        await bReady.promise;
        return "B";
      });
      const c = createMemo(async () => {
        await cReady.promise;
        return "C";
      });
      const d = createMemo(async () => {
        await dReady.promise;
        return "D";
      });

      const ordered = createRevealOrder(() => [
        createLoadingBoundary(
          () => a(),
          () => "la"
        ),
        createRevealOrder(
          () => [
            createLoadingBoundary(
              () => b(),
              () => "lb"
            ),
            createRevealOrder(() => [
              createLoadingBoundary(
                () => c(),
                () => "lc"
              ),
              createLoadingBoundary(
                () => d(),
                () => "ld"
              )
            ])
          ],
          { order: "together", collapsed: false }
        )
      ]);

      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(result).toEqual(["la", ["lb", [undefined, undefined]]]);

    aReady.resolve(1);
    await settle();
    // Outer advances frontier to the middle composite and releases it to run its
    // own order. Middle is together with collapsed=false: it holds b and the
    // innermost composite on their fallbacks (not collapsed) until the whole
    // composite is ready. Innermost in turn surfaces its leaves' fallbacks under
    // the hold.
    expect(result).toEqual(["A", ["lb", ["lc", "ld"]]]);

    bReady.resolve(1);
    cReady.resolve(1);
    dReady.resolve(1);
    await settle();
    expect(result).toEqual(["A", ["B", ["C", "D"]]]);
  });

  it("nested together on-reset does not re-gate revealed outer siblings", async () => {
    let result: any[] = [];
    const [$id, setId] = createSignal(0);
    const aReady = deferred<number>();
    const cReady = deferred<number>();
    let currentB1 = deferred<number>();
    let currentB2 = deferred<number>();

    createRoot(() => {
      const a = createMemo(async () => {
        await aReady.promise;
        return "A";
      });
      const b1 = createMemo(async () => {
        const id = $id();
        await currentB1.promise;
        return `B1-${id}`;
      });
      const b2 = createMemo(async () => {
        const id = $id();
        await currentB2.promise;
        return `B2-${id}`;
      });
      const c = createMemo(async () => {
        await cReady.promise;
        return "C";
      });

      const ordered = createRevealOrder(() => [
        createLoadingBoundary(
          () => a(),
          () => "la"
        ),
        createRevealOrder(
          () => [
            createLoadingBoundary(
              () => b1(),
              () => "lb1",
              { on: $id }
            ),
            createLoadingBoundary(
              () => b2(),
              () => "lb2",
              { on: $id }
            )
          ],
          { order: "together", collapsed: false }
        ),
        createLoadingBoundary(
          () => c(),
          () => "lc"
        )
      ]);

      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(result).toEqual(["la", [undefined, undefined], undefined]);

    aReady.resolve(1);
    await settle();
    expect(result).toEqual(["A", ["lb1", "lb2"], undefined]);

    currentB1.resolve(1);
    currentB2.resolve(1);
    await settle();
    expect(result).toEqual(["A", ["B1-0", "B2-0"], "lc"]);

    cReady.resolve(1);
    await settle();
    expect(result).toEqual(["A", ["B1-0", "B2-0"], "C"]);

    currentB1 = deferred<number>();
    currentB2 = deferred<number>();
    setId(1);
    flush();
    expect(result).toEqual(["A", ["lb1", "lb2"], "C"]);

    currentB1.resolve(1);
    currentB2.resolve(1);
    await settle();
    expect(result).toEqual(["A", ["B1-1", "B2-1"], "C"]);
  });

  it("nested composite recovers from error without breaking outer progression", async () => {
    let result: any[] = [];
    const [$retry, setRetry] = createSignal(0);
    const aReady = deferred<number>();
    const cReady = deferred<number>();
    let fail = true;

    createRoot(() => {
      const a = createMemo(async () => {
        await aReady.promise;
        return "A";
      });
      const b = createMemo(async () => {
        $retry();
        await Promise.resolve();
        if (fail) throw new Error("nested boom");
        return "B";
      });
      const c = createMemo(async () => {
        await cReady.promise;
        return "C";
      });

      const ordered = createRevealOrder(() => [
        createLoadingBoundary(
          () => a(),
          () => "la"
        ),
        createRevealOrder(() => [
          createErrorBoundary(
            () =>
              createLoadingBoundary(
                () => b(),
                () => "lb"
              )(),
            () => "eb"
          )
        ]),
        createLoadingBoundary(
          () => c(),
          () => "lc"
        )
      ]);

      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(result).toEqual(["la", ["lb"], undefined]);

    aReady.resolve(1);
    await settle();
    expect(result).toEqual(["A", ["eb"], "lc"]);

    fail = false;
    setRetry(1);
    flush();
    expect(result).toEqual(["A", ["eb"], "lc"]);

    await settle();
    expect(result).toEqual(["A", ["B"], "lc"]);

    cReady.resolve(1);
    await settle();
    expect(result).toEqual(["A", ["B"], "C"]);
  });

  it("does not retroactively collapse later slots after graduation", async () => {
    let first: any;
    let second: any;
    const [$id, setId] = createSignal(0);

    createRoot(() => {
      createRevealOrder(() => {
        const firstValue = createMemo(async () => {
          const id = $id();
          await Promise.resolve();
          return `a${id}`;
        });
        const secondValue = createMemo(async () => {
          const id = $id();
          await Promise.resolve();
          return `b${id}`;
        });

        const firstBoundary = createLoadingBoundary(
          () => firstValue(),
          () => "l1",
          { on: $id }
        );
        const secondBoundary = createLoadingBoundary(
          () => secondValue(),
          () => "l2"
        );

        createRenderEffect(
          () => (first = firstBoundary()),
          () => {}
        );
        createRenderEffect(
          () => (second = secondBoundary()),
          () => {}
        );
      });
    });

    flush();
    expect(first).toBe("l1");
    expect(second).toBeUndefined();

    await settle();
    expect(first).toBe("a0");
    expect(second).toBe("b0");

    setId(1);
    flush();
    expect(first).toBe("l1");
    expect(second).toBe("b0");

    await settle();
    expect(first).toBe("a1");
    expect(second).toBe("b1");
  });

  it("natural mode lets inner siblings reveal independently in resolution order", async () => {
    let result: any[] = [];
    const first = deferred<number>();
    const second = deferred<number>();
    const third = deferred<number>();

    createRoot(() => {
      const a = createMemo(async () => {
        await first.promise;
        return 1;
      });
      const b = createMemo(async () => {
        await second.promise;
        return 2;
      });
      const c = createMemo(async () => {
        await third.promise;
        return 3;
      });

      const ordered = createRevealOrder(
        () => [
          createLoadingBoundary(
            () => a(),
            () => "l1"
          ),
          createLoadingBoundary(
            () => b(),
            () => "l2"
          ),
          createLoadingBoundary(
            () => c(),
            () => "l3"
          )
        ],
        { order: "natural" }
      );

      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(result).toEqual(["l1", "l2", "l3"]);

    second.resolve(2);
    await settle();
    expect(result).toEqual(["l1", 2, "l3"]);

    third.resolve(3);
    await settle();
    expect(result).toEqual(["l1", 2, 3]);

    first.resolve(1);
    await settle();
    expect(result).toEqual([1, 2, 3]);
  });

  it("natural mode ignores collapsed — inner fallbacks stay visible", async () => {
    let result: any[] = [];
    const first = deferred<number>();
    const second = deferred<number>();

    createRoot(() => {
      const a = createMemo(async () => {
        await first.promise;
        return 1;
      });
      const b = createMemo(async () => {
        await second.promise;
        return 2;
      });

      const ordered = createRevealOrder(
        () => [
          createLoadingBoundary(
            () => a(),
            () => "l1"
          ),
          createLoadingBoundary(
            () => b(),
            () => "l2"
          )
        ],
        { order: "natural", collapsed: true }
      );

      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(result).toEqual(["l1", "l2"]);
  });

  it("outer sequential releases the inner natural composite at its frontier", async () => {
    // The natural composite registers with outer as one slot. When outer reaches
    // the composite as its frontier it releases it, so inner natural runs its own
    // per-slot policy locally — grandchildren reveal independently as their data
    // arrives, while outer still waits on the whole composite before advancing to
    // its own tail-collapsed siblings.
    let result: any[] = [];
    const a = deferred<number>();
    const innerA = deferred<number>();
    const innerB = deferred<number>();
    const c = deferred<number>();

    createRoot(() => {
      const outerA = createMemo(async () => {
        await a.promise;
        return "A";
      });
      const ia = createMemo(async () => {
        await innerA.promise;
        return "iA";
      });
      const ib = createMemo(async () => {
        await innerB.promise;
        return "iB";
      });
      const outerC = createMemo(async () => {
        await c.promise;
        return "C";
      });

      const ordered = createRevealOrder(() => [
        createLoadingBoundary(
          () => outerA(),
          () => "la"
        ),
        createRevealOrder(
          () => [
            createLoadingBoundary(
              () => ia(),
              () => "lia"
            ),
            createLoadingBoundary(
              () => ib(),
              () => "lib"
            )
          ],
          { order: "natural" }
        ),
        createLoadingBoundary(
          () => outerC(),
          () => "lc"
        )
      ]);

      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    // outer sequential with default collapsed=true: first-pending shows fallback,
    // tail-collapsed natural composite and c render undefined.
    expect(result).toEqual(["la", [undefined, undefined], undefined]);

    // Resolve outer A — frontier advances to the inner natural composite.
    a.resolve(1);
    await settle();
    expect(result).toEqual(["A", ["lia", "lib"], undefined]);

    // Inner B resolves independently while iA is still pending — inner natural's
    // per-slot policy applies while outer holds the tail siblings.
    innerB.resolve(2);
    await settle();
    expect(result).toEqual(["A", ["lia", "iB"], undefined]);

    // C is tail-collapsed under outer sequential — resolving doesn't change anything.
    c.resolve(3);
    await settle();
    expect(result).toEqual(["A", ["lia", "iB"], undefined]);

    // When inner A also resolves, the natural composite is fully ready and outer
    // advances past it to c.
    innerA.resolve(4);
    await settle();
    expect(result).toEqual(["A", ["iA", "iB"], "C"]);
  });

  it("outer natural releases nested natural composite so grandchildren reveal independently", async () => {
    // Outer natural releases each composite slot to run its own order locally.
    // The nested natural composite then reveals its children independently as
    // their data arrives — grandchildren are not held just because the composite
    // isn't fully ready.
    let result: any[] = [];
    const a = deferred<number>();
    const b = deferred<number>();
    const c = deferred<number>();

    createRoot(() => {
      const ma = createMemo(async () => {
        await a.promise;
        return "A";
      });
      const mb = createMemo(async () => {
        await b.promise;
        return "B";
      });
      const mc = createMemo(async () => {
        await c.promise;
        return "C";
      });

      const ordered = createRevealOrder(
        () => [
          createLoadingBoundary(
            () => ma(),
            () => "la"
          ),
          createRevealOrder(
            () => [
              createLoadingBoundary(
                () => mb(),
                () => "lb"
              ),
              createLoadingBoundary(
                () => mc(),
                () => "lc"
              )
            ],
            { order: "natural" }
          )
        ],
        { order: "natural" }
      );

      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(result).toEqual(["la", ["lb", "lc"]]);

    // C resolves alone — inner natural reveals it directly, independent of b.
    c.resolve(3);
    await settle();
    expect(result).toEqual(["la", ["lb", "C"]]);

    // A resolves — outer's leaf slot reveals independently.
    a.resolve(1);
    await settle();
    expect(result).toEqual(["A", ["lb", "C"]]);

    // B resolves — last pending boundary clears.
    b.resolve(2);
    await settle();
    expect(result).toEqual(["A", ["B", "C"]]);
  });

  it("outer together + inner together: releases only when every descendant is ready", async () => {
    let result: any[] = [];
    const t1 = deferred<number>();
    const t2 = deferred<number>();

    createRoot(() => {
      const m1 = createMemo(async () => {
        await t1.promise;
        return "T1";
      });
      const m2 = createMemo(async () => {
        await t2.promise;
        return "T2";
      });

      const ordered = createRevealOrder(
        () => [
          createRevealOrder(
            () => [
              createLoadingBoundary(
                () => m1(),
                () => "l1"
              ),
              createLoadingBoundary(
                () => m2(),
                () => "l2"
              )
            ],
            { order: "together", collapsed: false }
          )
        ],
        { order: "together", collapsed: false }
      );

      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(result).toEqual([["l1", "l2"]]);

    t1.resolve(1);
    await settle();
    // Inner together is atomic — not minimally ready until both resolve.
    // Outer still holds everything.
    expect(result).toEqual([["l1", "l2"]]);

    t2.resolve(2);
    await settle();
    // Inner together fully ready → outer releases → both visible at once.
    expect(result).toEqual([["T1", "T2"]]);
  });

  it("outer together + inner sequential: releases at first-ready; tail stays on fallback", async () => {
    // An inner sequential slot is "minimally ready" when its first registered slot
    // resolves. That triggers outer-together release, after which the inner
    // sequential continues to gate its tail on its own frontier.
    let result: any[] = [];
    const s1 = deferred<number>();
    const s2 = deferred<number>();

    createRoot(() => {
      const m1 = createMemo(async () => {
        await s1.promise;
        return "S1";
      });
      const m2 = createMemo(async () => {
        await s2.promise;
        return "S2";
      });

      const ordered = baseCreateRevealOrder(
        () => [
          baseCreateRevealOrder(
            () => [
              createLoadingBoundary(
                () => m1(),
                () => "l1"
              ),
              createLoadingBoundary(
                () => m2(),
                () => "l2"
              )
            ],
            { order: () => "sequential", collapsed: () => false }
          )
        ],
        { order: () => "together", collapsed: () => false }
      );

      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(result).toEqual([["l1", "l2"]]);

    // Resolve the second slot first — sequential's frontier hasn't advanced, so
    // the inner is NOT minimally ready yet, and outer still holds everything.
    s2.resolve(2);
    await settle();
    expect(result).toEqual([["l1", "l2"]]);

    // Now resolve the first slot. Inner sequential's frontier-0 is ready →
    // minimally ready → outer releases → inner sequential reveals l1 and, since
    // s2 already resolved, also reveals l2.
    s1.resolve(1);
    await settle();
    expect(result).toEqual([["S1", "S2"]]);
  });

  it("outer together + inner natural: releases when any inner child is ready", async () => {
    // An inner natural slot is "minimally ready" when any one of its children is
    // ready. That triggers outer-together release; remaining children continue to
    // reveal per natural as they resolve.
    let result: any[] = [];
    const n1 = deferred<number>();
    const n2 = deferred<number>();

    createRoot(() => {
      const m1 = createMemo(async () => {
        await n1.promise;
        return "N1";
      });
      const m2 = createMemo(async () => {
        await n2.promise;
        return "N2";
      });

      const ordered = baseCreateRevealOrder(
        () => [
          baseCreateRevealOrder(
            () => [
              createLoadingBoundary(
                () => m1(),
                () => "l1"
              ),
              createLoadingBoundary(
                () => m2(),
                () => "l2"
              )
            ],
            { order: () => "natural" }
          )
        ],
        { order: () => "together", collapsed: () => false }
      );

      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(result).toEqual([["l1", "l2"]]);

    // Resolve the second child — natural's minimally-ready condition (any child
    // ready) is satisfied → outer releases. Remaining natural children reveal
    // independently as they resolve.
    n2.resolve(2);
    await settle();
    expect(result).toEqual([["l1", "N2"]]);

    n1.resolve(1);
    await settle();
    expect(result).toEqual([["N1", "N2"]]);
  });

  it("outer natural + inner sequential: inner composite runs its own frontier locally", async () => {
    // Outer natural releases composite slots to run their own order locally, so
    // an inner sequential reveals its children per its own frontier-gating,
    // independently of the outer leaf sibling.
    let result: any[] = [];
    const a = deferred<number>();
    const s1 = deferred<number>();
    const s2 = deferred<number>();

    createRoot(() => {
      const ma = createMemo(async () => {
        await a.promise;
        return "A";
      });
      const m1 = createMemo(async () => {
        await s1.promise;
        return "S1";
      });
      const m2 = createMemo(async () => {
        await s2.promise;
        return "S2";
      });

      const ordered = baseCreateRevealOrder(
        () => [
          createLoadingBoundary(
            () => ma(),
            () => "la"
          ),
          baseCreateRevealOrder(
            () => [
              createLoadingBoundary(
                () => m1(),
                () => "l1"
              ),
              createLoadingBoundary(
                () => m2(),
                () => "l2"
              )
            ],
            { order: () => "sequential", collapsed: () => false }
          )
        ],
        { order: () => "natural" }
      );

      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(result).toEqual(["la", ["l1", "l2"]]);

    // Resolving the tail of the inner sequential is blocked by its own frontier.
    s2.resolve(2);
    await settle();
    expect(result).toEqual(["la", ["l1", "l2"]]);

    // Inner frontier-0 resolves — inner sequential advances past s1 and, since
    // s2 already resolved, advances past s2 too. Outer leaf is independent.
    s1.resolve(1);
    await settle();
    expect(result).toEqual(["la", ["S1", "S2"]]);

    a.resolve(1);
    await settle();
    expect(result).toEqual(["A", ["S1", "S2"]]);
  });

  it("outer natural + inner together: inner remains atomic while outer runs natural", async () => {
    // Outer natural releases the inner together composite to run its own policy.
    // Inner together stays on its fallback until every inner child resolves,
    // then reveals atomically — the outer leaf sibling is independent.
    let result: any[] = [];
    const a = deferred<number>();
    const t1 = deferred<number>();
    const t2 = deferred<number>();

    createRoot(() => {
      const ma = createMemo(async () => {
        await a.promise;
        return "A";
      });
      const m1 = createMemo(async () => {
        await t1.promise;
        return "T1";
      });
      const m2 = createMemo(async () => {
        await t2.promise;
        return "T2";
      });

      const ordered = baseCreateRevealOrder(
        () => [
          createLoadingBoundary(
            () => ma(),
            () => "la"
          ),
          baseCreateRevealOrder(
            () => [
              createLoadingBoundary(
                () => m1(),
                () => "l1"
              ),
              createLoadingBoundary(
                () => m2(),
                () => "l2"
              )
            ],
            { order: () => "together", collapsed: () => false }
          )
        ],
        { order: () => "natural" }
      );

      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(result).toEqual(["la", ["l1", "l2"]]);

    // Outer leaf resolves first — natural reveals it independently while inner
    // together is still holding its children.
    a.resolve(1);
    await settle();
    expect(result).toEqual(["A", ["l1", "l2"]]);

    // Partial inner resolution — together stays atomic, both still on fallback.
    t1.resolve(1);
    await settle();
    expect(result).toEqual(["A", ["l1", "l2"]]);

    // Inner fully ready — together reveals atomically.
    t2.resolve(2);
    await settle();
    expect(result).toEqual(["A", ["T1", "T2"]]);
  });
});
