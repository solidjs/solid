// The model. A simulated one: a fixed answer, streamed a word at a time with
// a small delay, and a way to make it fail part-way. Like a real SDK it takes
// an `AbortSignal` and stops when it fires — that is the whole of what
// src/server/reply.ts relies on. Nothing in this file reaches the browser:
// it is only ever imported from a `"use server"` body.
import type { Turn } from "~/types";

/** Milliseconds between tokens. `CHAT_PACE=200 pnpm dev` slows it down. */
export const PACE = Number(process.env.CHAT_PACE || 40);

/** A question containing this word fails part-way, the first time it is asked. */
export const FAILURE_WORD = "crash";

export const ANSWER = `Streaming into a store takes three pieces: the question in a signal, the reply in a projection, and the conversation in a store.

- each chunk is one store write
- the blocks before the last one are never touched again
- Stop is superseding the read, and the request goes with it

\`\`\`ts
const answer = createProjection(draft => {
  const question = asked();
  draft.text = "";
  if (question === undefined) return;
  return write(draft, history(question));
});
\`\`\`

That is the whole pattern. The server function behind it forwards the request's signal to the model, so closing this reply stops it there too.`;

export async function* stream(history: Turn[], signal?: AbortSignal): AsyncGenerator<string> {
  // ── A real model goes here. With Anthropic's SDK, these lines: ───────────
  // const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  // const events = client.messages.stream(
  //   {
  //     model: "claude-opus-5-5",
  //     max_tokens: 64000,
  //     messages: history.map(turn => ({ role: turn.role, content: turn.text }))
  //   },
  //   { signal } // the abort reaches the API: a stopped reply is not billed further
  // );
  // for await (const event of events) {
  //   if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
  //     yield event.delta.text;
  //   }
  // }
  // return;
  // ─────────────────────────────────────────────────────────────────────────
  const prompt = history.at(-1)?.text ?? "";
  const fails = failsThisTime(prompt);
  let sent = 0;
  for (const token of tokens(ANSWER)) {
    await sleep(PACE, signal);
    if (fails && sent++ === 12) throw new Error("The model stopped answering");
    yield token;
  }
}

/** The answer as the model sends it: a word and the whitespace after it, so
 * every prefix of the stream is a prefix of the text. */
export const tokens = (text: string): string[] => text.match(/\S+\s*|\s+/g) ?? [];

const failed = new Set<string>();
function failsThisTime(prompt: string): boolean {
  if (!new RegExp(`\\b${FAILURE_WORD}\\b`, "i").test(prompt) || failed.has(prompt)) return false;
  failed.add(prompt);
  return true;
}

/** A delay that ends early, rejecting, when the signal fires. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    function stop() {
      clearTimeout(timer);
      reject(signal!.reason);
    }
    signal?.addEventListener("abort", stop, { once: true });
  });
}
