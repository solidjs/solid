/**
 * A greedy minimizer for async-gen scenarios: fast-check's shrinker reduces
 * the script well but not the app (the memo tuple is built by `chain`), so a
 * failing case is reduced here by structural edits until no single edit
 * keeps the finding.
 */
import type { MemoDef, Node, Read, Scenario, SrcRef } from "./scenario.js";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function refsIn(sc: Scenario): SrcRef[] {
  const out: SrcRef[] = [];
  sc.memos.forEach(m => m.deps.forEach(d => out.push(d.src)));
  const walk = (n: Node) => {
    if (n.t === "leaf") [...n.text, ...n.attrs].forEach(r => out.push(r.src));
    else if (n.t === "group") n.kids.forEach(walk);
    else {
      if (n.t === "show") out.push(n.when.src);
      walk(n.child);
    }
  };
  walk(sc.tree);
  return out;
}

function mapRefs(sc: Scenario, f: (r: SrcRef) => SrcRef): Scenario {
  const c = clone(sc);
  c.memos.forEach(m => m.deps.forEach(d => (d.src = f(d.src))));
  const walk = (n: Node) => {
    if (n.t === "leaf") [...n.text, ...n.attrs].forEach(r => (r.src = f(r.src)));
    else if (n.t === "group") n.kids.forEach(walk);
    else {
      if (n.t === "show") n.when.src = f(n.when.src);
      walk(n.child);
    }
  };
  walk(c.tree);
  return c;
}

/** Every tree obtained by one structural reduction of `n`. */
function treeEdits(n: Node): Node[] {
  const out: Node[] = [];
  switch (n.t) {
    case "leaf":
      n.text.forEach((_, i) => out.push({ ...n, text: n.text.filter((_, j) => j !== i) }));
      n.attrs.forEach((_, i) => out.push({ ...n, attrs: n.attrs.filter((_, j) => j !== i) }));
      if (n.attrs.length > 1) out.push({ ...n, grouped: !n.grouped });
      [...n.text, ...n.attrs].forEach((r, i) => {
        if (r.how !== "plain") {
          const all = [...n.text, ...n.attrs].map((x, j) =>
            j === i ? { ...x, how: "plain" as const } : x
          );
          out.push({ ...n, text: all.slice(0, n.text.length), attrs: all.slice(n.text.length) });
        }
      });
      break;
    case "group":
      n.kids.forEach(k => out.push(k));
      n.kids.forEach(
        (_, i) => n.kids.length > 1 && out.push({ ...n, kids: n.kids.filter((_, j) => j !== i) })
      );
      n.kids.forEach((k, i) =>
        treeEdits(k).forEach(e => out.push({ ...n, kids: n.kids.map((x, j) => (j === i ? e : x)) }))
      );
      break;
    default:
      out.push(n.child);
      if (n.t === "show") {
        if (n.fallback) out.push({ ...n, fallback: false });
        if (n.when.how !== "plain") out.push({ ...n, when: { ...n.when, how: "plain" } });
      }
      treeEdits(n.child).forEach(e => out.push({ ...n, child: e } as Node));
  }
  return out;
}

export function edits(sc: Scenario): Scenario[] {
  const out: Scenario[] = [];
  // Script: drop one step; collapse task/micro/flush runs.
  sc.steps.forEach(
    (_, i) => sc.steps.length > 1 && out.push({ ...sc, steps: sc.steps.filter((_, j) => j !== i) })
  );
  sc.steps.forEach((st, i) => {
    if (st.t === "settle" && st.pick > 0)
      out.push({ ...sc, steps: sc.steps.map((x, j) => (j === i ? { ...st, pick: 0 } : x)) });
  });
  // Tree.
  treeEdits(sc.tree).forEach(tree => out.push({ ...sc, tree }));
  // Memos: drop an unreferenced memo (reindexing later ones); simplify one.
  const refs = refsIn(sc);
  sc.memos.forEach((_, i) => {
    if (refs.some(r => r.k === "m" && r.i === i)) {
      // Point every read of memo i at its first dependency instead.
      const to = sc.memos[i].deps[0].src;
      const c = mapRefs(sc, r => (r.k === "m" && r.i === i ? to : r));
      c.memos.splice(i, 1);
      out.push(mapRefs(c, r => (r.k === "m" && r.i > i ? { k: "m", i: r.i - 1 } : r)));
    } else {
      const c = clone(sc);
      c.memos.splice(i, 1);
      out.push(mapRefs(c, r => (r.k === "m" && r.i > i ? { k: "m", i: r.i - 1 } : r)));
    }
  });
  sc.memos.forEach((m, i) => {
    const set = (nm: MemoDef) =>
      out.push({ ...sc, memos: sc.memos.map((x, j) => (j === i ? nm : x)) });
    if (m.poison !== null) set({ ...m, poison: null });
    if (m.async) set({ ...m, async: false });
    m.deps.forEach((d, k) => {
      if (m.deps.length > 1) set({ ...m, deps: m.deps.filter((_, j) => j !== k) });
      if (d.how === "latest")
        set({ ...m, deps: m.deps.map((x, j) => (j === k ? { ...x, how: "plain" } : x)) });
    });
  });
  if (sc.owned) out.push({ ...sc, owned: undefined });
  // Signals: drop an unreferenced last signal.
  const last = sc.signals.length - 1;
  if (
    last > 0 &&
    !refs.some(r => r.k === "s" && r.i === last) &&
    !sc.steps.some(s => "s" in s && s.s === last)
  )
    out.push({ ...sc, signals: sc.signals.slice(0, last) });
  sc.signals.forEach(
    (v, i) => v !== 0 && out.push({ ...sc, signals: sc.signals.map((x, j) => (j === i ? 0 : x)) })
  );
  return out;
}

const size = (sc: Scenario) => JSON.stringify(sc).length;

export async function minimize(
  sc: Scenario,
  fails: (sc: Scenario) => Promise<boolean>
): Promise<Scenario> {
  let cur = clone(sc);
  for (let progress = true; progress; ) {
    progress = false;
    for (const cand of edits(cur)) {
      if (size(cand) >= size(cur)) continue;
      if (await fails(cand)) {
        cur = cand;
        progress = true;
        break;
      }
    }
  }
  return cur;
}

export type { Read };
