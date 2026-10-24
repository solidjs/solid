// `createDeferred` — an async memo that may lag, but never leads (D-40,
// docs/create-deferred.md).
//
// Once the node has a committed value, its own non-final work is invisible
// to the graph: its readers keep the committed value and hold nothing, its
// landings are changes of their own, and only the verdict (`isPending`) and
// the truth readers (`until`, `refresh`'s waiter) see the flight.
//
// Built from parts the engine already has, so core pays nothing for it:
//
// - **Read side: the loading window** (`_loading`, async.ts). Every pass of
//   a node with a committed value opens the window before it asks, so a
//   flight serves the committed value instead of throwing, and an unready
//   source parks the node instead of pending it. `CONFIG_REDERIVE` makes a
//   source going pending a question for the node's pass (which parks) rather
//   than a status pushed through it to its readers.
// - **Verdict: a mark** (affects-marks.ts) whose lifetime is the flight —
//   started when a pass asks a new question (a `refresh()` re-ask is quiet, F-9),
//   dropped at the landing, the rejection, a sync answer or the node's death.
// - **Never leads:** a flight that lands while an input it read is held
//   derived from that hold's world, so it lands into the hold (`holdNode`;
//   `setSignal` stages it there). An input that changed after the pass
//   would have superseded the flight, so a held input at the landing is one
//   the pass read held.
// - **Truth readers** wait the flight out (`GlobalQueue._lagging`, signals.ts
//   `watch`): `await refresh(d)` delivers the landing, `until` sees only
//   settled values.

import {
  CONFIG_HELD,
  CONFIG_LAGS,
  CONFIG_REDERIVE,
  CONFIG_SLOT_NODE,
  NOT_PENDING,
  REACTIVE_DISPOSED,
  REACTIVE_REASK,
  REACTIVE_RECOMPUTING_DEPS,
  STATUS_UNINITIALIZED
} from "./core/constants.js";
import { handleAsync, isThenable } from "./core/async.js";
import { cleanup, computed, getOwner, NotReadyError } from "./core/index.js";
import { GlobalQueue, holdNode, schedule, txOf } from "./core/scheduler.js";
import type { Computed } from "./core/types.js";
import { mark, repoll, unmark } from "./affects-marks.js";
import { accessor, type MemoOptions, type SourceAccessor } from "./signals.js";

/** Deferred nodes with a flight up. */
const lagging = new Set<Computed<any>>();

/** The deferred node with a flight up that `c`'s value derives from, if
 * any: `c` itself, or one reached through its current dependencies. */
function lagOf(c: Computed<any>, seen: Set<Computed<any>>): Computed<any> | undefined {
  if (lagging.has(c)) return c;
  if (seen.has(c)) return;
  seen.add(c);
  if (c._config & CONFIG_SLOT_NODE) return lagOf((c as any)._host?.fam?.node ?? c, seen);
  const tail = c._flags & REACTIVE_RECOMPUTING_DEPS ? c._depsTail : undefined;
  if (tail !== null)
    for (let d = c._deps ?? null; d !== null; d = d._nextDep) {
      const l = lagOf(d._dep as Computed<any>, seen);
      if (l) return l;
      if (d === tail) break;
    }
}
GlobalQueue._lagging = c => (lagging.size !== 0 ? lagOf(c, new Set()) : undefined);

/**
 * Creates an async memo that may lag, but never leads. Before its first
 * answer it is an ordinary async memo: readers suspend to the nearest
 * `<Loading>`. After it, a refetch holds nothing: readers keep the last
 * committed value until the new one lands, and the rest of the screen moves
 * on without it. `isPending` reports the refetch, on the node and on what
 * derives from it. Use it for independent widgets (dashboards, feeds,
 * search results) where the previous answer with a "refreshing" indicator is
 * better than waiting with everything else.
 *
 * - It never shows a value ahead of a held change: a refetch that read a
 *   held value lands with that hold.
 * - A rejected refetch errors like any memo; the stale value never masks it.
 * - `refresh(d)` is a quiet re-ask, and `await refresh(d)` and `until`
 *   wait for the landing rather than the stale value.
 * - Combine with `loadingValue` for a node that never suspends at all.
 *
 * @example
 * ```tsx
 * const rows = createDeferred(() => fetchRows(store.period));
 *
 * <section class={{ stale: isPending(() => rows()) }}>
 *   <For each={rows()}>{row => <Row row={row} />}</For>
 * </section>
 * ```
 */
