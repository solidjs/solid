import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  createStore,
  flush,
  untrack
} from "../src/index.js";

const COMP = "TestComponent";

afterEach(() => flush());

describe("strictRead", () => {
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
