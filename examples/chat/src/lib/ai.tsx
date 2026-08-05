"use server";
// The server component. `reply(prompt)` starts a (simulated) generation and
// returns the component that renders its markdown — on the server. The
// browser never sees `marked` or the canned answers; it receives finished
// HTML, one paragraph at a time as generation reaches it.
//
// The slot call at the bottom is the DR-2 showcase: `props.status` is a
// client position, and the args passed through it cross the border AS
// async values — `progress` (an async iterable the client reads as its
// latest yield) and `stats` (a promise the client read suspends on until
// generation completes). What you pass is what ships.
import { createMemo, Loading } from "solid-js";
import { asyncArg, type Slot } from "@solidjs/web/frames";
import { marked } from "marked";
import { generate, type Stats } from "./model";

export type StatusSlot = Slot<{ progress: string; stats: Stats }>;

export async function reply(prompt: string) {
  const gen = generate(prompt);
  return (props: { status: StatusSlot }) => (
    <section class="reply">
      {gen.parts.map(part => (
        <Part text={part} />
      ))}
      {props.status({ progress: asyncArg(gen.progress), stats: asyncArg(gen.stats) })}
    </section>
  );
}

/**
 * One markdown paragraph, revealed when its promise resolves. The async
 * memo's read suspends this hole; each part gets its own `<Loading>` so the
 * reply streams paragraph by paragraph instead of waiting whole.
 */
function Part(props: { text: Promise<string> }) {
  const text = createMemo(() => props.text);
  return (
    <Loading fallback={<p class="typing">▍</p>}>
      <div class="md" innerHTML={marked.parse(text(), { async: false }) as string} />
    </Loading>
  );
}
