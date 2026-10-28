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
export type Variant = { split?: boolean; grouped?: boolean };
export interface Result {
  findings: Finding[];
  screens: string[];
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
  });
  const read = (r: Read) => {
    const x = get(r.src);
    return r.how === "plain" ? x() : r.how === "latest" ? latest(x) : isPending(x);
  };
  const text = (r: Read) => `${r.how[0]}${r.src.k}${r.src.i}:${String(read(r))} `;

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

  const app = () =>
    createComponent(Errored, {
      fallback: (e: () => any) => (errors.push(errText(e)), "[ROOT-E]"),
      get children() {
        return createComponent(Loading, {
          fallback: "[ROOT-L]",
          get children() {
            return renderNode(sc.tree);
          }
        });
      }
    });
  return { sigs, app };
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
    const { sigs, app } = buildApp(sc, values, false, flights, variant, errors);
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

    for (step = 0; step < sc.steps.length; step++) {
      const st = sc.steps[step];
      switch (st.t) {
        case "write":
          values[st.s] = st.v;
          guard("throw", () => sigs[st.s][1](st.v));
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
      const screen = serialize(el);
      screens.push(screen);
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
  return { findings, screens, final, expected, description: describeScenario(sc) };
}
