// The room as a LIVE SERVER COMPONENT (Stage 8 Phase B). Where /live reads
// the room's DATA over live sources and renders it in the browser, this
// renders the room ON THE SERVER — presence and the transcript as markup —
// and the browser receives HTML that keeps changing after it arrives.
//
// The declaration is the same one the data sources use: `live(GET(fn))`,
// composed outermost. What differs is the answer — a component instead of
// a value — and `live` covers it with no further vocabulary: the render is
// the standing answer, its response is the connection, and the reference's
// loop owns that connection's lifetime. A death (the chaos switch, a proxy
// timeout, a redeploy) is a reconnect: a fresh render on the server, ONE
// morph in the browser, no fallback flash, and the client slot below keeps
// its instance — half-typed draft included.
//
// The component's sources are the same in-memory watchers as /live's. They
// read through memos, so every change re-renders the panel here and the
// browser morphs it — the transcript row a tab posts reaches every other
// tab as markup, through each one's open render.
//
// Teardown is the render's disposal: the loop closing its connection (a
// room switch, unmount), the request's abort, or the chaos knob ending the
// response — every one disposes this owner, and `onCleanup` is where the
// standing render lets go: the member leaves, and the watchers parked on
// the room's next write are woken by the abort so their `finally` runs now
// rather than at the room's next event.
//
// The DOCUMENT face (Stage 8 B3): the page renders this same component
// into the initial HTML — under the live scope every source here takes its
// first value and is closed, so the document completes with the transcript
// in it — and the browser adopts that markup at hydration, then reconnects
// once for the standing render. Identity is per tab and minted in the
// browser, so the document's call passes `me: null` and only watches; the
// connection the client makes with its identity is the one that joins.
import { createMemo, For, onCleanup } from "solid-js";
import { GET, live } from "@solidjs/web/server-functions";
import type { Slot } from "@solidjs/web/frames";
import { join, topicOf, watchMembers, watchMessages, type Identity } from "./rooms";

export type ComposerSlot = Slot<{ room: string }>;

let renders = 0;

export const roomPanel = live(
  GET(async (room: string, me: Identity | null) => {
    "use server";
    // Which render this is — shown in the panel so a reconnect (a new
    // render, the same room) can be told from a quiet morph. Read through a
    // call so the compiler makes it a live hole: on a conditional reconnect
    // (Stage 8 B4) the server compares it against what the page shows and
    // this counter is the one hole that crosses — everything else in the
    // panel is unchanged and never re-sent.
    const render = ++renders;
    const renderNo = () => render;
    return (props: { composer: ComposerSlot }) => {
      const gone = new AbortController();
      onCleanup(() => gone.abort());
      // Joining IS the render: this tab is a member while its panel's
      // response is open. A reconnect joins again under the same id before
      // the dead render's cleanup has run; `join` leaves only what it joined.
      // The document's render (no identity yet) only watches.
      if (me) onCleanup(join(room, me));
      const members = createMemo(() => watchMembers(room, gone.signal));
      const messages = createMemo(() => watchMessages(room, gone.signal));
      return (
        <section class="panel room-panel">
          <div class="panel-head">
            <h2>#{room}</h2>
            <span class="muted">
              {topicOf(room)} · render #{renderNo()}
            </span>
          </div>
          <div class="presence-row">
            <span class="count">{members().length}</span>
            <span class="muted"> here</span>
            <ul class="members">
              <For each={members()}>
                {m => <li class={m.id === me?.id ? "me" : ""}>{m.name}</li>}
              </For>
            </ul>
          </div>
          <ol class="messages">
            <For each={messages()}>
              {m => (
                <li class={{ system: m.from === "system", mine: m.from === me?.name }}>
                  <span class="from">{m.from}</span>
                  <span class="text">{m.text}</span>
                  <time class="muted">{new Date(m.at).toLocaleTimeString()}</time>
                </li>
              )}
            </For>
          </ol>
          <props.composer room={room} />
        </section>
      );
    };
  })
);
