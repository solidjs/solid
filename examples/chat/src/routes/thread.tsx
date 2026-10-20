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
// composer, a client component in a slot at the foot of the thread, and each
// code block's Copy button, a client component in a slot in that block.
import { createMemo, For, Loading, onCleanup } from "solid-js";
import { dynamicComponent, getRequestEvent, redirect } from "@solidjs/web";
import { GET, live } from "@solidjs/web/server-functions";
import type { Slot } from "@solidjs/web/frames";
import { formAction, liveQuery, type RouteSectionProps } from "@solidjs/router";
import Composer from "~/components/composer";
import CopyCode from "~/components/copy-code";
import * as db from "~/server/db";
import * as generations from "~/server/generations";
import * as markdown from "~/server/markdown";
import * as model from "~/server/model";
import type { Message, Thread } from "~/types";

type ComposerSlot = Slot<{ threadId: string; seen: string[]; busy: boolean }>;
type CopySlot = Slot<{ code: string }>;

// Stops the reply being written. A plain form posts it, so it works before
// the page's JavaScript has loaded; the thread's own stream shows the result.
const stopGeneration = formAction(async (replyId: string) => {
  "use server";
  generations.stop(replyId);
}, "stopGeneration");

// Writes the last reply again: Regenerate on a finished one, Retry on a
// failed one. Like sending, it starts a job and returns.
const regenerate = formAction(async (replyId: string) => {
  "use server";
  try {
    const { threadId } = await db.restart(replyId);
    generations.start(threadId, replyId);
  } catch (err) {
    if (err instanceof db.Rejected) return { error: err.message };
    throw err;
  }
}, "regenerate");

const renameThread = formAction(async (id: string, form: FormData) => {
  "use server";
  try {
    await db.renameThread(id, String(form.get("title") ?? ""));
  } catch (err) {
    if (err instanceof db.Rejected) return { error: err.message };
    throw err;
  }
}, "renameThread");

// Deleting leaves nothing to look at, so it answers with where to go.
const deleteThread = formAction(async (id: string) => {
  "use server";
  const writing = await db.deleteThread(id);
  if (writing) generations.stop(writing);
  return redirect("/");
}, "deleteThread");

// `live` holds the response open and reconnects it if it dies; `liveQuery`
// gives it a key and one connection per thread, and tells the router that
// this address is kept fresh by its own stream.
const getThread = liveQuery(
  live(
    GET(async (id: string) => {
      "use server";
      return (props: { composer: ComposerSlot; copyCode: CopySlot }) => {
        // This render lives as long as its response. When the tab goes away
        // the watcher below is told at once.
        const gone = new AbortController();
        onCleanup(() => gone.abort());
        getRequestEvent()?.request.signal.addEventListener("abort", () => gone.abort(), {
          once: true
        });

        // The thread as it is stored, again after every write to it.
        const view = createMemo(() => db.watchThread(id, gone.signal));

        return (
          <article class="thread">
            <header class="thread-head">
              {headMarkup(view().thread)}
              <p class="muted">Answered by {model.modelName()}</p>
            </header>
            <ol class="messages">
              {/* A row the server has already rendered is kept while its
                  message is unchanged, so a streaming reply doesn't render
                  the whole history again on every write (#4056). */}
              <For each={view().messages.filter(m => m.status !== "generating")}>
                {message => messageMarkup(message, props.copyCode)}
              </For>
              {messagesMarkup(view().messages, true, props.copyCode)}
            </ol>
            {/* Keyed by thread: going to another conversation is a new
                composer, so a half-typed message stays with its thread. */}
            <props.composer
              $key={id}
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

// The title is its own editor: a form around a field, so renaming is typing
// and pressing Enter, with or without JavaScript.
function headMarkup(thread: Thread | undefined) {
  if (!thread) return <h1>No such conversation</h1>;
  return (
    <div class="thread-title">
      <h1>
        <form action={renameThread.with(thread.id)} method="post">
          <input name="title" value={thread.title} aria-label="Title" required maxlength="60" />
        </form>
      </h1>
      <form action={deleteThread.with(thread.id)} method="post">
        <button type="submit">Delete</button>
      </form>
    </div>
  );
}

// The finished messages, or the one being written.
function messagesMarkup(messages: Message[], writing: boolean, Copy: CopySlot) {
  return messages
    .filter(m => (m.status === "generating") === writing)
    .map(message => messageMarkup(message, Copy));
}

// One message as markup. A plain function, not a component: the server
// re-runs the read that called it and sends the result, and there is nothing
// here to keep between runs. The Copy buttons are kept by the browser: each
// is keyed by its message and place, so it is the same button while the
// reply is written and after it moves into the finished list.
function messageMarkup(message: Message, Copy: CopySlot) {
  const { id, text } = message;
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
  // Every finished reply carries its Retry/Regenerate form and the
  // stylesheet shows it only on the last message, so a row depends on
  // nothing but its own message.
  const again = !generating && (failed ? "Retry" : "Regenerate");
  return (
    <li class={`message assistant ${message.status}`} data-id={id}>
      {message.reasoning && (
        <details class="reasoning">
          <summary>Reasoning</summary>
          <p>{message.reasoning}</p>
        </details>
      )}
      <div class="md">
        {markdown.render(text, generating).map((segment, i) =>
          segment.code ? (
            <div class="code-block">
              <Copy $key={`${id}.${i}`} code={segment.text!} />
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
        {failed && <span class="error">{message.error}</span>}
        {message.usage && (
          <span class="muted">
            {message.usage.tokens} tokens · {message.usage.seconds}s
          </span>
        )}
        {again && (
          <form class="again" action={regenerate.with(id)} method="post">
            <button type="submit">{again}</button>
          </form>
        )}
      </footer>
    </li>
  );
}

export default function ThreadRoute(props: RouteSectionProps) {
  const Thread = dynamicComponent(() => getThread(String(props.params.id)));
  return (
    <Loading fallback={<p class="muted">Loading the conversation…</p>}>
      <Thread
        composer={p => <Composer threadId={p.threadId} seen={p.seen} busy={p.busy} />}
        copyCode={p => <CopyCode code={p.code} />}
      />
    </Loading>
  );
}
