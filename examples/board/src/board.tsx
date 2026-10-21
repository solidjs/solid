// The board. Everything on screen is rendered here, in the browser, from one
// value: the server sends data and nothing else.
//
// `getBoard` is a live source — a standing answer this tab holds open. Each
// time the board changes it yields the whole board, and the store below
// reconciles that into what it already has, row by row, by id. A card that
// did not change is the same object afterwards, so nothing about it
// re-renders.
//
// Every write has the same life. It shows at once, as an optimistic write to
// that store. It is sent to the server, which answers nothing. Then the
// action holds until the board's own stream carries the write — and only
// then lets go of the optimistic value, onto data that already agrees with
// it. A write the server refuses, or one the stream never carries, undoes
// itself: there was never anything but the overlay to remove.
import {
  action,
  createContext,
  createMemo,
  createOptimisticStore,
  createSignal,
  createStore,
  For,
  latest,
  Loading,
  mapArray,
  Show,
  until,
  useContext
} from "solid-js";
import type { JSX } from "@solidjs/web";
import { getRequestEvent, isServer } from "@solidjs/web";
import { live } from "@solidjs/web/server-functions";
import { createDrag, type Over } from "~/drag";
import { createFlip } from "~/flip";
import { IdentityContext, mintId } from "~/identity";
import { byPos, keyAt } from "~/order";
import * as db from "~/server/db";
import * as presence from "~/server/presence";
import type { Board, Card, Identity, Member } from "~/types";

// ---------------------------------------------------------------------------
// The wire. Each of these runs on the server; in the browser the compiler
// leaves a reference to call, and `db` never reaches the bundle.

// The document's render calls this with `null` (the server cannot know the
// tab) and the browser calls it with the tab's id once it has one.
const getBoard = live(async function* (client: string | null): AsyncGenerator<Board> {
  "use server";
  // The response's lifetime: aborted when its client goes away, which ends
  // the watcher now rather than at the board's next change.
  yield* db.watchBoard(client, getRequestEvent()?.request.signal);
});

// Who has the board open. Joining is the connection: a tab is present while
// this response is open, and the generator's `finally` is what leaving
// means. The document's render has no identity and only watches.
const getPresence = live(async function* (me: Identity | null): AsyncGenerator<Member[]> {
  "use server";
  const leave = me ? presence.join(me) : () => {};
  try {
    yield* presence.watchMembers(getRequestEvent()?.request.signal);
  } finally {
    leave();
  }
});

// The writes answer nothing: what they did arrives on `getBoard`'s stream. A
// create names its row with an id the browser minted; a write to a row that
// exists carries a mutation id, which the board lists back in `applied`.
// What the board refuses is turned into an answer the browser may read in
// one place, for all of them: server-config.ts.

async function createList(id: string, title: string, pos: string) {
  "use server";
  await db.createList(id, title, pos);
}

async function createCard(id: string, listId: string, title: string, pos: string) {
  "use server";
  await db.createCard(id, listId, title, pos);
}

async function renameBoard(client: string, mutation: string, title: string) {
  "use server";
  await db.renameBoard(client, mutation, title);
}

async function renameList(client: string, mutation: string, id: string, title: string) {
  "use server";
  await db.renameList(client, mutation, id, title);
}

async function renameCard(client: string, mutation: string, id: string, title: string) {
  "use server";
  await db.renameCard(client, mutation, id, title);
}

async function moveList(client: string, mutation: string, id: string, pos: string) {
  "use server";
  await db.moveList(client, mutation, id, pos);
}

async function moveCard(client: string, mutation: string, id: string, listId: string, pos: string) {
  "use server";
  await db.moveCard(client, mutation, id, listId, pos);
}

async function archiveList(client: string, mutation: string, id: string) {
  "use server";
  await db.archiveList(client, mutation, id);
}

async function archiveCard(client: string, mutation: string, id: string) {
  "use server";
  await db.archiveCard(client, mutation, id);
}

// ---------------------------------------------------------------------------
// The board's state and its writes, for the components below.

/** How long a write waits for the board to carry it before undoing itself. */
const CONFIRM_WITHIN = 10_000;

/** Where a refused write is reported when it concerned no list. */
const BOARD = "board";

