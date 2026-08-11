"use server";
// The server component. `reply(prompt)` starts a (simulated) generation and
// returns the component that renders its markdown — on the server. The
// browser never sees `marked` or the canned answers; it receives finished
// HTML, one paragraph at a time as generation reaches it.
//
// Two kinds of liveness cross the border here, both written the same way —
// plain reactive expressions:
//
//   - MARKUP: `<Message>` renders the reply's markdown into ONE live hole
//     (`{text()}` feeding `innerHTML`) — the server re-renders the whole
//     message on every yield and the browser morphs it in place, no client
//     component. One hole because a real generation's length and structure
//     are UNKNOWN: there is no fixed set of paragraphs to give their own
//     boundaries up front (and a hole can't mint components as it grows —
//     the owner-creation latch), so the message is the unit that grows.
//   - SLOT ARGS: `progress={progress()}` and `stats={stats()}` are the same
//     expression shape at a client position (DR-2 case 1) — the server
//     re-evaluates them on every commit and re-ships the occurrence's
//     record, updating the client fill's props live. A not-ready read
//     (stats settles only when generation ends) is pending PER-ARG: the
//     fill renders immediately and its own <Loading> covers that read.
//   - CONTAINERS: `usage={usage}` passes a PROJECTION itself (DR-2 case 3,
//     Stage 5) — a whole reactive store crossing the border. It ships as
//     its trace (one snapshot, then the patches the server records as it
//     writes) and materializes on the client as a live read-only store:
//     `<Status>` reads `props.usage.tokens` like local state and each
//     field updates granularly, no re-shipping, no domain keys.
//
// Slots render as JSX (`<props.status …/>`), never as calls: the compiler
// wraps each prop in a getter, so reads defer to the slot border where the
// runtime owns them. A call form (`props.status({ … })`) evaluates its args
// eagerly in this component's body — a top-level read, an error in most
// cases. (To hand the client the async value ITSELF — the raw promise or
// iterable, consumer-controlled — wrap it in `asyncArg` instead.)
import { createMemo, createProjection, Loading } from "solid-js";
import { type Slot } from "@solidjs/web/frames";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import { generate, greet, type Generation, type Stats, type Usage } from "./model";

// Syntax highlighting rides the same single-copy principle as the markdown
// itself: highlight.js is a dependency of this server-only module, so the
// grammar never ships to the browser — only the token <span>s it produces
// (styled by ~15 lines of CSS in app.css). Streaming partials don't break
// it: an unclosed fence is code-to-end-of-input to marked, and hljs is a
// tolerant tokenizer, not a parser — a transiently odd token lasts one
// yield before the next re-render replaces the block.
hljs.registerLanguage("javascript", javascript);
hljs.registerAliases(["js", "jsx", "ts", "tsx"], { languageName: "javascript" });

const marked = new Marked(
  markedHighlight({
    langPrefix: "hljs language-",
    highlight(code, lang) {
      // Unknown language: return the code unchanged and marked applies its
      // normal escaping.
      return hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang }).value : code;
    }
  })
);

/**
 * Smooth a PARTIAL markdown stream before rendering. A token stream dangles
 * inline delimiters — `**Solid` renders literal asterisks until the closer
 * arrives, and a half-arrived `[link](url…` sits raw even longer — so real
 * chat UIs close unfinished constructs on every frame. Fenced code needs no
 * help (an unclosed fence is spec-legal code-to-end-of-input, which is why
 * the code blocks stream perfectly on their own); it's the inline forms
 * that flash. Closing them is a RENDER concern, so it lives here beside the
 * parser: server-only, like everything else about the markdown. On the
 * final (complete) text everything balances and this is a no-op.
 */
