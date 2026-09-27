/**
 * Harness for optimistic-list-mutation-matrix.test.ts — the rows, the
 * mutations, the two truth sources, the four readers and the oracle. Kept
 * out of the runner so the matrix reads as contexts × mutations.
 *
 * Oracle pattern (visibility-oracle-store.states.ts): a plain `createStore`
 * rendered by the same reader is the oracle; an optimistic context must show
 * the oracle's frame for the same cumulative mutation list at every
 * checkpoint, through the effect channel (`frames`) and the untracked
 * channel (`untrackedFrame`) alike.
 */
import {
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  mapArray,
  onCleanup,
  repeat,
  untrack,
  type Accessor
} from "../../src/index.js";

export interface Row {
  id: string;
  text: string;
}

export const row = (id: string, text = id.toUpperCase()): Row => ({ id, text });
export const INITIAL: Row[] = ["a", "b", "c", "d", "e", "f"].map(id => row(id));
/** The row a DIFFERENT truth appends beside the mutation the client asked for. */
export const SERVER_ROW: Row = row("s", "server");
/** The row the post-settle ambient probe pushes — it must revert at its flush. */
export const PROBE_ROW: Row = row("p", "probe");

export const clone = (rows: readonly Row[]): Row[] => rows.map(r => ({ ...r }));
export const frameOf = (rows: readonly Row[]): string =>
  rows.map(r => `${r.id}:${r.text}`).join(",");

export type Mutate = (d: Row[]) => void;

export interface Mutation {
  name: string;
  apply: Mutate;
  /** Undoes `apply` when `apply` ran against INITIAL. */
  inverse: Mutate;
}

const move =
  (from: number, to: number): Mutate =>
  d => {
    const [r] = d.splice(from, 1);
    d.splice(to, 0, r);
  };
const replaceAll =
  (rows: () => Row[]): Mutate =>
  d => {
    d.splice(0, d.length, ...rows());
  };
const noop: Mutate = () => {};
const restore = replaceAll(() => clone(INITIAL));

export const MUTATIONS: Mutation[] = [
  { name: "no-op", apply: noop, inverse: noop },
  {
    name: "swap a<->b",
    apply: d => {
      const t = d[0];
      d[0] = d[1];
      d[1] = t;
    },
    inverse: d => {
      const t = d[0];
      d[0] = d[1];
      d[1] = t;
    }
  },
  { name: "reverse", apply: d => void d.reverse(), inverse: d => void d.reverse() },
  {
    name: "rotate left",
    apply: d => void d.push(d.shift()!),
    inverse: d => void d.unshift(d.pop()!)
  },
  { name: "move head->tail", apply: move(0, 5), inverse: move(5, 0) },
  { name: "move tail->head", apply: move(5, 0), inverse: move(0, 5) },
  { name: "move middle (c->4)", apply: move(2, 4), inverse: move(4, 2) },
  { name: "insert head", apply: d => void d.unshift(row("x")), inverse: d => void d.shift() },
  {
    name: "insert middle",
    apply: d => void d.splice(3, 0, row("x")),
    inverse: d => void d.splice(3, 1)
  },
  { name: "insert tail", apply: d => void d.push(row("x")), inverse: d => void d.pop() },
  { name: "delete head", apply: d => void d.shift(), inverse: d => void d.unshift(row("a")) },
  {
    name: "delete middle (d)",
    apply: d => void d.splice(3, 1),
    inverse: d => void d.splice(3, 0, row("d"))
  },
  { name: "delete tail", apply: d => void d.pop(), inverse: d => void d.push(row("f")) },
  { name: "clear", apply: d => void d.splice(0, d.length), inverse: restore },
  {
    name: "replace-all disjoint ids",
    apply: replaceAll(() => ["u", "v", "w", "x", "y", "z"].map(id => row(id))),
    inverse: restore
  },
  {
    name: "replace-all same ids reordered",
    apply: replaceAll(() => ["c", "a", "f", "b", "e", "d"].map(id => row(id))),
    inverse: restore
  },
  {
    name: "update text in place (c)",
    apply: d => {
      d[2].text = "C!";
    },
    inverse: d => {
      d[2].text = "C";
    }
  },
  {
    name: "delete then re-add same id (c -> tail)",
    apply: d => {
      const [r] = d.splice(2, 1);
      d.push(row(r.id, r.text));
    },
    inverse: move(5, 2)
  },
  {
    name: "append then pop",
    apply: d => {
      d.push(row("x"));
      d.pop();
    },
    inverse: noop
  }
];

