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
  Show,
  action,
  createMemo,
  createSignal,
  createStore,
  flush,
  isPending,
  latest,
  resetErrorHalt
} from "solid-js";
import { createComponent, effect, insert, render, setAttribute } from "../../src/index.js";
import { describeScenario, type Node, type Read, type Scenario, type SrcRef } from "./scenario.js";

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
  final: string;
  expected: string;
  description: string;
}

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
  errors: string[]
) {
  const sigs = values.map(v => createSignal(v));
  const memos: (() => any)[] = [];
  const get = (r: SrcRef): (() => any) => (r.k === "s" ? sigs[r.i][0] : memos[r.i]);
  // What the tree reads a memo through: the memo, an identity memo of it, or
  // a derived store's `v`.
  const views: (() => any)[] = [];
  const view = (r: SrcRef): (() => any) => (r.k === "s" ? sigs[r.i][0] : views[r.i]);
  const makeMemos = () =>
    sc.memos.forEach((m, i) => {
      const input = () =>
        m.deps.reduce(
          (acc, d) => acc + Number(d.how === "latest" ? latest(get(d.src)) : get(d.src)()),
          1
        );
      if (m.async && !fresh) {
        memos.push(
          createMemo(() => {
            const v = input();
            return new Promise<number>((resolve, reject) => {
              flights.push({
                label: `m${i}:${v}`,
                value: v,
                rejects: poisoned(m.poison, v),
                resolve,
                reject
              });
            });
          })
        );
      } else {
        memos.push(
          createMemo(() => {
            const v = input();
            if (poisoned(m.poison, v)) throw new Error(`m${i}:${v}`);
            return v;
          })
        );
      }
      const x = memos[i];
      if (variant.identity) views.push(createMemo(() => x()));
      else if (variant.store) {
        const [store] = createStore<{ v?: number }>(d => {
          d.v = x();
        }, {});
        views.push(() => store.v);
      } else views.push(x);
    });
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
    if (r.how === "latest" && variant.latestDerive)
      return latestViews.get(`${r.src.k}${r.src.i}`)!();
    return r.how === "plain" ? x() : r.how === "latest" ? latest(x) : isPending(x);
  };
  const [epoch, setEpoch] = createSignal(1);
  const prefix = { plain: "v", latest: "l", pending: "p" } as const;
  const text = (r: Read) => `${prefix[r.how]}${r.src.k}${r.src.i}:${String(read(r))} `;

  function renderNode(n: Node): any {
    switch (n.t) {
      case "loading":
        return createComponent(Loading, {
          fallback: "[L]",
          get children() {
            return renderNode(n.child);
          }
        });
      case "errored":
        return createComponent(Errored, {
          fallback: (e: () => any) => (errors.push(errText(e)), "[E]"),
          get children() {
            return renderNode(n.child);
          }
        });
      case "show":
        return createComponent(Show, {
          get when() {
            return read(n.when);
          },
          fallback: n.fallback ? "[F]" : undefined,
          get children() {
            return renderNode(n.child);
          }
        } as any);
      case "group":
        return n.kids.map(renderNode);
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
            () => n.attrs.map(text),
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
  return { sigs, app, remount: () => setEpoch(e => e + 1) };
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

function settleAt(flights: Flight[], index: number) {
  const [f] = flights.splice(index, 1);
  if (f.rejects) f.reject(new Error(f.label));
  else f.resolve(f.value);
}

export async function runScenario(sc: Scenario, variant: Variant = {}): Promise<Result> {
  const findings: Finding[] = [];
  const screens: string[] = [];
  const settled: boolean[] = [];
  const quiet: boolean[] = [];
  const flights: Flight[] = [];
  const values = [...sc.signals];
  const errors: string[] = [];
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
    const { sigs, app, remount } = buildApp(sc, values, false, flights, variant, errors);
    const act = action(function* (s: number, v: number) {
      sigs[s][1](v);
      yield new Promise<number>(resolve => {
        flights.push({
          label: `act:s${s}=${v}`,
          value: v,
          rejects: false,
          resolve,
          reject: () => {}
        });
      });
    });
    guard("throw", () => {
      dispose = render(app, el);
      flush();
    });
    screens.push(serialize(el));
    settled.push(true);
    quiet.push(flights.length === 0);

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
          if (flights.length) settleAt(flights, st.pick % flights.length);
          break;
        case "action":
          values[st.s] = st.v;
          guard("throw", () => {
            const p = act(st.s, st.v) as Promise<unknown>;
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
      const screen = serialize(el);
      screens.push(screen);
      settled.push(st.t === "task");
      quiet.push(flights.length === 0);
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
  return { findings, screens, settled, quiet, final, expected, description: describeScenario(sc) };
}
