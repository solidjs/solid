import "server-only";
// The model. One interface — a stream of text and reasoning deltas over a
// conversation — and three adapters behind it, chosen by the server's
// environment:
//
//   OPENAI_BASE_URL     any server that speaks the OpenAI chat-completions
//                       API: a local one such as Ollama
//                       (http://localhost:11434/v1), or a hosted one, with
//                       OPENAI_API_KEY if it wants a key. Needs CHAT_MODEL.
//   ANTHROPIC_API_KEY   Claude, through Anthropic's SDK. CHAT_MODEL picks the
//                       model (default claude-opus-5-5).
//   neither             a simulated model. Like a real one it knows nothing
//                       about a reply's length or shape up front, takes a
//                       moment to start, and can be cut off or fail part-way.
//                       CHAT_PACE=<ms> sets the gap between its chunks
//                       (default 60).
//
// The keys, the SDK and the canned answers all live here, on the server.
import Anthropic from "@anthropic-ai/sdk";
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
  text: `This is a **simulated model**, so the conversation is short on surprises. The README says how to point this at a real one.

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

type Provider = "openai-compatible" | "anthropic" | "simulated";
const provider = (): Provider =>
  process.env.OPENAI_BASE_URL
    ? "openai-compatible"
    : process.env.ANTHROPIC_API_KEY
      ? "anthropic"
      : "simulated";
const claudeModel = () => process.env.CHAT_MODEL || "claude-opus-5-5";

// What went wrong, worded for the person reading the thread. The SDK's own
// messages can carry request details, and those stay in the server's log.
function explain(err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError) return new Error("The API key was rejected");
  if (err instanceof Anthropic.RateLimitError)
    return new Error("The model is busy. Try again in a moment");
  if (err instanceof Anthropic.APIConnectionError) return new Error("Couldn't reach the model");
  if (err instanceof Anthropic.APIError) return new Error("The model returned an error");
  return err instanceof Error ? err : new Error("The model stopped answering");
}

async function* claude(history: History, signal: AbortSignal): AsyncGenerator<Delta> {
  const client = new Anthropic();
  try {
    const events = client.messages.stream(
      {
        model: claudeModel(),
        max_tokens: 64000,
        // Thinking is summarized so the page has reasoning to show.
        thinking: { type: "adaptive", display: "summarized" },
        messages: history.map(m => ({ role: m.role, content: m.text }))
      },
      { signal }
    );
    for await (const event of events) {
      if (event.type !== "content_block_delta") continue;
      if (event.delta.type === "text_delta") yield { type: "text", delta: event.delta.text };
      else if (event.delta.type === "thinking_delta")
        yield { type: "reasoning", delta: event.delta.thinking };
    }
    const final = await events.finalMessage();
    if (final.stop_reason === "refusal") throw new Error("The model declined to answer that");
    if (final.stop_reason === "max_tokens")
      throw new Error("The reply was cut off at its length limit");
  } catch (err) {
    if (signal.aborted) throw signal.reason;
    console.error(err);
    throw explain(err);
  }
}

// The OpenAI chat-completions shape, streamed: server-sent events, each a
// JSON chunk with the next piece of the reply. Plain `fetch`, since the shape
// is the whole interface. Reasoning has no agreed field, so the two names in
// common use are read and anything else is ignored.
async function* openAiCompatible(history: History, signal: AbortSignal): AsyncGenerator<Delta> {
  const model = process.env.CHAT_MODEL;
  if (!model) throw new Error("Set CHAT_MODEL to the model to use");
  const base = process.env.OPENAI_BASE_URL!.replace(/\/+$/, "");
  const key = process.env.OPENAI_API_KEY;
  let response: Response;
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        ...(key ? { authorization: `Bearer ${key}` } : {})
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: history.map(m => ({ role: m.role, content: m.text }))
      })
    });
  } catch (err) {
    if (signal.aborted) throw signal.reason;
    console.error(err);
    throw new Error("Couldn't reach the model");
  }
  if (!response.ok || !response.body) {
    console.error(`${response.status} from ${base}:`, await response.text().catch(() => ""));
    throw new Error(
      response.status === 401 || response.status === 403
        ? "The API key was rejected"
        : response.status === 429
          ? "The model is busy. Try again in a moment"
          : response.status === 404
            ? `The provider has no model called "${model}"`
            : "The model returned an error"
    );
  }

  const decoder = new TextDecoder();
  let buffered = "";
  try {
    for await (const bytes of response.body) {
      buffered += decoder.decode(bytes, { stream: true });
      // An event can arrive split across reads: keep the unfinished line.
      const lines = buffered.split("\n");
      buffered = lines.pop()!;
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        const choice = JSON.parse(data).choices?.[0];
        const delta = choice?.delta;
        const reasoning = delta?.reasoning_content ?? delta?.reasoning;
        if (typeof reasoning === "string" && reasoning)
          yield { type: "reasoning", delta: reasoning };
        if (typeof delta?.content === "string" && delta.content) {
          yield { type: "text", delta: delta.content };
        }
        if (choice?.finish_reason === "length") {
          throw new Error("The reply was cut off at its length limit");
        }
      }
    }
  } catch (err) {
    if (signal.aborted) throw signal.reason;
    if (err instanceof SyntaxError) {
      console.error(err);
      throw new Error("The model's reply could not be read");
    }
    throw err;
  }
}

const ADAPTERS = { "openai-compatible": openAiCompatible, anthropic: claude, simulated };

/**
 * The reply to `history`, as it is produced. Ends when the reply does;
 * rejects with the signal's reason when aborted, or with an error whose
 * message can be shown.
 */
export function stream(history: History, signal: AbortSignal): AsyncIterable<Delta> {
  return ADAPTERS[provider()](history, signal);
}

/** Which model is answering, for the page to say. */
export function modelName(): string {
  const which = provider();
  if (which === "simulated") return "a simulated model";
  return which === "anthropic" ? claudeModel() : process.env.CHAT_MODEL || "an unnamed model";
}
