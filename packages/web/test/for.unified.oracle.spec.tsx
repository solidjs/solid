/** @jsxImportSource solid-js */
/**
 * Unified For ENGINE — the ORACLE HARNESS.
 *
 * mapArray + insert (no <For>) is the specification. For every mode, both
 * implementations render the SAME seeded random sequence off ONE signal, and
 * after every step we compare:
 *   - DOM (innerHTML) — identical
 *   - node retention — the SAME set of keys kept their DOM node across the
 *     step on both sides (identity is per side; retention is comparable)
 *   - row-fn invocation counts — identical (no double invocation, no extra
 *     rebuilds)
 *   - cleanup SET per step — the same rows are disposed on both sides.
 *     RULING: the ORDER among rows disposed in one step is not a For
 *     contract (mapArray's own order is an internal artifact: old-index
 *     order for partial removes, reverse creation order via dispose(false)
 *     on a clear), and the engine disposes at commit rather than in the
 *     compute (hold safety), so order is compared as a multiset.
 *
 * Row shapes are mixed per item: element rows, zero-node rows (null),
 * fragment rows, and DYNAMIC rows (a <Show> whose condition flips during the
 * run). Operations include shuffles, inserts, removes, duplicate inserts,
 * clears, full replaces, and same-key/new-object updates (key-fn mode).
 */
import { describe, expect, test } from "vitest";
import { createMemo, createSignal, flush, For, mapArray, onCleanup, Show } from "solid-js";
import { render } from "@solidjs/web";

type Item = { id: number; v: number };
const SEED_STEPS = 220;

/** Small deterministic PRNG (LCG). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

function shuffle<T>(arr: T[], r: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Produce the next list from the current one. Items are drawn from a pool
 * of stable objects (identity mode) or re-minted with the same id (key-fn
 * mode exercises same-key/new-object updates). */
function nextList(cur: Item[], pool: Item[], r: () => number, remint: boolean): Item[] {
  const pick = () => pool[Math.floor(r() * pool.length)];
  const op = r();
  let out: Item[];
  if (op < 0.14) out = shuffle(cur, r);
  else if (op < 0.28)
    out = [
      ...cur.slice(0, Math.floor(r() * (cur.length + 1))),
      pick(),
      ...cur.slice(Math.floor(r() * (cur.length + 1)))
    ];
  else if (op < 0.42) out = cur.filter(() => r() > 0.3);
  else if (op < 0.5)
    out = cur.length ? [...cur, cur[Math.floor(r() * cur.length)]] : [pick()]; // duplicate
  else if (op < 0.56) out = [];
  else if (op < 0.66)
    out = Array.from({ length: 1 + Math.floor(r() * 7) }, pick); // replace
  else if (op < 0.74) out = cur.slice().reverse();
  else if (op < 0.82) {
    out = cur.slice();
    if (out.length > 1) {
      const i = Math.floor(r() * out.length),
        j = Math.floor(r() * out.length);
      [out[i], out[j]] = [out[j], out[i]];
    }
  } else if (op < 0.9)
    out = [...cur.slice(1), ...cur.slice(0, 1)]; // rotate
  else out = [pick(), ...cur];
  if (remint) out = out.map(x => (r() < 0.3 ? { id: x.id, v: x.v + 1 } : x));
  return out;
}

type Mode = "identity" | "identity-index" | "byindex" | "keyfn";

/** Per-side probes: invocation counter, cleanup log. */
type Probe = { calls: number; cleaned: number[] };

/** Row renderer shared by both sides. Shape by id: 0 mod 4 → zero nodes,
 * 1 mod 4 → fragment, 2 mod 4 → DYNAMIC (Show), else element. */
function rowFor(mode: Mode, probe: Probe, dyn: () => boolean) {
  const body = (it: Item, idx: () => number | number, key: number) => {
    probe.calls++;
    onCleanup(() => probe.cleaned.push(key));
    const i = typeof idx === "function" ? idx() : idx;
    if (it.id % 4 === 0) return null;
    if (it.id % 4 === 1)
      return (
        <>
          <b data-k={key}>{it.v}</b>
          {i}
        </>
      );
    if (it.id % 4 === 2)
      return (
        <Show when={dyn()} fallback={<i data-k={key}>{it.v}</i>}>
          <u data-k={key}>{it.v}</u>
        </Show>
      );
    return (
      <span data-k={key}>
        {it.v}:{i}
      </span>
    );
  };
  switch (mode) {
    case "identity":
      return (it: Item) => body(it, 0, it.id);
    case "identity-index":
      return (it: Item, i: () => number) => body(it, i, it.id);
    case "byindex":
      return (it: () => Item, i: number) => body(it(), i, i);
    case "keyfn":
      return (it: () => Item, i: () => number) => body(it(), i, it().id);
  }
}

