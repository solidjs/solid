import "server-only";
// The model. One interface — a stream of text and reasoning deltas over a
// conversation — and, for now, one adapter: a simulated model that needs no
// key. Like a real one it knows nothing about a reply's length or shape up
// front, takes a moment to start, and can be cut off or fail part-way.
//
// CHAT_PACE=<ms> sets the gap between chunks (default 60).
import type { Message } from "~/types";

export interface Delta {
  type: "text" | "reasoning";
  delta: string;
}

export type History = Pick<Message, "role" | "text">[];

/** The word that makes the simulated model fail part-way through its reply. */
export const FAILURE_WORD = "crash";

interface Answer {
  reasoning?: string;
  text: string;
}

const ANSWERS: [RegExp, Answer][] = [
  [
    /server component|markup|html/i,
    {
      text: `A **server component** is a \`"use server"\` function that returns a component. Its arguments are the server's inputs; the component's props are the places a client fills in.

This thread is one. It renders on the server, from the messages the server has stored, and reaches the browser as HTML that keeps changing while I type:

\`\`\`jsx
const getThread = liveQuery(
  live(GET(async (id) => {
    "use server";
    return props => <Thread id={id} composer={props.composer} />;
  })),
  "thread"
);
\`\`\`

The markdown parser and the syntax highlighter that produced this reply never reach the browser. Only what they produce does.`
    }
  ],
  [
    /signal|reactiv|memo/i,
    {
      reasoning: `They asked about reactivity. Three primitives cover it: a value, a derivation, an effect. Keep it short and show the split effect, since that is the part that differs from other libraries.`,
      text: `Solid's reactivity rests on three primitives:

- \`createSignal\` — a value you can read and write
- \`createMemo\` — a derivation, cached until what it read changes
- \`createEffect\` — a side effect, split into a tracked half that reads and an untracked half that acts

Reads inside a tracked scope subscribe by themselves, so an update reaches exactly the computations that read what changed.

\`\`\`js
const [count, setCount] = createSignal(0);
const doubled = createMemo(() => count() * 2);
createEffect(doubled, d => console.log(d));
\`\`\``
    }
  ],
  [
    /reload|close|tab|durable|job/i,
    {
      text: `Try it: send a message, then **close this tab** while I am still answering, and open the same address again.

The reply is there, as far as it had got, and it is still growing. View the page's source and you will find it in the document.

That works because generating is not something the request does. Sending a message stores it, starts a job on the server, and returns. The job writes the reply into the thread as it arrives, and every open render of the thread shows what is stored.`
    }
  ]
];

const FALLBACK: Answer = {
  text: `This is a **simulated model**, so the conversation is short on surprises. Set \`ANTHROPIC_API_KEY\` on the server to talk to a real one.

What is real is everything around it. This reply is rendered on the server and arrives as HTML. It was written into the thread by a job that outlives the request that started it.

Ask about *server components*, *signals*, or what happens when you *close the tab*. A message containing the word \`${FAILURE_WORD}\` makes me fail part-way, so you can see what that looks like.`
};

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", stop);
      resolve();
    }
    function stop() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener("abort", stop, { once: true });
  });

async function* simulated(history: History, signal: AbortSignal): AsyncGenerator<Delta> {
  const pace = Number(process.env.CHAT_PACE || 60);
  const prompt = history.findLast(m => m.role === "user")?.text ?? "";
  const answer = ANSWERS.find(([pattern]) => pattern.test(prompt))?.[1] ?? FALLBACK;
  const fails = new RegExp(`\\b${FAILURE_WORD}\\b`, "i").test(prompt);

  await sleep(pace * 6, signal); // time to first token
  // Split keeping all whitespace, so every prefix is a prefix of the source
  // and half-arrived markdown keeps the structure it depends on.
  const chunk = (text: string) => text.split(/(?<=\s)/);
  for (const word of chunk(answer.reasoning ?? "")) {
    await sleep(pace / 2, signal);
    yield { type: "reasoning", delta: word };
  }
  const words = chunk(answer.text);
  for (let i = 0; i < words.length; i += 3) {
    await sleep(pace, signal);
    if (fails && i > words.length / 3) throw new Error("The simulated model crashed, as asked");
    yield { type: "text", delta: words.slice(i, i + 3).join("") };
  }
}

/**
 * The reply to `history`, as it is produced. Ends when the reply does;
 * rejects with the signal's reason when aborted, or with the model's error.
 */
export function stream(history: History, signal: AbortSignal): AsyncIterable<Delta> {
  return simulated(history, signal);
}

/** Which model is answering, for the page to say. */
export const modelName = () => "a simulated model";
