import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  createStore,
  flush,
  setStrictRead,
  untrack
} from "../src/index.js";

const COMP = "TestComponent";

afterEach(() => flush());

describe("strictRead", () => {
  it("warns on signal read under strict + untracked", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [$x] = createSignal(10);

    createRoot(() => {
      untrack(() => {
        setStrictRead(COMP);
        try {
          $x();
        } finally {
          setStrictRead(false);
        }
      });
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
      untrack(() => {
        setStrictRead(COMP);
        try {
          $m();
        } finally {
          setStrictRead(false);
        }
      });
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
        setStrictRead(COMP);
        try {
          void store.count;
        } finally {
          setStrictRead(false);
        }
      });
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(COMP);
    warn.mockRestore();
  });

  it("does not warn inside computed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [$x] = createSignal(10);

    createRoot(() => {
      setStrictRead(COMP);
      createMemo(() => $x() * 2);
      setStrictRead(false);
    });
    flush();

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not warn inside effect", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [$x] = createSignal(10);

    createRoot(() => {
      setStrictRead(COMP);
      createEffect(
        () => $x(),
        () => {}
      );
      setStrictRead(false);
    });
    flush();

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not warn when explicit untrack clears strictRead", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [$x] = createSignal(10);

    createRoot(() => {
      setStrictRead(COMP);
      untrack(() => {
        $x();
      });
      setStrictRead(false);
    });

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("restores strictRead correctly through nested calls", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [$x] = createSignal(10);

    createRoot(() => {
      untrack(() => {
        const prev = setStrictRead(COMP);
        try {
          const inner = setStrictRead(false);
          expect(inner).toBe(COMP);
          $x(); // strictRead is false, no warn
          setStrictRead(inner); // restore to COMP

          $x(); // strictRead is COMP again, should warn
        } finally {
          setStrictRead(prev);
        }
      });
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(COMP);
    warn.mockRestore();
  });
});
