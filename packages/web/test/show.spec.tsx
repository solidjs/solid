/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { createMemo, createRoot, createSignal, Show, flush, isPending } from "solid-js";
import { render } from "../src/index.js";

describe("Testing an only child show control flow", () => {
  let div!: HTMLDivElement, disposer: () => void;
  const [count, setCount] = createSignal(0);
  const Component = () => (
    <div ref={div}>
      <Show when={count() >= 5}>{count()}</Show>
    </div>
  );

  test("Create show control flow", () => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />;
    });

    expect(div.innerHTML).toBe("");
  });

  test("Toggle show control flow", () => {
    setCount(7);
    flush();
    expect(div.innerHTML).toBe("7");
    setCount(5);
    flush();
    expect(div.innerHTML).toBe("5");
    setCount(2);
    flush();
    expect(div.innerHTML).toBe("");
  });

  test("dispose", () => disposer());
});

describe("Testing an only child show control flow with DOM children", () => {
  let div!: HTMLDivElement, disposer: () => void;
  const [count, setCount] = createSignal(0);
  const Component = () => (
    <div ref={div}>
      <Show when={count() >= 5}>
        <span>{count()}</span>
        <span>counted</span>
      </Show>
    </div>
  );

  test("Create show control flow", () => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />;
    });

    expect(div.innerHTML).toBe("");
  });

  test("Toggle show control flow", () => {
    setCount(7);
    flush();
    expect((div.firstChild as HTMLSpanElement).innerHTML).toBe("7");
    setCount(5);
    flush();
    expect((div.firstChild as HTMLSpanElement).innerHTML).toBe("5");
    setCount(2);
    flush();
    expect(div.innerHTML).toBe("");
  });

  test("dispose", () => disposer());
});

describe("Testing nonkeyed show control flow", () => {
  let div!: HTMLDivElement, disposer: () => void;
  const [count, setCount] = createSignal(0);
  let whenExecuted = 0;
  let childrenExecuted = 0;
  function when() {
    whenExecuted++;
    return count();
  }
  const Component = () => (
    <div ref={div}>
      <Show when={when()}>
        <span>{count()}</span>
        <span>{childrenExecuted++}</span>
      </Show>
    </div>
  );

  test("Create show control flow", () => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />;
    });

    expect(div.innerHTML).toBe("");
    expect(whenExecuted).toBe(1);
    expect(childrenExecuted).toBe(0);
  });

  test("Toggle show control flow", () => {
    setCount(7);
    flush();
    expect(whenExecuted).toBe(2);
    expect((div.firstChild as HTMLSpanElement).innerHTML).toBe("7");
    expect(childrenExecuted).toBe(1);
    setCount(5);
    flush();
    expect(whenExecuted).toBe(3);
    expect((div.firstChild as HTMLSpanElement).innerHTML).toBe("5");
    expect(childrenExecuted).toBe(1);
    setCount(5);
    expect(whenExecuted).toBe(3);
    setCount(0);
    flush();
    expect(whenExecuted).toBe(4);
    expect(div.innerHTML).toBe("");
    expect(childrenExecuted).toBe(1);
    setCount(5);
    flush();
    expect(whenExecuted).toBe(5);
  });

  test("dispose", () => disposer());
});

describe("Testing keyed show control flow", () => {
  let div!: HTMLDivElement, disposer: () => void;
  const [count, setCount] = createSignal(0);
  let whenExecuted = 0;
  let childrenExecuted = 0;
  function when() {
    whenExecuted++;
    return count();
  }
  const Component = () => (
    <div ref={div}>
      <Show when={when()} keyed>
        <span>{count()}</span>
        <span>{childrenExecuted++}</span>
      </Show>
    </div>
  );

  test("Create show control flow", () => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />;
    });

    expect(div.innerHTML).toBe("");
    expect(whenExecuted).toBe(1);
    expect(childrenExecuted).toBe(0);
  });

  test("Toggle show control flow", () => {
    setCount(7);
    flush();
    expect(whenExecuted).toBe(2);
    expect((div.firstChild as HTMLSpanElement).innerHTML).toBe("7");
    expect(childrenExecuted).toBe(1);
    setCount(5);
    flush();
    expect(whenExecuted).toBe(3);
    expect((div.firstChild as HTMLSpanElement).innerHTML).toBe("5");
    expect(childrenExecuted).toBe(2);
    setCount(5);
    expect(whenExecuted).toBe(3);
    setCount(0);
    flush();
    expect(whenExecuted).toBe(4);
    expect(div.innerHTML).toBe("");
    expect(childrenExecuted).toBe(2);
    setCount(5);
    flush();
    expect(whenExecuted).toBe(5);
  });

  test("dispose", () => disposer());
});