function createBoard() {
  const me = useContext(IdentityContext);

  // The wire. A live source reconnects by itself and its values never show
  // it, so `onstatus` is the one place to learn that it is down.
  const [reconnecting, setReconnecting] = createSignal(false);

  const [board, setBoard] = createOptimisticStore<Board>(
    () => {
      const source = getBoard(me()?.id ?? null);
      if (!isServer) source.onstatus = status => setReconnecting(status === "reconnecting");
      return source;
    },
    {
      title: "",
      lists: [],
      cards: [],
      applied: []
    }
  );
  const people = createMemo(() => getPresence(me()));

  // The board is flat, as it is stored; the nesting on screen is derived.
  const lists = () => [...board.lists].sort(byPos);
  const cardsOf = (listId: string) => board.cards.filter(c => c.listId === listId).sort(byPos);

  // What went wrong with the last write to each list, in that list's own
  // line. Plain client state, under the optimistic layer: a refusal is a fact
  // about one request, and the board's stream has no place for it.
  const [errors, setErrors] = createStore<Record<string, string | undefined>>({});
  const starting = (where: string) => setErrors(e => void delete e[where]);
  const failed = (where: string, err: unknown) =>
    setErrors(e => {
      e[where] =
        err instanceof Error && err.name === "TimeoutError"
          ? "The board didn't confirm that, so it was undone."
          : err instanceof Error
            ? err.message
            : String(err);
    });

  // The two acknowledgements. Both read the board as the server last sent
  // it: inside an action the optimistic layer is invisible to `until`, so a
  // tab's own guess can never confirm itself.
  const applied = (mutation: string) =>
    until(() => board.applied.includes(mutation), { timeout: CONFIRM_WITHIN });
  const exists = (rows: () => readonly { id: string }[], id: string) =>
    until(() => rows().some(row => row.id === id), { timeout: CONFIRM_WITHIN });

  const write = {
    createList: action(function* (title: string) {
      const id = mintId();
      const pos = keyAt(lists(), board.lists.length);
      starting(BOARD);
      setBoard(b => void b.lists.push({ id, title, pos }));
      try {
        yield createList(id, title, pos);
        yield exists(() => board.lists, id);
      } catch (err) {
        failed(BOARD, err);
      }
    }),

    createCard: action(function* (listId: string, title: string) {
      const id = mintId();
      const rows = cardsOf(listId);
      const pos = keyAt(rows, rows.length);
      starting(listId);
      setBoard(b => void b.cards.push({ id, listId, title, pos }));
      try {
        yield createCard(id, listId, title, pos);
        yield exists(() => board.cards, id);
      } catch (err) {
        failed(listId, err);
      }
    }),

    renameBoard: action(function* (title: string) {
      const client = me();
      if (!client) return;
      const mutation = mintId();
      starting(BOARD);
      setBoard(b => void (b.title = title));
      try {
        yield renameBoard(client.id, mutation, title);
        yield applied(mutation);
      } catch (err) {
        failed(BOARD, err);
      }
    }),

    renameList: action(function* (id: string, title: string) {
      const client = me();
      if (!client) return;
      const mutation = mintId();
      starting(id);
      setBoard(b => {
        const list = b.lists.find(l => l.id === id);
        if (list) list.title = title;
      });
      try {
        yield renameList(client.id, mutation, id, title);
        yield applied(mutation);
      } catch (err) {
        failed(id, err);
      }
    }),

    renameCard: action(function* (card: Card, title: string) {
      const client = me();
      if (!client) return;
      const { id, listId } = card;
      const mutation = mintId();
      starting(listId);
      setBoard(b => {
        const row = b.cards.find(c => c.id === id);
        if (row) row.title = title;
      });
      try {
        yield renameCard(client.id, mutation, id, title);
        yield applied(mutation);
      } catch (err) {
        failed(listId, err);
      }
    }),

    // One field write on one row, whichever list it ends up in. The hold is
    // on the board saying this write was applied, not on the card being
    // where this tab put it: if another tab moved the same card a moment
    // later, this write still landed, and the card settles where the board
    // says it is.
    moveCard: action(function* (id: string, listId: string, pos: string) {
      const client = me();
      if (!client) return;
      const mutation = mintId();
      starting(listId);
      setBoard(b => {
        const row = b.cards.find(c => c.id === id);
        if (row) {
          row.listId = listId;
          row.pos = pos;
        }
      });
      try {
        yield moveCard(client.id, mutation, id, listId, pos);
        yield applied(mutation);
      } catch (err) {
        failed(listId, err);
      }
    }),

    moveList: action(function* (id: string, pos: string) {
      const client = me();
      if (!client) return;
      const mutation = mintId();
      starting(BOARD);
      setBoard(b => {
        const list = b.lists.find(l => l.id === id);
        if (list) list.pos = pos;
      });
      try {
        yield moveList(client.id, mutation, id, pos);
        yield applied(mutation);
      } catch (err) {
        failed(BOARD, err);
      }
    }),

    archiveList: action(function* (id: string) {
      const client = me();
      if (!client) return;
      const mutation = mintId();
      starting(BOARD);
      setBoard(b => {
        b.lists = b.lists.filter(l => l.id !== id);
        b.cards = b.cards.filter(c => c.listId !== id);
      });
      try {
        yield archiveList(client.id, mutation, id);
        yield applied(mutation);
      } catch (err) {
        failed(BOARD, err);
      }
    }),

    archiveCard: action(function* (card: Card) {
      const client = me();
      if (!client) return;
      const { id, listId } = card;
      const mutation = mintId();
      starting(listId);
      setBoard(b => void (b.cards = b.cards.filter(c => c.id !== id)));
      try {
        yield archiveCard(client.id, mutation, id);
        yield applied(mutation);
      } catch (err) {
        failed(listId, err);
      }
    })
  };

  // Alt+arrows on a focused card: up and down within its list, left and
  // right to the neighbouring list at the same height. The same write a
  // drop makes.
  const nudge = (card: Card, across: number, down: number) => {
    const all = lists();
    const target = all[all.findIndex(l => l.id === card.listId) + across];
    if (!target) return;
    const from = cardsOf(card.listId).findIndex(c => c.id === card.id);
    const rows = cardsOf(target.id).filter(c => c.id !== card.id);
    const to = Math.max(0, Math.min(rows.length, from + down));
    if (!across && to === from) return;
    write.moveCard(card.id, target.id, keyAt(rows, to));
  };

  // A drop is the same write, placed by the pointer. Letting go where the
  // row already was is not a write.
  let root: HTMLElement | undefined;
  const drag = createDrag({
    root: () => root,
    onDrop(over: Over) {
      if (over.kind === "list") {
        const rows = lists();
        const from = rows.findIndex(l => l.id === over.id);
        if (from === over.index) return;
        write.moveList(
          over.id,
          keyAt(
            rows.filter(l => l.id !== over.id),
            over.index
          )
        );
        return;
      }
      const card = board.cards.find(c => c.id === over.id);
      if (!card || !over.listId) return;
      const from = cardsOf(card.listId).findIndex(c => c.id === card.id);
      if (card.listId === over.listId && from === over.index) return;
      const rows = cardsOf(over.listId).filter(c => c.id !== card.id);
      write.moveCard(card.id, over.listId, keyAt(rows, over.index));
    }
  });
  // Where a dragged row would land, as each row asks it.
  const landsBefore = (kind: Over["kind"], id: string | null, listId?: string) => {
    const over = drag.over();
    return (
      !!over && over.kind === kind && over.beforeId === id && (!listId || over.listId === listId)
    );
  };

  return {
    board,
    lists,
    cardsOf,
    errors,
    write,
    nudge,
    me,
    people,
    reconnecting,
    grab: drag.grab,
    landsBefore,
    root: () => root,
    setRoot: (el: HTMLElement) => void (root = el)
  };
}

