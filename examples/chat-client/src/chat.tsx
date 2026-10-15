// The chat, owned by the browser. Three pieces of state, and one place that
// writes each:
//
//   turns    a store: the conversation so far, finished turn by finished turn
//   asked    a signal: the question being answered — writing it is what
//            starts a reply, supersedes one, and stops one
//   answer   a projection: the reply being written, a store the server
//            function's deltas are written into, one write per chunk
//
// Nothing here is an effect. A reply ends up in `turns` when the next
// question is asked or Stop is pressed, in the handler that does that.
import {
  createProjection,
  createSignal,
  createStore,
  Errored,
  For,
  Loading,
  Match,
  Show,
  snapshot,
  Switch,
  untrack
} from "solid-js";
import { reply } from "~/server/reply";
import { append, unfence, type Block } from "~/markdown";
import type { Turn } from "~/types";

interface Answer {
  /** The reply as blocks: only the last one changes as chunks arrive. */
  blocks: Block[];
  done: boolean;
}

export default function Chat() {
  const [turns, setTurns] = createStore<Turn[]>([]);
  const [asked, setAsked] = createSignal<string>();

  // The reply to `asked()`. Asking again re-runs this: the previous run's
  // iterator is closed through `return()`, which cancels its request.
  const answer = createProjection(
    (draft: Answer) => {
      const question = asked();
      draft.blocks = [];
      draft.done = false;
      if (question === undefined) return;
      // `untrack`: the history is read once, when the question is asked.
      // Tracking it would re-ask the model each time a turn is kept.
      const history = untrack(() => snapshot(turns));
      return write(draft, [...history, { role: "user", text: question }]);
    },
    { blocks: [], done: false },
    { name: "answer" }
  );

  // Each delta is one store write — to the last block's text, or a new block
  // where it splits — and each `yield` lands it. The first lands the reply
  // as a whole: until then it is not ready, and <Loading> below shows that.
  // The draft is writable for as long as this run is the current one, so a
  // token that arrives after Stop goes nowhere.
  async function* write(draft: Answer, history: Turn[]) {
    for await (const delta of await reply(history)) {
      append(draft.blocks, delta);
      yield;
    }
    draft.done = true;
  }

  // What has arrived of the reply becomes a turn, and the reply's slot is
  // free. A reply that has not started, or that failed, throws when read —
  // not ready, or its error — and either way there is nothing to keep.
  function keep() {
    if (asked() === undefined) return;
    let text: string;
    try {
      text = answer.blocks.map(block => block.text).join("\n");
    } catch {
      return;
    }
    if (!text) return;
    const stopped = !answer.done;
    setTurns(t => {
      t.push({ role: "assistant", text, stopped });
    });
  }

  function send(text: string) {
    keep();
    setTurns(t => {
      t.push({ role: "user", text });
    });
    setAsked(text);
  }

  // Superseding the read is the stop: the projection re-runs with no
  // question, and closing the previous iterator aborts its request.
  function stop() {
    keep();
    setAsked(undefined);
  }

  return (
    <main class="chat">
      <h1>Chat</h1>
      <ol class="turns">
        <For each={turns}>
          {turn => (
            <li class={["turn", turn.role]}>
              <p>{turn.text}</p>
              <Show when={turn.stopped}>
                <span class="muted">Stopped</span>
              </Show>
            </li>
          )}
        </For>
        {/* Keyed: a new question is a new reply element, with its own
            boundaries — the previous reply's error or wait does not carry
            over. */}
        <Show when={asked()} keyed>
          <li class="turn assistant reply">
            <Errored
              fallback={(err, reset) => (
                <p class="error">
                  {String(err())}{" "}
                  <button type="button" onClick={reset}>
                    Retry
                  </button>
                </p>
              )}
            >
              <Loading
                fallback={
                  <p class="muted">
                    Thinking…{" "}
                    <button type="button" class="stop" onClick={stop}>
                      Stop
                    </button>
                  </p>
                }
              >
                {/* Keyed by the block objects, which the store keeps stable:
                    this list re-runs when a block is added, and a chunk
                    reaches one text binding, the last block's. */}
                <div class="md">
                  <For each={answer.blocks}>{block => <BlockView block={block} />}</For>
                </div>
                <Show when={!answer.done}>
                  <button type="button" class="stop" onClick={stop}>
                    Stop
                  </button>
                </Show>
              </Loading>
            </Errored>
          </li>
        </Show>
      </ol>
      <Composer onSend={send} />
    </main>
  );
}

// One block of markdown. `kind` and `text` are two leaves of the store: a
// chunk changes the text, and the kind only while the first line is still
// arriving — so the element is chosen once and the text inside it updates.
function BlockView(props: { block: Block }) {
  return (
    <Switch fallback={<p>{props.block.text}</p>}>
      <Match when={props.block.kind === "pre"}>
        <pre>
          <code>{unfence(props.block.text)}</code>
        </pre>
      </Match>
      <Match when={props.block.kind === "li"}>
        <p class="bullet">{props.block.text.slice(2)}</p>
      </Match>
    </Switch>
  );
}

function Composer(props: { onSend: (text: string) => void }) {
  let field!: HTMLTextAreaElement;
  return (
    <form
      class="composer"
      onSubmit={e => {
        e.preventDefault();
        const text = field.value.trim();
        if (!text) return;
        field.value = "";
        props.onSend(text);
      }}
    >
      <textarea
        ref={field}
        rows="2"
        placeholder="Ask something"
        aria-label="Message"
        onKeyDown={e => {
          // Enter sends; Shift+Enter is a new line.
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            e.currentTarget.form!.requestSubmit();
          }
        }}
      />
      <button type="submit">Send</button>
    </form>
  );
}
