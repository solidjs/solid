/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Time travel through the DOM: `openView` from `solid-js/attribution`, steps
// recorded from the attribution engine's `flush` record.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createMemo, createSignal, createStore, flush, For, Loading, Show } from "solid-js";
import { render } from "@solidjs/web";
import { createTimeTravel } from "./view-time-travel-recorder.js";

const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

const timeTravel = createTimeTravel();
let stop: () => void;
let dispose: (() => void) | undefined;
let root: HTMLDivElement;

beforeEach(() => {
  stop = timeTravel.record();
  root = document.createElement("div");
  document.body.appendChild(root);
});
afterEach(() => {
  timeTravel.reset();
  dispose?.();
  dispose = undefined;
  root.remove();
  flush();
  stop();
});

describe("time travel through the DOM", () => {
  test("a counter: the text shows each step; resume lands the present", () => {
    const [count, setCount] = createSignal(0, { name: "count" });
    const double = createMemo(() => count() * 2);
    dispose = render(
      () => (
        <p>
          {count()} × 2 = {double()}
        </p>
      ),
      root
    );
    flush();
    const p = root.querySelector("p")!;
    for (let i = 0; i < 3; i++) (setCount(c => c + 1), flush());
    expect(p.textContent).toBe("3 × 2 = 6");
    expect(timeTravel.steps().length).toBe(3);
    timeTravel.view(-1);
    expect(p.textContent).toBe("0 × 2 = 0");
    timeTravel.view(1);
    expect(p.textContent).toBe("2 × 2 = 4");
    expect(timeTravel.resume()).toBe(true);
    expect(p.textContent).toBe("3 × 2 = 6");
    // The text node is updated in place, never replaced.
    expect(root.querySelector("p")).toBe(p);
  });

  test("a <Show> flip: the earlier branch is mounted by a step and unmounted by moving back", () => {
    const [on, setOn] = createSignal(true, { name: "on" });
    const [n, setN] = createSignal(0, { name: "n" });
    dispose = render(
      () => (
        <Show when={on()} fallback={<p id="off">off {n()}</p>}>
          <p id="on">on {n()}</p>
        </Show>
      ),
      root
    );
    flush();
    setN(1);
    flush();
    setOn(false);
    flush();
    setN(2);
    flush();
    expect(root.textContent).toBe("off 2");
    const live = root.querySelector("#off");

    timeTravel.view(-1);
    expect(root.textContent).toBe("on 0");
    expect(root.querySelector("#off")).toBe(null);
    // A remount: the branch's elements are new ones.
    const viewed = root.querySelector("#on");
    timeTravel.view(0);
    expect(root.textContent).toBe("on 1");
    expect(root.querySelector("#on")).toBe(viewed);
    timeTravel.view(1);
    expect(root.textContent).toBe("off 1");
    expect(root.querySelector("#on")).toBe(null);
    expect(root.querySelector("#off")).not.toBe(live);
    timeTravel.view(0);
    // The live program flips back beneath the view and moves on.
    setOn(true);
    setN(7);
    flush();
    expect(root.textContent).toBe("on 1");
    expect(timeTravel.resume()).toBe(true);
    expect(root.textContent).toBe("on 7");
    expect(root.querySelectorAll("p").length).toBe(1);
  });

  test("a keyed <For> over a store: rows added since are gone while viewing; rows keep their elements", () => {
    const [state, setState] = createStore({
      rows: [
        { id: 1, text: "a" },
        { id: 2, text: "b" }
      ]
    });
    const total = createMemo(() => state.rows.length);
    dispose = render(
      () => (
        <ul data-total={total()}>
          <For each={state.rows} keyed={(r: { id: number }) => r.id}>
            {row => <li>{row().text}</li>}
          </For>
        </ul>
      ),
      root
    );
    flush();
    const [a, b] = root.querySelectorAll("li");
    setState(s => {
      s.rows.push({ id: 3, text: "c" });
    });
    flush();
    setState(s => {
      s.rows[0].text = "A";
    });
    flush();
    expect(root.textContent).toBe("Abc");

    timeTravel.view(-1);
    expect(root.textContent).toBe("ab");
    expect([...root.querySelectorAll("li")]).toEqual([a, b]);
    expect(root.querySelector("ul")!.getAttribute("data-total")).toBe("2");
    timeTravel.view(0);
    expect(root.textContent).toBe("abc");
    const c = root.querySelectorAll("li")[2];
    timeTravel.view(1);
    expect(root.textContent).toBe("Abc");
    expect(timeTravel.resume()).toBe(true);
    expect(root.textContent).toBe("Abc");
    expect([...root.querySelectorAll("li")].slice(0, 2)).toEqual([a, b]);
    // Row 3 mounted while viewing step 0 and kept its element through the landing.
    expect(root.querySelectorAll("li")[2]).toBe(c);
  });

  test("known gap: a keyed <For> reads the list's items from the store's backing, so a reorder does not rewind", () => {
    const [state, setState] = createStore({ rows: [{ id: 1 }, { id: 2 }] });
    dispose = render(
      () => (
        <ul>
          <For each={state.rows} keyed={(r: { id: number }) => r.id}>
            {row => <li>{row().id}</li>}
          </For>
        </ul>
      ),
      root
    );
    flush();
    setState(s => {
      s.rows.push({ id: 3 });
    });
    flush();
    setState(s => {
      s.rows.reverse();
    });
    flush();
    expect(root.textContent).toBe("321");
    timeTravel.view(-1);
    // The length rewinds (2); the items are the present's first two.
    expect(root.textContent).toBe("32");
    timeTravel.resume();
    expect(root.textContent).toBe("321");
  });

  test("live writes while viewing do not touch the DOM until resume", () => {
    const [count, setCount] = createSignal(0, { name: "count" });
    const [label, setLabel] = createSignal("x", { name: "label" });
    dispose = render(
      () => (
        <p>
          {label()}:{count()}
        </p>
      ),
      root
    );
    flush();
    setCount(1);
    flush();
    timeTravel.view(-1);
    const observer = new MutationObserver(() => {});
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    setCount(5);
    setLabel("y");
    flush();
    setCount(6);
    flush();
    expect(observer.takeRecords()).toEqual([]);
    expect(root.textContent).toBe("x:0");
    timeTravel.resume();
    expect(observer.takeRecords().length).toBeGreaterThan(0);
    expect(root.textContent).toBe("y:6");
    observer.disconnect();
  });

  test("an async memo under <Loading>: no refetch and no fallback while viewing", async () => {
    const [id, setId] = createSignal(1, { name: "id" });
    let fetches = 0;
    const user = createMemo(async () => {
      const i = id();
      fetches++;
      await tick(10);
      return "user" + i;
    });
    dispose = render(
      () => (
        <Loading fallback={<p id="loading">loading</p>}>
          <p id="user">{user()}</p>
        </Loading>
      ),
      root
    );
    flush();
    await tick(30);
    flush();
    setId(2);
    flush();
    await tick(30);
    flush();
    expect(root.textContent).toBe("user2");
    expect(fetches).toBe(2);

    // The last step is the refetch; the one before it, the boundary showing
    // its content in place of the fallback.
    const before = timeTravel.steps().length - 2;
    timeTravel.view(before);
    expect(root.textContent).toBe("user1");
    await tick(30);
    flush();
    timeTravel.view(before + 1);
    expect(root.textContent).toBe("user2");
    timeTravel.view(before);
    await tick(30);
    flush();
    expect(root.textContent).toBe("user1");
    expect(root.querySelector("#loading")).toBe(null);
    expect(fetches).toBe(2);
    expect(timeTravel.resume()).toBe(true);
    expect(root.textContent).toBe("user2");
    await tick(30);
    flush();
    expect(fetches).toBe(2);
  });

  test("branch: the page continues from the viewed step", () => {
    const [count, setCount] = createSignal(0, { name: "count" });
    dispose = render(() => <button>{count()}</button>, root);
    flush();
    const button = root.querySelector("button")!;
    for (let i = 0; i < 3; i++) (setCount(c => c + 1), flush());
    timeTravel.view(0);
    expect(button.textContent).toBe("1");
    setCount(50);
    flush();
    timeTravel.branch();
    expect(button.textContent).toBe("1");
    setCount(c => c + 1);
    flush();
    expect(button.textContent).toBe("2");
    expect(timeTravel.steps().length).toBe(2);
  });
});
