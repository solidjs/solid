import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  createStore,
  deep,
  flush,
  isPending,
  untrack
} from "../src/index.js";

const COMP = "TestComponent";

afterEach(() => flush());

describe("strictRead", () => {
  describe("effect callback (back half)", () => {
    it("warns on signal read in effect callback", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const [$x, setX] = createSignal(1);
      const [$y] = createSignal(2);

      createRoot(() => {
        createEffect(
          () => $x(),
          () => {
            $y();
          }
        );
      });
      flush();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("an effect callback");
      warn.mockRestore();
    });

    it("warns on store property read in effect callback", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const [$x] = createSignal(1);
      const [store] = createStore({ count: 0 });

      createRoot(() => {
        createEffect(
          () => $x(),
          () => {
            void store.count;
          }
        );
      });
      flush();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("an effect callback");
      warn.mockRestore();
    });

    it("warns on isPending read in effect callback", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const [$x] = createSignal(1);
      const [$y] = createSignal(2);

      createRoot(() => {
        createEffect(
          () => $x(),
          () => {
            isPending(() => $y());
          }
        );
      });
      flush();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("an effect callback");
      warn.mockRestore();
    });

    it("does not warn when using deep() snapshot data in effect callback", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const [store] = createStore({ a: 1, b: { c: 2 } });

      createRoot(() => {
        createEffect(
          () => deep(store),
          val => {
            void val.a;
            void val.b.c;
          }
        );
      });
      flush();

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it("does not warn on reads in effect compute function", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const [$x] = createSignal(1);
      const [$y] = createSignal(2);

      createRoot(() => {
        createEffect(
          () => $x() + $y(),
          () => {}
        );
      });
      flush();

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  it("warns on signal read under strict + untracked", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [$x] = createSignal(10);

    createRoot(() => {
      untrack(() => $x(), COMP);
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(COMP);
    warn.mockRestore();
  });

  it("warns on memo read under strict + untracked", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [$x] = createSignal(10);

    createRoot(() => {
      const $m = createMemo(() => $x() * 2);
      flush();
      untrack(() => $m(), COMP);
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(COMP);
    warn.mockRestore();
  });

  it("warns on store property read under strict + untracked", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    createRoot(() => {
      const [store] = createStore({ count: 0 });
      untrack(() => {
        void store.count;
      }, COMP);
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(COMP);
    warn.mockRestore();
  });

  it("does not warn inside computed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [$x] = createSignal(10);

    createRoot(() => {
      untrack(() => {
        createMemo(() => $x() * 2);
      }, COMP);
    });
    flush();

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not warn inside effect", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [$x] = createSignal(10);

    createRoot(() => {
      untrack(() => {
        createEffect(
          () => $x(),
          () => {}
        );
      }, COMP);
    });
    flush();

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not warn when nested untrack clears strictRead", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [$x] = createSignal(10);

    createRoot(() => {
      untrack(() => {
        untrack(() => {
          $x();
        });
      }, COMP);
    });

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("restores strictRead correctly through nested untrack calls", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [$x] = createSignal(10);

    createRoot(() => {
      untrack(() => {
        untrack(() => {
          $x(); // inner untrack clears strictRead, no warn
        });
        $x(); // strictRead is COMP again after inner restores, should warn
      }, COMP);
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(COMP);
    warn.mockRestore();
  });
});
