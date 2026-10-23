// How many tabs are watching. Each tab holds one viewer stream open; the
// count goes up when it opens and down when it closes, and every stream
// hears the new count.

let count = 0;
const watchers = new Set<() => void>();

function setCount(next: number) {
  count = next;
  for (const notify of watchers) notify();
}

/** Counts the caller as a viewer until `signal` aborts; yields the count as it changes. */
export async function* watchViewers(signal?: AbortSignal): AsyncGenerator<number> {
  let wake: (() => void) | undefined;
  let dirty = false;
  const notify = () => {
    dirty = true;
    wake?.();
  };
  const leave = () => wake?.();
  watchers.add(notify);
  signal?.addEventListener("abort", leave, { once: true });
  setCount(count + 1);
  try {
    while (!signal?.aborted) {
      dirty = false;
      yield count;
      if (!dirty) await new Promise<void>(r => (wake = r));
      wake = undefined;
    }
  } finally {
    signal?.removeEventListener("abort", leave);
    watchers.delete(notify);
    setCount(count - 1);
  }
}
