# Board — a live data source and an optimistic store

A shared board: lists of cards that several people drag around at once. It
sits in the client-owned, persistent corner of the examples. The server owns
the truth and nothing else — no markup crosses the wire. Everything on screen
is rendered in the browser from one value that the server keeps sending.

Its twin will be [../chat](../chat): the other persistent app, with the
server owning the markup. That rebuild is still to come; today `chat` is an
earlier streaming demo. Its control is [../todos](../todos): the same optimistic store with
one user and a refetch where this has a stream.

```sh
pnpm dev                       # https://localhost:3011/  (self-signed cert)
HTTPS=0 pnpm dev               # http://localhost:3011/
pnpm build && pnpm start       # production harness, http://localhost:3011/
pnpm check                     # server checks, build, client-bundle check
```

Open it in **two tabs**. Each tab is its own person.

## What to look at

Start with `BOARD_SLOW=600 pnpm dev`. It delays every write on the server,
which makes the gap between "shown" and "confirmed" wide enough to see.

- **A card slides.** Drag a card to another list, or focus one and press
  Alt+arrows. It travels to its slot, and in the other tab the same card
  travels too. It is one element the whole time: set a property on the node
  in devtools, move the card, and the property is still there.
- **Instant, and never twice.** The card is in its new place when you let go,
  long before the server has answered. When the answer comes, nothing moves.
- **Two tabs agree.** Move things in both at once. They end up the same
  without a reload.
- **A refusal goes back.** A list holds eight cards, a rule only the server
  knows. Move a ninth in: it lands, then slides back, and the list says why.
  The other tab never saw it.
- **An edit survives a move.** Click a card's title and type half a word,
  then move that card from the other tab. The editor, the draft and the
  selection travel with it. Focus does not, today — see the notes.
- **Reconnect.** `CHAOS_EVERY=1500 pnpm dev` ends every live connection after
  a second and a half. The board does not flicker and writes still land.
- **Reload.** View source: the lists and cards are in the document. The
  browser adopts those elements rather than rendering them again.

## One value, held open

[src/board.tsx](./src/board.tsx) is the whole screen. `getBoard` is a `live`
server function: an answer the tab keeps open. Each time the board changes it
yields the whole board again.

```tsx
const getBoard = live(async function* (client: string | null): AsyncGenerator<Board> {
  "use server";
  yield* db.watchBoard(client, getRequestEvent()?.request.signal);
});

const [board, setBoard] = createOptimisticStore<Board>(() => getBoard(me()?.id ?? null), …);
```

The store reconciles each answer into what it already holds, row by row, by
`id`. A card that did not change is the same object afterwards, so nothing
about it re-renders. The board is flat, as it is stored — a card names its
list — and the columns are derived. Moving a card is one field write on one
row.

## A write, and how it is confirmed

The writes return nothing. What they did arrives on the stream, like
everything else.

```tsx
moveCard: action(function* (id, listId, pos) {
  const mutation = mintId();
  setBoard(b => {
    /* move the row, now */
  });
  yield moveCard(client.id, mutation, id, listId, pos);
  yield until(() => board.applied.includes(mutation), { timeout: CONFIRM_WITHIN });
});
```

`setBoard` inside an action is an optimistic write: it shows at once and
lasts as long as the action does. The action then holds until the board
itself says the write was applied. `applied` is part of the value: the ids of
this tab's recent writes that the board now reflects, stored by the same
commit that applied them, so a write's effect and its id always arrive
together. Inside an action, `until` reads the server's view and not the
tab's own guess, so the guess cannot confirm itself.

A create is simpler: the tab mints the row's id, and the row turning up is
the confirmation.

When the hold ends, the optimistic value is dropped onto data that already
agrees with it, and nothing moves. If the server refuses the write, or the
stream never carries it, there was only ever the overlay, and removing it is
the undo.

The hold is on the write having been applied, not on the card being where
this tab put it. If another tab moves the same card a moment later, this
write still landed, and the card settles wherever the board says.

## One element per card

```tsx
const cardViews = mapArray(
  () => board.cards,
  card => [card.id, <CardView card={card} />] as const
);
```

Card components are created once, at board level, and a list only references
the elements of the cards it holds. Moving a card to another list moves its
element and disposes nothing, so an open editor and its draft go with it.

That is also what the slide ([src/flip.ts](./src/flip.ts)) rests on. An
effect measures every card before the DOM changes and again after, and
animates the difference. There is one path for a drop, for another tab's
move, and for a refused write going back.

## The server

[src/server/db.ts](./src/server/db.ts) holds the board and its rules, behind
the `server-only` marker. Memory by default; `BOARD_STORAGE=fs` keeps it in
`.data/` across restarts. `pnpm check:server` exercises it with no UI.

Order is a fractional key ([src/order.ts](./src/order.ts)): a string that
sorts between its neighbours, so a move writes one row and never renumbers a
list. The browser computes the key for its optimistic write and the server
checks its shape.

Presence is connection-scoped: a tab is present while its `getPresence`
response is open.

## Notes

- **Focus is lost when an element moves.** The runtime moves a node by
  inserting it elsewhere, and the browser drops focus when it does. An open
  editor keeps its draft and selection through a move but has to be clicked
  again. Keyboard moves put focus back by hand, in one commented line in
  `CardView`.
- **Without JavaScript** the page is the server's render of the board,
  read-only. This is the client-owned corner.
- **Touch dragging** uses the same pointer events but has not been checked on
  a device. Dragging near an edge does not scroll the board.
- **In dev**, editing a source file reloads the server module and the
  in-memory board goes back to its seed.
- **HTTP/2.** A tab holds two live connections. Browsers allow six per origin
  over HTTP/1.1, so `pnpm dev` serves HTTPS, which Vite speaks as HTTP/2.
