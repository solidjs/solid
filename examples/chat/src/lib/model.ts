// The simulated model. Server-only — imported solely by the `"use server"`
// module, so none of this (or the canned answers) ever reaches the client
// bundle. `generate()` starts producing immediately and hands back three
// async faces of one generation:
//
//   parts     — one async iterable per markdown paragraph, yielding the
//               GROWING text as tokens accrue (drives the reply's live
//               holes: the server re-renders the markdown per yield and the
//               browser morphs the paragraph in place)
//   progress  — an async iterable of status lines ("42 tokens…"), the
//               live-ticker face (DR-2: an async iterable slot arg reads as
//               its latest yield on the client)
//   stats     — a promise of the final numbers, settling when generation
//               ends (DR-2: a promise slot arg suspends the client read)

export interface Stats {
  tokens: number;
  seconds: number;
  rate: number;
}

export interface Generation {
  parts: AsyncIterable<string>[];
  progress: AsyncIterable<string>;
  stats: Promise<Stats>;
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
      {gen.parts.map(part => <Part text={part} />)}
      {props.status({ progress: gen.progress, stats: gen.stats })}
    </section>
  );
}
\`\`\`

Notice the slot call at the end — \`props.status\` is a client position. The ticker under this reply is a client component reading two async values passed straight through that border.`
  ],
  [
    /signal|reactiv|memo/i,
    `Solid's reactivity is built on three primitives:

- \`createSignal\` — a readable/writable value
- \`createMemo\` — a derived computation, cached until its sources change
- \`createEffect\` — a side effect that re-runs when its sources change

The key idea is **fine-grained subscriptions**: reads inside a tracked scope register dependencies automatically, so updates touch exactly the computations that read the changed value — no diffing, no re-rendering components.

\`\`\`js
const [count, setCount] = createSignal(0);
const doubled = createMemo(() => count() * 2);
createEffect(() => console.log(doubled()));
\`\`\`

In 2.0 these live in \`@solidjs/signals\` and \`solid-js\` re-exports them with the component model layered on top.`
  ],
  [
    /markdown|marked/i,
    `The markdown you are reading right now was parsed by [marked](https://marked.js.org) — **on the server**. The parser is a dependency of the \`"use server"\` module only, so it is never bundled for the browser.

That is the single-copy principle: templates and the machinery that produces them stay wherever they run, and the client receives finished HTML exactly once.

1. Server parses markdown to HTML
2. HTML streams over the frame stream, paragraph by paragraph
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
 * per paragraph (the growing text) and one for status lines; consumers pull
 * in order. Ends when its producer completes.
 */
function progressChannel() {
  const queue: string[] = [];
  let notify: (() => void) | null = null;
  let done = false;
  const wake = () => {
    notify?.();
    notify = null;
  };
  return {
    push(line: string) {
      queue.push(line);
      wake();
    },
    end() {
      done = true;
      wake();
    },
    iterable: {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<string>> {
            while (queue.length === 0) {
              if (done) return { value: undefined, done: true };
              await new Promise<void>(r => (notify = r));
            }
            return { value: queue.shift()!, done: false };
          }
        };
      }
    } as AsyncIterable<string>
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
  const paragraphs = text.split(/\n\n+/);
  const parts = paragraphs.map(() => progressChannel());
  const channel = progressChannel();
  const stats = deferred<Stats>();

  (async () => {
    const started = Date.now();
    let tokens = 0;
    channel.push("thinking…");
    await sleep(timing.think);
    for (let i = 0; i < paragraphs.length; i++) {
      // Split retaining whitespace so mid-stream slices keep the newlines
      // markdown structure depends on (lists, code fences).
      const words = paragraphs[i].split(/(?<=\s)/);
      for (let w = 0; w < words.length; w += 4) {
        await sleep(timing.pace);
        tokens += Math.min(4, words.length - w);
        // The growing paragraph, mid-thought: each push re-renders the
        // part's markdown on the server and morphs it in the browser.
        parts[i].push(words.slice(0, w + 4).join(""));
        channel.push(`${tokens} tokens…`);
      }
      parts[i].end();
    }
    const seconds = (Date.now() - started) / 1000;
    stats.resolve({
      tokens,
      seconds: Math.round(seconds * 10) / 10,
      rate: Math.round(tokens / seconds)
    });
    channel.end();
  })();

  return { parts: parts.map(p => p.iterable), progress: channel.iterable, stats: stats.promise };
}
