/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Unified-For driver SPIKE suite (DESIGN-UNIFIED-FOR.md).
 *
 * Three jobs:
 *   1. Semantics parity on the engaged path — the classic for.spec matrix
 *      (permutations, inserts, removes, clear/refill) must hold verbatim.
 *   2. Contract edges — fragment rows, multi-slot mode, duplicate-key and
 *      non-array DEMOTION to classic (correct rendering after demote).
 *   3. H1 — holds/transitions: an optimistic store's held update must not
 *      half-apply the slot (old DOM until reveal, optimistic writes visible
 *      in flight, revert restores committed).
 */
import { beforeEach, describe, expect, test } from "vitest";
import { createRoot, createSignal, createOptimisticStore, flush, For } from "solid-js";
// IMPORTANT: the packaged specifier, NOT ../src — compiled JSX resolves
// `@solidjs/web` to dist (browser+development), and arming the driver on a
// second from-source instance would leave the compiled inserts classic.
import { insert, enableUnifiedFor, __unifiedForStats } from "@solidjs/web";

enableUnifiedFor();

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe("unified For: engaged semantics parity", () => {
  let div!: HTMLDivElement, disposer: () => void;
  const n1 = "a",
    n2 = "b",
    n3 = "c",
    n4 = "d";
  const [list, setList] = createSignal([n1, n2, n3, n4]);
  const Component = () => (
    <div ref={div}>
      <For each={list()}>{item => item}</For>
    </div>
  );

  function apply(array: string[]) {
    setList(array);
    flush();
    expect(div.innerHTML).toBe(array.join(""));
    setList([n1, n2, n3, n4]);
    flush();
    expect(div.innerHTML).toBe("abcd");
  }

  test("creates and ENGAGES the driver", () => {
    const before = __unifiedForStats.engaged;
    createRoot(dispose => {
      disposer = dispose;
      <Component />;
    });
    flush();
    expect(div.innerHTML).toBe("abcd");
    expect(__unifiedForStats.engaged).toBe(before + 1);
  });

  test("1 missing", () => {
    apply([n2, n3, n4]);
    apply([n1, n3, n4]);
    apply([n1, n2, n4]);
    apply([n1, n2, n3]);
  });

  test("2 missing", () => {
    apply([n3, n4]);
    apply([n2, n4]);
    apply([n2, n3]);
    apply([n1, n4]);
    apply([n1, n3]);
    apply([n1, n2]);
  });

  test("3 missing", () => {
    apply([n1]);
    apply([n2]);
    apply([n3]);
    apply([n4]);
  });

  test("all missing + refill", () => {
    apply([]);
  });

  test("swaps", () => {
    apply([n2, n1, n3, n4]);
    apply([n3, n2, n1, n4]);
    apply([n4, n2, n3, n1]);
    apply([n1, n3, n2, n4]);
    apply([n1, n4, n3, n2]);
  });

  test("rotations and reverse", () => {
    apply([n2, n3, n4, n1]);
    apply([n4, n1, n2, n3]);
    apply([n4, n3, n2, n1]);
    apply([n3, n1, n4, n2]);
  });

  test("inserts", () => {
    apply([n1, "e", n2, n3, n4]);
    apply(["e", n1, n2, n3, n4]);
    apply([n1, n2, n3, n4, "e"]);
    apply(["e", n1, "f", n3, n4]);
  });

  test("dispose is inert: rows stop reacting, no crash", () => {
    disposer();
    flush();
    const html = div.innerHTML;
    setList(["z"]);
    flush();
    expect(div.innerHTML).toBe(html); // dead slot never mutates again
    setList([n1, n2, n3, n4]);
    flush();
  });
});