describe("Testing nonkeyed function show control flow", () => {
  let div!: HTMLDivElement, disposer: () => void;
  const [count, setCount] = createSignal(0);
  let whenExecuted = 0;
  let childrenExecuted = 0;
  function when() {
    whenExecuted++;
    return count();
  }
  const Component = () => (
    <div ref={div}>
      <Show when={when()}>
        {count => (
          <>
            <span>{count()}</span>
            <span>{childrenExecuted++}</span>
          </>
        )}
      </Show>
    </div>
  );

  test("Create show control flow", () => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />;
    });

    expect(div.innerHTML).toBe("");
    expect(whenExecuted).toBe(1);
    expect(childrenExecuted).toBe(0);
  });

  test("Toggle show control flow", () => {
    setCount(7);
    flush();
    expect(whenExecuted).toBe(2);
    expect((div.firstChild as HTMLSpanElement).innerHTML).toBe("7");
    expect(childrenExecuted).toBe(1);
    setCount(5);
    flush();
    expect(whenExecuted).toBe(3);
    expect((div.firstChild as HTMLSpanElement).innerHTML).toBe("5");
    expect(childrenExecuted).toBe(1);
    setCount(5);
    expect(whenExecuted).toBe(3);
    setCount(0);
    flush();
    expect(whenExecuted).toBe(4);
    expect(div.innerHTML).toBe("");
    expect(childrenExecuted).toBe(1);
    setCount(5);
    flush();
    expect(whenExecuted).toBe(5);
  });

  test("dispose", () => disposer());
});

describe("Testing keyed function show control flow", () => {
  let div!: HTMLDivElement, disposer: () => void;
  const [count, setCount] = createSignal(0);
  let executed = 0;
  const Component = () => (
    <div ref={div}>
      <Show when={count()} keyed>
        {count => (
          <>
            <span>{count}</span>
            <span>{executed++}</span>
          </>
        )}
      </Show>
    </div>
  );

  test("Create show control flow", () => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />;
    });

    expect(div.innerHTML).toBe("");
    expect(executed).toBe(0);
  });

  test("Toggle show control flow", () => {
    setCount(7);
    flush();
    expect((div.firstChild as HTMLSpanElement).innerHTML).toBe("7");
    expect(executed).toBe(1);
    setCount(5);
    flush();
    expect((div.firstChild as HTMLSpanElement).innerHTML).toBe("5");
    expect(executed).toBe(2);
    setCount(0);
    flush();
    expect(div.innerHTML).toBe("");
    expect(executed).toBe(2);
  });

  test("dispose", () => disposer());
});

describe("Testing an only child show control flow with keyed function", () => {
  let div!: HTMLDivElement, disposer: () => void;
  const [data, setData] = createSignal<{ count: number }>();
  const Component = () => (
    <div ref={div}>
      <Show when={data()} keyed>
        {item => (
          <>
            <span>{item.count}</span>
            <span>counted</span>
          </>
        )}
      </Show>
    </div>
  );

  test("Create show control flow", () => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />;
    });

    expect(div.innerHTML).toBe("");
  });

  test("Toggle show control flow", () => {
    setData({ count: 7 });
    flush();
    expect((div.firstChild as HTMLSpanElement).innerHTML).toBe("7");
    setData({ count: 5 });
    flush();
    expect((div.firstChild as HTMLSpanElement).innerHTML).toBe("5");
    setData({ count: 2 });
    flush();
    expect((div.firstChild as HTMLSpanElement).innerHTML).toBe("2");
  });

  test("dispose", () => disposer());
});

describe("Testing an only child show control flow with non-keyed function", () => {
  let div!: HTMLDivElement, disposer: () => void;
  const [data, setData] = createSignal<{ count: number }>();
  const Component = () => (
    <div ref={div}>
      <Show when={data()}>
        {data => (
          <>
            <span>{data().count}</span>
            <span>counted</span>
          </>
        )}
      </Show>
    </div>
  );

  test("Create show control flow", () => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />;
    });

    expect(div.innerHTML).toBe("");
  });

  test("Toggle show control flow", () => {
    setData({ count: 7 });
    flush();
    expect((div.firstChild as HTMLSpanElement).innerHTML).toBe("7");
    setData({ count: 5 });
    flush();
    expect((div.firstChild as HTMLSpanElement).innerHTML).toBe("5");
    setData({ count: 2 });
    flush();
    expect((div.firstChild as HTMLSpanElement).innerHTML).toBe("2");
  });

  test("dispose", () => disposer());
});