const BoardContext = createContext<ReturnType<typeof createBoard>>();

// ---------------------------------------------------------------------------
// The screen.

export default function BoardScreen() {
  return (
    <BoardContext value={createBoard()}>
      <BoardView />
    </BoardContext>
  );
}

function BoardView() {
  const {
    board,
    lists,
    cardsOf,
    errors,
    write,
    grab,
    landsBefore,
    root,
    setRoot,
    me,
    people,
    reconnecting
  } = useContext(BoardContext);

  // One component, and so one element, per card for as long as the card
  // exists — created here, at board level, not inside a list. A list only
  // references the elements of the cards it currently holds, so moving a
  // card to another list moves its element and disposes nothing: an open
  // editor and its draft go with it.
  const cardViews = mapArray(
    () => board.cards,
    card => [card.id, <CardView card={card} />] as const
  );
  const cardElements = createMemo(() => new Map<string, JSX.Element>(cardViews()));

  // Where everything is: each list's place, and each card's list and place.
  // One string, so the slide's effect follows one value.
  const arrangement = createMemo(
    () =>
      board.lists.map(l => `${l.id}@${l.pos}`).join() +
      "|" +
      board.cards.map(c => `${c.id}@${c.listId}@${c.pos}`).join()
  );
  createFlip(root, arrangement);

  return (
    <div class="board" ref={setRoot}>
      <Loading fallback={<p class="board-loading">Loading the board…</p>}>
        <header class="board-head">
          <h1>
            <Editable label="Board title" value={board.title} onCommit={write.renameBoard} />
          </h1>
          <Show when={errors[BOARD]}>
            {message => (
              <p class="error" role="alert">
                {message()}
              </p>
            )}
          </Show>
          <Show when={reconnecting()}>
            <p class="wire" role="status">
              Reconnecting…
            </p>
          </Show>
          <ul class="people" aria-label="Here now">
            <Loading>
              <For each={people()}>
                {person => (
                  <li class={{ me: person.id === me()?.id }} title={person.name}>
                    {initials(person.name)}
                  </li>
                )}
              </For>
            </Loading>
          </ul>
        </header>
        <main class="lists">
          <For each={lists()}>
            {list => (
              <section
                class={["list", { "gap-before": landsBefore("list", list.id) }]}
                data-list={list.id}
              >
                <header
                  class="list-head"
                  onPointerDown={e => grab("list", e.currentTarget.parentElement!, e)}
                >
                  <h2>
                    <Editable
                      label="List title"
                      value={list.title}
                      onCommit={title => write.renameList(list.id, title)}
                    />
                  </h2>
                  <button
                    type="button"
                    class="archive"
                    aria-label={`Archive list ${list.title}`}
                    onClick={() => write.archiveList(list.id)}
                  >
                    ×
                  </button>
                </header>
                <ol class={["cards", { "gap-end": landsBefore("card", null, list.id) }]}>
                  <For each={cardsOf(list.id)}>{card => <>{cardElements().get(card.id)}</>}</For>
                </ol>
                <Show when={errors[list.id]}>
                  {message => (
                    <p class="error" role="alert">
                      {message()}
                    </p>
                  )}
                </Show>
                <AddForm label="Add a card" onAdd={title => write.createCard(list.id, title)} />
              </section>
            )}
          </For>
          <div class={["add-list", { "gap-before": landsBefore("list", null) }]}>
            <AddForm label="Add a list" onAdd={write.createList} />
          </div>
        </main>
      </Loading>
    </div>
  );
}

