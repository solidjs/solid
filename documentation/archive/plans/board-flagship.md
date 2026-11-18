# `board` flagship — the top-right corner as a product

_Drafted 2026-10-12. Handoff item 2 of
[`examples-grid-plan.md`](./examples-grid-plan.md), taken first by decision
(2026-10-12): the top-right corner has no app at all, and this one settles
the live-plus-optimistic vocabulary `chat`'s composer reuses. Not built. The
grid plan's bar and authoring layout apply unchanged and are not restated.
Design record: principles §9.5 (the `live` transport, data face), §9.6 (A)
(the feed echo), §10 (fit; this is Q4 over Q2's transport — a widget whose
truth other people change). Owner: Ryan._

_Status 2026-10-12: built through step 8, in the PR that adds this file.
Open against the acceptance moments: moment 2's focus half waits on the
runtime (B2, #3997); touch dragging and edge scrolling are unchecked, as are
Firefox and Safari; B6 was checked with `CHAOS_EVERY=1500` (no board
mutations on reconnect; the people list does re-render, since presence is
per connection). Departures from this plan as written: the rules live in
`db.ts`; the slide's effect reads a memo, not the rows (reading the rows
directly hit a runtime flush loop, reduced separately); keyboard moves
restore focus in one line; a `BOARD_SLOW` dev knob was added; refusals
answer 409._

## Objective

A shared board: lists of cards that several people drag around at once. The
server owns the truth and nothing else — no markup crosses the wire. The
board is one `live` data source, reconciled by id into an optimistic store;
every write is an action that shows its result now and holds with `until`
for the stream to carry it; a rejected write reverts by itself. Everything
on screen is client-rendered and client-owned: the drag, the drop, the
inline editor, the slide.

`chat` is the twin: the same primitives with the server owning the markup.
`todos` is the control: the same optimistic store with one user and a
refetch instead of a stream.

The point the example exists to make is identity. A card is one element for
as long as the card exists, wherever it is and whoever moved it. That is
what lets it slide instead of blink, and what lets a card keep its editor
open while someone else moves it.

## What exists today

- **`examples/room` `/live`** — the proof of the loop. `transcript` is
  `live(GET(async function*))` yielding the whole value on every change;
  the page reads it with `createOptimisticStore(() => wire.watch(transcript(room)), …)`;
  `post` is an action that pushes the row with an id the client minted,
  calls `send`, then `yield until(() => store.messages.some(m => m.id === id), { timeout })`.
  Presence is a second live source that joins in the generator and leaves in
  its `finally`. Identity is per tab (`sessionStorage`), null on the server.
  Proven there and carried over: the document renders first value and the
  client takes over once; a reconnect re-yields a fresh object that
  reconciles by id to no DOM change; a rejected or unechoed write reverts.
- **`examples/todos`** — the optimistic store over a nested-enough shape,
  per-item errors beneath the overlay, bulk writes. One user, `refresh`.
- **`examples/migrating-element`** — one DOM node referenced from several
  JSX positions migrates with a single `insertBefore` instead of being
  re-created. Its README lists focus as surviving "when the move is
  atomic"; the runtime does not use `moveBefore()` today (V5 is open).
- **Nothing** does a flat-to-nested read, drag, ordering, or a write that
  two tabs can race.

## The app

One board at `/`. No router: there is nowhere to navigate, and the bar's
"navigation" responsibility is honestly empty here (D1).

- **Header.** The board's title, who is here (one mark per open tab, this
  tab's own marked), and a quiet "Reconnecting…" line from the board
  source's `onstatus` when the wire is down.
- **Lists**, left to right. Each: its title (click to rename), its cards in
  order, an "Add a card" field at the foot, and an archive button. After
  the last list, "Add a list".
- **Cards.** A title. Click to edit in place; Enter commits, Escape
  abandons. An archive button on hover and focus.
