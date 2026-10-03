/**
 * Gabriel's kanban (GabbeV/solid-kanban, `board/cards.tsx`; Discord,
 * 2026-10-02; plan §27.2, §31 Q-C, §39) — the A17 fixture for stores.
 *
 * The shape: a plain store holds the board's truth; an optimistic view is
 * chained over it. A move writes the plain truth at the start (an error
 * flag reset — a held write, the action's transaction) AND shadows it
 * optimistically on the view; then it awaits the server. Mid-move a drag
 * ghost mounts and reads the view's flag through a `<Show>`-shaped memo,
 * beside an unrelated `dragging` signal.
 *
 * A17: a reader of an OVERRIDDEN leaf sees the guess now and never joins
 * the hold on the truth staged beneath it. On `next` the store layer
 * joined the ghost to the move's hold — `dragging` was held with it and the
 * ghost showed nothing until the move landed. Here: the ghost shows at
 * once, `dragging` writes show at once, and the landing changes nothing.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
  latest
} from "../../src/index.js";

const tick = () => new Promise<void>(r => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await tick();
    flush();
  }
};

type Card = { id: string; column: number };
type Board = { error: string | null; cards: Card[] };

function board() {
  const [base, setBase] = createStore<Board>({
    error: "stale error",
    cards: [
      { id: "a", column: 0 },
      { id: "b", column: 1 }
    ]
  });
  const [view, setView] = createOptimisticStore<Board>(base);
  const [dragging, setDragging] = createSignal<string | null>(null);
  const log: string[] = [];
  createRoot(() => {
    createRenderEffect(
      () => `error=${view.error ?? "none"} a@${view.cards[0].column}`,
      v => void log.push(v)
    );
  });
  flush();
  let release!: () => void;
  const move = action(function* (id: string, column: number) {
    // The plain truth first (the held write), the optimistic shadow beside it.
    setBase(d => {
      d.error = null;
    });
    setView(d => {
      d.error = null;
      d.cards.find(c => c.id === id)!.column = column;
    });
    yield new Promise<void>(r => (release = r));
    setBase(d => {
      d.cards.find(c => c.id === id)!.column = column;
    });
  });
  return { base, view, setView, dragging, setDragging, log, move, release: () => release() };
}

describe("A17 for stores — Gabriel's kanban: a new reader of an overridden leaf shows now, joins nothing", () => {
  it("the pre-existing reader shows the guess at the move's flush", async () => {
    const b = board();
    expect(b.log).toEqual(["error=stale error a@0"]);
    const done = b.move("a", 1);
    flush();
    expect(b.log.at(-1)).toBe("error=none a@1");
    expect(b.view.error).toBe(null); // untracked: the guess
    expect(b.base.error).toBe("stale error"); // the plain truth is held under the move
    b.release();
    await done;
    await settle();
    expect(b.log.at(-1)).toBe("error=none a@1");
    expect(b.base.error).toBe(null);
  });

  it("a drag ghost mounted mid-move shows the guess now, and an unrelated signal write shows with it", async () => {
    const b = board();
    const done = b.move("a", 1);
    flush();

    // The ghost: a `<Show>`-shaped memo over the overridden flag, beside the
    // drag state. Mounted mid-move, in its own root.
    const ghost: string[] = [];
    createRoot(() => {
      const show = createMemo(() => (b.view.error === null ? "ghost" : "(none)"));
      createRenderEffect(
        () => `drag=${b.dragging() ?? "no"} ${show()}`,
        v => void ghost.push(v)
      );
    });
    flush();
    expect(ghost).toEqual(["drag=no ghost"]); // shows now — not held to the landing

    // An unrelated write while the move is in flight: not entangled with it.
    b.setDragging("a");
    flush();
    expect(ghost.at(-1)).toBe("drag=a ghost");
    expect(isPending(() => b.dragging())).toBe(false);

    b.release();
    await done;
    await settle();
    // The landing confirms the guess: nothing moves.
    expect(ghost.at(-1)).toBe("drag=a ghost");
    expect(ghost.length).toBe(2);
    expect(b.view.error).toBe(null);
    expect(b.base.error).toBe(null);
  });

  it("latest() and isPending() on the overridden leaf read the guess, not the held truth beneath", async () => {
    const b = board();
    const done = b.move("a", 1);
    flush();
    expect(latest(() => b.view.error)).toBe(null);
    // The guess equals the truth the move staged beneath it: final (A24).
    expect(isPending(() => b.view.error)).toBe(false);
    b.release();
    await done;
    await settle();
    expect(isPending(() => b.view.error)).toBe(false);
  });
});
