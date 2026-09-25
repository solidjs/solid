// The live page. Every panel is one shape of answer from sources.ts, read
// the way any async value is read in Solid — a memo or a derived store — and
// the differences between them are all on the WIRE, which is what the
// status pills and the chaos switch make visible. The one mutation (posting)
// is an action over the transcript's optimistic store, acknowledged by the
// live stream itself (`until`), not by its own response.
//
// SSR renders the page in stream mode: each live source contributes its
// first value to the document and hands off; after hydration the client's
// `live` re-invokes each one from its own hydration scope — the shell's
// sources (presence, transcript, directory) as soon as the root pass ends,
// without waiting for the slow <Loading> boundaries lower on the page (D8).
import {
  action,
  createMemo,
  createOptimistic,
  createOptimisticStore,
  createSignal,
  Errored,
  For,
  latest,
  Loading,
  Show,
  until,
  type Accessor,
  type Store
} from "solid-js";
import type { RouteSectionProps } from "@solidjs/router";
import { useIdentity } from "~/lib/identity";
import {
  archive,
  presence,
  roomCard,
  send,
  summary,
  transcript,
  type Message,
  type Presence
} from "~/lib/sources";
import StatusPill, { createWire, type Wire } from "~/components/status-pill";

const ROOMS = ["lobby", "design", "infra", "random"];

