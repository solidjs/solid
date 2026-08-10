"use server";
// The server component. `reply(prompt)` starts a (simulated) generation and
// returns the component that renders its markdown — on the server. The
// browser never sees `marked` or the canned answers; it receives finished
// HTML, one paragraph at a time as generation reaches it.
//
// Two kinds of liveness cross the border here, both written the same way —
// plain reactive expressions:
//
//   - MARKUP: each `<Part>` renders markdown into a live hole (`{text()}`
//     feeding `innerHTML`) — the server re-renders the paragraph on every
//     yield and the browser morphs it in place, no client component.
//   - SLOT ARGS: `progress={progress()}` and `stats={stats()}` are the same
//     expression shape at a client position (DR-2 case 1) — the server
//     re-evaluates them on every commit and re-ships the occurrence's
//     record, updating the client fill's props live. A not-ready read
//     (stats settles only when generation ends) is pending PER-ARG: the
//     fill renders immediately and its own <Loading> covers that read.
//
// Slots render as JSX (`<props.status …/>`), never as calls: the compiler
// wraps each prop in a getter, so reads defer to the slot border where the
// runtime owns them. A call form (`props.status({ … })`) evaluates its args
// eagerly in this component's body — a top-level read, an error in most
// cases. (To hand the client the async value ITSELF — the raw promise or
// iterable, consumer-controlled — wrap it in `asyncArg` instead.)
import { createMemo, Loading } from "solid-js";
import { type Slot } from "@solidjs/web/frames";
import { marked } from "marked";
import { generate, greet, type Stats } from "./model";

export type StatusSlot = Slot<{ progress: string; stats: Stats }>;

export async function reply(prompt: string) {
  const gen = generate(prompt);
  return (props: { status: StatusSlot }) => {
    // Async values read through memos: `progress()` is the iterable's
    // latest yield, `stats()` the promise's resolution (not-ready until it
    // lands). The same reads would feed markup holes — here they feed the
    // slot border.
    const progress = createMemo(() => gen.progress);
    const stats = createMemo(() => gen.stats);
    return (
      <section class="reply">
        {gen.parts.map(part => (
          <Part text={part} />
        ))}
        <props.status progress={progress()} stats={stats()} />
      </section>
    );
  };
}

/**
 * The t=0 face (Stage 4). Same component shape as `reply`, but rendered
 * INTO the initial document rather than answering a call: at SSR the direct
 * result renders inline, generation starts with the page, and every yield
 * past the first re-emits over the document's own response — first tokens
 * paint through the streamed fragments before any JavaScript runs, the rest
 * ride the `sc:live` channel and morph in after hydration adopts this
 * boundary (the catch-up replay covers whatever landed in between). The
 * slot args are just as live: their record re-emissions ride the same
 * channel. One component, both transports: this exact markup machinery
 * answers `reply()` calls after the page is up.
 */
export async function welcome() {
  const gen = greet();
  return (props: { status: StatusSlot }) => {
    const progress = createMemo(() => gen.progress);
    const stats = createMemo(() => gen.stats);
    return (
      <section class="reply">
        {gen.parts.map(part => (
          <Part text={part} />
        ))}
        <props.status progress={progress()} stats={stats()} />
      </section>
    );
  };
}

/**
 * One markdown paragraph, streaming token by token — a live markup hole
 * (Stage 3), no client component. `props.text` is an async iterable of the
 * GROWING text; the memo's read is its latest yield. The first read
 * suspends this hole (each part gets its own `<Loading>`, so the reply
 * still reveals paragraph by paragraph), and every later yield re-renders
 * the markdown here on the server — the hole's binding re-emits the HTML
 * and the browser morphs the paragraph in place, mid-sentence.
 */
function Part(props: { text: AsyncIterable<string> }) {
  const text = createMemo(() => props.text);
  return (
    <Loading fallback={<p class="typing">▍</p>}>
      <div class="md" innerHTML={marked.parse(text(), { async: false }) as string} />
    </Loading>
  );
}
