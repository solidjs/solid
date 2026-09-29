// The serialization-border walk (`toBorderForm`, the slot-arg stand-in
// scrub): copy-on-write on acyclic data with no per-node bookkeeping, a
// memoized clone once a back-reference is met — with the first pass's
// replacements reused, so a visitor's side effects (a multicast seat, a
// trace envelope) happen once per node either way.
import { describe, expect, it } from "vitest";
import { DESCEND, rewriteTree } from "../../frames/src/tree-rewrite.js";

const SWAP = Symbol("swap");
type Swappable = { [SWAP]: true; id: string };
const swappable = (id: string): Swappable => ({ [SWAP]: true, id });

/** A visitor that replaces `swappable` leaves with a fresh seat and counts. */
function seats() {
  const taken: string[] = [];
  const visit = (v: any) => {
    if (v[SWAP] === true) {
      taken.push(v.id);
      return { seat: v.id };
    }
    return DESCEND;
  };
  return { taken, visit };
}

describe("rewriteTree", () => {
  it("acyclic: untouched subtrees pass by reference, changed paths are copied, the author value is not mutated", () => {
    const { taken, visit } = seats();
    const keep = { k: 1, deep: [1, { z: 2 }] };
    const src = { keep, list: [swappable("a"), "b"], own: "x" };
    const out = rewriteTree(src, visit, false);
    expect(out).not.toBe(src);
    expect(out.keep).toBe(keep);
    expect(out.list).toEqual([{ seat: "a" }, "b"]);
    expect(out.own).toBe("x");
    expect(src.list[0]).toEqual(swappable("a"));
    expect(taken).toEqual(["a"]);
  });

  it("acyclic with nothing to swap returns the value itself", () => {
    const { visit } = seats();
    const src = { a: [1, 2, { b: "c" }], d: null };
    expect(rewriteTree(src, visit, false)).toBe(src);
  });

  it("paths are built only when asked, `.key` and `[i]`; primitives are never visited", () => {
    const paths: (string | undefined)[] = [];
    let visited = 0;
    const visit = (v: any, path: string | undefined) => {
      visited++;
      paths.push(path);
      return DESCEND;
    };
    rewriteTree({ a: [1, { b: 2 }], c: "s" }, visit, true);
    expect(paths).toEqual(["", ".a", ".a[1]"]);
    expect(visited).toBe(3);
    paths.length = 0;
    rewriteTree({ a: [1] }, visit, false);
    expect(paths).toEqual([undefined, undefined]);
    expect(rewriteTree(1, visit, false)).toBe(1);
    expect(rewriteTree(null, visit, false)).toBe(null);
  });

  it("a cycle: the copy's back-reference points at the copy, and every replacement happens once", () => {
    const { taken, visit } = seats();
    // The seat sits BEFORE the back-reference in key order: the first pass
    // takes it, then meets the cycle and aborts; the clone pass must reuse
    // it rather than take a second seat (a generator shared twice never
    // closes).
    const src: any = { first: swappable("g"), tag: "m" };
    src.self = src;
    src.after = swappable("h");
    const out = rewriteTree(src, visit, false);
    expect(out).not.toBe(src);
    expect(out.self).toBe(out);
    expect(out.first).toEqual({ seat: "g" });
    expect(out.after).toEqual({ seat: "h" });
    expect(out.tag).toBe("m");
    expect(taken).toEqual(["g", "h"]);
    // The original is intact.
    expect(src.self).toBe(src);
    expect(src.first).toEqual(swappable("g"));
  });

  it("a cycle through an array, and a shared acyclic subtree beside it", () => {
    const { taken, visit } = seats();
    const shared = { s: swappable("s"), keep: 1 };
    const src: any = { list: [shared, shared], pair: [] };
    src.pair.push(src, shared);
    const out = rewriteTree(src, visit, false);
    expect(out.pair[0]).toBe(out);
    // One copy of the shared subtree, referenced from every occurrence.
    expect(out.list[0]).toBe(out.list[1]);
    expect(out.pair[1]).toBe(out.list[0]);
    expect(out.list[0]).toEqual({ s: { seat: "s" }, keep: 1 });
    expect(taken).toEqual(["s"]);
  });

  it("a cycle with nothing to swap still comes back as a cycle of copies, not a stack overflow", () => {
    const { taken, visit } = seats();
    const src: any = { a: 1 };
    src.me = src;
    const out = rewriteTree(src, visit, false);
    expect(out.a).toBe(1);
    expect(out.me).toBe(out);
    expect(taken).toEqual([]);
  });

  it("exotic values are not walked, on either pass", () => {
    const { taken, visit } = seats();
    class Box {
      constructor(public inner = swappable("boxed")) {}
    }
    const map = new Map([["k", swappable("mapped")]]);
    const src: any = { box: new Box(), map, set: new Set([swappable("set")]) };
    expect(rewriteTree(src, visit, false)).toBe(src);
    src.self = src;
    const out = rewriteTree(src, visit, false);
    expect(out.box).toBe(src.box);
    expect(out.map).toBe(map);
    expect(out.self).toBe(out);
    expect(taken).toEqual([]);
  });

  it("very deep acyclic data is rewritten correctly (ancestors tracked past the threshold, no false cycle)", () => {
    const { taken, visit } = seats();
    let leaf: any = { end: swappable("deep") };
    const bottom = leaf;
    for (let i = 0; i < 300; i++) leaf = { next: leaf };
    const out = rewriteTree(leaf, visit, false);
    let cursor = out;
    for (let i = 0; i < 300; i++) cursor = cursor.next;
    expect(cursor).toEqual({ end: { seat: "deep" } });
    expect(bottom.end).toEqual(swappable("deep"));
    expect(taken).toEqual(["deep"]);
  });

  it("a visitor's own error propagates", () => {
    const boom = new Error("boom");
    expect(() =>
      rewriteTree(
        { a: 1 },
        () => {
          throw boom;
        },
        false
      )
    ).toThrow(boom);
  });
});
