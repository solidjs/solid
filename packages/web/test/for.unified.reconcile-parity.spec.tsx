/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * RECONCILE PARITY MATRIX — the classic for.spec transition table (and then
 * some), driven through BOTH implementations:
 *
 *   slot     — arity-1 keyed rows (the engine, flat-mode eligible)
 *   slot-idx — arity-2 rows (`(item, i) =>`): the engine in index mode
 *              (per-row index signals, chain from the first fill)
 *   classic  — the ORACLE: mapArray + insert directly, no <For> (every <For>
 *              engages the engine on web). Identical expected output — a
 *              live specification, not a snapshot.
 *
 * Each mode runs the full matrix in three container shapes, because the P0
 * audit proved anchoring is where list bugs hide:
 *   whole   — For is the sole child (marker undefined; bulk-clear paths)
 *   trailing— preceding sibling, For last (marker null; classic MULTI)
 *   bounded — siblings on both sides (marker = element node)
 *
 * And in three row shapes (text / element / static fragment — fragments
 * exercise the multi-node ns rows).
 *
 * The differential section renders slot and classic off ONE signal and
 * asserts DOM equality after every step of a cumulative no-reset sequence —
 * state-to-state transitions, not just canonical-to-X.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { createSignal, flush, For, DEV } from "solid-js";
import { referenceMapArray as refMapArray } from "./reference/mapArray.js";
const mapArray: (...a: any[]) => any = refMapArray as any;
const stats = DEV!.unifiedFor;
import { render } from "@solidjs/web";

type Shape = {
  name: string;
  row: (item: string) => any;
  rowIdx: (item: string, i: any) => any;
  html: (k: string) => string;
};

const SHAPES: Shape[] = [
  {
    name: "text",
    row: (item: string) => item,
    rowIdx: (item: string, _i: any) => item,
    html: k => k
  },
  {
    name: "element",
    row: (item: string) => <span>{item}</span>,
    rowIdx: (item: string, _i: any) => <span>{item}</span>,
    html: k => `<span>${k}</span>`
  },
  {
    name: "fragment",
    row: (item: string) => (
      <>
        <b>{item}</b>
        <i>!</i>
      </>
    ),
    rowIdx: (item: string, _i: any) => (
      <>
        <b>{item}</b>
        <i>!</i>
      </>
    ),
    html: k => `<b>${k}</b><i>!</i>`
  }
];

const CANON = ["a", "b", "c", "d", "e"];

// Canonical-to-X transition table: the for.spec families plus jfb-style
// moves, boundary inserts/removes, and compound displacements.
const TRANSITIONS: [string, string[]][] = [
  ["identity", ["a", "b", "c", "d", "e"]],
  ["1 missing head", ["b", "c", "d", "e"]],
  ["1 missing mid", ["a", "b", "d", "e"]],
  ["1 missing tail", ["a", "b", "c", "d"]],
  ["2 missing ends", ["b", "c", "d"]],
  ["2 missing mid", ["a", "c", "e"]],
  ["3 missing", ["a", "e"]],
  ["single survivor head", ["a"]],
  ["single survivor mid", ["c"]],
  ["single survivor tail", ["e"]],
  ["all missing", []],
  ["swap adjacent", ["b", "a", "c", "d", "e"]],
  ["swap ends", ["e", "b", "c", "d", "a"]],
  ["swap inner", ["a", "d", "c", "b", "e"]],
  ["rotate forward", ["b", "c", "d", "e", "a"]],
  ["rotate backward", ["e", "a", "b", "c", "d"]],
  ["reversal", ["e", "d", "c", "b", "a"]],
  ["full replace", ["f", "g", "h", "i", "j"]],
  ["partial replace overlap", ["a", "x", "c", "y", "e"]],
  ["prepend", ["x", "a", "b", "c", "d", "e"]],
  ["append", ["a", "b", "c", "d", "e", "x"]],
  ["insert middle", ["a", "b", "x", "c", "d", "e"]],
  ["insert both ends", ["x", "a", "b", "c", "d", "e", "y"]],
  ["remove+insert mixed", ["x", "b", "d", "y"]],
  ["move first to last", ["b", "c", "d", "e", "a"]],
  ["move last to first", ["e", "a", "b", "c", "d"]],
  ["displace 3 forward", ["b", "c", "d", "a", "e"]],
  ["shuffle fixed", ["c", "a", "e", "b", "d"]],
  ["grow from subset", ["a", "b", "c", "d", "e", "f", "g"]],
  ["interleave new", ["a", "x", "b", "y", "c", "z"]]
];

type Container = {
  name: string;
  mount: (list: () => string[], row: any) => [HTMLElement, () => void];
  wrap: (rows: string) => string;
};

type Mode = "slot" | "slot-idx" | "classic";

/** The list expression for a mode: the engine (arity-1 rows), the engine in
 * index mode (arity-2 rows), or the ORACLE — mapArray + insert directly, no
 * <For> (every <For> engages the engine on web). */
