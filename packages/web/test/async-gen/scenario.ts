/**
 * The async app generator's scenario language: a small app (sources, memos,
 * a component tree of Loading / Errored / Show / leaves) and a script of
 * steps. Generated with fast-check; shrinking moves toward fewer memos,
 * a shallower tree and a shorter script.
 */
import fc from "fast-check";

/** A signal (`s`) or a memo (`m`), by index. */
export type SrcRef = { k: "s" | "m"; i: number };
/** How a hole reads its source: `x()`, `latest(x)`, `isPending(x)` or
 * `isPending(() => latest(x))` (`pendingLatest`: the verdict of the latest
 * channel, A8). */
export type How = "plain" | "latest" | "pending" | "pendingLatest";
export type Read = { how: How; src: SrcRef };

/** A memo input: `x()`, `latest(x)` or `isPending(x)` (counted as 0/1).
 * `when`: the input is read only while that signal is non-zero — a probe a
 * memo makes on one run and not the next (S-50). Rulings only; the random
 * generator never emits `pending` or `when`. */
export type Dep = { src: SrcRef; how: "plain" | "latest" | "pending"; when?: SrcRef };

/**
 * A memo over earlier sources. Its value is the sum of its deps plus one. An
 * async memo returns a manual flight per run, settled by the script; a flight
 * whose input `v` has `v % 4 === poison` rejects. A sync memo throws on the
 * same condition.
 */
export type MemoDef = {
  async: boolean;
  deps: Dep[];
  poison: number | null;
  /** `createOptimistic(fn)` instead of `createMemo(fn)`: its setter is the
   * target of `guess` writes (rulings only). */
  optimistic?: true;
};

export type Node =
  /** `on`: the boundary's dependency list (`<Loading on={[...]}>`); the reads
   * are made, the values never compared (rulings only). */
  | { t: "loading"; child: Node; on?: Read[] }
  | { t: "errored"; child: Node }
  /** `owns`: memos created inside this branch when it opens — born held when
   * the branch opens under a hold (rulings only; D-2). */
  | { t: "show"; when: Read; child: Node; fallback: boolean; owns?: number[] }
  | { t: "group"; kids: Node[] }
  /** A `<span>` with one inserted text hole per `text` read and one
   * `data-a<n>` attribute per `attrs` read — in ONE compiled effect when
   * `grouped`, one effect per attribute otherwise (pair E1). */
  | { t: "leaf"; text: Read[]; attrs: Read[]; grouped: boolean };

/** A write inside an action: a truth write to signal `s`, or a guess to an
 * optimistic source `o` (an optimistic signal's setter, or an optimistic
 * memo's). A truth write to an optimistic signal is a guess too. */
export type Write = { s: number; v: number } | { o: SrcRef; v: number };

export type Step =
  | { t: "write"; s: number; v: number }
  /** Settle the `pick % open`-th open flight (oldest first). */
  | { t: "settle"; pick: number }
  /** An action: writes s = v, then yields on a flight the script settles. */
  | { t: "action"; s: number; v: number }
  /** An action (rulings only): `before` writes, a yield on a flight the
   * script settles, then `after` writes and `refresh(memos[i])` calls.
   * `sync`: no yield — the body ends inside the call (S-52). */
  | { t: "action"; before: Write[]; after?: Write[]; refresh?: number[]; sync?: true }
  /** A guess outside an action (rulings only). */
  | { t: "guess"; o: SrcRef; v: number }
  /** `refresh(memos[m])` from outside any hold (rulings only). */
  | { t: "refresh"; m: number }
  | { t: "flush" }
  | { t: "micro" }
  | { t: "task" };

export interface Scenario {
  signals: number[]; // initial values, 1..2 signals
  memos: MemoDef[]; // 0..3
  tree: Node; // rendered under a root Errored > Loading
  steps: Step[];
  /** Memos created inside the root component instead of at module level. */
  owned?: boolean;
  /** Signals created with `createOptimistic(v)` (rulings only). */
  optimistic?: number[];
  /** Names for rendering a ruling's document block; the runner ignores them. */
  names?: Record<string, string>;
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
      : r.how === "pending"
        ? `isPending(${ref(r.src)})`
        : `isPending(() => latest(${ref(r.src)}))`;

export function describeNode(n: Node): string {
  switch (n.t) {
    case "leaf":
      return `<span${n.attrs.length ? ` ${n.grouped ? "fx" : "split"}[${n.attrs.map(rd).join(",")}]` : ""}>${n.text.map(rd).join(" ")}</span>`;
    case "loading":
      return `<Loading${n.on ? ` on=[${n.on.map(rd).join(",")}]` : ""}>${describeNode(n.child)}</Loading>`;
    case "errored":
      return `<Errored>${describeNode(n.child)}</Errored>`;
    case "show":
      return `<Show when=${rd(n.when)}${n.fallback ? " fb" : ""}${n.owns?.length ? ` owns=[${n.owns.map(i => `m${i}`).join(",")}]` : ""}>${describeNode(n.child)}</Show>`;
    case "group":
      return n.kids.map(describeNode).join("");
  }
}

export function describeScenario(s: Scenario): string {
  const memos = s.memos
    .map(
      (m, i) =>
        `m${i}=${m.optimistic ? "opt:" : ""}${m.async ? "async" : "memo"}(${m.deps.map(d => `${d.how === "latest" ? `latest(${ref(d.src)})` : d.how === "pending" ? `isPending(${ref(d.src)})` : ref(d.src)}${d.when ? `?${ref(d.when)}` : ""}`).join("+")}${m.poison !== null ? ` !%4=${m.poison}` : ""})`
    )
    .join(" ");
  const w = (x: Write) => ("s" in x ? `s${x.s}=${x.v}` : `guess ${ref(x.o)}=${x.v}`);
  const steps = s.steps
    .map(st =>
      st.t === "write"
        ? `s${st.s}=${st.v}`
        : st.t === "settle"
          ? `S${st.pick}`
          : st.t === "action"
            ? "s" in st
              ? `A(s${st.s}=${st.v})`
              : `A(${st.before.map(w).join(",")}${st.after?.length ? ` | after ${st.after.map(w).join(",")}` : ""}${st.refresh?.length ? ` | refresh ${st.refresh.map(i => `m${i}`).join(",")}` : ""})`
            : st.t === "guess"
              ? `G(${ref(st.o)}=${st.v})`
              : st.t === "refresh"
                ? `R(m${st.m})`
                : st.t === "flush"
                  ? "f"
                  : st.t === "micro"
                    ? "m"
                    : "t"
    )
    .join(" ");
  return `${s.owned ? "owned " : ""}[${s.signals.map((v, i) => `${s.optimistic?.includes(i) ? "opt:" : ""}s${i}=${v}`).join(" ")}${memos ? " " + memos : ""}] ${describeNode(s.tree)} :: ${steps}`;
}
