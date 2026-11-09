/**
 * Runs one async-gen scenario through the real runtime (signals, solid's
 * Loading / Errored / Show, @solidjs/web's insert / effect / render) and
 * checks the oracles that need no per-case ruling:
 *
 * - SAFETY (every step): nothing throws out of a step, no console.error (a
 *   halt, an uncaught error, a loop guard), no unhandled rejection.
 * - LIVENESS (end): settle every flight until none is left, then the screen
 *   equals a fresh render of the same tree over the final inputs, with every
 *   memo synchronous (no Loading anywhere, the same errors thrown).
 *
 * `variant` rewrites the app without changing what it means (equivalence
 * pairs); `runScenario` returns the screen after every step so callers can
 * compare variants.
 */
import {
  Errored,
  Loading,
  NotReadyError,
  Show,
  action,
  createMemo,
  createOptimistic,
  createSignal,
  createStore,
  flush,
  isPending,
  latest,
  refresh,
  resetErrorHalt
} from "solid-js";
import { createComponent, effect, insert, render, setAttribute } from "../../src/index.js";
import {
  describeScenario,
  type Node,
  type Read,
  type Scenario,
  type SrcRef,
  type Write
} from "./scenario.js";

export type Finding = {
  oracle: "safety" | "liveness" | "equivalence";
  law: string;
  step: number;
  detail: string;
};
/**
 * Rewrites that must not change any screen (the equivalence pairs):
 * `split`/`grouped` force one effect per attribute or one per leaf (E1);
 * `identity` reads every memo through an identity memo and `inertErrored`
 * wraps the tree in an Errored that shows what the root one would (E2);
 * `store` reads every memo through a derived store `{ v }` (E3);
 * `autoFlush` flushes after every step (E6, final screen only);
 * `owned` overrides where the memos are created;
 * `remount` re-creates the tree's readers in the flush that applies each
 * write (E8, compared where nothing is in flight);
 * `latestDerive` reads every `latest(x)` through a memo of it (E9).
 */
export type Variant = {
  /** Render each `show` as a hand-written gate instead of `<Show>`: `"memo"`
   * is one memo whose own pass reads `when` and mounts the branch (the
   * single-memo gate, zero hops); `"cond"` is a truthiness memo over `when`
   * and a branch memo reading it (one hop — `<Show>` has two). */
  gate?: "memo" | "cond";
  split?: boolean;
  grouped?: boolean;
  identity?: boolean;
  inertErrored?: boolean;
  store?: boolean;
  autoFlush?: boolean;
  owned?: boolean;
  remount?: boolean;
  latestDerive?: boolean;
};
export interface Result {
  findings: Finding[];
  screens: string[];
  /** Whether each screen is a settle point (after the first render, a task
   * step, the end): where equivalence pairs are compared. */
  settled: boolean[];
  /** Whether nothing was in flight at each screen. */
  quiet: boolean[];
  /** At each screen, what the passes last did (see `Passes`). */
  passes: Passes[];
  final: string;
  expected: string;
  description: string;
  /** Per step, the label of the flight a `settle` step landed (null for
   * other steps or when nothing was open). Rulings render it. */
  settles: (string | null)[];
}
/**
 * `held`: each grouped attribute effect (by leaf path) whose last pass ended
 * on a first load (NotReady from a memo the tree has not read a value of
 * yet), with the memos its unread later bindings read. `memos`: how each
 * memo's last computation ended (`error` also for a rejected flight,
 * `pending` for a flight or a NotReady read). Used by E1's D-28 check.
 */
export type Passes = {
  held: Record<string, number[]>;
  memos: Record<number, "value" | "error" | "pending">;
};

type Flight = {
  label: string;
  value: number;
  rejects: boolean;
  resolve(v: number): void;
  reject(e: unknown): void;
};

// ── screen ──────────────────────────────────────────────────────────────────

export function serialize(node: globalThis.Node): string {
  let out = "";
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3) out += c.textContent;
    else if (c.nodeType === 1) {
      const el = c as Element;
      const attrs = [...el.attributes]
        .map(a => `${a.name}=${a.value}`)
        .sort()
        .join(" ");
      out += `<${el.tagName.toLowerCase()}${attrs ? " " + attrs : ""}>${serialize(el)}</${el.tagName.toLowerCase()}>`;
    }
  }
  return out;
}

// ── app ─────────────────────────────────────────────────────────────────────

