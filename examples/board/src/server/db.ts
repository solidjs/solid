import "server-only";
// The board, and the only place its rules live. Only `"use server"` bodies
// import this module; the marker above fails the build if it ever reaches a
// client bundle.
//
// One board, held in memory and written through to unstorage: the memory
// driver by default (the board resets with the server), a file under
// `.data/` with BOARD_STORAGE=fs (it survives a restart). Every write is
// applied to memory synchronously, so a commit is atomic without a lock, and
// the store is saved behind it in commit order.
//
// Nothing a write does is answered by the write. It changes the board, every
// open `watchBoard` yields the new value, and that value is the answer —
// including, for the client that sent it, the write's own id in `applied`.
// Both are stored by one commit, so no value ever shows a write's effect
// without its id or its id without its effect, and any server instance
// reading the same store can answer a reconnect.
import { createStorage } from "unstorage";
import fsDriver from "unstorage/drivers/fs";
import memoryDriver from "unstorage/drivers/memory";
import { between, byPos, isKey } from "../order";
import type { Board, Card, List } from "~/types";

/** A list holds at most this many cards. Checked here and nowhere else. */
export const LIST_LIMIT = 8;

/** How many of a client's mutation ids the board remembers. */
const APPLIED_KEPT = 32;
/** How many clients it remembers them for (the least recently seen go first). */
const CLIENTS_KEPT = 64;

interface Row {
  archived?: true;
}

interface State {
  title: string;
  lists: (List & Row)[];
  cards: (Card & Row)[];
  applied: Record<string, string[]>;
}

const storage = createStorage<State>({
  driver: process.env.BOARD_STORAGE === "fs" ? fsDriver({ base: "./.data" }) : memoryDriver()
});

function seed(): State {
  const lists: List[] = [];
  const cards: Card[] = [];
  let listPos: string | undefined;
  const list = (id: string, title: string, titles: string[]) => {
    lists.push({ id, title, pos: (listPos = between(listPos)) });
    let pos: string | undefined;
    titles.forEach((cardTitle, i) => {
      cards.push({ id: `${id}card${i}`, listId: id, title: cardTitle, pos: (pos = between(pos)) });
    });
  };
  list("seedtodo", "To do", [
    "Drag me to another list",
    "Open this page in a second tab",
    "Rename a card"
  ]);
  list("seeddoing", "Doing", ["Add a card below"]);
  list("seeddone", "Done", []);
  return { title: "Board", lists, cards, applied: {} };
}

let state: State;
const ready = (async () => {
  state = (await storage.getItem("board")) ?? seed();
})();

let saving: Promise<unknown> = Promise.resolve();
function save() {
  const snapshot = structuredClone(state);
  saving = saving.then(() => storage.setItem("board", snapshot)).catch(console.error);
}

/** Settles when every commit so far has reached the store. */
export async function flushed(): Promise<void> {
  await ready;
  await saving;
}

// ---------------------------------------------------------------------------
// Change notification, in `room`'s shape: a counter and the promises parked
// on its next increment.

let version = 0;
const waiters = new Set<() => void>();

function changed(signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const wake = () => {
      waiters.delete(wake);
      signal?.removeEventListener("abort", wake);
      resolve();
    };
    waiters.add(wake);
    signal?.addEventListener("abort", wake, { once: true });
  });
}

function view(client: string | null): Board {
  const open = new Set<string>();
  const lists: List[] = [];
  for (const { archived, ...list } of state.lists) {
    if (archived) continue;
    open.add(list.id);
    lists.push(list);
  }
  const cards: Card[] = [];
  for (const { archived, ...card } of state.cards) {
    if (!archived && open.has(card.listId)) cards.push(card);
  }
  return {
    title: state.title,
    lists: lists.sort(byPos),
    cards: cards.sort(byPos),
    applied: client ? [...(state.applied[client] ?? [])] : []
  };
}

/**
 * The board now and after every commit, as `client` sees it; ends when
 * `signal` aborts. Every yield is the complete current state, so a
 * reconnect starts from one yield. `client` is null for a render that has
 * no identity yet (the document's): the same board, nothing acknowledged.
 */
export async function* watchBoard(
  client: string | null,
  signal?: AbortSignal
): AsyncGenerator<Board> {
  await ready;
  let seen = -1;
  while (!signal?.aborted) {
    if (version !== seen) {
      seen = version;
      yield view(client);
      // A commit can land while the consumer holds this value, when nothing
      // is parked to be woken: look again before waiting.
      continue;
    }
    await changed(signal);
  }
}

// ---------------------------------------------------------------------------
// Commits.

/** A write the board refused. The message is for the person who made it. */
export class Rejected extends Error {
  name = "Rejected";
}