export const byName = (name: string): Mutation => {
  const m = MUTATIONS.find(m => m.name === name);
  if (!m) throw new Error(`no mutation named ${name}`);
  return m;
};

/** Distinct mutations for the overlapping-actions context (#3662's shape). */
export const PAIRS: Array<[Mutation, Mutation]> = [
  [byName("move head->tail"), byName("move middle (c->4)")],
  [byName("insert head"), byName("delete tail")],
  [byName("update text in place (c)"), byName("swap a<->b")],
  [
    byName("swap a<->b"),
    {
      name: "swap e<->f",
      apply: d => {
        const t = d[4];
        d[4] = d[5];
        d[5] = t;
      },
      inverse: noop
    }
  ]
];

// ── truth sources ───────────────────────────────────────────────────────────

export type SourceKind = "derived" | "chained";
export const SOURCES: SourceKind[] = ["derived", "chained"];

export interface Source {
  view: Row[];
  setView: (fn: Mutate) => void;
  /** The committed truth beneath the view, as plain rows. */
  truth: () => Row[];
  /** Applies `m` to the truth. Inside an action this is transition-held. */
  commitTruth: (m: Mutate) => void;
}

/** Must run under an owner. */
export function createSource(kind: SourceKind): Source {
  if (kind === "derived") {
    // The playground shape: the optimistic store derives from a signal that
    // the action writes after its await (#3662's `createOptimisticStore(() => …)`).
    const [truth, setTruth] = createSignal<Row[]>(clone(INITIAL));
    const [view, setView] = createOptimisticStore<Row[]>(() => truth(), []);
    return {
      view,
      setView,
      truth: () => untrack(truth),
      commitTruth(m) {
        const next = clone(untrack(truth));
        m(next);
        setTruth(next);
      }
    };
  }
  // #3672's shape: an optimistic view chained over a plain store.
  const [base, setBase] = createStore<Row[]>(clone(INITIAL));
  const [view, setView] = createOptimisticStore<Row[]>(base);
  return {
    view,
    setView,
    truth: () => untrack(() => clone(base)),
    commitTruth(m) {
      setBase(m);
    }
  };
}

// ── readers ─────────────────────────────────────────────────────────────────

export type ReaderKind = "mapArray-keyed" | "mapArray-index" | "repeat" | "memo";
export const READERS: ReaderKind[] = ["mapArray-keyed", "mapArray-index", "repeat", "memo"];

export interface Rendered {
  /** Every frame the effect channel published, in order. */
  frames: string[];
  /** Interleaved `create:` / `cleanup:` / `frame:` entries. */
  log: string[];
  /** Invariant breaches recorded at publish time (asserted empty). */
  violations: string[];
  /** Per row instance: how many times its onCleanup ran. */
  instances: Map<string, number>;
  /** The row instances the latest frame displayed. */
  shown: string[];
}

interface RowView {
  inst: string;
  read: () => string;
}

/**
 * Renders `list` through `kind`. Must run under an owner. Every list reader
 * builds each row with an `onCleanup` and a nested memo chain (the
 * `<Show when={false}>` stand-in of #3662) and publishes through the
 * nested-insert shape: an OUTER render effect tracking the list builds an
 * INNER `schedule: true` effect that unwraps the rows and publishes.
 */
