import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRevealOrder as baseCreateRevealOrder,
  createRoot,
  createSignal,
  flush,
  mapArray
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
  options?: { together?: boolean; collapsed?: boolean }
): T {
  return baseCreateRevealOrder(fn, {
    together: () => !!options?.together,
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
        { together: true, collapsed: false }
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
        { together: () => true, collapsed: () => true }
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
          { together: true, collapsed: false }
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

  it("supports together outer with sequential inner mode mix", async () => {
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
        { together: true, collapsed: false }
      );

      createRenderEffect(
        () => (result = materialize(ordered)),
        () => {}
      );
    });

    flush();
    expect(result).toEqual(["la", ["lb1", undefined], "lc"]);

    aReady.resolve(1);
    await settle();
    expect(result).toEqual(["la", ["lb1", undefined], "lc"]);

    b1Ready.resolve(1);
    await settle();
    expect(result).toEqual(["la", ["B1", "lb2"], "lc"]);

    cReady.resolve(1);
    await settle();
    expect(result).toEqual(["la", ["B1", "lb2"], "lc"]);

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
              { together: true, collapsed: false }
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
                { together: true, collapsed: false }
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
          { together: true, collapsed: false }
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
    expect(result).toEqual(["A", ["lb", [undefined, undefined]]]);

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
          { together: true, collapsed: false }
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
});
