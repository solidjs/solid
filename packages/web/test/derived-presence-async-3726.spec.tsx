/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #3726 — the report's two playgrounds, verbatim in shape. The signals-side
// pins are `packages/signals/tests/store/derived-presence-async-3726.test.ts`.
import { describe, expect, test } from "vitest";
import {
  createMemo,
  createOptimisticStore,
  createSignal,
  createStore,
  For,
  Loading,
  Show
} from "solid-js";
import { render } from "../src/index.js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const microtasks = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("presence read on an async derived store (#3726)", () => {
  // A derived `createStore` whose first run returns a pending promise, read
  // by presence (`"length" in data`) inside `<Loading>`; a timer writes the
  // source (the derive lands synchronously) and resolves the superseded
  // promise in the same tick. The presence hole stayed blank while the
  // source hole outside the boundary updated.
  test("shows `present` after the source lands the derive synchronously", async () => {
    const div = document.createElement("div");
    const dispose = render(() => {
      const [ready, setReady] = createSignal<number[]>();
      const pending = new Promise<number[]>(resolve =>
        setTimeout(() => {
          setReady([1]);
          resolve([1]);
        }, 10)
      );
      const [data] = createStore(() => ready() ?? pending, []);
      return (
        <>
          <p>Source: {ready() ? "resolved" : "pending"}</p>
          <Loading fallback={<p>Loading…</p>}>
            <p>Presence: {"length" in data ? "present" : "missing"}</p>
          </Loading>
        </>
      );
    }, div);
    await microtasks();
    expect(div.innerHTML).toBe("<p>Source: pending</p><p>Loading…</p>");

    await sleep(30);
    await microtasks();
    expect(div.innerHTML).toBe("<p>Source: resolved</p><p>Presence: present</p>");
    dispose();
  });

  // GabbeV's board (issue comment): an async card source behind a memo, a
  // derived `createStore`, a `createOptimisticStore` over it and a keyed
  // `<For>`, remounted under a `<Loading>` that has already revealed; a
  // count outside the view. Before: after Activity → Board the count read
  // "All cards: 1" beside an empty lane — the remounted readers were parked
  // on the derive's first flight under the boundary's hold, and the held
  // synchronous landing never woke them (the case PR #3732 left open). On
  // L2 the revealed boundary holds the view switch (A29: a boundary already
  // showing content holds like any reader) and the lane reveals with its
  // card as one frame; the count and the list never disagree.
  test("a lane remounted under a revealed <Loading> fills beside the outside count", async () => {
    type Card = { id: string; title: string };
    const snapshot: Card[] = [{ id: "1", title: "Review the proposal" }];
    const div = document.createElement("div");
    let setView!: (v: "board" | "activity") => void;
    let mounts = 0;

    function CardList() {
      mounts++;
      const [ready, setReady] = createSignal<Card[]>();
      const pending = new Promise<Card[]>(resolve =>
        setTimeout(() => {
          setReady(snapshot);
          resolve(snapshot);
        }, 10)
      );
      const source = createMemo(() => ready() ?? pending);
      const [localCards] = createStore(() => source(), [] as Card[]);
      const [cards] = createOptimisticStore(localCards);
      return (
        <For each={cards} keyed={card => card.id}>
          {card => <article>{card().title}</article>}
        </For>
      );
    }

    function App() {
      const [view, set] = createSignal<"board" | "activity">("board");
      setView = set;
      const [allCards] = createSignal(snapshot);
      return (
        <main>
          <p>All cards: {allCards().length}</p>
          <section hidden={view() === "activity"}>
            <h2>To do</h2>
            <Loading fallback={<p>Loading lane…</p>}>
              {view() === "board" ? <CardList /> : null}
            </Loading>
          </section>
          <Show when={view() === "activity"}>
            <p>Activity view</p>
          </Show>
        </main>
      );
    }

    const board =
      "<main><p>All cards: 1</p><section><h2>To do</h2><article>Review the proposal</article></section></main>";
    const activity =
      '<main><p>All cards: 1</p><section hidden=""><h2>To do</h2></section><p>Activity view</p></main>';

    const dispose = render(() => <App />, div);
    await microtasks();
    expect(div.innerHTML).toBe(
      "<main><p>All cards: 1</p><section><h2>To do</h2><p>Loading lane…</p></section></main>"
    );
    await sleep(30);
    await microtasks();
    expect(div.innerHTML).toBe(board);
    expect(mounts).toBe(1);

    setView("activity");
    await microtasks();
    expect(div.innerHTML).toBe(activity);

    setView("board");
    await microtasks();
    // Held: the revealed boundary keeps its frame until the remounted lane's
    // flight lands — no fallback, no empty lane beside the count.
    expect(div.innerHTML).toBe(activity);
    expect(mounts).toBe(2);
    await sleep(30);
    await microtasks();
    expect(div.innerHTML).toBe(board);
    dispose();
  });
});
