# Chat — live server components

An AI chat where the server owns the markup. A thread — its messages, the
markdown, the highlighted code — is rendered on the server and arrives as
HTML that keeps changing while a reply is written. It sits in the
server-owned, persistent corner of the examples.

Its twin is [../board](../board), the other persistent app, where the
browser owns the markup and the server sends only data.

```sh
pnpm dev                       # https://localhost:3009/  (self-signed cert)
HTTPS=0 pnpm dev               # http://localhost:3009/
pnpm build && pnpm start       # production harness, http://localhost:3009/
pnpm check                     # server checks, build, client-bundle check
```

With nothing configured it talks to a simulated model, which is enough to see
everything below. To talk to a real one, set one of these on the server:

```sh
# A model on your own machine, free, through Ollama (https://ollama.com):
ollama pull llama3.2
OPENAI_BASE_URL=http://localhost:11434/v1 CHAT_MODEL=llama3.2 pnpm dev

# Any hosted provider that speaks the OpenAI chat-completions API:
OPENAI_BASE_URL=https://… OPENAI_API_KEY=… CHAT_MODEL=… pnpm dev

# Claude, through Anthropic's SDK (CHAT_MODEL defaults to claude-opus-5-5):
ANTHROPIC_API_KEY=… pnpm dev
```

The choice is made in one file, [src/server/model.ts](./src/server/model.ts),
and nothing outside the server knows which was made.

## What to look at

Start with `HTTPS=0 CHAT_PACE=120 CHAT_SLOW=500 pnpm dev`. `CHAT_PACE` slows
the simulated model down; `CHAT_SLOW` delays the server storing a message, so
you can see the moment between sending and the server having it.

- **Close the tab.** Send a message, close the tab while the reply is being
  written, and open the same address again. The reply is there as far as it
  had got, and still growing. View the page's source: it is in the document.
- **Two tabs.** Open a thread in two tabs and send from one. Both show the
  reply as it is written. Stop in one stops it in both; rename it in one and
  the title changes in both, in the header and in the sidebar.
- **The bundle.** `pnpm check` builds the app and confirms the browser's
  scripts contain no markdown parser, no highlighter, no model SDK and no
  key name. The browser gets what they produce.
- **Send.** Your message shows under the thread the moment you press Enter,
  and gives way to the server's own row when the server has it.
- **Stop, and failure.** Stop keeps what had arrived. A message containing
  the word `crash` makes the simulated model fail part-way: the partial
  reply stays, with the reason and a Retry, in every tab and after a reload.
- **Every control is a form.** Send, Stop, Regenerate, Retry, Delete, and
  the title itself (type in it and press Enter). The server renders them
  inside markup it keeps re-sending, and a form you have submitted stays
  marked busy while that markup changes around it.
- **Without JavaScript** the page is still the thread, and those forms post
  and come back. Reload to see more of a reply.

## Generation is a job

Sending a message does three things and returns: it stores the prompt,
stores an empty reply, and starts a job
([src/server/generations.ts](./src/server/generations.ts)). The job belongs
to the server, not to the request. It reads from the model and writes the
reply into the thread as it arrives.

Nothing renders "the stream". Every render of a thread reads what is stored,
and is told when that changes. That one decision is why a closed tab loses
nothing, why two tabs agree, and why a reply that was being written when the
server stopped is, after a restart, a failed message with what it had — a
fact about the thread, not something left hanging.

## The thread is a live server component

[src/routes/thread.tsx](./src/routes/thread.tsx) is the screen.

```tsx
const getThread = liveQuery(
  live(async (id: string) => {
    "use server";
    return (props: { composer: ComposerSlot; copyCode: CopySlot }) => {
      const view = createMemo(() => db.watchThread(id, gone.signal));
      return (
        <article class="thread">
          …
          <ol class="messages">
            {view().messages.filter(m => m.status !== "generating").map(…)}
            {view().messages.filter(m => m.status === "generating").map(…)}
          </ol>
          <props.composer $key={id} threadId={id} seen={…} busy={…} />
        </article>
      );
    };
  }),
  "thread"
);
```

`live` holds the response open and reconnects it if it dies. `liveQuery`
gives it a key and one connection per thread.

Each `{…}` that reads `view()` is a piece of the page the server can send
again by itself, and it sends one only when its HTML has changed. The thread
is cut along the line that matters: the finished messages are one piece, the
reply being written is another. A token re-sends the reply and nothing else.

One thing to know when writing markup the server re-sends: **one source per
render, read at the top.** A watcher created per message, inside the list,
never settles: each retry of the render makes a new one.

## What the browser owns

- **The composer** ([src/components/composer.tsx](./src/components/composer.tsx))
  is where a person types. The server places it with a slot
  (`<props.composer …/>`), keyed by thread so a half-typed message stays with
  its conversation. Its form is the send action; the message it shows while
  the server does not have it yet steps aside by derivation, the moment the
  server's render says it has that id (`seen`).
- **Copy.** Each code block's button is a client component
  ([src/components/copy-code.tsx](./src/components/copy-code.tsx)) that the
  server places in the block with the block's text
  (`<Copy $key={…} code={…} />`), including in the reply being written. The
  key is the message and the block's place in it, so while the reply grows
  the button stays mounted and gets each new text as a prop, and when the
  reply finishes and moves into the finished list it is the same button.
- **Navigation.** The sidebar is a second live server component
  (`getThreads` in [src/router.tsx](./src/router.tsx)): the list of threads,
  with a mark where a reply is being written. Its links are server markup;
  the router claims them and marks the current one. When the list changes
  the thread beside it is untouched, half-typed message included.

## Notes

- **Every open tab holds a render on the server.** That is the cost of this
  corner: the server keeps one live render per open thread per tab.
- **When a reply finishes it moves** from the "being written" piece to the
  "finished" piece, so its elements are replaced once at that moment. An open
  Reasoning disclosure closes.
- **Two connections per tab**: the sidebar and the open thread. That is why
  `pnpm dev` serves HTTPS, which Vite speaks as HTTP/2; a browser allows only
  six connections per origin over HTTP/1.1.
- **One reply at a time per thread.** Sending while one is being written is
  refused.
- **Only the last reply can be written again.** Regenerate and Retry replace
  it in place.
- **Not here:** accounts, attachments, tools, editing a sent message. Anyone
  at the address sees the same threads.
- **In dev**, editing a source file reloads the server module and the
  in-memory threads are gone. `CHAT_STORAGE=fs` keeps them in `.data/`.
