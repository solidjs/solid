// The composer. The thread around it is server markup; this is where a
// person types, so it is theirs.
//
// Sending is a form. Without JavaScript it posts and the page comes back;
// with it the router submits the same form in place, and a message shows
// here, under the thread, from the moment it is sent. The server's render
// says which messages it has (`seen`), and a bubble steps aside the moment
// its id is among them — by derivation, in the same update that brings the
// server's own row.
import { createSignal, For, latest, Show } from "solid-js";
import { action } from "@solidjs/router";
import { redirect } from "@solidjs/web";
import * as db from "~/server/db";
import * as generations from "~/server/generations";

const mintId = () => Math.random().toString(36).slice(2, 12).padEnd(10, "0");

// Stores the prompt, starts the reply as a job, and returns: the reply is
// written by the job, not by this request. From the front page there is no
// thread yet, so this makes one and goes to it.
export const sendMessage = action(async (form: FormData) => {
  "use server";
  const threadId = String(form.get("threadId") ?? "") || null;
  try {
    const sent = await db.send(
      threadId,
      String(form.get("id") ?? ""),
      String(form.get("text") ?? "")
    );
    if (sent.fresh) generations.start(sent.threadId, sent.replyId);
    if (!threadId) return redirect(`/t/${sent.threadId}`);
  } catch (err) {
    if (err instanceof db.Rejected) return { error: err.message };
    throw err;
  }
}, "sendMessage");

export default function Composer(props: {
  /** The thread to send into; none on the front page. */
  threadId?: string;
  /** The ids of the messages the server's render shows. */
  seen?: string[];
  /** A reply is being written, so the next message has to wait. */
  busy?: boolean;
}) {
  let field!: HTMLTextAreaElement;
  const [id, setId] = createSignal(mintId());
  // What has been sent from here. A message leaves the list when the
  // server's render has it, or when the server refuses it.
  const [sent, setSent] = createSignal<{ id: string; text: string }[]>([]);
  // `latest`: the write that adds a message is made in the same tick as the
  // form's action starts, so it belongs to that action and would otherwise
  // show only when the action settles.
  const outbox = () => latest(sent).filter(m => !props.seen?.includes(m.id));
  const [error, setError] = createSignal<string>();

  sendMessage.onSubmit(form => {
    setError(undefined);
    setSent(list => [
      ...list.filter(m => !props.seen?.includes(m.id)),
      { id: String(form.get("id")), text: String(form.get("text")).trim() }
    ]);
    // The form's data is taken; the next message is a new one.
    queueMicrotask(() => {
      setId(mintId());
      field.value = "";
      field.focus();
    });
  });
  sendMessage.onSettled(settled => {
    const refused = settled.result?.error;
    if (!refused) return;
    // A refused message goes back in the field, to be changed or sent again.
    const form = settled.input[0];
    setSent(list => list.filter(m => m.id !== form.get("id")));
    setError(refused);
    if (!field.value) field.value = String(form.get("text"));
  });

  return (
    <div class="composer">
      <ol class="outbox">
        <For each={outbox()}>
          {message => (
            <li class="message user pending" data-id={message.id}>
              <p>{message.text}</p>
            </li>
          )}
        </For>
      </ol>
      <Show when={error()}>
        {message => (
          <p class="error" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <form action={sendMessage} method="post">
        <input type="hidden" name="threadId" value={props.threadId ?? ""} />
        <input type="hidden" name="id" value={id()} />
        <textarea
          ref={field}
          name="text"
          rows="2"
          required
          placeholder="Message"
          aria-label="Message"
          onKeyDown={e => {
            // Enter sends; Shift+Enter is a new line.
            if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
              e.preventDefault();
              e.currentTarget.form!.requestSubmit();
            }
          }}
        />
        <button type="submit" disabled={props.busy}>
          Send
        </button>
      </form>
    </div>
  );
}
