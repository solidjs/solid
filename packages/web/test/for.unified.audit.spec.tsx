/** @jsxImportSource @solidjs/web */
/**
 * Unified For — external audit regressions (PR #3281, 2026-09-07). One test
 * per finding, each pinned against classic's behavior (arity-2 rows decline
 * the slot and run classic mapArray, so they serve as the in-test oracle).
 */
import { describe, expect, test, beforeEach } from "vitest";
import {
  createContext,
  createMemo,
  createRoot,
  createSignal,
  flush,
  onCleanup,
  useContext,
  DEV,
  For,
  Errored,
  Show
} from "solid-js";
import { referenceMapArray as refMapArray } from "./reference/mapArray.js";
const mapArray: (...a: any[]) => any = refMapArray as any;
import { mapArray as engineMapArray } from "solid-js";
import { insert, render } from "@solidjs/web";

const stats = () => DEV!.unifiedFor;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
beforeEach(() => {
  dispose?.();
  dispose = undefined;
  container = document.createElement("div");
});

describe("P1-1 rows live under For's CREATION owner (mapArray parity)", () => {
  test("context: rows see the creator's provider, not the inserter's", () => {
    const Ctx = createContext("none");
    const [items] = createSignal([1]);
    let slotSaw = "";
    let classicSaw = "";
    const Reader = (p: { list: any }) => (
      <Ctx value="inserter">
        <section>{p.list}</section>
      </Ctx>
    );
    const Creator = () => {
      // Eager creation in the creator scope; inserted later by Reader.
      const slot = (
        <For each={items()}>
          {i => {
            slotSaw = useContext(Ctx);
            return <span>{i}</span>;
          }}
        </For>
      );
      // Oracle: mapArray directly (every <For> engages the engine on web).
      const classic = mapArray(items, (i: number) => {
        classicSaw = useContext(Ctx);
        return <span>{i}</span>;
      });
      return (
        <>
          <Reader list={slot} />
          <Reader list={classic} />
        </>
      );
    };
    const engaged0 = stats().engaged;
    dispose = render(
      () => (
        <Ctx value="creator">
          <Creator />
        </Ctx>
      ),
      container
    );
    flush();
    expect(stats().engaged).toBe(engaged0 + 1);
    expect(classicSaw).toBe("creator");
    expect(slotSaw).toBe("creator");
  });

  test("row cleanups run when the inserting scope disposes (no leak until For's owner dies)", () => {
    const [items] = createSignal([1, 2]);
    const [show, setShow] = createSignal(true);
    let cleaned = 0;
    const Creator = () => {
      const list = (
        <For each={items()}>
          {i => {
            onCleanup(() => cleaned++);
            return <span>{i}</span>;
          }}
        </For>
      );
      return <Show when={show()}>{<section>{list}</section>}</Show>;
    };
    dispose = render(() => <Creator />, container);
    flush();
    expect(container.querySelectorAll("span").length).toBe(2);
    setShow(false);
    flush();
    expect(cleaned).toBe(2);
  });
});