describe("Testing an only child show control flow with DOM children and fallback", () => {
  let div!: HTMLDivElement, disposer: () => void;
  const [count, setCount] = createSignal(0);
  const Component = () => (
    <div ref={div}>
      <Show when={count() >= 5} fallback={<span>Too Low</span>}>
        <span>{count()}</span>
      </Show>
    </div>
  );

  test("Create when control flow", () => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />;
    });

    expect(div.innerHTML).toBe("<span>Too Low</span>");
  });

  test("Toggle show control flow", () => {
    setCount(7);
    flush();
    expect((div.firstChild as HTMLSpanElement).innerHTML).toBe("7");
    setCount(5);
    flush();
    expect((div.firstChild as HTMLSpanElement).innerHTML).toBe("5");
    setCount(2);
    flush();
    expect((div.firstChild as HTMLSpanElement).innerHTML).toBe("Too Low");
  });

  test("dispose", () => disposer());
});

describe("Sibling Shows with isPending in a fragment (#2963)", () => {
  // The isPending companion flip puts the fragment's insert effect under an
  // optimistic lane; without replay-at-commit the unrelated `data` write went
  // stale for a tick, so the second Show never rendered its settled branch
  // (the healed value equaled what was already in the DOM).
  test("settled branch renders the same flush as the write", () => {
    const div = document.createElement("div");
    const [state, setState] = createSignal<{ promise?: Promise<string>; data?: string }>({});

    const dispose = render(
      () => (
        <>
          <Show when={isPending(state) || !!state().promise}>
            <span>submitting</span>
          </Show>
          <Show when={state().data}>{d => <span>result:{d()}</span>}</Show>
        </>
      ),
      div
    );
    flush();
    expect(div.textContent).toBe("");

    setState({ promise: Promise.resolve("ok") });
    flush();
    expect(div.textContent).toBe("submitting");

    setState({ data: "ok" });
    flush();
    expect(div.textContent).toBe("result:ok");

    dispose();
  });
});

describe("isPending in Show `when` outside a Loading boundary (#3028)", () => {
  // `<Show when={isPending(a)}>` compiles to a memo of the bare probe. That
  // memo recomputes during the write's flush before the downstream async memo
  // pends, reads a's held value fresh, and the fresh-read pairing rule
  // (#2831) suppressed the verdict — the indicator never showed for the
  // whole flight even though an untracked isPending(a) read true.
  const tick = async () => {
    await new Promise(r => setTimeout(r, 0));
    flush();
  };

  function setup(when: (a: () => number) => boolean) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const [a, setA] = createSignal(0);
    const resolvers: Array<() => void> = [];
    const double = createMemo(async () => {
      const x = a();
      await new Promise<void>(r => resolvers.push(r));
      return x * 2;
    });
    const dispose = render(
      () => (
        <div>
          Count: {a()} {double()}
          <Show when={when(a)}>...</Show>
        </div>
      ),
      container
    );
    return {
      container,
      setA,
      resolveAll: () => resolvers.splice(0).forEach(r => r()),
      cleanup() {
        dispose();
        document.body.removeChild(container);
      }
    };
  }

  test("shows the pending indicator while the async memo refetches", async () => {
    const t = setup(a => isPending(a));
    flush();
    t.resolveAll();
    await tick();
    expect(t.container.textContent).toBe("Count: 0 0");

    t.setA(1);
    flush();
    // refetch in flight: stale view plus the pending indicator
    expect(t.container.textContent).toBe("Count: 0 0...");

    t.resolveAll();
    await tick();
    expect(t.container.textContent).toBe("Count: 1 2");
    t.cleanup();
  });

  test("variant B from the issue: when reads a() before isPending(a)", async () => {
    const t = setup(a => {
      a();
      return isPending(a);
    });
    flush();
    t.resolveAll();
    await tick();
    expect(t.container.textContent).toBe("Count: 0 0");

    t.setA(1);
    flush();
    expect(t.container.textContent).toBe("Count: 0 0...");

    t.resolveAll();
    await tick();
    expect(t.container.textContent).toBe("Count: 1 2");
    t.cleanup();
  });
});
