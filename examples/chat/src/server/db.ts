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

// A dev knob: CHAT_SLOW=<ms> delays storing a prompt by that long, so the
// gap between a message being sent and the server having it is wide enough
// to see.
const slow = Number(process.env.CHAT_SLOW || 0);

/** Settles when every write so far has reached the store. */
export async function flushed(): Promise<void> {
  await ready;
  await saving;
}

// ---------------------------------------------------------------------------
// Change notification. Two things can be watched, each with its own counter:
// the list of threads, and one thread. A token arriving wakes the renders of
// its thread and nobody watching the list.

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

/** Every thread, newest first, as of now. */
export async function listThreads(): Promise<ThreadSummary[]> {
  return (await watchThreads().next()).value;
}

export interface ThreadView {
  thread: Thread | undefined;
  /** In order, each as it stands now. */
  messages: Message[];
}

/** A thread and its messages, again after every write to either. */
export function watchThread(id: string, signal?: AbortSignal): AsyncGenerator<ThreadView> {
  return watch(
    `thread:${id}`,
    () => ({
      thread: state.threads.find(t => t.id === id),
      messages: messagesOf(id).map(m => ({ ...m }))
    }),
    signal
  );
}

const messagesOf = (threadId: string) =>
  state.messages.filter(m => m.threadId === threadId).sort((a, b) => a.createdAt - b.createdAt);

/** The conversation so far, for the model. */
export async function historyOf(threadId: string): Promise<Pick<Message, "role" | "text">[]> {
  await ready;
  return messagesOf(threadId)
    .filter(m => m.text && m.status !== "failed" && m.status !== "generating")
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
  if (slow > 0) await new Promise(resolve => setTimeout(resolve, slow));
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

/** Gives a thread a new title. */
export async function renameThread(id: string, title: string): Promise<void> {
  await ready;
  const thread = state.threads.find(t => t.id === id);
  if (!thread) throw new Rejected("That conversation no longer exists");
  const named = typeof title === "string" ? title.trim().slice(0, 60) : "";
  if (!named) throw new Rejected("A title can't be empty");
  thread.title = named;
  save();
  bump(`thread:${id}`);
  bump("threads");
}

/** Removes a thread and everything in it. Answers the reply being written, if any. */
export async function deleteThread(id: string): Promise<string | undefined> {
  await ready;
  if (!state.threads.some(t => t.id === id)) return;
  const writing = messagesOf(id).find(m => m.status === "generating")?.id;
  state.threads = state.threads.filter(t => t.id !== id);
  state.messages = state.messages.filter(m => m.threadId !== id);
  save();
  bump(`thread:${id}`);
  bump("threads");
  return writing;
}

/**
 * Clears the last reply in a thread to be written again: Regenerate on a
 * finished or stopped reply, Retry on a failed one. Only the last message
 * can be, and not while it is being written. Answers its thread.
 */
export async function restart(replyId: string): Promise<{ threadId: string }> {
  await ready;
  const reply = state.messages.find(m => m.id === replyId);
  if (!reply || reply.role !== "assistant") throw new Rejected("That reply no longer exists");
  if (messagesOf(reply.threadId).at(-1) !== reply) {
    throw new Rejected("Only the last reply can be written again");
  }
  if (reply.status === "generating") throw new Rejected("That reply is still being written");
  Object.assign(reply, { text: "", reasoning: "", status: "generating" });
  delete reply.error;
  delete reply.usage;
  const thread = state.threads.find(t => t.id === reply.threadId)!;
  thread.updatedAt = Date.now();
  save();
  bump(`thread:${reply.threadId}`);
  bump("threads");
  return { threadId: reply.threadId };
}

/** More of a reply has arrived. */
export function append(messageId: string, kind: "text" | "reasoning", delta: string): void {
  const message = state.messages.find(m => m.id === messageId);
  if (!message || message.status !== "generating") return;
  message[kind] += delta;
  save();
  bump(`thread:${message.threadId}`);
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
  bump(`thread:${message.threadId}`);
  bump("threads");
}

/** The reply being written in a thread, if there is one. */
export async function generatingIn(threadId: string): Promise<string | undefined> {
  await ready;
  return messagesOf(threadId).find(m => m.status === "generating")?.id;
}