- **Drag.** Pointer events with pointer capture, mouse and touch alike. A
  card follows the pointer; a gap opens where it would land, in any list.
  Lists drag by their header to reorder. Escape cancels. A drop is a write;
  a drag that never drops writes nothing.
- **Keyboard.** A focused card moves with Alt+arrows: up and down within
  its list, left and right to the neighbouring list. Same action as a drop.
  This is how the app is usable without a pointer, and how moment 2 is
  demonstrated on one machine.

Every write is optimistic: create, rename, move, reorder, archive, for
cards and lists. None blocks the next; actions run concurrently.

Without JavaScript the page is the server's first render of the board,
read-only. This is the client-owned corner; the README says so.

**Out of scope.** Accounts (identity is per tab, as `room`), several boards,
card detail (description, labels, due dates, members, comments), undo,
un-archive, search, offline writes. Presence is who is here; who is
dragging or editing what is §9.6 (C)'s territory and stays out (D5).

## Acceptance moments

The bar names these so they get built; each is checked by hand in the
browser before the PR and listed in the README's "What to look at". The
first two are the identity moments the grid plan requires by name.

1. **A card slides into its new column.** Drop a card in another list: it
   travels from the pointer to its slot. In a second tab the same card
   slides from the old list to the new one. In both, it is the same element
   before and after — checked with a property set on the node in devtools
   that is still there afterwards. Never a remove-and-insert.
2. **An edit survives someone else's move.** In tab A, open a card's editor
   and type half a title, caret mid-word. In tab B, move that card to
   another list. In tab A the card slides to the new column with the editor
   still open, still focused, the caret where it was and the draft intact;
   the next keystroke lands in it. _Waiting on the runtime (B2, measured
   2026-10-12): the editor, draft and selection survive today; focus does
   not. Not a blocker for the rest of the build._
3. **Two tabs converge.** Interleaved moves from two tabs end in the same
   order in both, with no reload. Two cards dropped into the same gap at
   once both appear, in the same order in both tabs.
4. **A rejected move goes back.** Move a card into a list that is already
   full (D4): it lands, then slides back to where it was, and the reason
   appears beside the list. The other tab sees nothing. Same for a move
   into a list another tab archived mid-drag.
5. **Instant, and never twice.** The card is in its new slot in the same
   frame as the drop. When the stream confirms, nothing moves: the overlay
   drops onto data that already agrees. A created card is one element from
   the keystroke that made it to the row the server echoes (B3).
6. **Reconnect.** With `CHAOS_EVERY` set, nothing flashes and nothing
   moves; a drag in progress continues; an open editor keeps focus; a
   write in flight when the wire dies still settles on the reconnected
   stream.
7. **Reload.** View source shows the board's lists and cards. After
   hydration the same elements are adopted and the board is live; with
   `BOARD_STORAGE=fs`, after a server restart too.
8. **The bundle.** The client build has no `unstorage` and no board state
   module. A `check` script greps `dist/client`, as `hackernews`' does.

## Architecture

### Durable state — `src/server/db.ts`

`import "server-only"`, unstorage as in `notes`: memory by default,
`BOARD_STORAGE=fs` for a `.data/` file driver. Flat, as it would be in a
database:

```ts
interface List { id: string; title: string; pos: string }
interface Card { id: string; listId: string; title: string; pos: string }
interface Board { title: string; lists: List[]; cards: Card[]; applied: string[] }
```

Archived rows leave the value (kept in storage with a flag; nothing reads
them back). Ids are minted by the client that creates the row, as `room`'s
message ids are: the optimistic row and the echoed row are the same row,
and a retried create of a row that landed is a no-op.

`applied` is the acknowledgement (D2). Every write to an existing row
carries a mutation id its client minted; the commit that applies the write
stores that id against the client, in the same commit, keeping each
client's last 32. `watchBoard(client, signal)` is `room`'s watcher — the
whole board now and after every commit, racing the request's abort — with
`applied` filled in for the client the connection named, and empty for the
document's render, which has no client yet. Every yield is the complete
current state, so a reconnect starts from one yield, and because the ids
are stored with the board any instance can answer it. It is a list and not
a counter because concurrent actions are parallel requests: they can
commit out of order, and "everything up to 5" would release 4 early.