export default function Live(props: RouteSectionProps) {
  const room = () => {
    const q = String(props.location.query.room || "lobby");
    return ROOMS.includes(q) ? q : "lobby";
  };
  return (
    <div class="room">
      <Header room={room()} />
      <div class="columns">
        <main class="main">
          <Chat room={room()} />
        </main>
        <aside class="side">
          <Directory current={room()} />
          <Card room={room()} />
          <Summary room={room()} />
          <Archive room={room()} />
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// presence — a standing answer read through a memo. Joining IS the
// connection: this tab is a member while its response is open. The document
// render watches only (`me()` is null on the server and until the tab's
// identity is minted); then the memo re-invokes and that connection joins.
function Header(props: { room: string }) {
  const me = useIdentity();
  const wire = createWire();
  const who = createMemo<Presence>(() => wire.watch(presence(props.room, me())));
  // Am I in the room? Only once the tab's own connection has joined — the
  // document render's value never lists me (it watched with `me: null`).
  const joined = () => {
    const id = me()?.id;
    return id != null && who().members.some(m => m.id === id);
  };
  return (
    <header class="header">
      <div>
        <h1>#{props.room}</h1>
        <p class="muted">
          <Loading fallback="Joining…">
            <Show when={joined()} fallback="Not in the room yet — your connection is what joins.">
              You are <b>{me()!.name}</b>, here while this tab's connection is open.
            </Show>
          </Loading>{" "}
          Open another tab to be two people.
        </p>
      </div>
      <div class="presence">
        <Loading fallback={<span class="muted">joining…</span>}>
          <span class="count">{who().members.length}</span>
          <span class="muted"> here · connection #{who().connection}</span>
          <ul class="members">
            <For each={who().members}>
              {m => <li class={m.id === me()?.id ? "me" : ""}>{m.name}</li>}
            </For>
          </ul>
        </Loading>
        <StatusPill wire={wire} label="presence" />
        <Chaos />
      </div>
    </header>
  );
}

// The chaos switch: asks the dev server to destroy the socket of every open
// server-function response (see vite.config.ts). Live responses die and
// their loops reconnect; the undeclared summary dies and errors. In the
// production harness there is no such route — the button says so.
function Chaos() {
  const [last, setLast] = createSignal("");
  const drop = async () => {
    try {
      const res = await fetch("/__chaos/drop", { method: "POST" });
      setLast(res.ok ? await res.text() : `no chaos route (${res.status}) — dev only`);
    } catch (e) {
      setLast(String(e));
    }
  };
  return (
    <span class="chaos">
      <button type="button" onClick={drop}>
        Kill every connection
      </button>
      <Show when={last()}>
        <span class="muted"> {last()}</span>
      </Show>
    </span>
  );
}

// ---------------------------------------------------------------------------
// transcript + composer — the same standing shape as presence, read through
// a STORE instead of a memo: every yield is the whole transcript, reconciled
// by `id`, so <For> keeps the rows that did not change. It is an OPTIMISTIC
// store because the composer writes into it.
//
// Posting is an action. No refetch anywhere: the post reaches every tab —
// this one included — through the transcript's open stream, and the
// mutation's own promise settles before that echo arrives. So the action
// shows the row at once (an optimistic write, keyed with the id the server
// will echo), sends, then HOLDS with `until` for the transcript to carry it:
// the predicate reads the authoritative view, so the tab's own optimistic
// row can't answer for the world. Settling drops the overlay onto data that
// already contains the real row — same id, so <For> keeps the element.
// Failure — a rejected send, or no echo within the timeout — reverts the row
// and leaves only the reason.
type Row = Message & { pending?: boolean };

function Chat(props: { room: string }) {
  const me = useIdentity();
  const wire = createWire();
  const [store, setOptimistic] = createOptimisticStore<{ messages: Row[] }>(
    () => wire.watch(transcript(props.room)),
    { messages: [] }
  );
  // Process affordance: true for the life of the post transaction — which,
  // with the hold below, is until the stream has echoed it. Reverts with it.
  const [sending, setSending] = createOptimistic(false);
  // A mutation's error is its own channel — the transcript stays valid, so
  // no boundary; the next post clears it.
  const [error, setError] = createSignal<string>();
  const post = action(function* (text: string) {
    const who = me();
    if (!who) return;
    const id = Math.random().toString(36).slice(2, 10);
    setError(undefined);
    setSending(true);
    setOptimistic(t => {
      t.messages.push({ id, from: who.name, text, at: Date.now(), pending: true });
    });
    try {
      yield send(props.room, id, who.name, text);
      yield until(() => store.messages.some(m => m.id === id), { timeout: 10_000 });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  });
  return (
    <>
      <Transcript store={store} wire={wire} />
      <Composer room={props.room} post={post} sending={sending} error={error} />
    </>
  );
}

function Transcript(props: { store: Store<{ messages: Row[] }>; wire: Wire }) {
  const me = useIdentity();
  return (
    <section class="panel transcript">
      <div class="panel-head">
        <h2>Transcript</h2>
        <StatusPill wire={props.wire} />
      </div>
      <Loading fallback={<p class="muted">loading…</p>}>
        <ol class="messages">
          <For each={props.store.messages}>
            {m => (
              <li
                class={{
                  system: m.from === "system",
                  mine: m.from === me()?.name,
                  pending: !!m.pending
                }}
              >
                <span class="from">{m.from}</span>
                <span class="text">{m.text}</span>
                <time class="muted">{new Date(m.at).toLocaleTimeString()}</time>
              </li>
            )}
          </For>
        </ol>
      </Loading>
    </section>
  );
}

// The composer is disabled until this tab has an identity: the server
// renders it disabled (`me` is null there), the client hydrates that, and the
// mint enables it — one reactive update, in whatever order it lands relative
// to hydration. It is NOT disabled while a post is in flight: the row is
// already on screen, and actions run concurrently — type the next one.
function Composer(props: {
  room: string;
  post: (text: string) => unknown;
  sending: Accessor<boolean>;
  error: Accessor<string | undefined>;
}) {
  const me = useIdentity();
  const [text, setText] = createSignal("");
  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    const trimmed = text().trim();
    if (!trimmed) return;
    props.post(trimmed);
    // Same tick as the action call, so this write is the action's: it lands
    // when the post settles — when the stream echoes it. The input reads
    // `latest(text)` and shows the clear at once; a keystroke during the
    // hold is a rewrite of the same held value, shown the same way, and it
    // is what lands, not the clear.
    setText("");
  };
  return (
    <form class="composer" onSubmit={submit}>
      <input
        value={latest(text)}
        onInput={e => setText(e.currentTarget.value)}
        placeholder={`Message #${props.room}`}
        disabled={me() === null}
        autocomplete="off"
      />
      <button type="submit" disabled={me() === null}>
        Send
      </button>
      <Show when={props.sending()}>
        <span class="muted sending">sending…</span>
      </Show>
      <Show when={props.error()}>
        <span class="muted post-error" role="alert">
          {props.error()}
        </span>
      </Show>
    </form>
  );
}

// ---------------------------------------------------------------------------
// directory — one more live source per room, watching only (no identity).
// With the current room's three, that is seven live connections on the
// page: more than a browser allows per origin under HTTP/1.1, which is the
// dev warning you will see with HTTPS=0 (see README).
function Directory(props: { current: string }) {
  return (
    <section class="panel">
      <div class="panel-head">
        <h2>Rooms</h2>
      </div>
      <ul class="directory">
        <For each={ROOMS}>{name => <DirectoryEntry name={name} current={props.current} />}</For>
      </ul>
    </section>
  );
}

function DirectoryEntry(props: { name: string; current: string }) {
  const wire = createWire();
  const who = createMemo<Presence>(() => wire.watch(presence(props.name, null)));
  return (
    <li class={props.name === props.current ? "current" : ""}>
      <a href={`/live?room=${props.name}`}>#{props.name}</a>
      <span class="count-small">
        <Loading fallback="…">{who().members.length}</Loading>
      </span>
      <span class={`dot dot-${wire.status()}`} title={wire.status()} />
    </li>
  );
}

// ---------------------------------------------------------------------------
// roomCard — a NESTED-async answer: one object, a promise and a bounded
// stream inside it. `live` holds the response open until both have
// settled (completion → "closed"); a death before that reconnects and
// re-yields a fresh object — watch the connection number and the ticks
// start over. Set CHAOS_EVERY=2500 to see it never complete.
//
// The child memos read INTO the answer. On the server the serializer is
// reading the same nested sources to ship them to the client; every read
// goes through a seat on one shared pump, so both see the whole sequence.
function Card(props: { room: string }) {
  const wire = createWire();
  const card = createMemo(() => wire.watch(roomCard(props.room)));
  const members = createMemo(() => card().members);
  const activity = createMemo(() => card().activity);
  return (
    <section class="panel">
      <div class="panel-head">
        <h2>Room card</h2>
        <StatusPill wire={wire} />
      </div>
      <Loading on={props.room} fallback={<p class="muted">loading card…</p>}>
        <p>
          <b>{card().topic}</b>
          <span class="muted"> · connection #{card().connection}</span>
        </p>
        <p>
          <Loading fallback={<span class="muted">counting members…</span>}>
            {members().length} member{members().length === 1 ? "" : "s"} when the card was cut
          </Loading>
        </p>
        <p>
          <Loading fallback={<span class="muted">sampling activity…</span>}>
            <span class="ticks">
              <For each={Array.from({ length: activity().of })}>
                {(_, i) => <span class={i() < activity().tick ? "tick on" : "tick"} />}
              </For>
            </span>
            <span class="muted">
              {" "}
              {activity().posts} post{activity().posts === 1 ? "" : "s"} in the last minute
            </span>
          </Loading>
        </p>
      </Loading>
    </section>
  );
}

// ---------------------------------------------------------------------------
// summary — an UNDECLARED slow stream at the data address. Kill the
// connections while it is running and it errors: nothing re-invokes on its
// own; <Errored> shows the failure and Regenerate is an explicit new call.
// Client-only (`ssrSource: "client"`) so the very first run is already over
// the wire and killable.
function Summary(props: { room: string }) {
  const [attempt, setAttempt] = createSignal(1);
  return (
    <section class="panel">
      <div class="panel-head">
        <h2>Summary</h2>
        <span class="muted">undeclared</span>
      </div>
      <Errored
        fallback={(err, reset) => (
          <div class="error">
            <p>The stream died: {describe(err())}</p>
            <button
              type="button"
              onClick={() => {
                setAttempt(a => a + 1);
                reset();
              }}
            >
              Regenerate
            </button>
          </div>
        )}
      >
        <Loading fallback={<p class="muted">summarizing…</p>}>
          <SummaryText room={props.room} attempt={attempt()} />
        </Loading>
      </Errored>
    </section>
  );
}

function SummaryText(props: { room: string; attempt: number }) {
  const text = createMemo(() => summary(props.room, props.attempt), { ssrSource: "client" });
  return <p>{text()}</p>;
}

// ---------------------------------------------------------------------------
// archive — a slow plain read in its own boundary. Its four seconds are
// what the presence pill up top does NOT wait for: the shell's live sources
// take over when the root pass ends, this boundary lands whenever it lands.
// `on={room}` makes a room switch the same story: a different room is
// different content, so the boundary shows its fallback for the new room at
// once instead of holding the whole navigation for the count. (A refetch of
// the SAME room would still keep the old count visible while it loads.)
function Archive(props: { room: string }) {
  const stats = createMemo(() => archive(props.room));
  return (
    <section class="panel">
      <div class="panel-head">
        <h2>Archive</h2>
        <span class="muted">slow, plain</span>
      </div>
      <Loading on={props.room} fallback={<p class="muted">counting the archive (4s)…</p>}>
        <p>
          {stats().total} message{stats().total === 1 ? "" : "s"} ever in #{stats().room}
        </p>
      </Loading>
    </section>
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
