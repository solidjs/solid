/** @jsxImportSource solid-js */
/**
 * Unified For — external audit regressions (PR #3281, 2026-09-07). One test
 * per finding, each pinned against classic's behavior (arity-2 rows decline
 * the slot and run classic mapArray, so they serve as the in-test oracle).
 */
import { describe, expect, test, beforeEach } from "vitest";
import {
  createContext,
  createMemo,
  createSignal,
  flush,
  onCleanup,
  useContext,
  DEV,
  For,
  Errored,
  Show
} from "solid-js";
import { render } from "@solidjs/web";

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
      const classic = (
        <For each={items()}>
          {(i, _idx) => {
            classicSaw = useContext(Ctx);
            return <span>{i}</span>;
          }}
        </For>
      );
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
    const demoted0 = stats().demoted;
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
    expect(stats().demoted).toBe(demoted0);
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
    expect(stats().demoted).toBe(demoted0);
  });

  test("a LATE dynamic row does not remount the surviving rows", () => {
    const [items, setItems] = createSignal<any[]>(["a", "b"]);
    const demoted0 = stats().demoted;
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
    expect(stats().demoted).toBe(demoted0);
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

  test("dynamic row resolving to nothing holds its position with a placeholder", () => {
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
    expect(div.childNodes.length).toBe(2); // two empty text placeholders
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

describe("P2-1 duplicate FRESH keys are caught (no key→row map corruption)", () => {
  test("two fresh copies of one identity demote to classic (which owns duplicates)", () => {
    const o1 = { id: 1 },
      o2 = { id: 2 },
      o3 = { id: 3 };
    const [items, setItems] = createSignal<any[]>([o1]);
    const demoted0 = stats().demoted;
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
    expect(stats().demoted).toBe(demoted0 + 1);
    setItems([o3, o2, o1]);
    flush();
    expect(parent.innerHTML).toBe("<span>3</span><span>2</span><span>1</span>");
  });
});