// "quick-otter" → "QO"
const initials = (name: string) =>
  name
    .split("-")
    .map(part => part[0]?.toUpperCase())
    .join("");

const ARROWS: Record<string, [across: number, down: number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0]
};

function CardView(props: { card: Card }) {
  const { write, nudge, grab, landsBefore } = useContext(BoardContext);
  const onKeyDown = (e: KeyboardEvent & { currentTarget: HTMLLIElement }) => {
    const step = e.altKey && e.target === e.currentTarget && ARROWS[e.key];
    if (!step) return;
    e.preventDefault();
    nudge(props.card, ...step);
    // Moving an element takes focus off it today, and the next Alt+arrow
    // needs it. This line comes out when the runtime keeps focus on a move.
    const el = e.currentTarget;
    queueMicrotask(() => el.focus());
  };
  return (
    <li
      class={["card", { "gap-before": landsBefore("card", props.card.id) }]}
      data-card={props.card.id}
      tabindex="0"
      onKeyDown={onKeyDown}
      onPointerDown={e => grab("card", e.currentTarget, e)}
    >
      <Editable
        label="Card title"
        value={props.card.title}
        onCommit={title => write.renameCard(props.card, title)}
      />
      <button
        type="button"
        class="archive"
        aria-label={`Archive card ${props.card.title}`}
        onClick={() => write.archiveCard(props.card)}
      >
        ×
      </button>
    </li>
  );
}

// A title that turns into its own editor. Click (or Enter on it) to edit;
// Enter or leaving the field commits, Escape abandons. The draft lives here,
// in the component, so it is untouched by whatever the board does around it.
function Editable(props: { label: string; value: string; onCommit: (title: string) => void }) {
  const [draft, setDraft] = createSignal<string>();
  const commit = () => {
    const title = draft()?.trim();
    // Closing the editor and starting the write happen in one tick, so the
    // close belongs to the write and lands when the write settles. The
    // `latest` below is what shows it now instead of then.
    setDraft(undefined);
    if (title && title !== props.value) props.onCommit(title);
  };
  return (
    <Show
      when={latest(draft) !== undefined}
      fallback={
        <button type="button" class="editable" onClick={() => setDraft(props.value)}>
          {props.value}
        </button>
      }
    >
      <input
        class="editable"
        aria-label={props.label}
        maxlength="120"
        value={draft()}
        ref={el =>
          queueMicrotask(() => {
            el.focus();
            el.select();
          })
        }
        onInput={e => setDraft(e.currentTarget.value)}
        onKeyDown={e => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") setDraft(undefined);
        }}
        onBlur={commit}
      />
    </Show>
  );
}

function AddForm(props: { label: string; onAdd: (title: string) => void }) {
  const submit = (e: SubmitEvent & { currentTarget: HTMLFormElement }) => {
    e.preventDefault();
    const form = e.currentTarget;
    const title = String(new FormData(form).get("title") ?? "").trim();
    if (!title) return;
    props.onAdd(title);
    form.reset();
  };
  return (
    <form class="add" onSubmit={submit}>
      <input
        name="title"
        aria-label={props.label}
        placeholder={props.label}
        maxlength="120"
        autocomplete="off"
      />
    </form>
  );
}