const ID = /^[a-z0-9]{6,24}$/;

function checkId(id: unknown, what: string): asserts id is string {
  if (typeof id !== "string" || !ID.test(id)) throw new Rejected(`Bad ${what} id`);
}

function checkPos(pos: unknown): asserts pos is string {
  if (!isKey(pos)) throw new Rejected("Bad position");
}

function titleOf(title: unknown): string {
  const trimmed = typeof title === "string" ? title.trim() : "";
  if (!trimmed) throw new Rejected("A title can't be empty");
  return trimmed.slice(0, 120);
}

function listOf(id: string): List & Row {
  const list = state.lists.find(l => l.id === id);
  if (!list || list.archived) throw new Rejected("That list was archived");
  return list;
}

function cardOf(id: string): Card & Row {
  const card = state.cards.find(c => c.id === id);
  if (!card || card.archived || state.lists.find(l => l.id === card.listId)?.archived) {
    throw new Rejected("That card was archived");
  }
  return card;
}

function room(list: List, except?: string) {
  const held = state.cards.filter(c => !c.archived && c.listId === list.id && c.id !== except);
  if (held.length >= LIST_LIMIT) {
    throw new Rejected(`"${list.title}" is full (${LIST_LIMIT} cards)`);
  }
}

function committed() {
  version++;
  save();
  const waking = [...waiters];
  waiters.clear();
  for (const wake of waking) wake();
}

/**
 * A write to rows that exist. `write` validates and changes `state`; if it
 * throws, nothing changed and nothing is remembered. A mutation id this
 * client already had applied is a retry of a write that landed, and does
 * nothing.
 */
async function apply(client: string, mutation: string, write: () => void): Promise<void> {
  await ready;
  checkId(client, "client");
  checkId(mutation, "mutation");
  const mine = state.applied[client] ?? [];
  if (mine.includes(mutation)) return;
  write();
  // Re-inserting moves this client to the end, so the first key is always
  // the one seen longest ago.
  delete state.applied[client];
  state.applied[client] = [...mine, mutation].slice(-APPLIED_KEPT);
  const clients = Object.keys(state.applied);
  for (const old of clients.slice(0, Math.max(0, clients.length - CLIENTS_KEPT))) {
    delete state.applied[old];
  }
  committed();
}

// A create is acknowledged by its row: the id is the creating client's, so
// the row it showed at once is the row that lands, and a retry of a create
// that landed does nothing.

export async function createList(id: string, title: string, pos: string): Promise<void> {
  await ready;
  checkId(id, "list");
  checkPos(pos);
  const named = titleOf(title);
  if (state.lists.some(l => l.id === id)) return;
  state.lists.push({ id, title: named, pos });
  committed();
}

export async function createCard(
  id: string,
  listId: string,
  title: string,
  pos: string
): Promise<void> {
  await ready;
  checkId(id, "card");
  checkPos(pos);
  const named = titleOf(title);
  if (state.cards.some(c => c.id === id)) return;
  room(listOf(listId));
  state.cards.push({ id, listId, title: named, pos });
  committed();
}

export function renameBoard(client: string, mutation: string, title: string) {
  return apply(client, mutation, () => {
    state.title = titleOf(title);
  });
}

export function renameList(client: string, mutation: string, id: string, title: string) {
  return apply(client, mutation, () => {
    const named = titleOf(title);
    listOf(id).title = named;
  });
}

export function renameCard(client: string, mutation: string, id: string, title: string) {
  return apply(client, mutation, () => {
    const named = titleOf(title);
    cardOf(id).title = named;
  });
}

export function moveList(client: string, mutation: string, id: string, pos: string) {
  return apply(client, mutation, () => {
    checkPos(pos);
    listOf(id).pos = pos;
  });
}

export function moveCard(
  client: string,
  mutation: string,
  id: string,
  listId: string,
  pos: string
) {
  return apply(client, mutation, () => {
    checkPos(pos);
    const card = cardOf(id);
    const list = listOf(listId);
    if (card.listId !== listId) room(list, id);
    card.listId = listId;
    card.pos = pos;
  });
}

// Archiving what another tab already archived is not a rejection: the board
// already says what this write asked for.

export function archiveList(client: string, mutation: string, id: string) {
  return apply(client, mutation, () => {
    const list = state.lists.find(l => l.id === id);
    if (!list) throw new Rejected("No such list");
    list.archived = true;
  });
}

export function archiveCard(client: string, mutation: string, id: string) {
  return apply(client, mutation, () => {
    const card = state.cards.find(c => c.id === id);
    if (!card) throw new Rejected("No such card");
    card.archived = true;
  });
}