function closePartial(md: string): string {
  // Inside an open code fence the tail is code — nothing to balance.
  if ((md.match(/(^|\n)```/g) || []).length % 2 === 1) return md;
  // Inline constructs can't span paragraphs: only the last one can dangle.
  const cut = md.lastIndexOf("\n\n");
  const head = cut === -1 ? "" : md.slice(0, cut + 2);
  let tail = cut === -1 ? md : md.slice(cut + 2);
  // A half-arrived link/image is raw text until `](url)` completes: hide it
  // rather than close it (an unfinished href isn't worth navigating to).
  tail = tail.replace(/!?\[[^\]]*(\]\([^)\s]*)?$/, "");
  // Closers must hug the text (`**Solid **` is not valid emphasis).
  tail = tail.replace(/\s+$/, "");
  // An odd backtick makes the rest of the line inline code — close it first
  // or the emphasis balancing below would count asterisks inside it.
  if ((tail.match(/`/g) || []).length % 2 === 1) tail += "`";
  const bold = (tail.match(/\*\*/g) || []).length % 2 === 1;
  const italic = (tail.replace(/\*\*/g, "").match(/\*/g) || []).length % 2 === 1;
  if (italic) tail += "*";
  if (bold) tail += "**";
  return head + tail;
}

export type StatusSlot = Slot<{ progress: string; stats: Stats; usage: Usage }>;

/**
 * The generation's structured face as a live STORE (DR-2 case 3): a
 * projection folding the model's usage events into one object. Created ONCE
 * in the component body (a projection is a reactive scope, not an
 * expression to re-run) and passed WHOLE across the slot border
 * (`usage={usage}` — the store, not a read), it serializes as its trace and
 * the client materializes a live read-only twin. Reads into it suspend
 * until the first event lands.
 */
function usageStore(gen: Generation) {
  return createProjection(
    async function* (draft: Usage) {
      for await (const event of gen.usage) {
        Object.assign(draft, event);
        yield;
      }
    },
    { state: "thinking", tokens: 0, parts: 0, totalParts: 0 } as Usage
  );
}

export async function reply(prompt: string) {
  const gen = generate(prompt);
  return (props: { status: StatusSlot }) => {
    // Async values read through memos: `progress()` is the iterable's
    // latest yield, `stats()` the promise's resolution (not-ready until it
    // lands). The same reads would feed markup holes — here they feed the
    // slot border.
    const progress = createMemo(() => gen.progress);
    const stats = createMemo(() => gen.stats);
    const usage = usageStore(gen);
    return (
      <section class="reply">
        <Message text={gen.text} />
        <props.status progress={progress()} stats={stats()} usage={usage} />
      </section>
    );
  };
}

/**
 * The t=0 face (Stage 4). Same component shape as `reply`, but rendered
 * INTO the initial document rather than answering a call: at SSR the direct
 * result renders inline, generation starts with the page, and every yield
 * past the first re-emits over the document's own response — first tokens
 * paint through the streamed fragments before any JavaScript runs, the rest
 * ride the `sc:live` channel and morph in after hydration adopts this
 * boundary (the catch-up replay covers whatever landed in between). The
 * slot args are just as live: their record re-emissions ride the same
 * channel — the usage PROJECTION included, whose trace streams through the
 * document's data scripts and revives at hydration as the same live store.
 * One component, both transports: this exact markup machinery answers
 * `reply()` calls after the page is up.
 */
export async function welcome() {
  const gen = greet();
  return (props: { status: StatusSlot }) => {
    const progress = createMemo(() => gen.progress);
    const stats = createMemo(() => gen.stats);
    const usage = usageStore(gen);
    return (
      <section class="reply">
        <Message text={gen.text} />
        <props.status progress={progress()} stats={stats()} usage={usage} />
      </section>
    );
  };
}

/**
 * The whole reply, streaming token by token — a live markup hole (Stage 3),
 * no client component. `props.text` is an async iterable of the ACCUMULATED
 * markdown; the memo's read is its latest yield. The first read suspends
 * this hole (the `<Loading>` shows the typing cursor until the first token),
 * and every later yield re-renders the markdown here on the server — the
 * hole's binding re-emits the HTML and the browser morphs the message in
 * place, mid-sentence. Nothing about the reply's length is known up front;
 * the hole is the unit that grows.
 *
 * (Each yield re-ships the full rendered message — the workload that
 * motivates an eventual patch format for hole re-emissions: streamed text is
 * append-mostly, so a prefix-check could ship just the tail.)
 */
function Message(props: { text: AsyncIterable<string> }) {
  const text = createMemo(() => props.text);
  return (
    <Loading fallback={<p class="typing">▍</p>}>
      <div class="md" innerHTML={marked.parse(closePartial(text()), { async: false }) as string} />
    </Loading>
  );
}
