/**
 * The async app generator's scenario language: a small app (sources, memos,
 * a component tree of Loading / Errored / Show / leaves) and a script of
 * steps. Generated with fast-check; shrinking moves toward fewer memos,
 * a shallower tree and a shorter script.
 */
import fc from "fast-check";

/** A signal (`s`) or a memo (`m`), by index. */
export type SrcRef = { k: "s" | "m"; i: number };
/** How a hole reads its source: `x()`, `latest(x)` or `isPending(x)`. */
export type How = "plain" | "latest" | "pending";
export type Read = { how: How; src: SrcRef };

/**
 * A memo over earlier sources. Its value is the sum of its deps plus one. An
 * async memo returns a manual flight per run, settled by the script; a flight
 * whose input `v` has `v % 4 === poison` rejects. A sync memo throws on the
 * same condition.
 */
export type MemoDef = {
  async: boolean;
  deps: { src: SrcRef; how: "plain" | "latest" }[];
  poison: number | null;
};

export type Node =
  | { t: "loading"; child: Node }
  | { t: "errored"; child: Node }
  | { t: "show"; when: Read; child: Node; fallback: boolean }
  | { t: "group"; kids: Node[] }
  /** A `<span>` with one inserted text hole per `text` read and one
   * `data-a<n>` attribute per `attrs` read — in ONE compiled effect when
   * `grouped`, one effect per attribute otherwise (pair E1). */
  | { t: "leaf"; text: Read[]; attrs: Read[]; grouped: boolean };

export type Step =
  | { t: "write"; s: number; v: number }
  /** Settle the `pick % open`-th open flight (oldest first). */
  | { t: "settle"; pick: number }
  /** An action: writes s = v, then yields on a flight the script settles. */
  | { t: "action"; s: number; v: number }
  | { t: "flush" }
  | { t: "micro" }
  | { t: "task" };

export interface Scenario {
  signals: number[]; // initial values, 1..2 signals
  memos: MemoDef[]; // 0..3
  tree: Node; // rendered under a root Errored > Loading
  steps: Step[];
}

const VALUES = 4;

function refArb(signals: number, memos: number): fc.Arbitrary<SrcRef> {
  const s = fc.nat(signals - 1).map(i => ({ k: "s" as const, i }));
  if (!memos) return s;
  const m = fc.nat(memos - 1).map(i => ({ k: "m" as const, i }));
  return fc.oneof({ weight: 1, arbitrary: s }, { weight: 2, arbitrary: m });
}

function memoArb(signals: number, index: number): fc.Arbitrary<MemoDef> {
  return fc.record({
    async: fc.boolean(),
    deps: fc.array(
      fc.record({
        src: refArb(signals, index),
        how: process.env.ASYNC_GEN_NO_LATEST_DEPS
          ? fc.constant("plain" as const)
          : fc.constantFrom("plain" as const, "plain" as const, "latest" as const)
      }),
      { minLength: 1, maxLength: 2 }
    ),
    poison: fc.option(fc.nat(VALUES - 1), { nil: null, freq: 2 })
  });
}

function readArb(signals: number, memos: number): fc.Arbitrary<Read> {
  return fc.record({
    how: fc.constantFrom("plain" as const, "plain" as const, "latest" as const, "pending" as const),
    src: refArb(signals, memos)
  });
}

function treeArb(signals: number, memos: number): fc.Arbitrary<Node> {
  const read = readArb(signals, memos);
  const { node } = fc.letrec<{ node: Node }>(tie => ({
    node: fc.oneof(
      { depthSize: "small", withCrossShrink: true },
      {
        weight: 3,
        arbitrary: fc.record({
          t: fc.constant("leaf" as const),
          text: fc.array(read, { minLength: 0, maxLength: 2 }),
          attrs: fc.array(read, { minLength: 0, maxLength: 2 }),
          grouped: fc.boolean()
        })
      },
      {
        weight: 1,
        arbitrary: fc.record({ t: fc.constant("loading" as const), child: tie("node") })
      },
      {
        weight: 1,
        arbitrary: fc.record({ t: fc.constant("errored" as const), child: tie("node") })
      },
      {
        weight: 1,
        arbitrary: fc.record({
          t: fc.constant("show" as const),
          when: read,
          child: tie("node"),
          fallback: fc.boolean()
        })
      },
      {
        weight: 1,
        arbitrary: fc.record({
          t: fc.constant("group" as const),
          kids: fc.array(tie("node"), { minLength: 1, maxLength: 3 })
        })
      }
    ) as fc.Arbitrary<Node>
  }));
  return node;
}