describe("P1-2 dynamic rows: resolved by the slot, never demoted, never double-invoked", () => {
  test("component rows returning a conditional run ONCE each and stay engaged", () => {
    const [items, setItems] = createSignal([1, 2, 3]);
    let calls = 0;
    const [big, setBig] = createSignal(1);
    const Item = (p: { v: number }) => {
      calls++;
      return (
        <Show when={p.v > big()} fallback={<i>{p.v}</i>}>
          {<b>{p.v}</b>}
        </Show>
      );
    };
    const engaged0 = stats().engaged;
    dispose = render(
      () => (
        <div>
          <For each={items()}>{i => <Item v={i} />}</For>
        </div>
      ),
      container
    );
    flush();
    const div = container.firstChild as HTMLElement;
    expect(stats().engaged).toBe(engaged0 + 1);
    expect(calls).toBe(3);
    expect(div.innerHTML).toBe("<i>1</i><b>2</b><b>3</b>");
    // A row flips: only its range is spliced; siblings keep node identity.
    const b3 = div.children[2];
    setBig(2);
    flush();
    expect(div.innerHTML).toBe("<i>1</i><i>2</i><b>3</b>");
    expect(div.children[2]).toBe(b3);
    expect(calls).toBe(3);
    // Reorder + append with dynamic rows in play.
    setItems([3, 1, 2, 4]);
    flush();
    expect(div.innerHTML).toBe("<b>3</b><i>1</i><i>2</i><b>4</b>");
    expect(div.children[0]).toBe(b3);
    expect(calls).toBe(4);
  });

  test("a LATE dynamic row does not remount the surviving rows", () => {
    const [items, setItems] = createSignal<any[]>(["a", "b"]);
    dispose = render(
      () => (
        <div>
          <For each={items()}>{(r: any) => (typeof r === "function" ? r : <span>{r}</span>)}</For>
        </div>
      ),
      container
    );
    flush();
    const div = container.firstChild as HTMLElement;
    const [a, b] = Array.from(div.children);
    const dyn = () => <em>dyn</em>;
    setItems(["a", dyn, "b"]);
    flush();
    expect(div.innerHTML).toBe("<span>a</span><em>dyn</em><span>b</span>");
    expect(div.children[0]).toBe(a);
    expect(div.children[2]).toBe(b);
  });

  test("fragment rows with accessor leaves update text IN PLACE (.data write, node identity kept)", () => {
    const [n, setN] = createSignal(1);
    const [items] = createSignal(["x"]);
    dispose = render(
      () => (
        <div>
          <For each={items()}>
            {r => (
              <>
                <b>{r}</b>
                {n()}
              </>
            )}
          </For>
        </div>
      ),
      container
    );
    flush();
    const div = container.firstChild as HTMLElement;
    expect(div.innerHTML).toBe("<b>x</b>1");
    const text = div.childNodes[1];
    const bold = div.childNodes[0];
    setN(2);
    flush();
    expect(div.innerHTML).toBe("<b>x</b>2");
    expect(div.childNodes[1]).toBe(text);
    expect(div.childNodes[0]).toBe(bold);
  });

  test("dynamic row resolving to nothing renders ZERO nodes and keeps its position", () => {
    const [items, setItems] = createSignal(["a", "b"]);
    const [show, setShow] = createSignal(true);
    dispose = render(
      () => (
        <div>
          <For each={items()}>{r => <Show when={show()}>{<span>{r}</span>}</Show>}</For>
        </div>
      ),
      container
    );
    flush();
    const div = container.firstChild as HTMLElement;
    expect(div.innerHTML).toBe("<span>a</span><span>b</span>");
    setShow(false);
    flush();
    expect(div.innerHTML).toBe("");
    expect(div.childNodes.length).toBe(0); // classic parity: nothing rendered, no placeholders
    setItems(["b", "a"]);
    flush();
    setShow(true);
    flush();
    expect(div.innerHTML).toBe("<span>b</span><span>a</span>");
  });

  test("NotReady from a row's resolution keeps the built rows (one invocation, classic parity)", async () => {
    const [items] = createSignal([1, 2]);
    let calls = 0;
    const data = createMemo(async () => sleep(5).then(() => "ok"));
    const Item = (p: { v: number }) => {
      calls++;
      // The row's TOP LEVEL is a memo that reads the async value: the slot's
      // resolve throws NotReady; the rows themselves must survive the retry.
      return createMemo(() => (
        <b>
          {p.v}:{data()}
        </b>
      )) as any;
    };
    dispose = render(
      () => (
        <div>
          <For each={items()}>{i => <Item v={i} />}</For>
        </div>
      ),
      container
    );
    flush();
    await sleep(20);
    flush();
    const div = container.firstChild as HTMLElement;
    expect(Array.from(div.children).map(b => b.textContent)).toEqual(["1:ok", "2:ok"]);
    expect(calls).toBe(2);
  });
});

describe("P1-3 list end anchor is contiguous (classic's tail.nextSibling rule)", () => {
  test("appending after a foreign trailing node keeps the list contiguous", () => {
    const [items, setItems] = createSignal(["a", "b"]);
    dispose = render(
      () => (
        <div>
          <For each={items()}>{i => <span>{i}</span>}</For>
        </div>
      ),
      container
    );
    flush();
    const parent = container.firstChild as HTMLElement;
    parent.appendChild(document.createElement("hr"));
    setItems(["a", "b", "c"]);
    flush();
    expect(parent.innerHTML).toBe("<span>a</span><span>b</span><span>c</span><hr>");
    // Replace (no survivors) also stays before the foreign node.
    setItems(["x", "y"]);
    flush();
    expect(parent.innerHTML).toBe("<span>x</span><span>y</span><hr>");
    // Structural replace of a materialized chain too.
    setItems(["y", "x", "z"]);
    flush();
    expect(parent.innerHTML).toBe("<span>y</span><span>x</span><span>z</span><hr>");
    setItems(["q"]);
    flush();
    expect(parent.innerHTML).toBe("<span>q</span><hr>");
  });
});

