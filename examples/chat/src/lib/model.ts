// The simulated model. Server-only — imported solely by the `"use server"`
// module, so none of this (or the canned answers) ever reaches the client
// bundle. `generate()` streams like a real LLM: nothing about the reply's
// length or structure is known up front. It hands back four async faces of
// one generation:
//
//   text      — an async iterable of the ACCUMULATED markdown so far (the
//               whole reply, growing token by token — drives the reply's
//               live hole: the server re-renders the markdown per yield and
//               the browser morphs the message in place)
//   progress  — an async iterable of status lines ("42 tokens…"), the
//               live-ticker face (DR-2: an async iterable slot arg reads as
//               its latest yield on the client)
//   stats     — a promise of the final numbers, settling when generation
//               ends (DR-2: a promise slot arg suspends the client read)
//   usage     — structured events the server component folds into a
//               projection (DR-2 case 3) — see `ai.tsx`

export interface Stats {
  tokens: number;
  seconds: number;
  rate: number;
}

/** The structured face of a generation: one object, updated as it runs.
 *  Counts only — like a real stream, no totals exist until the end. */
export interface Usage {
  state: "thinking" | "generating" | "done";
  tokens: number;
  parts: number;
}

export interface Generation {
  text: AsyncIterable<string>;
  progress: AsyncIterable<string>;
  stats: Promise<Stats>;
  usage: AsyncIterable<Partial<Usage>>;
}

const ANSWERS: [RegExp, string][] = [
  [
    /server component|frame|stream/i,
    `A **server component** here is just a \`"use server"\` function that returns a component. The function's *arguments* are server inputs; the returned component's *props* are client positions — holes the client fills.

The markup renders once, on the server, and streams to the browser as HTML over the frame stream. The data behind it never crosses the wire as JSON — this very reply is one: the markdown renderer lives on the server and only its output travels.

\`\`\`jsx
"use server";
export async function reply(prompt) {
  const gen = generate(prompt);
  return props => (
    <section>
      <Message text={gen.text} />
      <props.status progress={gen.progress} stats={gen.stats} />
    </section>
  );
}
\`\`\`

Notice the slot at the end — \`props.status\` is a client position. The ticker under this reply is a client component reading async values passed straight through that border.`
  ],
  [
    /signal|reactiv|memo/i,
    `Solid's reactivity is built on three primitives:

- \`createSignal\` — a readable/writable value
- \`createMemo\` — a derived computation, cached until its sources change
- \`createEffect\` — a side effect, split into a tracked *compute* phase and an untracked *effect* phase

The key idea is **fine-grained subscriptions**: reads inside a tracked scope register dependencies automatically, so updates touch exactly the computations that read the changed value — no diffing, no re-rendering components.

\`\`\`js
const [count, setCount] = createSignal(0);
const doubled = createMemo(() => count() * 2);
createEffect(doubled, d => console.log(d));
\`\`\`

In 2.0 these live in \`@solidjs/signals\` and \`solid-js\` re-exports them with the component model layered on top.`
  ],
  [
    /markdown|marked/i,
    `The markdown you are reading right now was parsed by [marked](https://marked.js.org) — **on the server**. The parser is a dependency of the \`"use server"\` module only, so it is never bundled for the browser.

That is the single-copy principle: templates and the machinery that produces them stay wherever they run, and the client receives finished HTML exactly once.

1. Server parses markdown to HTML
2. HTML streams over the frame stream as the reply grows
3. Client adopts it — no parser, no re-render, no JSON twin of this text`
  ]
];

const FALLBACK = `Good question. Let me think out loud for a moment.

This chat is a demo of **Solid server components**: every reply you see is server-rendered markdown streaming into a client-owned transcript. The input box, the send button, and the list you are scrolling are ordinary client state — the replies are HTML produced elsewhere.

Under this reply there is a live ticker. While I "generate", it reads an *async iterable* the server passed across the slot border — each yield updates the same read in place. When I finish, a *promise* settles with the final stats and the ticker swaps to it. Both values crossed as themselves; the client subscribed, it never polled.

Ask me about *server components*, *signals*, or *markdown* to see a different answer.`;