function stepArb(signals: number): fc.Arbitrary<Step> {
  return fc.oneof(
    {
      weight: 4,
      arbitrary: fc.record({
        t: fc.constant("write" as const),
        s: fc.nat(signals - 1),
        v: fc.nat(VALUES - 1)
      })
    },
    { weight: 4, arbitrary: fc.record({ t: fc.constant("settle" as const), pick: fc.nat(7) }) },
    {
      weight: 1,
      arbitrary: fc.record({
        t: fc.constant("action" as const),
        s: fc.nat(signals - 1),
        v: fc.nat(VALUES - 1)
      })
    },
    { weight: 1, arbitrary: fc.constant({ t: "flush" as const }) },
    { weight: 1, arbitrary: fc.constant({ t: "micro" as const }) },
    { weight: 2, arbitrary: fc.constant({ t: "task" as const }) }
  );
}

export function scenarioArb(): fc.Arbitrary<Scenario> {
  return fc.integer({ min: 1, max: 2 }).chain(ns =>
    fc.integer({ min: 0, max: 3 }).chain(nm =>
      fc.record({
        signals: fc.array(fc.nat(VALUES - 1), { minLength: ns, maxLength: ns }),
        memos: fc.tuple(...Array.from({ length: nm }, (_, i) => memoArb(ns, i))) as fc.Arbitrary<
          MemoDef[]
        >,
        tree: treeArb(ns, nm),
        steps: fc.array(stepArb(ns), { minLength: 1, maxLength: 12 })
      })
    )
  );
}

// ── printing ────────────────────────────────────────────────────────────────

const ref = (r: SrcRef) => `${r.k}${r.i}`;
const rd = (r: Read) =>
  r.how === "plain"
    ? `${ref(r.src)}()`
    : r.how === "latest"
      ? `latest(${ref(r.src)})`
      : `isPending(${ref(r.src)})`;

export function describeNode(n: Node): string {
  switch (n.t) {
    case "leaf":
      return `<span${n.attrs.length ? ` ${n.grouped ? "fx" : "split"}[${n.attrs.map(rd).join(",")}]` : ""}>${n.text.map(rd).join(" ")}</span>`;
    case "loading":
      return `<Loading>${describeNode(n.child)}</Loading>`;
    case "errored":
      return `<Errored>${describeNode(n.child)}</Errored>`;
    case "show":
      return `<Show when=${rd(n.when)}${n.fallback ? " fb" : ""}>${describeNode(n.child)}</Show>`;
    case "group":
      return n.kids.map(describeNode).join("");
  }
}

export function describeScenario(s: Scenario): string {
  const memos = s.memos
    .map(
      (m, i) =>
        `m${i}=${m.async ? "async" : "memo"}(${m.deps.map(d => (d.how === "latest" ? `latest(${ref(d.src)})` : ref(d.src))).join("+")}${m.poison !== null ? ` !%4=${m.poison}` : ""})`
    )
    .join(" ");
  const steps = s.steps
    .map(st =>
      st.t === "write"
        ? `s${st.s}=${st.v}`
        : st.t === "settle"
          ? `S${st.pick}`
          : st.t === "action"
            ? `A(s${st.s}=${st.v})`
            : st.t === "flush"
              ? "f"
              : st.t === "micro"
                ? "m"
                : "t"
    )
    .join(" ");
  return `[${s.signals.map((v, i) => `s${i}=${v}`).join(" ")}${memos ? " " + memos : ""}] ${describeNode(s.tree)} :: ${steps}`;
}