describe("P1-4 removes are parent-guarded", () => {
  test("a row node the user migrated elsewhere is left alone", () => {
    const [items, setItems] = createSignal(["a", "b", "c"]);
    dispose = render(
      () => (
        <div>
          <For each={items()}>{i => <span>{i}</span>}</For>
        </div>
      ),
      container
    );
    flush();
    const parent = container.firstChild as HTMLElement;
    const other = document.createElement("aside");
    other.appendChild(parent.firstChild!); // migrate <span>a</span>
    setItems(["b", "c"]);
    flush();
    expect(other.innerHTML).toBe("<span>a</span>");
    expect(parent.innerHTML).toBe("<span>b</span><span>c</span>");
    // Chain mode as well (materialized by the partial op above).
    other.appendChild(parent.firstChild!); // migrate <span>b</span>
    setItems(["c"]);
    flush();
    expect(other.innerHTML).toBe("<span>a</span><span>b</span>");
    expect(parent.innerHTML).toBe("<span>c</span>");
  });
});

describe("P1-5 a throwing row disposes its own owner", () => {
  function throwScenario(classic: boolean) {
    const [items, setItems] = createSignal([1]);
    const cleanedRows: number[] = [];
    let caught = 0;
    const row = (i: number) => {
      onCleanup(() => cleanedRows.push(i));
      if (i === 2) throw new Error("row 2");
      return <span>{i}</span>;
    };
    dispose = render(
      () => (
        <Errored
          fallback={() => {
            caught++;
            return <p>err</p>;
          }}
        >
          <div>
            <For each={items()}>{classic ? (i, _idx) => row(i) : i => row(i)}</For>
          </div>
        </Errored>
      ),
      container
    );
    flush();
    expect(container.innerHTML).toBe("<div><span>1</span></div>");
    setItems([1, 2]);
    flush();
    expect(caught).toBe(1);
    return [...cleanedRows].sort();
  }

  test("cleanups registered before the throw run (row owner disposed on the throw path)", () => {
    const slot = throwScenario(false);
    expect(slot).toContain(2);
    dispose!();
    container = document.createElement("div");
    // Whatever the boundary does with the surviving row, the slot matches classic.
    const classic = throwScenario(true);
    expect(slot).toEqual(classic);
  });
});

// ─── Audit 2 (PR #3308, 2026-09-08) ────────────────────────────────────────

describe("#3308 P1-1 nested lists: row ownership survives reentrant builds", () => {
  test("removing an outer row disposes THAT row (and its nested list), nothing else", () => {
    type G = { id: string; items: string[] };
    const g1: G = { id: "g1", items: ["a", "b"] };
    const g2: G = { id: "g2", items: ["c"] };
    const [groups, setGroups] = createSignal<G[]>([g1, g2]);
    const cleaned: string[] = [];
    dispose = render(
      () => (
        <ul>
          <For each={groups()}>
            {g => {
              onCleanup(() => cleaned.push(`outer:${g.id}`));
              return (
                <li>
                  <For each={g.items}>
                    {item => {
                      onCleanup(() => cleaned.push(`inner:${g.id}:${item}`));
                      return <span>{item}</span>;
                    }}
                  </For>
                </li>
              );
            }}
          </For>
        </ul>
      ),
      container
    );
    flush();
    expect(container.textContent).toBe("abc");
    setGroups([g2]);
    flush();
    expect(container.textContent).toBe("c");
    // Exactly g1 and its nested rows were disposed — not g2's.
    expect(cleaned.sort()).toEqual(["inner:g1:a", "inner:g1:b", "outer:g1"]);
  });
});

describe("#3308 P1-2 key-fn semantics match mapArray", () => {
  test("no key fn calls during the fill; identity beats keys (in-place key mutation keeps the row)", () => {
    type It = { id: number; v: string };
    const a: It = { id: 1, v: "a" },
      b: It = { id: 2, v: "b" };
    const [list, setList] = createSignal<It[]>([a, b]);
    let eKeys = 0,
      oKeys = 0;
    const eKey = (x: It) => (eKeys++, x.id);
    const oKey = (x: It) => (oKeys++, x.id);
    const host = document.createElement("div");
    dispose = render(
      () => (
        <>
          <section id="e">
            <For each={list()} keyed={eKey}>
              {it => <span>{it().v}</span>}
            </For>
          </section>
          <section id="o">
            {mapArray(
              list,
              (it: () => It) => (
                <span>{it().v}</span>
              ),
              { keyed: oKey }
            )}
          </section>
        </>
      ),
      host
    );
    flush();
    const e = host.querySelector("#e")!,
      o = host.querySelector("#o")!;
    expect(eKeys).toBe(0); // the fill keys nothing (mapArray parity)
    expect(oKeys).toBe(0);
    const [ea] = Array.from(e.querySelectorAll("span"));
    // Same objects, one key mutated IN PLACE: identity matches first → the
    // row stays; no rebuild.
    a.id = 99;
    setList([a, b]);
    flush();
    expect(e.innerHTML).toBe(o.innerHTML);
    expect(e.querySelectorAll("span")[0]).toBe(ea);
  });
});

