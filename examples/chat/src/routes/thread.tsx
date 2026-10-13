// A thread. The whole of it — the title, every message, the markdown, the
// highlighted code — is rendered on the server and arrives as HTML that
// keeps changing: `getThread` is a live server component, so the browser
// holds its response open and morphs in what the server renders next.
//
// What it renders is what is stored. The reply being written is written by a
// job (server/generations.ts), not by this render and not by the request
// that sent the prompt. So closing the tab loses nothing, a reload shows the
// reply as far as it has got, and two tabs show the same thing.
//
// The browser owns two things here, and the server places both: the
// composer, a client component in a slot at the foot of the thread, and what
// the Copy button on a code block does.
import { createMemo, For, Loading, onCleanup } from "solid-js";
import { dynamicComponent, getRequestEvent } from "@solidjs/web";
import { GET, live } from "@solidjs/web/server-functions";
import type { BindingSlot, Slot } from "@solidjs/web/frames";
import { action, liveQuery, type RouteSectionProps } from "@solidjs/router";
import Composer from "~/components/composer";
import * as db from "~/server/db";
import * as generations from "~/server/generations";
import * as markdown from "~/server/markdown";
import type { Message } from "~/types";

type ComposerSlot = Slot<{ threadId: string; seen: string[]; busy: boolean }>;
type CopyHandler = (e: MouseEvent & { currentTarget: HTMLButtonElement }) => void;
type CodeBlockSlot = BindingSlot<{}, { onCopy: CopyHandler }>;

// Stops the reply being written. A plain form posts it, so it works before
// the page's JavaScript has loaded; the thread's own stream shows the result.
const stopGeneration = action(async (replyId: string) => {
  "use server";
  generations.stop(replyId);
}, "stopGeneration");

// `live` holds the response open and reconnects it if it dies; `liveQuery`
// gives it a key and one connection per thread, and tells the router that
// this address is kept fresh by its own stream.
const getThread = liveQuery(
  live(
    GET(async (id: string) => {
      "use server";
      return (props: { composer: ComposerSlot; codeBlock: CodeBlockSlot }) => {
        // This render lives as long as its response. When the tab goes away
        // the watcher below is told at once.
        const gone = new AbortController();
        onCleanup(() => gone.abort());
        getRequestEvent()?.request.signal.addEventListener("abort", () => gone.abort(), {
          once: true
        });

        // The thread as it is stored, again after every write to it.
        const view = createMemo(() => db.watchThread(id, gone.signal));

        const block = props.codeBlock();

        return (
          <article class="thread">
            <header class="thread-head">
              <h1>{view().thread?.title ?? "No such conversation"}</h1>
            </header>
            <ol class="messages">
              {view()
                .messages.filter(m => m.status !== "generating")
                .map(message => messageMarkup(message, block))}
              {view()
                .messages.filter(m => m.status === "generating")
                .map(message => messageMarkup(message, block))}
            </ol>
            <props.composer
              threadId={id}
              seen={view().messages.map(m => m.id)}
              busy={view().messages.some(m => m.status === "generating")}
            />
          </article>
        );
      };
    })
  ),
  "thread"
);

// One message as markup. A plain function, not a component: the server
// re-runs the read that called it and sends the result, and there is nothing
// here to keep between runs.
//
// Every condition below tests a local, not a property. The compiler wraps a
// condition it cannot see through (`message.usage && …`) in a memo, and a
// read the server re-runs cannot create one.
function messageMarkup(message: Message, block: { onCopy: CopyHandler }) {
  const { id, text, reasoning, error, usage } = message;
  if (message.role === "user") {
    return (
      <li class="message user" data-id={id}>
        <p>{text}</p>
      </li>
    );
  }
  const generating = message.status === "generating";
  const stopped = message.status === "stopped";
  const failed = message.status === "failed";
  return (
    <li class={`message assistant ${message.status}`} data-id={id}>
      {reasoning && (
        <details class="reasoning">
          <summary>Reasoning</summary>
          <p>{reasoning}</p>
        </details>
      )}
      <div class="md">
        {markdown.render(text, generating).map(segment =>
          segment.code ? (
            <div class="code-block">
              <button class="copy-code" type="button" onClick={block.onCopy}>
                Copy
              </button>
              <pre>
                <code class="hljs" innerHTML={segment.html} />
              </pre>
            </div>
          ) : (
            <div innerHTML={segment.html} />
          )
        )}
      </div>
      <footer class="message-foot">
        {generating && <span class="typing" aria-label="Writing" />}
        {generating && (
          <form action={stopGeneration.with(id)} method="post">
            <button type="submit">Stop</button>
          </form>
        )}
        {stopped && <span class="muted">Stopped</span>}
        {failed && <span class="error">{error}</span>}
        {usage && (
          <span class="muted">
            {usage.tokens} tokens · {usage.seconds}s
          </span>
        )}
      </footer>
    </li>
  );
}

// What Copy does, for every code block in the thread: one handler, bound by
// the server to each button it renders. It reads the code from the page.
const copyCode: CopyHandler = e => {
  const button = e.currentTarget;
  const code = button.parentElement?.querySelector("code");
  if (!code) return;
  navigator.clipboard.writeText(code.textContent ?? "").catch(() => {});
  button.textContent = "Copied";
  setTimeout(() => (button.textContent = "Copy"), 1200);
};

export default function ThreadRoute(props: RouteSectionProps) {
  const Thread = dynamicComponent(() => getThread(String(props.params.id)));
  return (
    <Loading fallback={<p class="muted">Loading the conversation…</p>}>
      <Thread
        composer={p => <Composer threadId={p.threadId} seen={p.seen} busy={p.busy} />}
        codeBlock={() => ({ onCopy: copyCode })}
      />
    </Loading>
  );
}
