import "server-only";
// The threads, and the only place their rules live. Held in memory and
// written through to unstorage: the memory driver by default (threads reset
// with the server), a file under `.data/` with CHAT_STORAGE=fs (they survive
// a restart). Every write is applied to memory synchronously and saved
// behind it in order.
//
// Nothing here knows who is watching. A write changes what is stored and
// wakes the watchers; each open render of a thread reads what is stored.
// That is the whole of how two tabs agree, and of how a reply keeps growing
// for a tab that was closed while it was being written.
import { createStorage } from "unstorage";
import fsDriver from "unstorage/drivers/fs";
import memoryDriver from "unstorage/drivers/memory";
import type { Message, MessageStatus, Thread } from "~/types";

interface State {
  threads: Thread[];
  messages: Message[];
}

const storage = createStorage<State>({
  driver: process.env.CHAT_STORAGE === "fs" ? fsDriver({ base: "./.data" }) : memoryDriver()
});

let state: State;
const ready = (async () => {
  state = (await storage.getItem("chat")) ?? { threads: [], messages: [] };
  // A reply that was being written when the server stopped has no job any
  // more. That is a fact about the thread, not something to wait on.
  let orphans = false;
  for (const message of state.messages) {
    if (message.status === "generating") {
      message.status = "failed";
      message.error = "Interrupted by a server restart";
      orphans = true;
    }
  }
  if (orphans) save();
})();

let saving: Promise<unknown> = Promise.resolve();
// Saves are coalesced: a reply is written many times a second, and only the
// latest state is worth the disk.
let saveQueued = false;
function save() {
  if (saveQueued) return;
  saveQueued = true;
  saving = saving
    .then(() => {
      saveQueued = false;
      return storage.setItem("chat", structuredClone(state));
    })
    .catch(console.error);
}

/** Settles when every write so far has reached the store. */
export async function flushed(): Promise<void> {
  await ready;
  await saving;
}

// ---------------------------------------------------------------------------
// Change notification. Three things can be watched, each with its own
// counter, so a token arriving re-renders one message and nothing else:
// the list of threads, a thread's shape (which messages, in what state), and
// one message's content.

const versions = new Map<string, number>();
const waiters = new Map<string, Set<() => void>>();

function bump(key: string) {
  versions.set(key, (versions.get(key) ?? 0) + 1);
  const waking = waiters.get(key);
  if (!waking) return;
  waiters.delete(key);
  for (const wake of waking) wake();
}

function changed(key: string, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const wake = () => {
      waiters.get(key)?.delete(wake);
      signal?.removeEventListener("abort", wake);
      resolve();
    };
    let set = waiters.get(key);
    if (!set) waiters.set(key, (set = new Set()));
    set.add(wake);
    signal?.addEventListener("abort", wake, { once: true });
  });
}

// Yields `read()` now and after every bump of `key`; ends when `signal`
// aborts. After a yield it looks again before waiting: a write can land
// while the consumer holds the value, when nothing is parked to be woken.
async function* watch<T>(key: string, read: () => T, signal?: AbortSignal): AsyncGenerator<T> {
  await ready;
  let seen = -1;
  while (!signal?.aborted) {
    const version = versions.get(key) ?? 0;
    if (version !== seen) {
      seen = version;
      yield read();
      continue;
    }
    await changed(key, signal);
  }
}

export interface ThreadSummary extends Thread {
  generating: boolean;
}

/** Every thread, newest first, and whether a reply is being written in it. */
export function watchThreads(signal?: AbortSignal): AsyncGenerator<ThreadSummary[]> {
  return watch(
    "threads",
    () =>
      [...state.threads]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(thread => ({
          ...thread,
          generating: state.messages.some(
            m => m.threadId === thread.id && m.status === "generating"
          )
        })),
    signal
  );
}

export interface ThreadShape {
  thread: Thread | undefined;
  /** In order. Yields again when a message is added or changes status — not per token. */
  messages: Pick<Message, "id" | "role" | "status">[];
}

export function watchThread(id: string, signal?: AbortSignal): AsyncGenerator<ThreadShape> {
  return watch(
    `thread:${id}`,
    () => ({
      thread: state.threads.find(t => t.id === id),
      messages: messagesOf(id).map(({ id, role, status }) => ({ id, role, status }))
    }),
    signal
  );
}

