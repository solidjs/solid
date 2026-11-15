/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
/**
 * #4874: two adds into one keyed optimistic store, each guessing a
 * placeholder row at the end. Both write the store's length, so their holds
 * are one (D-33): until both actions return, neither one's writes show.
 * When the first add's answer landed first, its truth row showed beside its
 * own placeholder (the keyed re-base appended it), and the card appeared
 * twice. The signals version is
 * packages/signals/tests/entangled-adds-truth-early-4874.test.ts.
 */
import { test, expect } from "vitest";
import { action, createSignal, createOptimisticStore, flush, For } from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
type Row = { id: number; title: string; adding?: boolean };

function setup() {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const take = (key: string) =>
    asks.splice(
      asks.findIndex(a => a.key === key),
      1
    )[0];
  const c = document.body.appendChild(document.createElement("div"));
  const [ans, setAns] = createSignal<Row[]>([{ id: 1, title: "W" }]);
  const [board, guess] = createOptimisticStore<Row[]>(() => ans().map(r => ({ ...r })), [], {
    key: "id"
  });
  const add = action(function* (key: number, title: string, at: number) {
    guess(b => {
      b[at] = { id: key, title, adding: true };
    });
    const r = yield ask(`add:${title}`);
    setAns(cs => [...cs, { id: r.id, title }]);
  });
  render(
    () => (
      <p>
        <For each={board}>
          {r => <span>{r.adding ? `${r.title}(adding) ` : `#${r.id} ${r.title} `}</span>}
        </For>
      </p>
    ),
    c
  );
  return { add, take, screen: () => c.textContent!.trim(), board };
}

for (const first of ["A1", "A2"])
  test(`#4874 two entangled adds, ${first} answered first: neither truth shows before both return`, async () => {
    const { add, take, screen, board } = setup();
    await tick();
    add(-1, "A1", board.length);
    await tick();
    add(-2, "A2", board.length);
    await tick();
    expect(screen()).toBe("#1 W A1(adding) A2(adding)");
    take(`add:${first}`).res({ id: first === "A1" ? 10 : 11 });
    await tick();
    expect(screen()).toBe("#1 W A1(adding) A2(adding)");
    const second = first === "A1" ? "A2" : "A1";
    take(`add:${second}`).res({ id: second === "A1" ? 10 : 11 });
    await tick();
    expect(screen()).toBe(first === "A1" ? "#1 W #10 A1 #11 A2" : "#1 W #11 A2 #10 A1");
  });
