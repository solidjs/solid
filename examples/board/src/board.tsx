// The board. Everything on screen is rendered here, in the browser, from one
// value: the server sends data and nothing else.
//
// `getBoard` is a live source — a standing answer this tab holds open. Each
// time the board changes it yields the whole board, and the store below
// reconciles that into what it already has, row by row, by id. A card that
// did not change is the same object afterwards, so nothing about it
// re-renders.
import { createMemo, createOptimisticStore, For, Loading, mapArray } from "solid-js";
import type { JSX } from "@solidjs/web";
import { getRequestEvent } from "@solidjs/web";
import { GET, live } from "@solidjs/web/server-functions";
import { useIdentity } from "~/identity";
import { byPos } from "~/order";
import * as db from "~/server/db";
import type { Board, Card, List } from "~/types";

// The document's render calls this with `null` (the server cannot know the
// tab) and the browser calls it again with the tab's id once it has one.
const getBoard = live(
  GET(async function* (client: string | null): AsyncGenerator<Board> {
    "use server";
    // The response's lifetime: aborted when its client goes away, which ends
    // the watcher now rather than at the board's next change.
    yield* db.watchBoard(client, getRequestEvent()?.request.signal);
  })
);

export default function BoardScreen() {
  const me = useIdentity();
  const [board] = createOptimisticStore<Board>(() => getBoard(me()?.id ?? null), {
    title: "",
    lists: [],
    cards: [],
    applied: []
  });

  // One component, and so one element, per card for as long as the card
  // exists — created here, at board level, not inside a list. A list only
  // references the elements of the cards it currently holds, so moving a
  // card to another list moves its element and disposes nothing.
  const cardViews = mapArray(
    () => board.cards,
    card => [card.id, <CardView card={card} />] as const
  );
  const cardElements = createMemo(() => new Map<string, JSX.Element>(cardViews()));

  // The board is flat, as it is stored; the nesting on screen is derived.
  const cardsOf = (list: List) => board.cards.filter(c => c.listId === list.id).sort(byPos);

  return (
    <div class="board">
      <Loading fallback={<p class="board-loading">Loading the board…</p>}>
        <header class="board-head">
          <h1>{board.title}</h1>
        </header>
        <main class="lists">
          <For each={[...board.lists].sort(byPos)}>
            {list => (
              <section class="list" data-list={list.id}>
                <h2 class="list-title">{list.title}</h2>
                <ol class="cards">
                  <For each={cardsOf(list)}>{card => <>{cardElements().get(card.id)}</>}</For>
                </ol>
              </section>
            )}
          </For>
        </main>
      </Loading>
    </div>
  );
}

function CardView(props: { card: Card }) {
  return (
    <li class="card" data-card={props.card.id}>
      <span class="card-title">{props.card.title}</span>
    </li>
  );
}
