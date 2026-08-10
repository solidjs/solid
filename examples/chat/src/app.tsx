// The client side of the chat. Compare weights: this file owns the
// transcript state, the input, and the status ticker — and that is the whole
// client app. The replies (the markdown, the parser behind it, the canned
// answers) are server components; their markup arrives as HTML over frame
// streams and never exists here as templates or JSON.
import { createSignal, For, Loading } from "solid-js";
import { dynamic } from "@solidjs/web";
import { reply, welcome } from "~/lib/ai";
import Status from "~/components/status";
import "./app.css";

interface Message {
  id: number;
  prompt: string;
}

let nextId = 0;

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
  };

  return (
    <main class="chat">
      <header class="masthead">
        <h1>Solid Chat</h1>
        <p>
          Every reply is a <em>server component</em>: markdown rendered on the server, streamed in
          as HTML. Ask about <b>server components</b>, <b>signals</b>, or <b>markdown</b>.
        </p>
      </header>
      <ol class="transcript">
        <li class="exchange">
          <div class="bubble assistant">
            <Loading fallback={<p class="typing">▍</p>}>
              <Welcome status={p => <Status progress={p.progress} stats={p.stats} />} />
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
                    <Reply status={p => <Status progress={p.progress} stats={p.stats} />} />
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
