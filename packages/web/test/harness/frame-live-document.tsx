/**
 * @jsxImportSource @solidjs/web
 *
 * Fixture for the DOCUMENT face of a live server component (Stage 8 B3):
 * `dynamic(() => room("a"))` where `room` is `live(...)` and answers with a
 * component. Shared by test/server/frame-live-document-artifact.spec.tsx
 * (renders the document, writes the chunk artifact) and
 * test/hydration/frame-live-document.spec.tsx (replays it, hydrates, and
 * drives the takeover). Same tree on both sides so hydration ids agree; only
 * the SOURCE differs — the server's in-process answer (a promise of the
 * branded component) and the client's live reference.
 */
import { createMemo, createSignal, Loading } from "solid-js";
import { dynamic } from "@solidjs/web";

// One function id per replay mode: a document boundary is claimable exactly
// once per page (module state in the frames client), and the hydration spec
// replays every mode in one jsdom page. The document is the same for all
// of them; the modes name what the CLIENT does with it — `loaded` replays
// the whole document before hydrating, `streamed` hydrates the shell and
// lands the boundary after, `switched` changes the call's arguments after
// adoption (the identity-minted-in-the-browser shape).
export const MODES = ["loaded", "streamed", "switched"] as const;
export const REPLAY_MODES = ["loaded", "streamed"] as const;
export type Mode = (typeof MODES)[number];
export const fidFor = (mode: Mode) => `frame-live-doc/room-${mode}`;
export const ARGS = ["a"];

/** A client slot fill with state of its own: the draft must survive a morph. */
export function Composer(props: { room: string }) {
  const [text, setText] = createSignal("");
  return (
    <input
      class="draft"
      value={text()}
      onInput={e => setText(e.currentTarget.value)}
      placeholder={`Message #${props.room}`}
    />
  );
}

/**
 * The page: the room under a `Loading`, mounted through `dynamic`. The
 * `dynamic()` call is INSIDE the render (as in an app's component body), so
 * its memo is created under hydration on the client and gets the hydration
 * wrapper — the takeover arms there.
 */
export function makeApp(source: () => any) {
  return () => {
    const Room = dynamic(source);
    return (
      <main>
        <Loading fallback={<p class="fb">shell-fallback</p>}>
          <Room composer={(p: any) => <Composer room={p.room} />} />
        </Loading>
      </main>
    );
  };
}

/**
 * The server component: a STANDING source (never ends) read through a memo,
 * and a client slot. On the document face under the live scope the memo
 * takes the first value and closes the source; `state` records it.
 */
export function makeRoomComponent(label: string) {
  const state = { closed: false, pulls: 0 };
  const source: AsyncIterable<string> = {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: () => {
          state.pulls++;
          return new Promise<IteratorResult<string>>(r =>
            setTimeout(() => r({ done: false, value: `${label} v${++i}` }), 2)
          );
        },
        return: () => {
          state.closed = true;
          return Promise.resolve({ done: true as const, value: undefined });
        }
      };
    }
  };
  const RoomComponent = (props: { composer: any }) => {
    const title = createMemo(() => source);
    return (
      <article>
        <h1>{title()}</h1>
        <ul>
          <props.composer room="a" />
        </ul>
      </article>
    );
  };
  return { RoomComponent, state };
}
