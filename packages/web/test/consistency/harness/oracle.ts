/**
 * The oracle: the contract's invariants as laws over the harness's world,
 * each tagged with its contract id (`documentation/server-components/
 * frames-consistency-contract.md`). `immediate` laws hold after EVERY
 * event; `settled` laws hold at settle points (after a `tick`, and at the
 * end); `end` laws hold once the schedule has quiesced.
 */
import type { Scenario } from "./scenario.js";

export interface Finding {
  /** Contract id: `C1`, `C2`, … (`G` for the general no-error law). */
  id: string;
  law: string;
  step: number;
  detail: string;
}

/** What the runner knows about the page at a step. */
export interface World {
  scenario: Scenario;
  fid: string;
  container: Element;
  warnings: string[];
  errors: string[];
  /** Index of the last event executed (-1 before the first). */
  step: number;
  /** Fill invocations per occurrence name (render occurrences), and the step of the first. */
  invoked: Map<string, number>;
  invokedAt: Map<string, number>;
  /** Trace occurrence index → step of its first patch. */
  firstPatchAt: Map<number, number>;
  /** `_hk` → the node the server rendered (root content at boot, fragment content at its reveal). */
  bootNodes: Map<string, Element>;
  /** Fragment index → step of its reveal. */
  revealed: Map<number, number>;
  hydratedAt: number;
  disposedAt: number;
  /** Fill invocations that ran after `dispose`. */
  invokedAfterDispose: string[];
  /** `frame:applied` events after `dispose`. */
  appliedAfterDispose: number;
  /** Render-prop fills evaluated with no props (classified as direct-insert). */
  zeroArgCalls: number;
  /** Whether the host still has the boundary's store (read at settle points after dispose). */
  hostHas: () => boolean;
  /** Whether hydration is still in progress (`sharedConfig.isHydrationInProgress`). */
  hydrationInProgress: () => boolean;
  /** Snapshot taken in the hydration-end callback. */
  hydrationEnd?: { step: number; mountedButUninvoked: string[] };
  /** Trace occurrence index → the oracle's current `n`. */
  traceN: Map<number, number>;
  /** The live hole's id on this page (document-unique) and its history: the initial text, then every pushed op. */
  holeId: number;
  holeHistory: string[];
  /** Whether the end-of-schedule reactivity bump has been applied. */
  bumped: boolean;
}

export const TRACE_RE = /^slot:(.+):start$/;

/** A slot range present in the LIVE tree (template contents are not walked). */
export interface Range {
  name: string;
  nodes: Node[];
  elements: Element[];
}

export function liveRanges(root: Node): Range[] {
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, 128 /* SHOW_COMMENT */);
  for (let c = walker.nextNode(); c; c = walker.nextNode()) {
    const m = TRACE_RE.exec(c.nodeValue ?? "");
    if (!m) continue;
    const name = m[1];
    const nodes: Node[] = [];
    for (let n = c.nextSibling; n; n = n.nextSibling) {
      if (n.nodeType === 8 && n.nodeValue === `slot:${name}:end`) break;
      nodes.push(n);
    }
    ranges.push({ name, nodes, elements: nodes.filter(n => n.nodeType === 1) as Element[] });
  }
  return ranges;
}

/** The text between `<!--lh:N-->` and `<!--lh:/N-->`, or undefined if absent. */
export function holeText(root: Node, n: number): string | undefined {
  const walker = document.createTreeWalker(root, 128);
  for (let c = walker.nextNode(); c; c = walker.nextNode()) {
    if (c.nodeValue !== `lh:${n}`) continue;
    let text = "";
    for (let s = c.nextSibling; s; s = s.nextSibling) {
      if (s.nodeType === 8 && s.nodeValue === `lh:/${n}`) break;
      text += s.textContent ?? "";
    }
    return text;
  }
  return undefined;
}

/** The label a fill shows for an occurrence (first hole), per the runner's convention. */
export function labelOf(w: World, occ: number): string {
  const o = w.scenario.occurrences[occ];
  if (o.kind === "direct") return "";
  if (o.arg.kind === "plain") return `p${occ}`;
  return `t${occ}=${w.traceN.get(occ) ?? o.arg.snapshot}`;
}

/** The text a mounted fill's `<li>`/`<b>` shows, markers removed. */
const shown = (el: Element) => el.textContent ?? "";

function fallbackShowing(w: World, frag: number) {
  const fb = w.scenario.fragments[frag].fallback;
  return [...w.container.querySelectorAll("i")].some(i => i.textContent === fb);
}

export function immediate(w: World): Finding[] {
  const f: Finding[] = [];
  const at = (id: string, law: string, detail: string) => f.push({ id, law, step: w.step, detail });
  if (w.errors.length) at("G", "no-runtime-error", w.errors.join(" | "));
  const miss = w.warnings.filter(x => x.includes("Hydration key miss"));
  if (miss.length) at("C1", "no-key-miss", miss[0]);
  const unclaimed = w.warnings.filter(x => x.includes("unclaimed server-rendered"));
  if (unclaimed.length) at("C1", "no-unclaimed", unclaimed[0]);
  for (const r of liveRanges(w.container)) {
    if (r.elements.length > 1)
      at("C1", "no-duplicate-fill", `${r.name} holds ${r.elements.length} elements`);
  }
  for (const [hk, node] of w.bootNodes) {
    const now = w.container.querySelector(`[_hk="${hk}"]`);
    if (now && now !== node) at("C1", "node-identity", `${hk} is a different node`);
  }
  for (const [name, n] of w.invoked) {
    if (n > 1) at("C4", "invoke-once", `${name} invoked ${n}×`);
  }
  if (w.zeroArgCalls)
    at(
      "C18",
      "classify-after-drain",
      `${w.zeroArgCalls} render-prop fill(s) evaluated as direct-insert`
    );
  if (w.scenario.liveHole) {
    const text = holeText(w.container, w.holeId);
    if (text !== undefined && !w.holeHistory.includes(text))
      at("C4", "live-op-known-value", `hole shows ${JSON.stringify(text)}`);
  }
  if (w.disposedAt >= 0) {
    if (w.invokedAfterDispose.length)
      at("C14", "dispose-no-invoke", `invoked after dispose: ${w.invokedAfterDispose.join(",")}`);
    if (w.appliedAfterDispose)
      at("C14", "dispose-no-apply", `${w.appliedAfterDispose} frame:applied after dispose`);
  }
  return f;
}

