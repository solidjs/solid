import "server-only";
// Who has the board open. Connection-scoped memory: a member is present
// while the live response that joined is open, and nothing here is stored —
// it is fine to lose, and a reconnect rebuilds it by joining again.
import type { Identity, Member } from "~/types";

const members = new Map<string, Member>();
const waiters = new Set<() => void>();
let version = 0;

function notify() {
  version++;
  const waking = [...waiters];
  waiters.clear();
  for (const wake of waking) wake();
}

// Settles on the next join or leave, or when `signal` aborts: a generator
// parked on an await cannot be returned until it settles, so a watcher that
// waited only for the next change would run its `finally` — the leave — at
// the board's next event instead of at the disconnect.
function changed(signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const wake = () => {
      waiters.delete(wake);
      signal?.removeEventListener("abort", wake);
      resolve();
    };
    waiters.add(wake);
    signal?.addEventListener("abort", wake, { once: true });
  });
}

/**
 * Present until the returned `leave` is called. The entry belongs to this
 * connection: a reconnect joins again under the same id before the dead
 * connection's cleanup has run, and that late `leave` removes only what it
 * joined.
 */
export function join(me: Identity): () => void {
  const entry: Member = { ...me, since: Date.now() };
  members.set(me.id, entry);
  notify();
  return () => {
    if (members.get(me.id) !== entry) return;
    members.delete(me.id);
    notify();
  };
}

/** The members now and after every join or leave; ends when `signal` aborts. */
export async function* watchMembers(signal?: AbortSignal): AsyncGenerator<Member[]> {
  let seen = -1;
  while (!signal?.aborted) {
    if (version !== seen) {
      seen = version;
      yield [...members.values()].sort((a, b) => a.since - b.since);
      // A change can land while the consumer holds this value: look again
      // before waiting.
      continue;
    }
    await changed(signal);
  }
}