/** One message, again after every write to it. */
export function watchMessage(id: string, signal?: AbortSignal): AsyncGenerator<Message> {
  return watch(`message:${id}`, () => ({ ...state.messages.find(m => m.id === id)! }), signal);
}

const messagesOf = (threadId: string) =>
  state.messages.filter(m => m.threadId === threadId).sort((a, b) => a.createdAt - b.createdAt);

/** The conversation so far, for the model. */
export async function historyOf(threadId: string): Promise<Pick<Message, "role" | "text">[]> {
  await ready;
  return messagesOf(threadId)
    .filter(m => m.text && m.status !== "failed")
    .map(({ role, text }) => ({ role, text }));
}

// ---------------------------------------------------------------------------
// Writes.

/** A write the server refused. The message is for the person who made it. */
export class Rejected extends Error {
  name = "Rejected";
}

const ID = /^[a-z0-9]{6,24}$/;
const mintId = () => Math.random().toString(36).slice(2, 12).padEnd(10, "0");

/**
 * Stores a prompt and the empty reply that will answer it; creates the
 * thread when `threadId` is null. Answers the thread and the reply's id, for
 * the caller to start the generation. `messageId` is the sender's: a retry of
 * a prompt that landed changes nothing and answers the same reply.
 */
export async function send(
  threadId: string | null,
  messageId: string,
  text: string
): Promise<{ threadId: string; replyId: string; fresh: boolean }> {
  await ready;
  if (typeof messageId !== "string" || !ID.test(messageId)) throw new Rejected("Bad message id");
  const body = typeof text === "string" ? text.trim() : "";
  if (!body) throw new Rejected("Nothing to send");
  if (body.length > 8000) throw new Rejected("That message is too long");

  const landed = state.messages.find(m => m.id === messageId);
  if (landed) {
    const reply = messagesOf(landed.threadId).find(
      m => m.role === "assistant" && m.createdAt >= landed.createdAt
    );
    return { threadId: landed.threadId, replyId: reply!.id, fresh: false };
  }

  const now = Date.now();
  let thread = threadId === null ? undefined : state.threads.find(t => t.id === threadId);
  if (threadId !== null && !thread) throw new Rejected("That conversation no longer exists");
  if (thread && messagesOf(thread.id).some(m => m.status === "generating")) {
    throw new Rejected("Wait for the reply, or stop it");
  }
  if (!thread) {
    thread = {
      id: mintId(),
      title: body.split("\n")[0].slice(0, 60),
      createdAt: now,
      updatedAt: now
    };
    state.threads.push(thread);
  }
  thread.updatedAt = now;
  const replyId = mintId();
  state.messages.push(
    {
      id: messageId,
      threadId: thread.id,
      role: "user",
      text: body,
      reasoning: "",
      status: "complete",
      createdAt: now
    },
    {
      id: replyId,
      threadId: thread.id,
      role: "assistant",
      text: "",
      reasoning: "",
      status: "generating",
      createdAt: now + 1
    }
  );
  save();
  bump(`thread:${thread.id}`);
  bump("threads");
  return { threadId: thread.id, replyId, fresh: true };
}

/** More of a reply has arrived. */
export function append(messageId: string, kind: "text" | "reasoning", delta: string): void {
  const message = state.messages.find(m => m.id === messageId);
  if (!message || message.status !== "generating") return;
  message[kind] += delta;
  save();
  bump(`message:${messageId}`);
}

/** A reply is over, one way or another. */
export function finish(
  messageId: string,
  status: Exclude<MessageStatus, "generating">,
  extra: Pick<Message, "error" | "usage"> = {}
): void {
  const message = state.messages.find(m => m.id === messageId);
  if (!message || message.status !== "generating") return;
  Object.assign(message, extra, { status });
  save();
  bump(`message:${messageId}`);
  bump(`thread:${message.threadId}`);
  bump("threads");
}

/** The reply being written in a thread, if there is one. */
export async function generatingIn(threadId: string): Promise<string | undefined> {
  await ready;
  return messagesOf(threadId).find(m => m.status === "generating")?.id;
}
