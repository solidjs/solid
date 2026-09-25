// The wire: every server function of the app, each with a function-level
// `"use server"`. The bodies run on the server (and in process during SSR);
// in the client build the compiler replaces them with references and shakes
// out what only they used — `./rooms`, the state, never reaches the browser.
//
// Five shapes, one declaration (`live`) and one address rule:
//
//   presence    live(GET(async function*))  a STANDING answer: the iterable
//               itself is the source. Joining is the connection — the
//               member is present while the response is open, and the
//               generator's `finally` is what "leave" means. Kill the
//               connection and the tab drops out of the room; the loop
//               reconnects and it is back.
//   transcript  live(GET(async function*))  the same shape read through a
//               derived (optimistic) store instead of a memo: each yield is
//               the whole transcript, reconciled by id.
//   roomCard    live(GET(async () => ({…})))  a NESTED-async answer: an
//               object whose properties are a promise and a bounded
//               generator. `live` claims the whole response — alive until
//               both have settled, a death before that reconnects and
//               re-yields a fresh object, and settling is completion.
//   summary     GET(async function*)  UNDECLARED: a slow bounded stream at
//               the data address. A death here is an error, caught by
//               <Errored>; nothing re-invokes on its own.
//   archive     GET(async)  a slow plain read, to show what a live source
//               in the shell does NOT wait for.
//   send        a mutation (POST by default), acknowledged by the transcript
//               stream, not by its own answer (see the action in live.tsx).
import { getRequestEvent } from "@solidjs/web";
import { GET, live } from "@solidjs/web/server-functions";
import {
  delay,
  join,
  membersOf,
  messagesOf,
  post,
  topicOf,
  watchMembers,
  watchMessages,
  type Identity,
  type Member,
  type Message
} from "./rooms";

export type { Identity, Member, Message };

export interface Presence {
  room: string;
  members: Member[];
  // Which connection produced this value — shown in the UI so a reconnect
  // (a new connection, the same members) can be told from a quiet one.
  connection: number;
}

let presenceConnections = 0;

// The response's lifetime, as a signal: aborted when its client goes away.
// A standing source waits on it as well as on its data, so a disconnect ends
// the generator now — its `finally` is the teardown — rather than at the
// next time the data happens to change (see `changed` in rooms.ts).
const gone = () => getRequestEvent()?.request.signal;

export const presence = live(
  GET(async function* (room: string, me: Identity | null): AsyncGenerator<Presence> {
    "use server";
    const connection = ++presenceConnections;
    // A tab with an identity joins for the life of THIS connection. The
    // document render passes `me: null` (identity is per tab, minted in the
    // browser) and only watches; the client's takeover after hydration is
    // the connection that joins.
    const leave = me ? join(room, me) : () => {};
    try {
      for await (const members of watchMembers(room, gone())) yield { room, members, connection };
    } finally {
      leave();
    }
  })
);

export const transcript = live(
  GET(async function* (room: string): AsyncGenerator<{ messages: Message[] }> {
    "use server";
    for await (const messages of watchMessages(room, gone())) yield { messages };
  })
);

export interface Activity {
  tick: number;
  of: number;
  posts: number;
}

export interface RoomCard {
  name: string;
  topic: string;
  // Settles after a moment: a nested promise.
  members: Promise<Member[]>;
  // Eight samples half a second apart: a nested BOUNDED stream. The response
  // is alive until the last one; with the chaos knob shorter than four
  // seconds it never gets there and you watch the reconnect re-yield.
  activity: AsyncIterable<Activity>;
  connection: number;
}

let cardConnections = 0;

export const roomCard = live(
  GET(async (room: string): Promise<RoomCard> => {
    "use server";
    const connection = ++cardConnections;
    const members = delay(700).then(() => membersOf(room));
    const activity = (async function* (): AsyncGenerator<Activity> {
      const of = 8;
      for (let tick = 1; tick <= of; tick++) {
        await delay(500);
        const since = Date.now() - 60_000;
        yield { tick, of, posts: messagesOf(room).filter(m => m.at > since).length };
      }
    })();
    return { name: room, topic: topicOf(room), members, activity, connection };
  })
);

export const summary = GET(async function* (room: string, attempt: number): AsyncGenerator<string> {
  "use server";
  const messages = messagesOf(room);
  yield `Reading ${messages.length} message${messages.length === 1 ? "" : "s"} in #${room}…`;
  await delay(1500);
  yield `Finding the thread…`;
  await delay(1500);
  yield `Almost there…`;
  await delay(1500);
  const humans = new Set(messages.filter(m => m.from !== "system").map(m => m.from));
  yield humans.size === 0
    ? `Attempt ${attempt}: nobody has said anything in #${room} yet.`
    : `Attempt ${attempt}: ${humans.size} ${humans.size === 1 ? "person has" : "people have"} posted ${messages.length - 1} message${messages.length === 2 ? "" : "s"} in #${room}.`;
});

export const archive = GET(async (room: string): Promise<{ room: string; total: number }> => {
  "use server";
  await delay(4000);
  return { room, total: messagesOf(room).length };
});

// The mutation. It answers nothing: the post reaches every tab — the
// poster's included — through the transcript's open stream, which is why the
// poster's action holds with `until` for the echo instead of this promise.
// `id` is the poster's: the row it showed optimistically is the row that
// lands (see Message in rooms.ts).
export async function send(room: string, id: string, from: string, text: string): Promise<void> {
  "use server";
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Nothing to send");
  if (!/^[a-z0-9]{6,12}$/.test(id)) throw new Error("Bad message id");
  if (messagesOf(room).some(m => m.id === id)) return; // a retry of a post that landed
  post(room, id, from, trimmed.slice(0, 500));
}