A seed board on first run (three lists, a handful of cards) so the first
thing a visitor can do is drag.

### Ordering — `src/order.ts`

`pos` is a fractional key: a string that sorts between its neighbours, so a
move writes one row and never renumbers a list. `between(a?, b?)` is about
thirty lines and is shared code: the client computes the key for its
optimistic write, the server validates its shape and stores it. Two tabs
dropping into one gap mint the same key; order is `pos` then `id`, so both
tabs agree (moment 3). Hand-written here rather than a dependency (D3).

### Presence — `src/server/presence.ts`

`import "server-only"`. `room`'s `join` / `watchMembers`, unchanged: a
module-level map, an entry per connection, removed in the generator's
`finally`. Connection-scoped memory, fine to lose (§9.6).

### The board screen — `src/board.tsx`

One screen, one file. Module-private, in this order:

- **Sources.** `getBoard = live(GET(async function* (client: string | null) { "use server"; … }))`
  over `db.watchBoard`, and `getPresence` over `presence.watchMembers`,
  joining with the tab's identity as `room` does. Both are called with
  `null` by the document's render and again with the tab's identity once
  it is minted.
- **Mutations.** Plain `"use server"` functions, one line each over `db`:
  `createList`, `createCard`, `renameBoard`, `renameList`, `renameCard`,
  `moveList`, `moveCard`, `archiveList`, `archiveCard`. Each returns
  nothing: the result arrives on the board's stream. The rules live in
  `db.ts`, where a script can check them without a UI: input validation,
  a repeat of an applied mutation id being a no-op, and the one the client
  does not pre-check — a list holds at most 8 cards (D4). A refusal is
  thrown with a server-worded message and marked safe to send
  (`markSafeError`), so it reads the same in a production build.
- **The store.**

  ```ts
  const [board, setBoard] = createOptimisticStore<Board>(
    () => wire.watch(getBoard(me()?.id ?? null)),
    { title: "", lists: [], cards: [], applied: [] }
  );
  ```

  Reconciled by `id`, the default. Flat on purpose. A move is one field write on one card
  (`card.listId = to; card.pos = pos`), the card's store object is the
  same object before and after, and nothing has to be spliced out of one
  array and into another. The nesting the screen shows is derived:
  `cardsOf(listId)` is a memo that filters and sorts.
- **The actions.** Two shapes. A write to a row that exists holds for its
  mutation id:

  ```ts
  const moveCard = action(function* (id: string, to: string, pos: string) {
    const mid = mintId();
    setBoard(b => {
      const card = b.cards.find(c => c.id === id)!;
      card.listId = to;
      card.pos = pos;
    });
    yield server.moveCard(me()!.id, mid, id, to, pos);
    yield until(() => board.applied.includes(mid), { timeout: 10_000 });
  });
  ```

  A create holds for the row it made, as `room`'s post does — the row's
  own id is the acknowledgement:
  `yield until(() => board.cards.some(c => c.id === id), …)`.

  The hold is on the board saying this write was applied, not on the card
  being where this tab put it: if another tab moved the same card a moment
  later, the write still landed, and the card should settle where the
  board says it is. A throw — a rejection, or no echo in time — reverts
  the overlay and is caught at the call site into the one error line of
  the list it concerned, cleared by the next write there (§9.6 (A)).
- **Identity.** Card components are created once per card at board level
  and referenced from whichever list holds them:

  ```tsx
  const cardEls = mapArray(() => board.cards, card => <CardView card={card} … />);
  // in a list:
  <For each={cardsOf(list.id)}>{card => elementOf(card.id)}</For>
  ```

  A card's scope — its editor's `<Show>`, its draft signal, its ref —
  belongs to the board, not to a list, so a move disposes nothing. The DOM
  node is referenced from a new position and migrates (B1). Lists get the
  same treatment for reorder.
