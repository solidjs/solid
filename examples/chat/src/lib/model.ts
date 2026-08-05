// The simulated model. Server-only — imported solely by the `"use server"`
// module, so none of this (or the canned answers) ever reaches the client
// bundle. `generate()` starts producing immediately and hands back three
// async faces of one generation:
//
//   parts     — one promise per markdown paragraph, resolving in order as
//               "generation" reaches it (drives the reply's streamed reveal)
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
  parts: Promise<string>[];
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
 * A push-driven async iterable. `generate`'s driver pushes status lines as
 * tokens accrue; the consumer (seroval, streaming each yield to the client)
 * pulls them in order. Ends when generation completes.
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
  const paragraphs = answerFor(prompt).split(/\n\n+/);
  const parts = paragraphs.map(() => deferred<string>());
  const channel = progressChannel();
  const stats = deferred<Stats>();

  (async () => {
    const started = Date.now();
    let tokens = 0;
    channel.push("thinking…");
    await sleep(700);
    for (let i = 0; i < paragraphs.length; i++) {
      const words = paragraphs[i].split(/\s+/);
      for (let w = 0; w < words.length; w += 4) {
        await sleep(220);
        tokens += Math.min(4, words.length - w);
        channel.push(`${tokens} tokens…`);
      }
      parts[i].resolve(paragraphs[i]);
    }
    const seconds = (Date.now() - started) / 1000;
    stats.resolve({
      tokens,
      seconds: Math.round(seconds * 10) / 10,
      rate: Math.round(tokens / seconds)
    });
    channel.end();
  })();

  return { parts: parts.map(p => p.promise), progress: channel.iterable, stats: stats.promise };
}