// The t=0 greeting (see `greet()`): generation starts when the DOCUMENT
// renders, so these tokens stream over the page's own response — before the
// client bundle has even loaded. Kept short and fast-paced: the document
// response window stays open until the generation completes.
const GREETING = `Welcome to **Solid Chat** — and yes, I am typing this *into the page itself*. This greeting is a server component rendered in the initial document: generation started before any of the page's JavaScript loaded, and these words are streaming over the document's own response as HTML.

\`\`\`jsx
// even this code block streamed in as highlighted HTML —
// and its Copy button is a client handler on a server element
<button class="copy-code" onClick={props.copy}>Copy</button>
\`\`\`

When the app hydrates it adopts this reply mid-sentence and replays whatever it missed — no fetch, no JSON twin. Ask about **server components**, **signals**, or **markdown** and the next reply arrives the other way: a server-function call streaming over its own connection.`;

function answerFor(prompt: string): string {
  for (const [pattern, answer] of ANSWERS) {
    if (pattern.test(prompt)) return answer;
  }
  return FALLBACK;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * A push-driven async iterable. `generate`'s driver pushes into one channel
 * for the growing text, one for status lines and one for usage events;
 * consumers pull in order. Ends when its producer completes.
 */
function progressChannel<T = string>() {
  const queue: T[] = [];
  let notify: (() => void) | null = null;
  let done = false;
  const wake = () => {
    notify?.();
    notify = null;
  };
  return {
    push(value: T) {
      queue.push(value);
      wake();
    },
    end() {
      done = true;
      wake();
    },
    iterable: {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<T>> {
            while (queue.length === 0) {
              if (done) return { value: undefined, done: true };
              await new Promise<void>(r => (notify = r));
            }
            return { value: queue.shift()!, done: false };
          }
        };
      }
    } as AsyncIterable<T>
  };
}

export function generate(prompt: string): Generation {
  return run(answerFor(prompt), { pace: 220, think: 700 });
}

/** The t=0 generation: the greeting a document render starts producing.
 *  Faster cadence and no thinking pause — the document response holds open
 *  for exactly this window. */
export function greet(): Generation {
  return run(GREETING, { pace: 90, think: 120 });
}

function run(text: string, timing: { pace: number; think: number }): Generation {
  // Split retaining ALL whitespace (including the blank lines between
  // paragraphs) so every accumulated slice is exactly a prefix of the real
  // source — mid-stream markdown keeps the structure it depends on (lists,
  // code fences, paragraph breaks). The stream itself carries no structure:
  // like a real model, the consumer learns the reply's shape token by token.
  const words = text.split(/(?<=\s)/);
  const out = progressChannel();
  const channel = progressChannel();
  const usage = progressChannel<Partial<Usage>>();
  const stats = deferred<Stats>();

  (async () => {
    const started = Date.now();
    let tokens = 0;
    channel.push("thinking…");
    usage.push({ state: "thinking", tokens: 0, parts: 0 });
    await sleep(timing.think);
    for (let w = 0; w < words.length; w += 4) {
      await sleep(timing.pace);
      tokens += Math.min(4, words.length - w);
      const sofar = words.slice(0, w + 4).join("");
      // The whole reply so far, mid-thought: each push re-renders the
      // message's markdown on the server and morphs it in the browser.
      out.push(sofar);
      channel.push(`${tokens} tokens…`);
      // Paragraph count OBSERVED from the stream (a real generation knows
      // no totals — structure is discovered as it streams).
      usage.push({ state: "generating", tokens, parts: sofar.split(/\n\n+/).length });
    }
    const seconds = (Date.now() - started) / 1000;
    stats.resolve({
      tokens,
      seconds: Math.round(seconds * 10) / 10,
      rate: Math.round(tokens / seconds)
    });
    usage.push({ state: "done" });
    out.end();
    channel.end();
    usage.end();
  })();

  return {
    text: out.iterable,
    progress: channel.iterable,
    stats: stats.promise,
    usage: usage.iterable
  };
}
