/**
 * The scenario language of the GENERIC (frames-free) hydration harness and
 * its fast-check arbitrary — `documentation/server-components/
 * frames-consistency-contract.md` §"Generic hydration".
 *
 * The page is fixed (test/harness/generic-hydration.tsx: a shell and two
 * sibling streamed `<Loading>` boundaries reading module-level state); the
 * server rendered it in both fragment orders (`__artifacts__/
 * generic-hydration-<order>.json`). A scenario picks the order and an EVENT
 * SCHEDULE: when the client hydrates relative to the stream's chunks, and
 * where client writes (a signal write, a store push), pre-hydration clicks,
 * a disposal, and settle points fall between them. The chunks keep their
 * wire order (each references resolvers the previous one defined); every
 * other event is free. Shrinking moves the schedule toward the canonical
 * order, so a reduced counterexample reads as "these events, in this
 * order".
 */
import fc from "fast-check";
import type { Order } from "../../harness/generic-hydration.jsx";

export type Side = "a" | "b";

export type Event =
  | { t: "hydrate" }
  /** The stream's `i`-th chunk parses (markup appended, its scripts run). */
  | { t: "chunk"; i: number }
  /** A client write to the module-level signal (`setPath("/b")`). */
  | { t: "write" }
  /** A client push to the module-level store list. */
  | { t: "push" }
  /** A user click on a boundary's button — queued by the bootstrap if its range is not claimed yet. */
  | { t: "click"; side: Side }
  /** A settle point: flush, 20ms (an in-flight client async re-run lands), flush. */
  | { t: "tick" }
  | { t: "micro" }
  | { t: "dispose" };

export interface Scenario {
  order: Order;
  /** How many chunks the artifact for `order` has (fixed per artifact). */
  chunks: number;
  events: Event[];
}

/** Required events in canonical order: hydrate, the chunks in wire order, then the optional ones. */
export function requiredEvents(
  chunks: number,
  opts: {
    write: boolean;
    push: boolean;
    clicks: Side[];
    dispose: boolean;
    ticks: number;
    micros: number;
  }
): Event[] {
  const events: Event[] = [{ t: "hydrate" }];
  for (let i = 0; i < chunks; i++) events.push({ t: "chunk", i });
  if (opts.write) events.push({ t: "write" });
  if (opts.push) events.push({ t: "push" });
  for (const side of opts.clicks) events.push({ t: "click", side });
  for (let i = 0; i < opts.ticks; i++) events.push({ t: "tick" });
  for (let i = 0; i < opts.micros; i++) events.push({ t: "micro" });
  if (opts.dispose) events.push({ t: "dispose" });
  return events;
}

/**
 * Restore the constraints a permutation may have broken: chunks stay in
 * wire order (positions kept, indices re-assigned ascending); `dispose`,
 * `write` and `push` follow `hydrate` (a client write BEFORE `hydrate()`
 * runs is an app-level mismatch — the server markup was never rendered
 * from that state — and outside the contract; a write DURING hydration is
 * what the snapshot rules, #3504, are about).
 */
export function normalize(events: Event[]): Event[] {
  const out = events.map(e => ({ ...e }));
  let next = 0;
  for (const e of out) if (e.t === "chunk") e.i = next++;
  for (const t of ["dispose", "write", "push"] as const) {
    const h = out.findIndex(e => e.t === "hydrate");
    const d = out.findIndex(e => e.t === t);
    if (d >= 0 && d < h) {
      const [moved] = out.splice(d, 1);
      out.splice(h, 0, moved);
    }
  }
  return out;
}

export function scenarioArb(chunksFor: (order: Order) => number): fc.Arbitrary<Scenario> {
  return fc
    .record({
      order: fc.constantFrom("ab" as const, "ba" as const),
      write: fc.boolean(),
      push: fc.boolean(),
      clicks: fc.subarray(["a", "b"] as Side[]),
      dispose: fc.boolean(),
      ticks: fc.nat({ max: 3 }),
      micros: fc.nat({ max: 2 })
    })
    .chain(({ order, ...opts }) => {
      const chunks = chunksFor(order);
      const required = requiredEvents(chunks, opts);
      return fc
        .shuffledSubarray(required, { minLength: required.length, maxLength: required.length })
        .map(events => ({ order, chunks, events: normalize(events) }));
    });
}

/** One line per scenario: `[ab] :: H C0 W C1 t P C2 Ea X`. */
export function describeScenario(s: Scenario): string {
  const ev = s.events
    .map(e => {
      switch (e.t) {
        case "hydrate":
          return "H";
        case "chunk":
          return `C${e.i}`;
        case "write":
          return "W";
        case "push":
          return "P";
        case "click":
          return `E${e.side}`;
        case "tick":
          return "t";
        case "micro":
          return "m";
        case "dispose":
          return "X";
      }
    })
    .join(" ");
  return `[${s.order}] :: ${ev}`;
}