const errText = (e: () => any) => {
  const v = typeof e === "function" ? e() : e;
  return String(v?.message ?? v);
};
const poisoned = (poison: number | null, v: number) => poison !== null && v % 4 === poison;

function buildApp(
  sc: Scenario,
  values: number[],
  fresh: boolean,
  flights: Flight[],
  variant: Variant,
  errors: string[],
  passes: Passes = { held: {}, memos: {} },
  staleAsks: string[] = []
) {
  // An optimistic signal's setter is a guess; the fresh render (truth only)
  // uses plain signals.
  const sigs = values.map((v, i) =>
    sc.optimistic?.includes(i) && !fresh ? createOptimistic(v) : createSignal(v)
  );
  const memos: (() => any)[] = [];
  /** The setter of an optimistic memo (`guess` writes), by memo index. */
  const guessers: ((v: any) => void)[] = [];
  const get = (r: SrcRef): (() => any) => {
    const x = r.k === "s" ? sigs[r.i][0] : memos[r.i];
    if (x === undefined)
      throw new Error(
        `async-gen: ${r.k}${r.i} is not created yet (an owned memo read outside its branch?)`
      );
    return x;
  };
  /** Memos a `show` branch owns: created when the branch opens, not up front. */
  const ownedBy = new Set<number>();
  {
    const walk = (n: Node) => {
      if (n.t === "group") n.kids.forEach(walk);
      else if (n.t !== "leaf") {
        if (n.t === "show") n.owns?.forEach(i => ownedBy.add(i));
        walk(n.child);
      }
    };
    walk(sc.tree);
  }
  // What the tree reads a memo through: the memo, an identity memo of it, or
  // a derived store's `v`.
  const views: (() => any)[] = [];
  // Memos the tree has read a value of (`x()` or `latest(x)` returned).
  const shown = new Set<number>();
  const ended = (i: number, e: unknown) =>
    (passes.memos[i] = e instanceof NotReadyError ? "pending" : "error");
  const view = (r: SrcRef): (() => any) => (r.k === "s" ? sigs[r.i][0] : views[r.i]);
  const makeMemo = (i: number) => {
    const m = sc.memos[i];
    // The plain signal reads of the pass, for the truth-asks oracle (F-2's
    // producer clause): an async memo whose pass read a signal's screen value
    // while the script had already written a newer truth asked a question
    // of a value the engine knew was stale. Guesses are not truth (F-11).
    const reads: [number, number][] = [];
    const input = () =>
      m.deps.reduce((acc, d) => {
        if (d.when && !get(d.when)()) return acc;
        const x = get(d.src);
        const v = Number(d.how === "latest" ? latest(x) : d.how === "pending" ? isPending(x) : x());
        if (d.how === "plain" && d.src.k === "s" && !sc.optimistic?.includes(d.src.i))
          reads.push([d.src.i, v]);
        return acc + v;
      }, 1);
    // `createOptimistic(fn)` is a memo whose setter writes guesses; the
    // fresh render has no guesses, so a plain memo stands in.
    const mk = (fn: () => any): (() => any) => {
      if (m.optimistic && !fresh) {
        const [g, set] = createOptimistic(fn);
        guessers[i] = set as (v: any) => void;
        return g;
      }
      return createMemo(fn);
    };
    if (m.async && !fresh) {
      memos[i] = mk(() => {
        let v: number;
        reads.length = 0;
        try {
          v = input();
        } catch (e) {
          ended(i, e);
          throw e;
        }
        for (const [si, sv] of reads)
          if (sv !== values[si])
            staleAsks.push(`m${i}:${v} asked with s${si} = ${sv} while ${values[si]} is held`);
        passes.memos[i] = "pending";
        return new Promise<number>((resolve, reject) => {
          flights.push({
            label: `m${i}:${v}`,
            value: v,
            rejects: poisoned(m.poison, v),
            resolve: v => {
              passes.memos[i] = "value";
              resolve(v);
            },
            reject: e => {
              passes.memos[i] = "error";
              reject(e);
            }
          });
        });
      });
    } else {
      memos[i] = mk(() => {
        try {
          const v = input();
          if (poisoned(m.poison, v)) throw new Error(`m${i}:${v}`);
          passes.memos[i] = "value";
          return v;
        } catch (e) {
          ended(i, e);
          throw e;
        }
      });
    }
    const x = memos[i];
    if (variant.identity) views[i] = createMemo(() => x());
    else if (variant.store) {
      const [store] = createStore<{ v?: number }>(d => {
        d.v = x();
      }, {});
      views[i] = () => store.v;
    } else views[i] = x;
  };
  const makeMemos = () => sc.memos.forEach((_, i) => ownedBy.has(i) || makeMemo(i));
  // E9: `latest(x)` read in a derivation instead of at the leaf.
  const latestViews = new Map<string, () => any>();
  const makeLatestViews = () => {
    if (!variant.latestDerive) return;
    // Only the sources the tree reads with latest(): an extra observer of
    // anything else would be a different app.
    const srcs: SrcRef[] = [];
    const walk = (n: Node) => {
      if (n.t === "leaf")
        [...n.text, ...n.attrs].forEach(r => r.how === "latest" && srcs.push(r.src));
      else if (n.t === "group") n.kids.forEach(walk);
      else {
        if (n.t === "show" && n.when.how === "latest") srcs.push(n.when.src);
        if (n.t === "loading") n.on?.forEach(r => r.how === "latest" && srcs.push(r.src));
        walk(n.child);
      }
    };
    walk(sc.tree);
    for (const r of srcs) {
      if (latestViews.has(`${r.k}${r.i}`)) continue;
      const x = view(r);
      latestViews.set(
        `${r.k}${r.i}`,
        createMemo(() => latest(x))
      );
    }
  };
  const owned = variant.owned ?? !!sc.owned;
  if (!owned) {
    makeMemos();
    makeLatestViews();
  }
  const read = (r: Read) => {
    const x = view(r.src);
    const v =
      r.how === "latest" && variant.latestDerive
        ? latestViews.get(`${r.src.k}${r.src.i}`)!()
        : r.how === "plain"
          ? x()
          : r.how === "latest"
            ? latest(x)
            : r.how === "pending"
              ? isPending(x)
              : isPending(() => latest(x));
    if (r.src.k === "m" && (r.how === "plain" || r.how === "latest")) shown.add(r.src.i);
    return v;
  };
  const [epoch, setEpoch] = createSignal(1);
  const prefix = { plain: "v", latest: "l", pending: "p", pendingLatest: "q" } as const;
  const text = (r: Read) => `${prefix[r.how]}${r.src.k}${r.src.i}:${String(read(r))} `;

  // A grouped effect's pass: the same reads in order, noting a pass that a
  // first load ends before its later bindings are read (rethrows as is).
  const groupPass = (id: string, attrs: Read[]) => {
    let j = 0;
    try {
      const vals: string[] = [];
      for (; j < attrs.length; j++) vals.push(text(attrs[j]));
      delete passes.held[id];
      return vals;
    } catch (e) {
      const src = attrs[j].src;
      if (e instanceof NotReadyError && src.k === "m" && !shown.has(src.i))
        passes.held[id] = attrs
          .slice(j + 1)
          .filter(r => r.how !== "pending" && r.src.k === "m")
          .map(r => r.src.i);
      else delete passes.held[id];
      throw e;
    }
  };

  function renderNode(n: Node, id = "r"): any {
    switch (n.t) {
      case "loading": {
        const props: any = {
          fallback: "[L]",
          get children() {
            return renderNode(n.child, `${id}.0`);
          }
        };
        // Defined, not spread: a getter in a spread is read at spread time,
        // and `Loading` tests `"on" in props`.
        if (n.on)
          Object.defineProperty(props, "on", {
            enumerable: true,
            get: () => n.on!.map(read)
          });
        return createComponent(Loading, props);
      }
      case "errored":
        return createComponent(Errored, {
          fallback: (e: () => any) => (errors.push(errText(e)), "[E]"),
          get children() {
            return renderNode(n.child, `${id}.0`);
          }
        });
      case "show": {
        if (variant.gate) {
          const branch = (open: unknown) =>
            open
              ? (n.owns?.forEach(makeMemo), renderNode(n.child, `${id}.0`))
              : n.fallback
                ? "[F]"
                : undefined;
          if (variant.gate === "memo") return createMemo(() => branch(read(n.when)));
          const cond = createMemo(() => read(n.when), { equals: (a, b) => !a === !b });
          return createMemo(() => branch(cond()));
        }
        return createComponent(Show, {
          get when() {
            return read(n.when);
          },
          fallback: n.fallback ? "[F]" : undefined,
          get children() {
            // Memos the branch owns are born with it (re-created when it
            // re-opens), so a branch opened under a hold mounts them held.
            n.owns?.forEach(makeMemo);
            return renderNode(n.child, `${id}.0`);
          }
        } as any);
      }
      case "group":
        return n.kids.map((k, i) => renderNode(k, `${id}.${i}`));
      case "leaf": {
        const span = document.createElement("span");
        for (const r of n.text) {
          const marker = document.createComment("");
          span.appendChild(marker);
          insert(span, () => text(r), marker);
        }
        const grouped = variant.split ? false : variant.grouped ? true : n.grouped;
        if (grouped && n.attrs.length) {
          effect(
            () => groupPass(id, n.attrs),
            (vals: string[], prev?: string[]) => {
              vals.forEach((v, j) => v !== prev?.[j] && setAttribute(span, `data-a${j}`, v));
            }
          );
        } else {
          n.attrs.forEach((r, j) =>
            effect(
              () => text(r),
              (v: string) => setAttribute(span, `data-a${j}`, v)
            )
          );
        }
        return span;
      }
    }
  }

  const rootErrored = (children: () => any) =>
    createComponent(Errored, {
      fallback: (e: () => any) => (errors.push(errText(e)), "[ROOT-E]"),
      get children() {
        return children();
      }
    });
  const app = () => rootErrored(() => (variant.inertErrored ? rootErrored(loading) : loading()));
  const loading = () =>
    createComponent(Loading, {
      fallback: "[ROOT-L]",
      get children() {
        if (owned) {
          makeMemos();
          makeLatestViews();
        }
        if (!variant.remount) return renderNode(sc.tree);
        return createComponent(Show, {
          get when() {
            return epoch();
          },
          keyed: true,
          get children() {
            return renderNode(sc.tree);
          }
        } as any);
      }
    });
  /** The setter a guess write targets: an optimistic signal's, or an
   * optimistic memo's. */
  const guessOf = (o: SrcRef): ((v: any) => void) => {
    const g =
      o.k === "s" ? (sc.optimistic?.includes(o.i) ? sigs[o.i][1] : undefined) : guessers[o.i];
    if (!g) throw new Error(`async-gen: ${o.k}${o.i} is not optimistic`);
    return g as (v: any) => void;
  };
  return { sigs, memos, guessOf, app, remount: () => setEpoch(e => e + 1) };
}