describe("unified For: element rows and moves preserve identity", () => {
  test("row DOM nodes survive reorders", () => {
    const a = { id: "a" },
      b = { id: "b" },
      c = { id: "c" };
    const [list, setList] = createSignal([a, b, c]);
    let div!: HTMLDivElement;
    createRoot(() => {
      <div ref={div}>
        <For each={list()}>{(item: any) => <span>{item.id}</span>}</For>
      </div>;
    });
    flush();
    expect(div.innerHTML).toBe("<span>a</span><span>b</span><span>c</span>");
    const [sa, sb, sc] = Array.from(div.children);
    setList([c, a, b]);
    flush();
    expect(div.innerHTML).toBe("<span>c</span><span>a</span><span>b</span>");
    // Same elements, moved — never rebuilt.
    expect(Array.from(div.children)).toEqual([sc, sa, sb]);
  });

  test("fragment rows (multi-root) move as a unit", () => {
    const a = { id: "a" },
      b = { id: "b" };
    const [list, setList] = createSignal([a, b]);
    let div!: HTMLDivElement;
    createRoot(() => {
      <div ref={div}>
        <For each={list()}>
          {(item: any) => (
            <>
              <b>{item.id}</b>
              <i>!</i>
            </>
          )}
        </For>
      </div>;
    });
    flush();
    expect(div.innerHTML).toBe("<b>a</b><i>!</i><b>b</b><i>!</i>");
    setList([b, a]);
    flush();
    expect(div.innerHTML).toBe("<b>b</b><i>!</i><b>a</b><i>!</i>");
  });

  test("multi-slot mode: list bounded by siblings", () => {
    const [list, setList] = createSignal(["x", "y"]);
    let div!: HTMLDivElement;
    createRoot(() => {
      <div ref={div}>
        <header>H</header>
        <For each={list()}>{item => <span>{item}</span>}</For>
        <footer>F</footer>
      </div>;
    });
    flush();
    expect(div.innerHTML).toBe("<header>H</header><span>x</span><span>y</span><footer>F</footer>");
    setList(["y", "x", "z"]);
    flush();
    expect(div.innerHTML).toBe(
      "<header>H</header><span>y</span><span>x</span><span>z</span><footer>F</footer>"
    );
    setList([]);
    flush();
    expect(div.innerHTML).toBe("<header>H</header><footer>F</footer>");
  });
});

describe("unified For: demotion to classic", () => {
  beforeEach(() => {
    __unifiedForStats.demoted = 0;
  });

  test("duplicate keys demote and still render correctly", () => {
    const [list, setList] = createSignal(["a", "b"]);
    let div!: HTMLDivElement;
    createRoot(() => {
      <div ref={div}>
        <For each={list()}>{item => <span>{item}</span>}</For>
      </div>;
    });
    flush();
    expect(div.innerHTML).toBe("<span>a</span><span>b</span>");
    setList(["a", "a", "b"]); // duplicate identity → driver demotes
    flush();
    expect(__unifiedForStats.demoted).toBe(1);
    expect(div.innerHTML).toBe("<span>a</span><span>a</span><span>b</span>");
    // Classic owns it from here on — still fully live.
    setList(["b", "a"]);
    flush();
    expect(div.innerHTML).toBe("<span>b</span><span>a</span>");
  });

  test("non-array subject demotes to classic single-value insert", () => {
    const [list, setList] = createSignal<any>(["a"]);
    let div!: HTMLDivElement;
    createRoot(() => {
      <div ref={div}>
        <For each={list()}>{(item: any) => <span>{item}</span>}</For>
      </div>;
    });
    flush();
    expect(div.innerHTML).toBe("<span>a</span>");
    setList("not-an-array" as any);
    flush();
    expect(__unifiedForStats.demoted).toBe(1);
  });
});

describe("unified For: H1 — holds and optimism", () => {
  test("held async update never half-applies; in-flight push holds with the flight", async () => {
    const container = document.createElement("div");
    let resolveTruth!: () => void;
    const gate = new Promise<void>(r => (resolveTruth = r));

    let push!: () => void;
    createRoot(() => {
      const [s, ss] = createOptimisticStore<{ id: string }[]>(
        async function* (draft) {
          yield [{ id: "a" }, { id: "b" }];
          await gate;
          yield [{ id: "c" }, { id: "d" }, { id: "e" }];
        },
        [{ id: "a" }, { id: "b" }]
      );
      push = () =>
        ss(draft => {
          draft.push({ id: "opt" });
        });
      insert(
        container,
        () => (<For each={s as any}>{(item: any) => <span>{item.id}</span>}</For>) as any
      );
    });
    flush();
    await sleep(10);
    expect(container.innerHTML).toBe("<span>a</span><span>b</span>");

    // Optimistic structural write DURING the store's own truth flight: the
    // bare write rides the FLIGHT'S transaction (#3146 declared ownership)
    // and holds with it — no flash, no half-applied frame. (Classic mapArray
    // behaves identically — pinned by the classic probe twin of this suite.)
    push();
    flush();
    await sleep(10);
    expect(container.innerHTML).toBe("<span>a</span><span>b</span>");

    // Truth lands: committed topology replaces both the old rows and the
    // optimistic row at the reveal — no intermediate half-applied frame.
    resolveTruth();
    await sleep(20);
    flush();
    expect(container.innerHTML).toBe("<span>c</span><span>d</span><span>e</span>");
  });
});

