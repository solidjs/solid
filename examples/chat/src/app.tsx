// The client side of the chat. Compare weights: this file owns the
// transcript state, the input, and the status ticker — and that is the whole
// client app. The replies (the markdown, the parser behind it, the canned
// answers) are server components; their markup arrives as HTML over frame
// streams and never exists here as templates or JSON.
import { createSignal, For, Loading, onSettled } from "solid-js";
import { dynamic } from "@solidjs/web";
import { reply, welcome } from "~/lib/ai";
import Status from "~/components/status";
import "./app.css";

interface Message {
  id: number;
  prompt: string;
}

let nextId = 0;

// Behavior for SERVER-rendered elements (Stage 6): every code block in a
// reply carries a copy button the server renders with `onClick={props.copy}`
// — this function, passed as a prop. The marker in the markup names the
// prop; delegation resolves it here at dispatch. It reads the code from the
// element it was clicked in, so one handler serves every block in every
// reply, including blocks that streamed in mid-sentence.
const copyCode = (e: MouseEvent & { currentTarget: HTMLButtonElement }) => {
  const button = e.currentTarget;
  const code = button.parentElement?.querySelector("code");
  if (!code) return;
  // Clipboard access can reject (unfocused window, missing permission) —
  // the label flip is the affordance either way.
  navigator.clipboard.writeText(code.textContent ?? "").catch(() => {});
  button.textContent = "Copied!";
  setTimeout(() => (button.textContent = "Copy"), 1200);
};

export default function App() {
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [draft, setDraft] = createSignal("");

  // The t=0 reply: rendered during the INITIAL document render, so the
  // assistant is already typing as the page loads — tokens stream over the
  // document's own response, and hydration adopts the boundary in place
  // (zero network) and picks the generation up mid-sentence. The `reply`
  // calls below are the same machinery on the call-driven face.
  const Welcome = dynamic(() => welcome());

  const send = (e: SubmitEvent) => {
    e.preventDefault();
    const prompt = draft().trim();
    if (!prompt) return;
    setMessages(m => [...m, { id: nextId++, prompt }]);
    setDraft("");
    pinned = true;
  };

  // Follow the stream: replies grow through server-driven morphs — HTML the
  // browser patches in place, no client render to hook — so bottom-pinning
  // watches the transcript's SIZE, not the component tree. Stay pinned only
  // while the reader is already at the bottom; scrolling up to re-read wins.
  // (`onSettled` is 2.0's setup-and-teardown — the onMount + onCleanup pair.)
  let transcript!: HTMLOListElement;
  let pinned = true;
  onSettled(() => {
    const doc = document.documentElement;
    const onScroll = () => {
      pinned = window.innerHeight + window.scrollY >= doc.scrollHeight - 120;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    const follow = new ResizeObserver(() => {
      if (pinned) window.scrollTo({ top: doc.scrollHeight });
    });
    follow.observe(transcript);
    return () => {
      window.removeEventListener("scroll", onScroll);
      follow.disconnect();
    };
  });

  return (
    <main class="chat">
      <header class="masthead">
        <h1>Solid Chat</h1>
        <p>
          Every reply is a <em>server component</em>: markdown rendered on the server, streamed in
          as HTML. Ask about <b>server components</b>, <b>signals</b>, or <b>markdown</b>.
        </p>
      </header>
      <ol class="transcript" ref={transcript}>
        <li class="exchange">
          <div class="bubble assistant">
            <Loading fallback={<p class="typing">▍</p>}>
              <Welcome
                status={p => <Status progress={p.progress} stats={p.stats} usage={p.usage} />}
                copy={copyCode}
              />
            </Loading>
          </div>
        </li>
        <For each={messages()}>
          {m => {
            // One server-component call per message. The prompt is the server
            // input; the `status` prop is a client position the server fills
            // with two live expression args (DR-2): progress updates on every
            // yield, stats settles when generation completes. The <Status>
            // reading them is client code.
            const Reply = dynamic(() => reply(m.prompt));
            return (
              <li class="exchange">
                <div class="bubble user">{m.prompt}</div>
                <div class="bubble assistant">
                  <Loading fallback={<p class="typing">▍</p>}>
                    <Reply
                      status={p => <Status progress={p.progress} stats={p.stats} usage={p.usage} />}
                      copy={copyCode}
                    />
                  </Loading>
                </div>
              </li>
            );
          }}
        </For>
      </ol>
      <form class="composer" onSubmit={send}>
        <input
          type="text"
          placeholder="Ask something…"
          value={draft()}
          onInput={e => setDraft(e.currentTarget.value)}
        />
        <button type="submit" disabled={!draft().trim()}>
          Send
        </button>
      </form>
    </main>
  );
}