describe("#3308 P1-3 the engine dies with For's creation owner", () => {
  test("after the creation owner is disposed, source updates no longer touch the DOM (frozen, like mapArray)", () => {
    const [list, setList] = createSignal(["a", "b"]);
    let forAcc!: any;
    const disposeCreator = createRoot(d => {
      forAcc = <For each={list()}>{item => <span>{item}</span>}</For>;
      return d;
    });
    // Rendered under a DIFFERENT owner that outlives the creator.
    dispose = render(() => <div>{forAcc}</div>, container);
    flush();
    const div = container.firstChild as HTMLElement;
    expect(div.innerHTML).toBe("<span>a</span><span>b</span>");
    disposeCreator();
    setList(["c"]);
    flush();
    expect(div.innerHTML).toBe("<span>a</span><span>b</span>"); // frozen at the last value
  });
});

describe("#3308 P1-4 one engine per list: calling AND rendering an accessor", () => {
  test("called first (children-style) then rendered: rows built once, both views live", () => {
    const [list, setList] = createSignal(["a", "b"]);
    let calls = 0;
    let seen: any[] = [];
    dispose = render(() => {
      const acc = (
        <For each={list()}>
          {item => {
            calls++;
            return <span>{item}</span>;
          }}
        </For>
      ) as any;
      createMemo(() => (seen = acc())); // introspection
      return <div>{acc}</div>;
    }, container);
    flush();
    const div = container.firstChild as HTMLElement;
    expect(calls).toBe(2);
    expect(div.innerHTML).toBe("<span>a</span><span>b</span>");
    expect(seen.length).toBe(2);
    setList(["b", "c", "a"]);
    flush();
    expect(calls).toBe(3);
    expect(div.innerHTML).toBe("<span>b</span><span>c</span><span>a</span>");
    expect(seen.map((n: any) => n.textContent)).toEqual(["b", "c", "a"]);
  });

  test("rendered first then called: the call reads the rendered engine's array view", () => {
    const [list, setList] = createSignal(["a", "b"]);
    let calls = 0;
    let seen: any[] = [];
    let acc!: any;
    dispose = render(() => {
      acc = (
        <For each={list()}>
          {item => {
            calls++;
            return <span>{item}</span>;
          }}
        </For>
      ) as any;
      return <div>{acc}</div>;
    }, container);
    flush();
    const div = container.firstChild as HTMLElement;
    const stop = createRoot(d => {
      createMemo(() => (seen = acc()));
      return d;
    });
    flush();
    expect(calls).toBe(2);
    expect(seen.map((n: any) => n.textContent)).toEqual(["a", "b"]);
    setList(["c", "a"]);
    flush();
    expect(calls).toBe(3);
    expect(div.innerHTML).toBe("<span>c</span><span>a</span>");
    expect(seen.map((n: any) => n.textContent)).toEqual(["c", "a"]);
    stop();
  });
});

describe("#3308 P1-5 reclaim: OUR runtime moving a row's node (element shared with a <Show>)", () => {
  test("an element rendered in a row AND in a Show elsewhere returns to the list on the next structural pass", () => {
    // The Show turning on moves the element out of the row (insertExpression);
    // turning off detaches it (cleanup). The list must recover on its next
    // structural pass — classic does, through its liveness walk.
    const shared = document.createElement("b");
    shared.textContent = "S";
    const [list, setList] = createSignal<any[]>(["a", shared, "c"]);
    const [show, setShow] = createSignal(false);
    const row = (item: any) => (typeof item === "string" ? <span>{item}</span> : item);
    const host = document.createElement("div");
    dispose = render(
      () => (
        <>
          <section id="e">
            <For each={list()}>{row}</For>
          </section>
          <aside id="other">
            <Show when={show()}>{shared}</Show>
          </aside>
        </>
      ),
      host
    );
    flush();
    const e = host.querySelector("#e")!,
      other = host.querySelector("#other")!;
    expect(e.innerHTML).toBe("<span>a</span><b>S</b><span>c</span>");
    setShow(true); // OUR insert moves the shared element into the aside
    flush();
    expect(other.contains(shared)).toBe(true);
    expect(e.innerHTML).toBe("<span>a</span><span>c</span>");
    setShow(false); // Show's cleanup detaches it: the row now points at a detached node
    flush();
    expect(shared.parentNode).toBe(null);
    setList(["a", shared, "c", "d"]); // next structural pass reclaims it
    flush();
    expect(e.innerHTML).toBe("<span>a</span><b>S</b><span>c</span><span>d</span>");
  });
});