describe("unified For: batch clear engagement", () => {
  test("whole-parent N→0 rides textContent, not per-row removes", () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const [list, setList] = createSignal<any[]>(items);
    let div!: HTMLDivElement;
    createRoot(() => {
      <div ref={div}>
        <For each={list()}>{(item: any) => <span>{item.id}</span>}</For>
      </div>;
    });
    flush();
    expect(div.childNodes.length).toBe(100);
    const before = __unifiedForStats.batchCleared;
    setList([]);
    flush();
    expect(div.innerHTML).toBe("");
    expect(__unifiedForStats.batchCleared).toBe(before + 1);
  });
});

describe("unified For: keyed-fn mode (shallow idiom)", () => {
  test("engages, retains DOM by key across raw replacement, accessor updates bindings", () => {
    const before = __unifiedForStats.engaged;
    const [list, setList] = createSignal([
      { id: 1, label: "a" },
      { id: 2, label: "b" }
    ]);
    let div!: HTMLDivElement;
    createRoot(() => {
      <div ref={div}>
        <For each={list()} keyed={(r: any) => r.id}>
          {(row: any) => <span>{row().label}</span>}
        </For>
      </div>;
    });
    flush();
    expect(__unifiedForStats.engaged).toBe(before + 1);
    expect(div.innerHTML).toBe("<span>a</span><span>b</span>");
    const [s1, s2] = Array.from(div.children);
    // Raw replacement, same keys: rows RETAINED, bindings update via accessor.
    setList([
      { id: 1, label: "a2" },
      { id: 2, label: "b2" }
    ]);
    flush();
    expect(div.textContent).toBe("a2b2");
    expect(Array.from(div.children)).toEqual([s1, s2]); // same DOM
  });

  test("reorders move DOM by key", () => {
    const [list, setList] = createSignal([
      { id: 1, label: "a" },
      { id: 2, label: "b" },
      { id: 3, label: "c" }
    ]);
    let div!: HTMLDivElement;
    createRoot(() => {
      <div ref={div}>
        <For each={list()} keyed={(r: any) => r.id}>
          {(row: any) => <span>{row().label}</span>}
        </For>
      </div>;
    });
    flush();
    const [sa, sb, sc] = Array.from(div.children);
    setList([
      { id: 3, label: "c" },
      { id: 1, label: "a" },
      { id: 2, label: "b" }
    ]);
    flush();
    expect(div.textContent).toBe("cab");
    expect(Array.from(div.children)).toEqual([sc, sa, sb]); // moved, not rebuilt
  });

  test("adds and removes by key", () => {
    const [list, setList] = createSignal([{ id: 1, label: "a" }]);
    let div!: HTMLDivElement;
    createRoot(() => {
      <div ref={div}>
        <For each={list()} keyed={(r: any) => r.id}>
          {(row: any) => <span>{row().label}</span>}
        </For>
      </div>;
    });
    flush();
    setList([
      { id: 2, label: "b" },
      { id: 1, label: "a" },
      { id: 3, label: "c" }
    ]);
    flush();
    expect(div.textContent).toBe("bac");
    setList([{ id: 3, label: "c" }]);
    flush();
    expect(div.textContent).toBe("c");
  });

  test("duplicate keys demote to classic and still render", () => {
    const d0 = __unifiedForStats.demoted;
    const [list, setList] = createSignal([
      { id: 1, label: "a" },
      { id: 2, label: "b" }
    ]);
    let div!: HTMLDivElement;
    createRoot(() => {
      <div ref={div}>
        <For each={list()} keyed={(r: any) => r.id}>
          {(row: any) => <span>{row().label}</span>}
        </For>
      </div>;
    });
    flush();
    setList([
      { id: 1, label: "a" },
      { id: 1, label: "dup" },
      { id: 2, label: "b" }
    ]);
    flush();
    expect(__unifiedForStats.demoted).toBe(d0 + 1);
    expect(div.textContent).toBe("adupb");
  });
});