- **The slide.** A small `flip` helper: each card keeps its last laid-out
  rect; after a flush that changed its `listId` or `pos`, it animates from
  the old rect (or from the pointer, after a drop) to the new one with the
  Web Animations API on `transform`. One code path for a local drop, a
  remote move, and a revert — which is why a rejected move visibly goes
  back (moment 4) without code of its own. Respects
  `prefers-reduced-motion`.

### Drag — `src/drag.ts`

Client-only, no framework surface: pointer capture on the grabbed element, a
signal for the drag (`id`, pointer offset, target list and index), hit
testing against list and card rects measured at drag start and on scroll.
The dragged card keeps its place in the store until the drop; while
dragging it is lifted with `transform` and the target list renders a gap.
Drag state is not optimistic state: it is not a write until the pointer
comes up.

### Files

```text
src/
  app.tsx  board.tsx  drag.ts  order.ts  identity.tsx  types.ts
  server-config.ts  Document.tsx  app.css
  server/   db.ts  presence.ts        (each: import "server-only")
```

`identity.tsx` is `room`'s. `server-config.ts` keeps the `CHAOS_EVERY`
knob. HTTP/2 in dev via `@vitejs/plugin-basic-ssl`, as `room`: two live
connections per tab.

## What this takes from `room`, and what loses its example

- **From `room` `/live`:** absorbed — live data source into an optimistic
  store, `until` on the echo, presence by connection, takeover, reconnect.
  `room` is deleted when both flagships exist (grid plan, Handoff 3).
- **Mechanisms left without an example, flagged:** a nested-async live
  answer (`roomCard`: a promise and a bounded stream inside one live
  object), an undeclared stream dying into `<Errored>` (`summary`), and a
  slow plain read beside live sources in the shell (`archive`, #3764 /
  #3819). None has a natural home on a board. Each is evidence for
  principles §10.5, not a feature to add back here; their specs stay.

## Verification items (gate the build)

- **B1 — One node, two `<For>`s.** A node returned from list A's `<For>`
  and, after one store write, from list B's instead, migrates as one move
  in one flush: no vanish, no duplicate, no re-create, in either order of
  the two lists' updates. `migrating-element` proves sibling `<Show>`
  slots; this is keyed lists under different parents. If it fails, that is
  a runtime finding, not a reason to key cards per list.
- **B2 — Focus across a move.** What a focused `<input>` keeps when its
  ancestor is moved by `insertBefore`: value and selection are expected to
  survive, focus is expected to be lost (the move is a remove and an
  insert), and commit-on-blur would then end the edit. Measure in Chrome,
  Firefox and Safari, with and without `moveBefore()`. This is V5's
  question asked of an input instead of a video, and moment 2 depends on
  the answer (D6).
  _Measured 2026-10-12 (Chromium 152, a throwaway scratch page,
  cards from one board-level `mapArray` referenced from three lists'
  `<For>`s). B1 holds: across eight cases (each direction, into an empty
  list, a reorder, a two-card swap in one write, emptying a list, two
  writes in one tick) the card is the same node, on screen once, and no
  component is created. But it is not always one move. When the list the
  card leaves updates before the list it joins, the runtime calls
  `remove()` and then `insertBefore` on the detached node; a reorder
  toward the end is `replaceChild` and then an insert of the detached
  node. Only when the receiving position updates first is it a single
  `insertBefore` of a connected node. B2: the editor stays open and the
  input keeps its value and selection in every case; focus is lost in
  every case. With connected-node `insertBefore` routed through
  `moveBefore()`, focus survives only the single-insert cases (right to
  left, and a reorder toward the front) and is still lost in the others,
  because the node is detached before it is inserted. So the
  `moveBefore()` exploration has two parts: use it for connected moves,
  and stop detaching a node that the same flush re-inserts. Firefox and
  Safari not measured._
- **B3 — Echo and settlement in one flush.** The data-tier form of `chat`'s
  C1. When the stream's value satisfies an action's `until`, the overlay
  drops in the same flush the value is reconciled: the card never shows
  its authoritative old position in between, and a created row is never
  on screen twice or not at all. `room` shows this for an append; a board
  shows it for a field change on an existing row, which is where a flicker
  would be a slide.
- **B4 — Stacked actions on one row.** Move a card twice before the first
  echo. The first settling must not reveal the first destination under
  the second overlay; a rejection of the first must not revert the
  second.
- **B5 — Remote change under a local overlay.** While this tab holds an
  optimistic move on card X, another tab moves card Y and renames X. Y
  moves at once; X keeps its optimistic position and takes the new title.
  Per-field overlay on a keyed, reconciled row.
- **B6 — Reconnect is silent on a nested, derived read.** A re-yield of an
  equal board causes zero DOM writes and no `flip` (rects unchanged), with
  a drag in progress and an editor focused. With `CHAOS_EVERY` shorter
  than the action timeout, an in-flight write settles on the next
  connection's first yield.
- **B7 — Takeover with a seeded store.** The document's first value
  hydrates the store; the takeover's first yield reconciles into the same
  card objects, so `mapArray` re-creates nothing and the adopted nodes are
  the nodes.

## Decisions

Decided 2026-10-12.

- **D1 — One board, no router.** No index of boards; the "navigation"
  responsibility is empty in this example and the README says so.
- **D2 — The acknowledgement is data in the live value.** Mutations return
  nothing. A create is acknowledged by its row; a write to an existing row
  by its client-minted mutation id appearing in `applied`, a bounded
  per-client list with no ordering assumption. Not a version returned by
  the mutation (a live mutation's response is not where truth arrives —
  RFC 06, `until`), and not a predicate on the row's own fields (it times
  out when another tab overwrites first). This is the top-right pattern
  only: `chat` acknowledges by the row appearing in the server's markup.