export function renderList(kind: ReaderKind, list: () => Row[]): Rendered {
  const out: Rendered = {
    frames: [],
    log: [],
    violations: [],
    instances: new Map(),
    shown: []
  };
  let serial = 0;

  const publish = (frame: string, shown: string[]) => {
    for (const inst of shown) {
      if (out.instances.get(inst)! > 0)
        out.violations.push(`row ${inst} displayed in frame "${frame}" after its cleanup ran`);
    }
    out.frames.push(frame);
    out.shown = shown;
    out.log.push(`frame:${frame}`);
  };

  const makeRow = (label: string | undefined, read: () => Row | undefined): RowView => {
    const inst = `${label ?? "<undefined>"}#${++serial}`;
    out.instances.set(inst, 0);
    out.log.push(`create:${inst}`);
    onCleanup(() => {
      out.instances.set(inst, out.instances.get(inst)! + 1);
      out.log.push(`cleanup:${inst}`);
    });
    const cond = createMemo(() => false);
    const show = createMemo(() => (cond() ? "child" : undefined));
    return {
      inst,
      read: () => {
        show();
        const r = read();
        // A hole where a row should be is recorded, not thrown: see keyOf.
        return r ? `${r.id}:${r.text}` : "<undefined>";
      }
    };
  };

  // The key function a user writes is `r => r.id`. Here an undefined item is
  // recorded as a violation instead of thrown, because a throw inside the
  // graph halts the scheduler for every later row (REACTIVITY_HALTED) and
  // the StatusError it leaves as an unhandled rejection carries the node
  // graph, which vitest's reporter cannot serialize (OOM). The row still
  // fails — on the violation — with the frame it failed at.
  const keyOf = (r: Row | undefined) => {
    if (r === undefined) {
      out.violations.push(`keyed(): called with an undefined item (a hole in the list)`);
      return undefined;
    }
    return r.id;
  };

  if (kind === "memo") {
    const joined = createMemo(() => frameOf(list()));
    createRenderEffect(joined, frame => publish(frame, []));
    return out;
  }

  let mapped: Accessor<RowView[]>;
  if (kind === "mapArray-keyed") {
    mapped = mapArray(
      list,
      (item: Accessor<Row>) =>
        makeRow(
          untrack(() => keyOf(item())),
          item
        ),
      {
        keyed: keyOf
      }
    );
  } else if (kind === "mapArray-index") {
    mapped = mapArray(list, (item: Accessor<Row>, index: number) => makeRow(`slot${index}`, item), {
      keyed: false
    });
  } else {
    mapped = repeat(
      () => list().length,
      i => makeRow(`slot${i}`, () => list()[i])
    ) as Accessor<RowView[]>;
  }

  createRenderEffect(
    () => {
      const rows = mapped();
      createRenderEffect(
        () => rows.map(r => r.read()).join(","),
        frame =>
          publish(
            frame,
            rows.map(r => r.inst)
          ),
        { schedule: true }
      );
      return rows.length;
    },
    () => {}
  );
  return out;
}

// ── oracle ──────────────────────────────────────────────────────────────────

/** The frame plain JavaScript produces for `muts` applied in order to INITIAL. */
export function pureFrame(muts: Mutate[]): string {
  const rows = clone(INITIAL);
  for (const m of muts) m(rows);
  return frameOf(rows);
}

/**
 * The oracle: a plain store rendered through `kind`, `muts` applied one
 * flush at a time. Returns the last frame the effect channel published.
 */
export function oracleFrame(kind: ReaderKind, muts: Mutate[]): string {
  let setStore!: (fn: Mutate) => void;
  let r!: Rendered;
  const dispose = createRoot(d => {
    const [store, set] = createStore<Row[]>(clone(INITIAL));
    setStore = set;
    r = renderList(kind, () => store);
    return d;
  });
  flush();
  for (const m of muts) {
    setStore(m);
    flush();
  }
  const frame = r.frames.at(-1)!;
  dispose();
  flush();
  return frame;
}

// ── timing ──────────────────────────────────────────────────────────────────

export const tick = () => new Promise<void>(r => setTimeout(r, 0));

export interface Gate {
  promise: Promise<void>;
  release: () => void;
}
export function gate(): Gate {
  let release!: () => void;
  const promise = new Promise<void>(r => (release = r));
  return { promise, release };
}

/**
 * Lets an action whose gate was released run to its end and commit. Bounded:
 * an action that never settles (a halted scheduler) must fail on the frame
 * it left, not on the test timeout.
 */
export async function settle(done: Promise<unknown>): Promise<void> {
  flush();
  await Promise.race([
    done,
    (async () => {
      for (let i = 0; i < 10; i++) await tick();
    })()
  ]);
  flush();
  await tick();
  flush();
}
