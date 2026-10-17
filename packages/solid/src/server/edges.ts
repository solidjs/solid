// Deferred hydration, dependency edges: plain-signal identities and read
// tracking on the server. The render paths in signals.ts hold one
// null-checked slot, filled only while an edges render is in flight
// (`beginEdgesRender`, renderToStream with the server-components codec); the
// hooks act only inside such a render's context (`on`), allocating nothing
// for any other.
//
// A plain signal created under an id-bearing owner is named `<owner id>~<n>`
// (n counts plain signals under that owner since its child counter last
// reset), as the client's signals core names it. A read reports the name to
// the current sink: a slot fill's (`trackFillReads`), a memo's — a memo read
// re-reports what its compute read, so an edge through a memo lands on its
// sources — or the request's WIDE sink, for reads whose readers are not
// tracked (a projection's compute): a write to a wide signal mounts
// everything left.
import { getOwner, materializeId, setEdgeHooks, type EdgeHooks } from "./signals.js";
import { sharedConfig } from "./shared.js";

// Per render: only a render whose context has `edges` set (renderToStream,
// with the server-components codec among its plugins) names or tracks.
function on(): boolean {
  const ctx = sharedConfig.context as any;
  return !!ctx && ctx.edges === true;
}

type ReadSink = { s: Set<string> | null; wide?: true; untracked?: true };
let readSink: ReadSink | null = null;
// The innermost slot fill being tracked (`trackFillReads`), for computations
// whose reads the server cannot see: a client-source memo or effect, a
// tracked effect (its compute never runs here). The fill's edges are then
// incomplete, and it mounts on every named write.
let fillSink: ReadSink | null = null;

// Plain signals created under each id-bearing owner. An owner's entry is
// dropped with its child counter: by a cleanup on the owner (dispose, retry
// reset, rerun) or by `reset` (a reused row owner).
const counts = new WeakMap<object, number>();
function counted(owner: any, n: number): void {
  if (!counts.has(owner)) {
    const drop = () => void counts.delete(owner);
    const d = owner._disposal;
    owner._disposal = !d ? drop : Array.isArray(d) ? (d.push(drop), d) : [d, drop];
  }
  counts.set(owner, n);
}

// What each memo's last compute read (keyed by its owner), re-reported when
// the memo is read: an edge through a memo lands on its sources.
const memoReads = new WeakMap<object, Set<string>>();
// Each id scope's resume point (`ssrScope`'s retry pull, the boundary
// resolve scope): the plain-signal count a resumed pass continues from.
const scopes = new WeakMap<object, { mark: number; resume: number }>();

function reportReads(reads: Set<string>): void {
  if (readSink === null) return;
  const s = (readSink.s ||= new Set());
  for (const sid of reads) s.add(sid);
}

const hooks: EdgeHooks = {
  on,
  signal<T>(read: () => T): () => T {
    let o: any = getOwner();
    if (!o || !on()) return read;
    while (o._transparent && o._parent) o = o._parent;
    if (o.id == null) return read;
    const n = counts.get(o) || 0;
    counted(o, n + 1);
    const sid = materializeId(o) + "~" + n;
    return () => {
      if (readSink !== null) (readSink.s ||= new Set()).add(sid);
      return read();
    };
  },
  run<T>(owner: object, fn: () => T): T {
    const prev = readSink;
    const sink: ReadSink = (readSink = { s: null });
    try {
      return fn();
    } finally {
      readSink = prev;
      if (sink.s !== null) memoReads.set(owner, sink.s);
      else memoReads.delete(owner);
    }
  },
  report(owner: object) {
    if (readSink === null) return;
    const reads = memoReads.get(owner);
    if (reads !== undefined) reportReads(reads);
  },
  projection<F extends Function>(ctx: any, fn: F): F {
    if (!on()) return fn;
    return ((...args: unknown[]) => {
      const prev = readSink;
      readSink = ctx.edgeWide ||= { s: null, wide: true };
      try {
        return fn(...args);
      } finally {
        readSink = prev;
      }
    }) as unknown as F;
  },
  untracked() {
    if (fillSink !== null) fillSink.untracked = true;
  },
  enter(key: object, owner: object, resumed: boolean): number {
    if (!on()) return 0;
    const prev = counts.get(owner) || 0;
    counted(owner, resumed ? scopes.get(key)?.resume || 0 : 0);
    return prev;
  },
  mark(key: object, owner: object) {
    if (!on()) return;
    let st = scopes.get(key);
    if (st === undefined) scopes.set(key, (st = { mark: 0, resume: 0 }));
    st.mark = counts.get(owner) || 0;
  },
  leave(key: object, owner: object, prev: number, keep: 0 | 1 | 2) {
    if (!on()) return;
    if (keep !== 0) {
      let st = scopes.get(key);
      if (st === undefined) scopes.set(key, (st = { mark: 0, resume: 0 }));
      st.resume = keep === 1 ? st.mark : counts.get(owner) || 0;
    }
    counted(owner, prev);
  },
  reset(owner: object) {
    counts.delete(owner);
  }
};

// Edges renders in flight. The hooks are installed only while one is: a
// process that never starts one (or has none running) keeps the plain paths
// with nothing behind the slot. Interleaved async renders still check their
// own context (`on`).
let active = 0;
/** @internal Edges renders in flight (tests). */
export function edgesRenders(): number {
  return active;
}
/**
 * @internal An edges render starts (renderToStream with the server-components
 * codec): install the hooks. Call the returned function once when it ends.
 */
export function beginEdgesRender(): () => void {
  if (active++ === 0) setEdgeHooks(hooks);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    if (--active === 0) setEdgeHooks(null);
  };
}

/**
 * @internal Run a slot fill, returning its result, the plain-signal
 * identities it read, and whether it ran a computation whose reads the
 * server cannot see (`untracked`).
 */
export function trackFillReads<T>(fn: () => T): {
  result: T;
  reads: Set<string> | null;
  untracked: boolean;
} {
  if (!on()) return { result: fn(), reads: null, untracked: false };
  const prev = readSink;
  const prevFill = fillSink;
  const sink: ReadSink = { s: null };
  readSink = fillSink = sink;
  try {
    const result = fn();
    return { result, reads: sink.s, untracked: !!sink.untracked };
  } finally {
    readSink = prev;
    fillSink = prevFill;
  }
}