function listFor(mode: Mode, list: () => string[], shape: Shape): any {
  if (mode === "classic") return mapArray(list, shape.row as any);
  return <For each={list()}>{mode === "slot-idx" ? shape.rowIdx : shape.row}</For>;
}

function makeContainers(mode: Mode, shape: Shape): Container[] {
  return [
    {
      name: "whole",
      mount: (list, _row) => {
        const host = document.createElement("div");
        const dispose = render(() => <section>{listFor(mode, list, shape)}</section>, host);
        return [host.querySelector("section")!, dispose];
      },
      wrap: rows => rows
    },
    {
      name: "trailing (null marker)",
      mount: (list, _row) => {
        const host = document.createElement("div");
        const dispose = render(
          () => (
            <section>
              <em>pre</em>
              {listFor(mode, list, shape)}
            </section>
          ),
          host
        );
        return [host.querySelector("section")!, dispose];
      },
      wrap: rows => `<em>pre</em>${rows}`
    },
    {
      name: "bounded (element marker)",
      mount: (list, _row) => {
        const host = document.createElement("div");
        const dispose = render(
          () => (
            <section>
              <em>pre</em>
              {listFor(mode, list, shape)}
              <em>post</em>
            </section>
          ),
          host
        );
        return [host.querySelector("section")!, dispose];
      },
      wrap: rows => `<em>pre</em>${rows}<em>post</em>`
    }
  ];
}

for (const mode of ["slot", "slot-idx", "classic"] as const) {
  for (const shape of SHAPES) {
    describe(`reconcile parity [${mode}] [${shape.name} rows]`, () => {
      for (const container of makeContainers(mode, shape)) {
        test(`${container.name}: full transition matrix`, () => {
          const [list, setList] = createSignal(CANON);
          const engagedBefore = stats.engaged;
          const [el, dispose] = container.mount(list, null);
          try {
            // Mode sanity: the engine engages exactly once, the oracle never.
            expect(stats.engaged).toBe(engagedBefore + (mode === "classic" ? 0 : 1));
            const expected = (arr: string[]) => container.wrap(arr.map(shape.html).join(""));
            expect(el.innerHTML).toBe(expected(CANON));
            for (const [label, target] of TRANSITIONS) {
              setList(target);
              flush();
              expect(el.innerHTML, `${label} (forward)`).toBe(expected(target));
              setList(CANON);
              flush();
              expect(el.innerHTML, `${label} (reset)`).toBe(expected(CANON));
            }
          } finally {
            dispose();
          }
        });
      }
    });
  }
}

describe("reconcile parity: differential (slot vs classic, one signal, no resets)", () => {
  // Cumulative state-to-state sequence — every step diffs against the
  // PREVIOUS state, so this covers transitions the canonical matrix cannot.
  const SEQUENCE: string[][] = [
    ["a", "b", "c", "d", "e"],
    ["e", "d", "c", "b", "a"], // reversal
    ["e", "c", "a"], // remove evens (of reversed)
    ["x", "e", "c", "a", "y"], // grow both ends
    ["y", "x", "e", "c", "a"], // rotate
    ["a", "c", "e", "x", "y"], // reversal again
    [], // clear
    ["m", "n"], // refill small
    ["n", "m"], // swap pair
    ["n", "q", "m"], // insert middle
    ["q"], // collapse to middle survivor
    ["q", "r", "s", "t", "u", "v", "w"], // grow long
    ["w", "q", "s", "u", "t", "r", "v"], // shuffle
    ["v", "w"], // heavy shrink, tail survivors
    ["f", "g", "h"], // full replace
    ["h", "g", "f"], // reverse the replacement
    ["a", "b", "c", "d", "e"] // back to canon
  ];

  for (const shape of SHAPES) {
    test(`${shape.name} rows: DOM identical after every step`, () => {
      const [list, setList] = createSignal(SEQUENCE[0]);
      const slotHost = document.createElement("div");
      const classicHost = document.createElement("div");
      const disposeSlot = render(
        () => (
          <section>
            <em>pre</em>
            {listFor("slot", list, shape)}
            <em>post</em>
          </section>
        ),
        slotHost
      );
      const disposeClassic = render(
        () => (
          <section>
            <em>pre</em>
            {listFor("classic", list, shape)}
            <em>post</em>
          </section>
        ),
        classicHost
      );
      try {
        expect(slotHost.innerHTML).toBe(classicHost.innerHTML);
        for (let i = 1; i < SEQUENCE.length; i++) {
          setList(SEQUENCE[i]);
          flush();
          expect(slotHost.innerHTML, `step ${i}: ${SEQUENCE[i].join(",") || "(empty)"}`).toBe(
            classicHost.innerHTML
          );
        }
      } finally {
        disposeSlot();
        disposeClassic();
      }
    });
  }
});