export function createDeferred<T>(
  fn: (prev?: T) => T | PromiseLike<T> | AsyncIterable<T>,
  options?: MemoOptions<T>
): SourceAccessor<T> {
  let node!: Computed<T>;
  /** The flight in force: a promise, a stream, or the error an unready
   * source parked the node with. */
  let flight: unknown = null;
  let marked = false;
  let answered = false;
  /** The flight `r` is over. An async answer (`held`) arriving while an
   * input is held lands into that hold first. */
  const land = (r: unknown, held?: boolean) => {
    if (r === null || flight !== r) return;
    flight = null;
    lagging.delete(node);
    if (held)
      for (let d = node._deps; d !== null; d = d._nextDep)
        if (d._dep._config & CONFIG_HELD) {
          holdNode(node, txOf(d._dep));
          break;
        }
    if (marked) {
      marked = false;
      unmark(node);
      schedule();
    }
  };
  const ask = (r: unknown) => {
    flight = r;
    lagging.add(node);
    if (!marked && !(node._flags & REACTIVE_REASK)) {
      marked = true;
      mark(node);
      repoll(node);
    }
  };
  /** Registers the flight and serves the pass's value: the committed one,
   * or over a held landing the landing itself, which a lagging question
   * does not replace (D-40) — restaged as the committed value, the hold's
   * readers would re-derive against the old input. */
  const serve = (r: PromiseLike<T> | AsyncIterable<T>): T => {
    const v = handleAsync(node, r);
    return node._config & CONFIG_HELD && node._pendingValue !== NOT_PENDING
      ? (node._pendingValue as T)
      : v;
  };
  const end = () => node._flags & REACTIVE_DISPOSED && land(flight);
  return accessor<T>(
    computed<T>(prev => {
      node = getOwner() as Computed<T>;
      node._config |= CONFIG_REDERIVE;
      cleanup(end);
      // Answered: the node has a real committed answer — not a first load,
      // not a `loadingValue` window still open (both are loading, F-9).
      // Sticky, and read before this wrapper ever opens the window itself.
      const open = (answered ||= !(node._statusFlags & STATUS_UNINITIALIZED) && !node._loading);
      if (open) ((node._loading = true), (node._config |= CONFIG_LAGS));
      try {
        const r = fn(prev);
        if (open && typeof r === "object" && r !== null) {
          if (isThenable(r as PromiseLike<T>)) {
            ask(r);
            const done = () => land(r, true);
            (r as PromiseLike<T>).then(done, done);
            return serve(r as PromiseLike<T>);
          }
          const iterate = (r as AsyncIterable<T>)[Symbol.asyncIterator];
          if (iterate) {
            // A stream's flight ends at its first yield (or its end).
            const it = iterate.call(r);
            let first = true;
            const done = () => land(s, true);
            const s: AsyncIterator<T> = {
              // Registered ahead of the engine's own reaction to the same
              // promise, as for a plain flight: verdict and value in one flush.
              next: v => {
                const p = it.next(v);
                if (first) {
                  first = false;
                  if (isThenable(p)) p.then(done, done);
                  else done();
                }
                return p;
              },
              return: v => it.return?.(v) ?? Promise.resolve({ done: true, value: v })
            };
            ask(s);
            return serve({ [Symbol.asyncIterator]: () => s });
          }
        }
        land(flight);
        return r;
      } catch (e) {
        // The wrapping form: an unready source parks the node in the window,
        // and the wait is its flight until the source's settle re-runs it.
        if (open && e instanceof NotReadyError) ask(e);
        else land(flight);
        throw e;
      }
    }, options)
  );
}
