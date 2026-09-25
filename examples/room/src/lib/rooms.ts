// The room state, server-only: a plain in-memory module with change
// notification. Nothing here knows about server functions or the wire — the
// sources in sources.ts read it, and `changes()` is the one primitive a live
// source needs: a promise that settles on the next write.
//
// This module is imported only from inside `"use server"` functions, so the
// client build never carries it (verify: `pnpm build` and grep dist/client
// for "members").

export interface Identity {
  id: string;
  name: string;
}

export interface Member extends Identity {
  since: number;
}

export interface Message {
  // Minted by the CLIENT that posts (the server's welcome row aside): the
  // optimistic row a tab shows at once and the confirmed row the transcript
  // stream echoes carry the same id, so the landing replaces the row instead
  // of sitting next to it, and the poster's `until` can name its own post.
  id: string;
  from: string;
  text: string;
  at: number;
}

interface Room {
  name: string;
  topic: string;
  members: Map<string, Member>;
  messages: Message[];
  // Two version counters so each source wakes on ITS changes only: presence
  // ignores chatter, the transcript ignores joins and leaves.
  membersVersion: number;
  messagesVersion: number;
  waiters: Set<() => void>;
}

const rooms = new Map<string, Room>();

const TOPICS: Record<string, string> = {
  lobby: "Where everyone lands",
  design: "Pixels, type, and taste",
  infra: "Servers, pipes, and pagers",
  random: "Everything else"
};

export const ROOM_NAMES = Object.keys(TOPICS);

function room(name: string): Room {
  let r = rooms.get(name);
  if (!r) {
    r = {
      name,
      topic: TOPICS[name] ?? `The ${name} room`,
      members: new Map(),
      messages: [
        {
          id: `${name}:welcome`,
          from: "system",
          text: `Welcome to #${name}. Open this page in another tab to see presence move.`,
          at: Date.now()
        }
      ],
      membersVersion: 0,
      messagesVersion: 0,
      waiters: new Set()
    };
    rooms.set(name, r);
  }
  return r;
}

function notify(r: Room) {
  const waiters = [...r.waiters];
  r.waiters.clear();
  for (const wake of waiters) wake();
}

/**
 * Settles on the room's next write (any kind) — or when `signal` aborts.
 * The abort matters for teardown: when a live response's client goes away
 * the runtime calls `return()` on the source, but an async generator parked
 * on an `await` cannot be returned until that await settles. A watcher that
 * only waited for the next write would run its `finally` — `leave()` — at
 * the room's next event, not at the disconnect. Racing the request's signal
 * makes the disconnect the wake.
 */
function changed(r: Room, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const wake = () => {
      r.waiters.delete(wake);
      signal?.removeEventListener("abort", wake);
      resolve();
    };
    r.waiters.add(wake);
    signal?.addEventListener("abort", wake, { once: true });
  });
}

/**
 * A member is present while the returned `leave` has not been called. The
 * entry is this CONNECTION's: a reconnect (the tab's loop re-invoking after
 * a death) joins again under the same id before the dead connection's
 * `finally` has run, and that late `leave` must not remove the new entry —
 * it leaves only what it joined.
 */
export function join(name: string, me: Identity): () => void {
  const r = room(name);
  const entry: Member = { ...me, since: Date.now() };
  r.members.set(me.id, entry);
  r.membersVersion++;
  notify(r);
  return () => {
    if (r.members.get(me.id) !== entry) return;
    r.members.delete(me.id);
    r.membersVersion++;
    notify(r);
  };
}

export function post(name: string, id: string, from: string, text: string): Message {
  const r = room(name);
  const message = { id, from, text, at: Date.now() };
  r.messages.push(message);
  if (r.messages.length > 200) r.messages.splice(0, r.messages.length - 200);
  r.messagesVersion++;
  notify(r);
  return message;
}

export function topicOf(name: string): string {
  return room(name).topic;
}

export function membersOf(name: string): Member[] {
  return [...room(name).members.values()].sort((a, b) => a.since - b.since);
}

export function messagesOf(name: string): Message[] {
  return room(name).messages.slice();
}

/**
 * Yields the current members now and again after every join or leave. The
 * value-shaped contract a live source promises: every yield is the complete
 * current state, so a reconnect can start from the first yield alone. Ends
 * when `signal` aborts (the response's client went away — see `changed`).
 */
export async function* watchMembers(name: string, signal?: AbortSignal): AsyncGenerator<Member[]> {
  const r = room(name);
  let seen = -1;
  while (!signal?.aborted) {
    if (r.membersVersion !== seen) {
      seen = r.membersVersion;
      yield membersOf(name);
    }
    await changed(r, signal);
  }
}

/** Yields the transcript now and after every post; ends when `signal` aborts. */
export async function* watchMessages(
  name: string,
  signal?: AbortSignal
): AsyncGenerator<Message[]> {
  const r = room(name);
  let seen = -1;
  while (!signal?.aborted) {
    if (r.messagesVersion !== seen) {
      seen = r.messagesVersion;
      yield messagesOf(name);
    }
    await changed(r, signal);
  }
}

export const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