// ── driving ─────────────────────────────────────────────────────────────────

const micro = () => Promise.resolve();
const task = () => new Promise<void>(r => setTimeout(r, 0));
async function drain(guard: (law: string, fn: () => void) => void) {
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 6; j++) await micro();
    guard("throw", flush);
    await task();
  }
  guard("throw", flush);
}

function settleAt(flights: Flight[], index: number): string {
  const [f] = flights.splice(index, 1);
  if (f.rejects) f.reject(new Error(f.label));
  else f.resolve(f.value);
  return f.label;
}

export async function runScenario(sc: Scenario, variant: Variant = {}): Promise<Result> {
  const findings: Finding[] = [];
  const screens: string[] = [];
  const settled: boolean[] = [];
  const quiet: boolean[] = [];
  const passes: Passes[] = [];
  const settles: (string | null)[] = [];
  const last: Passes = { held: {}, memos: {} };
  const snapshot = () => passes.push(structuredClone(last));
  const flights: Flight[] = [];
  const values = [...sc.signals];
  const errors: string[] = [];
  const staleAsks: string[] = [];
  let step = -1;

  const origError = console.error;
  const origWarn = console.warn;
  console.error = (...args: unknown[]) => {
    findings.push({
      oracle: "safety",
      law: "console-error",
      step,
      detail: args
        .map(a => (a instanceof Error ? a.message : String(a)))
        .join(" ")
        .slice(0, 240)
    });
  };
  console.warn = () => {};
  const onUnhandled = (e: unknown) => {
    findings.push({
      oracle: "safety",
      law: "unhandled-rejection",
      step,
      detail: String((e as any)?.message ?? e).slice(0, 240)
    });
  };
  process.on("unhandledRejection", onUnhandled);
  process.on("uncaughtException", onUnhandled);

  const el = document.createElement("div");
  const guard = (law: string, fn: () => void) => {
    try {
      fn();
    } catch (e: any) {
      findings.push({ oracle: "safety", law, step, detail: String(e?.message ?? e).slice(0, 240) });
    }
  };

  let dispose: (() => void) | undefined;
  let final = "";
  let expected = "";
  try {
    const { sigs, memos, guessOf, app, remount } = buildApp(
      sc,
      values,
      false,
      flights,
      variant,
      errors,
      last,
      staleAsks
    );
    // A truth write updates `values` (the fresh render's inputs); a guess —
    // a write to an optimistic signal, or to an optimistic memo — never does.
    const truth = (w: Write) => "s" in w && !sc.optimistic?.includes(w.s);
    const apply = (w: Write) => ("s" in w ? sigs[w.s][1](w.v) : guessOf(w.o)(w.v));
    let acts = 0;
    const act = (
      label: string,
      before: Write[],
      after: Write[] = [],
      refreshes: number[] = [],
      sync = false
    ) =>
      action(function* () {
        before.forEach(apply);
        if (!sync)
          yield new Promise<number>(resolve => {
            flights.push({ label, value: 0, rejects: false, resolve, reject: () => {} });
          });
        after.forEach(apply);
        refreshes.forEach(i => refresh(memos[i] as any));
      })();
    guard("throw", () => {
      dispose = render(app, el);
      flush();
    });
    screens.push(serialize(el));
    settled.push(true);
    quiet.push(flights.length === 0);
    snapshot();

    for (step = 0; step < sc.steps.length; step++) {
      const st = sc.steps[step];
      switch (st.t) {
        case "write":
          values[st.s] = st.v;
          guard("throw", () => {
            sigs[st.s][1](st.v);
            if (variant.remount) remount();
          });
          break;
        case "settle":
          settles[step] = flights.length ? settleAt(flights, st.pick % flights.length) : null;
          break;
        case "action": {
          const a = "s" in st ? { before: [{ s: st.s, v: st.v }], after: [], refresh: [] } : st;
          for (const w of [...a.before, ...(a.after ?? [])])
            if (truth(w)) values[(w as { s: number }).s] = w.v;
          const label = "s" in st ? `act:s${st.s}=${st.v}` : `act#${++acts}`;
          guard("throw", () => {
            const p = act(
              label,
              a.before,
              a.after,
              a.refresh,
              "sync" in a && a.sync
            ) as Promise<unknown>;
            p?.catch?.((e: any) =>
              findings.push({
                oracle: "safety",
                law: "action-rejected",
                step,
                detail: String(e?.message ?? e)
              })
            );
          });
          break;
        }
        case "guess":
          guard("throw", () => guessOf(st.o)(st.v));
          break;
        case "refresh":
          guard("throw", () => {
            refresh(memos[st.m] as any);
          });
          break;
        case "flush":
          guard("throw", flush);
          break;
        case "micro":
          await micro();
          break;
        case "task":
          await task();
          guard("throw", flush);
          break;
      }
      if (variant.autoFlush) guard("throw", flush);
      for (const detail of staleAsks.splice(0))
        findings.push({ oracle: "safety", law: "truth-asks", step, detail });
      const screen = serialize(el);
      screens.push(screen);
      settled.push(st.t === "task");
      quiet.push(flights.length === 0);
      snapshot();
      // A read of an async value is its value or a throw (NotReady, the
      // error) — never undefined. NaN is undefined + 1 in a memo.
      if (/NaN|undefined/.test(screen) && !findings.some(f => f.law === "undefined-value"))
        findings.push({
          oracle: "safety",
          law: "undefined-value",
          step,
          detail: screen.slice(0, 240)
        });
    }

    // Liveness: settle every flight (oldest first) until none is left.
    step = sc.steps.length;
    let rounds = 0;
    await drain(guard);
    while (flights.length && rounds++ < 25) {
      while (flights.length) settleAt(flights, 0);
      await drain(guard);
    }
    if (flights.length)
      findings.push({
        oracle: "liveness",
        law: "endless-flights",
        step,
        detail: flights.map(f => f.label).join(",")
      });
    final = serialize(el);

    // The fresh render of the final inputs, every memo synchronous.
    const freshEl = document.createElement("div");
    const fresh = buildApp(sc, values, true, [], variant, []);
    const freshDispose = render(fresh.app, freshEl);
    flush();
    expected = serialize(freshEl);
    freshDispose();
    if (final !== expected)
      findings.push({
        oracle: "liveness",
        law: "final-screen",
        step,
        detail: `${final}  ≠  fresh ${expected}  (errors: ${errors.slice(-3).join(",")})`
      });
  } finally {
    try {
      dispose?.();
    } catch {}
    resetErrorHalt();
    process.off("unhandledRejection", onUnhandled);
    process.off("uncaughtException", onUnhandled);
    console.error = origError;
    console.warn = origWarn;
  }
  return {
    findings,
    screens,
    settled,
    quiet,
    passes,
    final,
    expected,
    description: describeScenario(sc),
    settles
  };
}
