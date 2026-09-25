// The server-component page. The room is ONE live server component
// (src/lib/room-panel.tsx): presence and the transcript are rendered on the
// server and arrive as HTML that keeps changing; the composer is a CLIENT
// slot the server positions inside its markup. Compare with /live, which
// renders the same room in the browser from live DATA sources — the same
// declaration (`live`), the same loop, the same status pill, and the
// differences are all in what crosses the wire.
//
// The panel mounts after the page is up: identity is minted in the browser,
// and `<Show when={me()}>` holds the panel until then (the server renders
// with `me` null). This is the CALL-DRIVEN face — the connection is a call
// the client makes. The document face — the room rendered INTO the initial
// HTML and adopted by hydration, the loop reconnecting from there — is B3.
import { action, createSignal, latest, Loading, Show } from "solid-js";
import { dynamic } from "@solidjs/web";
import type { RouteSectionProps } from "@solidjs/router";
import { useIdentity } from "~/lib/identity";
import { roomPanel } from "~/lib/room-panel";
import { send, type Identity } from "~/lib/sources";
import StatusPill, { createWire } from "~/components/status-pill";

type Wire = ReturnType<typeof createWire>;

const ROOMS = ["lobby", "design", "infra", "random"];

export default function Home(props: RouteSectionProps) {
  const room = () => {
    const q = String(props.location.query.room || "lobby");
    return ROOMS.includes(q) ? q : "lobby";
  };
  const me = useIdentity();
  const wire = createWire();
  return (
    <div class="room">
      <header class="header">
        <div>
          <h1>Room, rendered on the server</h1>
          <p class="muted">
            One live server component: markup that keeps changing after it arrives, over one
            connection. The same room from live <em>data</em> sources is at{" "}
            <a href={`/live?room=${room()}`}>/live</a>.
          </p>
          <p class="muted rooms-inline">
            {ROOMS.map(name => (
              <a href={`/?room=${name}`} class={name === room() ? "current" : ""}>
                #{name}
              </a>
            ))}
          </p>
        </div>
        <div class="presence">
          <StatusPill wire={wire} label="room" />
          <Chaos />
        </div>
      </header>
      <main class="main">
        <Show
          when={me()}
          fallback={<p class="muted">Minting this tab's identity — the panel mounts after.</p>}
        >
          {me => <Panel room={room()} me={me()} wire={wire} />}
        </Show>
      </main>
    </div>
  );
}

// `roomPanel(room, me)` is the reconnecting iterable itself, and `dynamic`
// is a memo: it pumps the iterable as it pumps any async source, and its
// value is the component the server answered with. A reconnect re-yields
// the SAME binding — the memo stays quiet, nothing re-mounts, and the
// reconnected render's markup lands as one morph.
function Panel(props: { room: string; me: Identity; wire: Wire }) {
  const Room = dynamic(() => props.wire.watch(roomPanel(props.room, props.me)));
  return (
    <Loading fallback={<p class="muted">Rendering the room on the server…</p>}>
      <Room composer={p => <Composer room={p.room} />} />
    </Loading>
  );
}

// The client slot. The server positions it (`<props.composer room={room} />`)
// and the browser fills it with this component — client state, client
// handlers, keyed by position so a morph (a post landing, a reconnect)
// keeps the instance: type half a message, kill every connection, and the
// draft is still there when the panel comes back.
//
// Posting answers nothing here: the row reaches this tab — and every other
// — as MARKUP, through each open render. `sending` covers the round trip.
function Composer(props: { room: string }) {
  const me = useIdentity();
  const [text, setText] = createSignal("");
  const [error, setError] = createSignal<string>();
  const post = action(function* (text: string) {
    const who = me();
    if (!who) return;
    setError(undefined);
    try {
      yield send(props.room, Math.random().toString(36).slice(2, 10), who.name, text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  });
  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    const trimmed = text().trim();
    if (!trimmed) return;
    post(trimmed);
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
      <Show when={error()}>
        <span class="muted post-error" role="alert">
          {error()}
        </span>
      </Show>
    </form>
  );
}

// The chaos switch, as on /live: the dev server destroys the socket of every
// open server-function response — this panel's standing render included.
// The loop reads it as a death and reconnects; watch the pill cycle and the
// render number climb, and nothing else move.
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