export function settled(w: World): Finding[] {
  const f: Finding[] = [];
  const at = (id: string, law: string, detail: string) => f.push({ id, law, step: w.step, detail });
  const disposed = w.disposedAt >= 0;
  // C11 — a mounted trace fill shows the oracle's value.
  if (!disposed) {
    const ranges = liveRanges(w.container);
    w.scenario.occurrences.forEach((o, i) => {
      if (o.arg.kind !== "trace") return;
      const r = ranges.find(x => x.name === o.name);
      if (!r || !r.elements.length || !(w.invoked.get(o.name) ?? 0)) return;
      const want = labelOf(w, i);
      const text = shown(r.elements[0]);
      if (!text.startsWith(want)) {
        // A patch that landed BEFORE the fill claimed is C19 (the claim
        // adopted the snapshot's text, and a later patch to the same value
        // cannot heal it); patches only after the claim are C11 proper.
        const preClaim =
          (w.firstPatchAt.get(i) ?? Infinity) < (w.invokedAt.get(o.name) ?? Infinity);
        // "Every observable point" is read OUTSIDE a claim's park (contract
        // C11, frames-rulings 3.6 (iii)): a fill that claimed with patches
        // already delivered reads the SNAPSHOT — what the markup was
        // rendered from — and its backlog is parked until hydration ends,
        // which another occurrence's hold can keep open past this settle
        // point (3.1 / 3.2: the park releases after the hold). The end is
        // never inside a park: hydration is over by then and the law is
        // strict.
        if (preClaim && w.hydrationInProgress() && text.startsWith(`t${i}=${o.arg.snapshot}`))
          return;
        at(
          preClaim ? "C19" : "C11",
          preClaim ? "claim-shows-oracle" : "trace-equals-oracle",
          `${o.name} shows ${JSON.stringify(text)}, oracle ${want}`
        );
      }
    });
    // C4 — the hole shows the LAST op once the channel has had time.
    if (w.scenario.liveHole && w.hydratedAt >= 0 && w.holeHistory.length > 1) {
      const text = holeText(w.container, w.holeId);
      const last = w.holeHistory[w.holeHistory.length - 1];
      if (text !== undefined && text !== last)
        at("C4", "live-op-latest", `hole shows ${JSON.stringify(text)}, last op ${last}`);
    }
    // C12 — fragment parity: pending shows the fallback and no content;
    // revealed shows the content and no fallback.
    w.scenario.fragments.forEach((frag, i) => {
      const fb = fallbackShowing(w, i);
      const content = w.scenario.occurrences
        .map((o, k) => ({ o, k }))
        .filter(x => x.o.inFragment === i)
        .map(x => liveRanges(w.container).find(r => r.name === x.o.name));
      const anyContent = content.some(r => r && r.nodes.length > 0);
      if (w.revealed.has(i) && w.hydratedAt >= 0) {
        if (fb) at("C12", "fragment-parity", `${frag.key} revealed but its fallback shows`);
      } else if (!w.revealed.has(i)) {
        if (!fb) at("C12", "fragment-parity", `${frag.key} pending but its fallback is gone`);
        if (anyContent) at("C12", "fragment-parity", `${frag.key} pending but its content shows`);
      }
    });
  } else if (w.hostHas()) {
    at("C14", "dispose-host-cleared", "host still holds the boundary's store");
  }
  return f;
}

export function end(w: World): Finding[] {
  const f: Finding[] = [];
  const at = (id: string, law: string, detail: string) => f.push({ id, law, step: w.step, detail });
  // A mount disposed before done owes no claim: its hold releases at the
  // disposal (as a disposed <Loading>'s registration does — a boundary that
  // can never resume must not hold global hydration open forever), and the
  // server markup it left behind is nobody's to claim.
  if (
    w.hydrationEnd &&
    w.hydrationEnd.mountedButUninvoked.length &&
    !(w.disposedAt >= 0 && w.hydrationEnd.step >= w.disposedAt)
  )
    at(
      "C3",
      "done-counts-holds",
      `hydration-end fired at step ${w.hydrationEnd.step} with ${w.hydrationEnd.mountedButUninvoked.join(",")} mounted and uninvoked`
    );
  if (w.disposedAt >= 0) return f;
  // C2 — every range in the live tree is mounted (invoked exactly once) and
  // reactive (the bump moved its second hole).
  for (const r of liveRanges(w.container)) {
    const o = w.scenario.occurrences.find(x => x.name === r.name);
    if (!o) continue;
    if (o.kind === "render") {
      const n = w.invoked.get(o.name) ?? 0;
      if (n !== 1) at("C2", "every-range-live", `${r.name} invoked ${n}× (expected 1)`);
    }
    if (w.bumped) {
      const el = r.elements[0];
      const text = el ? shown(el) : "";
      if (!text.endsWith("1"))
        at("C2", "every-range-reactive", `${r.name} shows ${JSON.stringify(text)} after the bump`);
    }
  }
  return f;
}
