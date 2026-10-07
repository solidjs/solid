/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * C7 — the store is the truth.
 *
 * "After every flush, a frame's shown server content is the materialization
 * of its resident store at the frame's version: the root record is applied,
 * every segment whose content, reveal gate, stylesheets and placeholder are
 * present is revealed, no fallback stands where a revealed segment belongs,
 * and no record of an older version is visible — for every arrival order of
 * the response's chunks."
 *
 * Mechanism meant to carry it: frames/src/frame-client.ts `FrameImpl.#flush`
 * (the repeat-until-no-progress segment loop), `#segmentReady`,
 * `#revealSegment`, `#showFallback`, `#resetStreamState` (per-version seg
 * reset), and `createFrameHost.write` (the store's version guard).
 *
 * The frame is driven DIRECTLY (`createFrameHost` + `createFrameElement`,
 * chunks through `host.apply`) — no transport, so every permutation of the
 * response's chunks is one synchronous sequence of applies, and the DOM
 * after each apply is an observable point by the contract's definition.
 */
import { describe, expect, test } from "vitest";
import { createFrameElement, createFrameHost } from "../../frames/src/frame-client.js";
import { permutations } from "./support.js";

// The response: a root with placeholder `a` (its fallback inline, as the
// document shape carries it), segment `a` carrying a nested placeholder `b`
// (its fallback in the template, materialized by a fallback reveal), and
// segment `b`.
const ROOT = `<div><template id="pl-a"></template>fb-a<!--pl-a--></div>`;
const SEG_A = `<p>A<template id="pl-b">fb-b</template><!--pl-b--></p>`;
const SEG_B = `<b>B</b>`;
/** The oracle: the root with both segments revealed in place. */
const ORACLE = `<div><p>A<b>B</b></p></div>`;

function responseChunks(id: string, version = 1) {
  return {
    root: { type: "html", id, version, html: ROOT },
    fragA: { type: "fragment", id, version, key: "a", html: SEG_A },
    fragB: { type: "fragment", id, version, key: "b", html: SEG_B },
    revealA: { type: "reveal", id, version, keys: ["a"] },
    fallbackB: { type: "reveal", id, version, keys: ["b"], fallback: true },
    revealB: { type: "reveal", id, version, keys: ["b"] }
  } as Record<string, any>;
}

/** A fresh host + frame under `id`; the frame has no slots (pure server content). */
function freshFrame(id: string) {
  const host = createFrameHost();
  const { element, frame, dispose } = createFrameElement({ host, id });
  document.body.appendChild(element);
  return { host, element, frame, dispose };
}

/**
 * The visible text (template content is NOT part of an element's
 * textContent — only a MATERIALIZED fallback shows up here) and the
 * coexistence check: a revealed segment never stands beside its own
 * fallback at an observable point.
 */
function checkNoCoexistence(element: Element, label: string) {
  const text = element.textContent ?? "";
  const aRevealed = !!element.querySelector("p");
  const bRevealed = !!element.querySelector("b");
  if (aRevealed) expect(text.includes("fb-a"), `${label}: a revealed beside fb-a`).toBe(false);
  if (bRevealed) expect(text.includes("fb-b"), `${label}: b revealed beside fb-b`).toBe(false);
  // A revealed segment is never shown outside its placeholder's position.
  if (bRevealed) expect(aRevealed, `${label}: b revealed without a`).toBe(true);
}

describe("C7 — the store is the truth", () => {
  const names = ["root", "fragA", "fragB", "revealA", "fallbackB", "revealB"];
  const orders = permutations(names);

  test(`(a) every arrival order (${orders.length} permutations) ends at the oracle, with no fallback/segment coexistence at any apply`, () => {
    for (const order of orders) {
      const id = `c7a-${order.join("")}`;
      const { host, element, dispose } = freshFrame(id);
      const chunks = responseChunks(id);
      const label = order.join(" → ");
      for (const name of order) {
        host.apply(chunks[name]);
        checkNoCoexistence(element, label);
      }
      // All six records resident → the materialization must be complete.
      expect(element.innerHTML, label).toBe(ORACLE);
      dispose();
    }
    // 720 fresh frames with a coexistence check per apply: ~2 s unloaded,
    // ~10 s beside a build. Budgeted explicitly so load never reads as red.
  }, 60_000);

  test("(b) the fallback reveal alone materializes `fb-b`, and the real reveal then replaces it (no coexistence, no leftover)", () => {
    const id = "c7b";
    const { host, element, dispose } = freshFrame(id);
    const chunks = responseChunks(id);
    host.apply(chunks.root);
    host.apply(chunks.fragA);
    host.apply(chunks.revealA);
    expect(element.textContent).toBe("A");
    host.apply(chunks.fallbackB);
    // The fallback is MATERIALIZED (visible text), the placeholder kept.
    expect(element.textContent).toBe("Afb-b");
    expect(element.querySelector("template#pl-b")).not.toBeNull();
    host.apply(chunks.fragB);
    expect(element.textContent).toBe("Afb-b");
    host.apply(chunks.revealB);
    expect(element.innerHTML).toBe(ORACLE);
    dispose();
  });

  // Per-version reset: fragment names restart in every stream, so v1's
  // `seg:a` must not reveal into v2's `pl-a` with v1's content — and a late
  // v1 fragment/reveal arriving after v2's root is an older version's record
  // and must never become visible.
  const SEG_A1 = `<p>A1</p>`;
  const SEG_A2 = `<p>A2</p>`;

  // Arm (c): the v2 root is BYTE-IDENTICAL to v1's — the normal refetch
  // shape (the shell around a server `<Loading>` does not change between
  // renders; only the deferred segment's content does).
  //
  // Was red on `next`: the version-bump branch of `FrameImpl.apply` reset
  // the segment bookkeeping but KEPT `#appliedRootValue`, so a new version
  // whose root equals the previous one's was value-skipped — the DOM kept
  // v1's revealed interior (no placeholder), `#segmentReady("a")` failed
  // its structural prerequisite forever, and `A2` never appeared. Green
  // under frames-rulings 2.1/2.2: the applied state is one version's — the
  // bump replaces it wholesale, root included — so an equal root is still
  // the new version's landing and re-creates the placeholders its segments
  // reveal into.
  test("(c) a v2 root byte-identical to v1's resets the segment: v1's revealed content gives way to v2's placeholder, then v2's segment", () => {
    const id = "c7c";
    const { host, element, dispose } = freshFrame(id);
    host.apply({ type: "html", id, version: 1, html: ROOT });
    host.apply({ type: "fragment", id, version: 1, key: "a", html: SEG_A1 });
    host.apply({ type: "reveal", id, version: 1, keys: ["a"] });
    expect(element.innerHTML).toBe(`<div><p>A1</p></div>`);
    host.apply({ type: "html", id, version: 2, html: ROOT });
    // v2's shell: the placeholder is back with its inline fallback; v1's
    // `seg:a` was reset and does not reveal into it.
    expect(element.querySelector("p")).toBeNull();
    expect(element.querySelector("template#pl-a")).not.toBeNull();
    expect(element.textContent).toBe("fb-a");
    host.apply({ type: "fragment", id, version: 2, key: "a", html: SEG_A2 });
    host.apply({ type: "reveal", id, version: 2, keys: ["a"] });
    host.apply({ type: "complete", id, version: 2 });
    expect(element.innerHTML).toBe(`<div><p>A2</p></div>`);
    dispose();
  });

  // Arm (d) (control for c): a v2 root that differs from v1's by one byte
  // takes the morph path, and the per-version reset then holds over every
  // v2 chunk order the wire can produce — the root first (one response's
  // drain is sequential and the producer flushes the shell before any
  // fragment of it; a v2 fragment ahead of v2's root is unreachable), then
  // the fragment and reveal in either order — with v1 stragglers (its
  // fragment and reveal re-sent after v2 began) dropped by the store's
  // version guard at every placement.
  const ROOT2 = ROOT.replace("<div>", `<div data-v="2">`);
  const v2Orders = permutations(["fragA2", "revealA2"]).map(rest => ["root2", ...rest]);
  test(`(d) a v2 root differing from v1's resets the segment and v1's late seg records never reveal into v2's placeholder (${v2Orders.length} v2 orders × 3 late-v1 placements)`, () => {
    for (const order of v2Orders) {
      for (const lateAt of [0, 1, 2]) {
        const id = `c7d-${order.join("")}-${lateAt}`;
        const { host, element, dispose } = freshFrame(id);
        const v1 = {
          root: { type: "html", id, version: 1, html: ROOT },
          fragA: { type: "fragment", id, version: 1, key: "a", html: SEG_A1 },
          revealA: { type: "reveal", id, version: 1, keys: ["a"] }
        } as Record<string, any>;
        const v2 = {
          root2: { type: "html", id, version: 2, html: ROOT2 },
          fragA2: { type: "fragment", id, version: 2, key: "a", html: SEG_A2 },
          revealA2: { type: "reveal", id, version: 2, keys: ["a"] }
        } as Record<string, any>;
        host.apply(v1.root);
        host.apply(v1.fragA);
        host.apply(v1.revealA);
        expect(element.innerHTML).toBe(`<div><p>A1</p></div>`);
        const label = `v2: ${order.join(" → ")}, late v1 after #${lateAt}`;
        order.forEach((name, i) => {
          host.apply(v2[name]);
          if (i === lateAt) {
            // A straggler from v1: its fragment AND reveal re-sent after
            // v2 began. Older version → dropped by the store guard.
            host.apply(v1.fragA);
            host.apply(v1.revealA);
          }
          // Once v2 began, v1's segment is never visible again: the root
          // shows v2's shell (placeholder + fallback) or v2's segment only.
          expect(element.textContent?.includes("A1"), `${label} (after ${name})`).toBe(false);
          checkNoCoexistence(element, label);
        });
        expect(element.innerHTML, label).toBe(`<div data-v="2"><p>A2</p></div>`);
        dispose();
      }
    }
  });
});
