/**
 * The scenario language of the consistency harness and its fast-check
 * arbitrary.
 *
 * A scenario is a PAGE SHAPE (a server-component boundary's occurrences,
 * the server `<Loading>` fragments some of them sit in, an optional live
 * hole) plus an EVENT SCHEDULE — the order in which the client hydrates,
 * the occurrences' args records execute, the fragments reveal, trace
 * patches and live-hole ops arrive, time passes, and (optionally) the
 * mount disposes. Every required event appears exactly once; the schedule's
 * ORDER is the generated thing (fast-check shrinks it toward the identity
 * permutation, so a reduced counterexample reads as "the first N required
 * events, in the order listed").
 */
import fc from "fast-check";

export type OccurrenceArg =
  | { kind: "plain" }
  | { kind: "trace"; snapshot: number; patches: number[] };

export interface Occurrence {
  /** `item#i` (render-prop `item`) or `children` (direct-insert). */
  name: string;
  kind: "render" | "direct";
  arg: OccurrenceArg;
  /** Index into `fragments`, or null for the root content. */
  inFragment: number | null;
}

export interface Fragment {
  /** Short key; the runner namespaces it per case (the ledger is module-level). */
  key: string;
  fallback: string;
}

export type Event =
  | { t: "hydrate" }
  | { t: "record"; occ: number }
  | { t: "reveal"; frag: number }
  | { t: "trace"; occ: number; patch: number }
  | { t: "live"; html: string }
  | { t: "tick" }
  | { t: "micro" }
  | { t: "dispose" };

export interface Scenario {
  occurrences: Occurrence[];
  fragments: Fragment[];
  liveHole: boolean;
  late: "none" | "dispose";
  events: Event[];
}

const WORDS = ["ab", "cd", "ef"] as const;

/**
 * The required events of a shape, in canonical order: hydrate, each render
 * occurrence's record, each fragment's reveal, each trace occurrence's
 * patches (in order), each live op.
 */
export function requiredEvents(
  shape: Omit<Scenario, "events">,
  liveOps: string[],
  ticks: number,
  micros: number
): Event[] {
  const events: Event[] = [{ t: "hydrate" }];
  shape.occurrences.forEach((o, i) => {
    if (o.kind === "render") events.push({ t: "record", occ: i });
  });
  shape.fragments.forEach((_, i) => events.push({ t: "reveal", frag: i }));
  shape.occurrences.forEach((o, i) => {
    if (o.arg.kind === "trace")
      o.arg.patches.forEach((_, p) => events.push({ t: "trace", occ: i, patch: p }));
  });
  for (const html of liveOps) events.push({ t: "live", html });
  for (let i = 0; i < ticks; i++) events.push({ t: "tick" });
  for (let i = 0; i < micros; i++) events.push({ t: "micro" });
  if (shape.late === "dispose") events.push({ t: "dispose" });
  return events;
}

/**
 * Restore the constraints a permutation may have broken: trace patches of
 * one occurrence stay in index order (the positions are kept, the indices
 * re-assigned ascending), and `dispose` follows `hydrate`.
 */
export function normalize(events: Event[]): Event[] {
  const out = events.map(e => ({ ...e }));
  const seen = new Map<number, number>();
  for (const e of out) {
    if (e.t === "trace") {
      const n = seen.get(e.occ) ?? 0;
      e.patch = n;
      seen.set(e.occ, n + 1);
    }
  }
  const h = out.findIndex(e => e.t === "hydrate");
  const d = out.findIndex(e => e.t === "dispose");
  if (d >= 0 && d < h) {
    const [disp] = out.splice(d, 1);
    out.splice(h, 0, disp);
  }
  return out;
}

const argArb: fc.Arbitrary<OccurrenceArg> = fc.oneof(
  { weight: 2, arbitrary: fc.constant({ kind: "plain" } as const) },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("trace" as const),
      snapshot: fc.nat({ max: 3 }),
      patches: fc.array(fc.integer({ min: -2, max: 3 }), { maxLength: 2 })
    })
  }
);

const shapeArb = fc
  .record({
    renders: fc.array(argArb, { minLength: 1, maxLength: 3 }),
    direct: fc.boolean(),
    fragmentCount: fc.nat({ max: 2 }),
    placement: fc.array(fc.nat({ max: 2 }), { minLength: 4, maxLength: 4 }),
    liveHole: fc.boolean(),
    late: fc.constantFrom("none" as const, "dispose" as const)
  })
  .map(({ renders, direct, fragmentCount, placement, liveHole, late }) => {
    const fragments: Fragment[] = [];
    for (let i = 0; i < fragmentCount; i++) fragments.push({ key: `f${i}`, fallback: `fb${i}` });
    const occurrences: Occurrence[] = renders.map((arg, i) => ({
      name: `item#${i}`,
      kind: "render" as const,
      arg,
      inFragment: fragmentCount ? (placement[i] % (fragmentCount + 1)) - 1 : null
    }));
    for (const o of occurrences) if (o.inFragment !== null && o.inFragment < 0) o.inFragment = null;
    if (direct)
      occurrences.push({
        name: "children",
        kind: "direct",
        arg: { kind: "plain" },
        inFragment: fragmentCount ? (placement[3] % (fragmentCount + 1)) - 1 : null
      });
    for (const o of occurrences) if (o.inFragment !== null && o.inFragment < 0) o.inFragment = null;
    return { occurrences, fragments, liveHole, late };
  });

/** The arbitrary: a shape, its required events, a permutation of them. */
export const scenarioArb: fc.Arbitrary<Scenario> = shapeArb.chain(shape =>
  fc
    .record({
      liveOps: shape.liveHole
        ? fc.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 2 })
        : fc.constant([] as string[]),
      ticks: fc.nat({ max: 2 }),
      micros: fc.nat({ max: 2 })
    })
    .chain(({ liveOps, ticks, micros }) => {
      const required = requiredEvents(shape, liveOps, ticks, micros);
      return fc
        .shuffledSubarray(required, { minLength: required.length, maxLength: required.length })
        .map(events => ({ ...shape, events: normalize(events) }));
    })
);

/** One line per scenario, for logs and pin titles. */
export function describeScenario(s: Scenario): string {
  const occ = s.occurrences
    .map(o => {
      const arg =
        o.arg.kind === "trace"
          ? `trace(${o.arg.snapshot}${o.arg.patches.map(p => `,${p}`).join("")})`
          : "";
      return `${o.name}${arg}${o.inFragment !== null ? `@${s.fragments[o.inFragment].key}` : ""}`;
    })
    .join(" ");
  const ev = s.events
    .map(e => {
      switch (e.t) {
        case "hydrate":
          return "H";
        case "record":
          return `R${e.occ}`;
        case "reveal":
          return `V${e.frag}`;
        case "trace":
          return `T${e.occ}.${e.patch}`;
        case "live":
          return `L(${e.html})`;
        case "tick":
          return "t";
        case "micro":
          return "m";
        case "dispose":
          return "X";
      }
    })
    .join(" ");
  return `[${occ}]${s.liveHole ? " hole" : ""} :: ${ev}`;
}