const keyFn = (x: Item) => x.id;

function mount(mode: Mode, list: () => Item[], probe: Probe, dyn: () => boolean, oracle: boolean) {
  const row: any = rowFor(mode, probe, dyn);
  const host = document.createElement("div");
  const dispose = render(
    () => (
      <section>
        <em>pre</em>
        {oracle ? (
          mapArray(
            list,
            row,
            mode === "byindex" ? { keyed: false } : mode === "keyfn" ? { keyed: keyFn } : undefined
          )
        ) : mode === "byindex" ? (
          <For each={list()} keyed={false}>
            {row}
          </For>
        ) : mode === "keyfn" ? (
          <For each={list()} keyed={keyFn}>
            {row}
          </For>
        ) : (
          <For each={list()}>{row}</For>
        )}
        <em>post</em>
      </section>
    ),
    host
  );
  return { el: host.firstElementChild as HTMLElement, dispose };
}

/** key → root node, for retention comparison (data-k on every row root). */
function keyNodes(el: HTMLElement): Map<string, Element[]> {
  const m = new Map<string, Element[]>();
  for (const n of el.querySelectorAll("[data-k]")) {
    const k = n.getAttribute("data-k")!;
    (m.get(k) ?? m.set(k, []).get(k)!).push(n);
  }
  return m;
}
/** Which keys kept (all of) their nodes across a step. */
function retained(before: Map<string, Element[]>, after: Map<string, Element[]>): string[] {
  const out: string[] = [];
  for (const [k, prev] of before) {
    const now = after.get(k);
    if (now && now.length === prev.length && now.every((n, i) => n === prev[i])) out.push(k);
  }
  return out.sort();
}

/** ARRAY output: a plain call of the For accessor (children(), introspection,
 * non-engaging renderers) must return mapArray's array — same values, same
 * identity while structurally unchanged, `[fallback]` when empty. */