describe("#3308 P1-5 retained rows whose node migrated are reclaimed", () => {
  test("a middle row moved elsewhere by user code comes back on the next structural pass (classic parity)", () => {
    const [list, setList] = createSignal(["a", "b", "c"]);
    const host = document.createElement("div");
    dispose = render(
      () => (
        <>
          <section id="e">
            <For each={list()}>{item => <span>{item}</span>}</For>
          </section>
          <section id="o">
            {mapArray(list, (item: string) => (
              <span>{item}</span>
            ))}
          </section>
        </>
      ),
      host
    );
    flush();
    const e = host.querySelector("#e")!,
      o = host.querySelector("#o")!;
    const aside = document.createElement("aside");
    aside.appendChild(e.children[1]); // migrate the engine's <span>b</span>
    aside.appendChild(o.children[1]); // and the oracle's
    setList(["a", "b", "c", "d"]);
    flush();
    expect(e.innerHTML).toBe(o.innerHTML);
    expect(e.innerHTML).toBe("<span>a</span><span>b</span><span>c</span><span>d</span>");
    expect(aside.childNodes.length).toBe(0);
  });
});

describe("#3308 P1-6 insert contracts: host tagging and initial range", () => {
  test("a host-aware insert tags every placed row node with _$host", () => {
    const [list, setList] = createSignal(["a", "b"]);
    const hostNode = document.createElement("main");
    const parent = document.createElement("div");
    dispose = createRoot(d => {
      insert(
        parent,
        (<For each={list()}>{item => <span>{item}</span>}</For>) as any,
        undefined,
        undefined,
        {
          host: () => hostNode
        }
      );
      return d;
    });
    flush();
    for (const n of Array.from(parent.children)) expect((n as any)._$host).toBe(hostNode);
    setList(["a", "b", "c"]);
    flush();
    expect((parent.children[2] as any)._$host).toBe(hostNode);
  });

  test("a caller-provided initial range is consumed, not left beside the list", () => {
    const [list] = createSignal(["a"]);
    const parent = document.createElement("div");
    const stale = document.createElement("i");
    parent.appendChild(stale);
    dispose = createRoot(d => {
      insert(parent, (<For each={list()}>{item => <span>{item}</span>}</For>) as any, undefined, [
        stale
      ]);
      return d;
    });
    flush();
    expect(parent.innerHTML).toBe("<span>a</span>");
  });
});

describe("#3308 P2 fallback is called with zero arguments (mapArray parity)", () => {
  test("mapArray fallback sees arguments.length === 0", () => {
    const [list] = createSignal<string[]>([]);
    let argc = -1;
    dispose = render(() => {
      const m = engineMapArray(list, (x: string) => x, {
        fallback: function () {
          argc = arguments.length;
          return "none";
        }
      });
      createMemo(() => m());
      return null;
    }, container);
    flush();
    expect(argc).toBe(0);
  });
});

describe("P2-1 duplicate keys are rows (mapArray's chained pairing, no demotion)", () => {
  test("two fresh copies of one identity become two rows; removing one keeps the other", () => {
    const o1 = { id: 1 },
      o2 = { id: 2 },
      o3 = { id: 3 };
    const [items, setItems] = createSignal<any[]>([o1]);
    dispose = render(
      () => (
        <div>
          <For each={items()}>{(i: any) => <span>{i.id}</span>}</For>
        </div>
      ),
      container
    );
    flush();
    const parent = container.firstChild as HTMLElement;
    setItems([o1, o2, o3, o2]); // o2 twice, both fresh
    flush();
    expect(parent.innerHTML).toBe("<span>1</span><span>2</span><span>3</span><span>2</span>");
    const [e1, e2a, e3, e2b] = Array.from(parent.children);
    setItems([o3, o2, o1]);
    flush();
    expect(parent.innerHTML).toBe("<span>3</span><span>2</span><span>1</span>");
    expect(parent.children[0]).toBe(e3);
    expect(parent.children[1]).toBe(e2a); // first occurrence pairs with the first old row
    expect(parent.children[2]).toBe(e1);
    expect(parent.contains(e2b)).toBe(false);
  });
});