- **D3 — Fractional keys are hand-written** in `order.ts`; no dependency.
- **D4 — The demonstrable rejection is a per-list card limit**, enforced
  only on the server. The archive race is a second case of the same path.
- **D5 — Presence is who is here**, in the header. No per-card marks.
- **D6 — Split out.** If B2 finds focus is lost: adopt
  `moveBefore()` in the insert path behind feature detection, explored on
  its own and not as part of this example — it is V5's follow-up, and
  `migrating-element` wants it too. No focus restore in example code. B2
  stays as this plan's measurement; moment 2's focus-and-caret half waits
  on that work, and Safari's behaviour is stated in the README.

## Build order

Each step is a commit that runs.

1. B1 and B2 as scratch pages, before any app code. They decide whether
   the identity design stands and what the `moveBefore()` exploration has
   to deliver.
2. `server/` and `order.ts` — db, watcher, mutations, the limit, presence.
   Checked by a script, with no UI.
3. Read-only board — sources, the store, derived lists, board-level card
   elements, document render and takeover. B7.
4. Writes without drag — create, rename, archive, keyboard move; the
   action shape, errors per list. B3, B4, B5.
5. The slide — `flip` for local, remote and reverted moves. Moments 1, 4.
6. Drag — pointer, gap, list reorder, cancel.
7. Presence, the status line, chaos. B6, moment 6.
8. README — coordinate, twin, control, the moments; `check` script. The
   grid plan's `board` entry and Handoff item 2 updated.

Not part of this plan: `room`'s deletion (waits for `chat`), `chat`'s
verification spikes (planned with `chat`), anything under G1/G2.

## Public API

None expected from the app. B1 failing would be a runtime fix; B2 may make
`moveBefore()` adoption (a runtime behaviour change with no API surface,
already flagged under V5) a prerequisite for moment 2. Either stops the
build and is recorded as a gap in the grid plan, as its rule requires.