describe("oracle: array output (plain call of the For accessor)", () => {
  for (const mode of ["identity", "identity-index", "byindex", "keyfn"] as Mode[]) {
    test(`${mode}: values, identity stability, invocation counts match mapArray`, () => {
      const r = rng(mode.length * 131);
      const pool: Item[] = Array.from({ length: 10 }, (_, id) => ({ id, v: 0 }));
      const [list, setList] = createSignal<Item[]>(pool.slice(0, 4));
      const [dyn] = createSignal(true);
      const pe: Probe = { calls: 0, cleaned: [] };
      const po: Probe = { calls: 0, cleaned: [] };
      const rowE: any = rowFor(mode, pe, dyn);
      const rowO: any = rowFor(mode, po, dyn);
      let eAcc!: () => any[];
      let oAcc!: () => any[];
      const [tick, setTick] = createSignal(0);
      const readsE: any[][] = [];
      const readsO: any[][] = [];
      const dispose = render(() => {
        eAcc =
          mode === "byindex"
            ? ((
                <For each={list()} keyed={false}>
                  {rowE}
                </For>
              ) as any)
            : mode === "keyfn"
              ? ((
                  <For each={list()} keyed={keyFn}>
                    {rowE}
                  </For>
                ) as any)
              : ((<For each={list()}>{rowE}</For>) as any);
        oAcc = mapArray(
          list,
          rowO,
          mode === "byindex" ? { keyed: false } : mode === "keyfn" ? { keyed: keyFn } : undefined
        );
        // Two readers per side that also depend on `tick`, so a tick-only
        // change re-reads without a structural change (identity must hold).
        createMemo(() => {
          tick();
          readsE.push(eAcc());
        });
        createMemo(() => {
          tick();
          readsO.push(oAcc());
        });
        return null;
      }, document.createElement("div"));
      try {
        flush();
        const same = (label: string) => {
          const e = readsE[readsE.length - 1],
            o = readsO[readsO.length - 1];
          expect(e.length, `${label} length`).toBe(o.length);
          for (let i = 0; i < e.length; i++) {
            const ev = e[i],
              ov = o[i];
            // Values are what the row fn returned: nodes (compare by outerHTML
            // / text), functions (Show memos), or null.
            expect(typeof ev, `${label}[${i}] type`).toBe(typeof ov);
            if (ev && ev.nodeType) expect(ev.outerHTML ?? ev.data).toBe(ov.outerHTML ?? ov.data);
            else if (Array.isArray(ev)) expect(ev.length).toBe(ov.length);
          }
          expect(pe.calls, `${label} invocations`).toBe(po.calls);
        };
        same("init");
        let cur = list();
        for (let step = 0; step < 60; step++) {
          if (step % 5 === 2) {
            // Tick without a list change: both sides must return the SAME
            // array identity as before.
            const eBefore = readsE[readsE.length - 1];
            const oBefore = readsO[readsO.length - 1];
            setTick(t => t + 1);
            flush();
            expect(readsE[readsE.length - 1], `step ${step} identity`).toBe(eBefore);
            expect(readsO[readsO.length - 1], `step ${step} oracle identity`).toBe(oBefore);
            continue;
          }
          cur = nextList(cur, pool, r, mode === "keyfn");
          setList(cur);
          flush();
          same(`step ${step}`);
        }
      } finally {
        dispose();
      }
    });
  }

  test("fallback: empty list yields [fallback] and back", () => {
    const [list, setList] = createSignal<string[]>([]);
    let eAcc!: () => any[];
    let oAcc!: () => any[];
    const dispose = render(() => {
      eAcc = (
        <For each={list()} fallback={<i>none</i>}>
          {(s: string) => <b>{s}</b>}
        </For>
      ) as any;
      oAcc = mapArray(list, (s: string) => <b>{s}</b>, { fallback: () => <i>none</i> });
      return null;
    }, document.createElement("div"));
    try {
      flush();
      const html = (a: any[]) => a.map(n => n.outerHTML).join("");
      expect(html(eAcc())).toBe(html(oAcc()));
      expect(html(eAcc())).toBe("<i>none</i>");
      setList(["x", "y"]);
      flush();
      expect(html(eAcc())).toBe(html(oAcc()));
      expect(html(eAcc())).toBe("<b>x</b><b>y</b>");
      setList([]);
      flush();
      expect(html(eAcc())).toBe("<i>none</i>");
    } finally {
      dispose();
    }
  });
});

for (const mode of ["identity", "identity-index", "byindex", "keyfn"] as Mode[]) {
  describe(`oracle: ${mode}`, () => {
    for (const seed of [1, 2, 3]) {
      test(`seed ${seed}: DOM, retention, invocations, cleanup order match mapArray for ${SEED_STEPS} steps`, () => {
        const r = rng(seed * 7919);
        const pool: Item[] = Array.from({ length: 12 }, (_, id) => ({ id, v: 0 }));
        const [list, setList] = createSignal<Item[]>(pool.slice(0, 5));
        const [dyn, setDyn] = createSignal(true);
        const pe: Probe = { calls: 0, cleaned: [] };
        const po: Probe = { calls: 0, cleaned: [] };
        const E = mount(mode, list, pe, dyn, false);
        const O = mount(mode, list, po, dyn, true);
        try {
          flush();
          expect(E.el.innerHTML).toBe(O.el.innerHTML);
          expect(pe.calls).toBe(po.calls);
          let cur = list();
          for (let step = 0; step < SEED_STEPS; step++) {
            const label = `step ${step}`;
            const eBefore = keyNodes(E.el);
            const oBefore = keyNodes(O.el);
            if (step % 9 === 4) setDyn(d => !d); // dynamic rows flip (same flush as a list change every so often)
            if (step % 9 !== 4 || r() < 0.5) {
              cur = nextList(cur, pool, r, mode === "keyfn");
              setList(cur);
            }
            flush();
            expect(E.el.innerHTML, `${label} DOM`).toBe(O.el.innerHTML);
            expect(retained(eBefore, keyNodes(E.el)), `${label} retention`).toEqual(
              retained(oBefore, keyNodes(O.el))
            );
            expect(pe.calls, `${label} invocations`).toBe(po.calls);
            expect(pe.cleaned.slice().sort(), `${label} cleanup set`).toEqual(
              po.cleaned.slice().sort()
            );
          }
        } finally {
          E.dispose();
          O.dispose();
        }
      });
    }
  });
}
