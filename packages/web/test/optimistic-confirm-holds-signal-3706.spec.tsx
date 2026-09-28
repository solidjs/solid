/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #3706 playground port: two overlapping optimistic moves share a
 * transaction; confirming the first adopts the authoritative array on the
 * derived base store under the open hold. A later, independent `drag` write
 * must publish while the second move is still pending, even though a memo on
 * the page reads `drag() === cards[0].id` — a key the adoption left unchanged.
 * Signals-level pin: tests/adoption-unchanged-key-read-3706.test.ts.
 */
import { describe, expect, test } from "vitest";
import {
  action,
  createMemo,
  createOptimisticStore,
  createSignal,
  createStore,
  flush,
  isPending,
  latest
} from "solid-js";
import { render } from "../src/index.js";

type Card = { id: string; column: number };
const tick = () => new Promise<void>(r => setTimeout(r, 0));

function setup(opts: { memo: boolean; confirmFirst: boolean }) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let run!: () => Promise<void>;
  let confirmSecond!: () => void;
  let confirmFirst!: () => void;

  function App() {
    const [server, setServer] = createSignal<Card[]>(
      Array.from({ length: 2 }, (_, index) => ({ id: String(index), column: index }))
    );
    const [base] = createStore<Card[]>(() => server(), []);
    const [cards, setCards] = createOptimisticStore(base);
    const [drag, setDrag] = createSignal<string>();
    const condition = opts.memo ? createMemo(() => drag() === cards[0].id) : () => "off";

    const move = action(function* (id: string, column: number) {
      setCards(draft => {
        const card = draft.find(item => item.id === id)!;
        card.column = column;
      });
      yield new Promise<void>(resolve => {
        if (id === "0") confirmFirst = resolve;
        else confirmSecond = resolve;
      });
      setServer(rows => rows.map(row => (row.id === id ? { ...row, column } : row)));
    });

    run = async () => {
      const first = move("0", 1);
      void move("1", 2);
      if (opts.confirmFirst) {
        confirmFirst();
        await first;
      }
      await tick();
      setDrag("0");
    };

    return (
      <>
        <div id="cond">{String(condition())}</div>
        <pre id="out">
          drag: {drag() ?? "unset"}
          {"\n"}
          latest: {latest(drag) ?? "unset"}
          {"\n"}
          pending: {String(isPending(drag))}
        </pre>
      </>
    );
  }

  const dispose = render(() => <App />, container);
  flush();
  const out = () => container.querySelector("#out")!.textContent!.replace(/\s+/g, " ").trim();
  const cond = () => container.querySelector("#cond")!.textContent;
  const settle = () => {
    confirmFirst();
    confirmSecond();
  };
  return { run, out, cond, settle, dispose, container };
}

describe("#3706 confirming one overlapping optimistic action holds an independent signal write", () => {
  for (const memo of [true, false]) {
    for (const confirmFirst of [true, false]) {
      test(`memo=${memo} confirmFirst=${confirmFirst}`, async () => {
        const s = setup({ memo, confirmFirst });
        expect(s.out()).toBe("drag: unset latest: unset pending: false");
        await s.run();
        flush();
        await tick();
        flush();
        const afterWrite = s.out();
        const condAfterWrite = s.cond();
        s.settle();
        await tick();
        await tick();
        flush();
        const afterSettle = s.out();
        s.dispose();
        s.container.remove();
        expect({ afterWrite, condAfterWrite, afterSettle }).toEqual({
          afterWrite: "drag: 0 latest: 0 pending: false",
          condAfterWrite: memo ? "true" : "off",
          afterSettle: "drag: 0 latest: 0 pending: false"
        });
      });
    }
  }
});
