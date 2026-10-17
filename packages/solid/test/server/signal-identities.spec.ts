/** @vitest-environment node */
/**
 * Dependency edges on the server: plain-signal identities and read tracking
 * (edges.ts). Off until the frames server installs them, so a render without
 * server components names nothing and tracks nothing. On, a plain signal
 * created under an id-bearing owner is named `<owner id>~<n>`, n restarting
 * whenever the owner's child counter does (dispose, retry reset), as the
 * client names it; a slot fill's reads report those names, through memos too.
 */
import { afterEach, describe, expect, test } from "vitest";
import {
  createMemo,
  createOwner,
  createRoot,
  createSignal,
  edgeHooks,
  resetOwnerForRerun,
  runWithOwner
} from "../../src/server/signals.js";
import { beginEdgesRender, edgesRenders, trackFillReads } from "../../src/server/edges.js";
import { sharedConfig } from "../../src/server/shared.js";

let end: (() => void) | undefined;
afterEach(() => {
  end?.();
  end = undefined;
  sharedConfig.context = undefined;
});

/** A render that asked for edges is in flight. */
function edgesRender() {
  end = beginEdgesRender();
  sharedConfig.context = { edges: true } as any;
}

const readsOf = (fn: () => unknown) => [...(trackFillReads(fn).reads || [])];

describe("server plain-signal identities", () => {
  test("off: nothing is named or tracked", () => {
    const reads = createRoot(
      () => {
        const [a] = createSignal(1);
        return readsOf(() => a());
      },
      { id: "off" }
    );
    expect(reads).toEqual([]);
  });

  test("installed, but the render did not ask: nothing is named", () => {
    end = beginEdgesRender();
    sharedConfig.context = { edges: false } as any;
    const reads = createRoot(
      () => {
        const [a] = createSignal(1);
        return readsOf(() => a());
      },
      { id: "plain" }
    );
    expect(reads).toEqual([]);
  });

  test("on: named per id-bearing owner in creation order; fills see reads through memos", () => {
    edgesRender();
    const reads = createRoot(
      () => {
        const [a] = createSignal(1);
        const [b] = createSignal(2);
        const sum = createMemo(() => a() + b());
        return [readsOf(() => a()), readsOf(() => sum())];
      },
      { id: "r" }
    );
    expect(reads[0]).toEqual(["r~0"]);
    expect(reads[1].sort()).toEqual(["r~0", "r~1"]);
  });

  test("the count restarts when the owner's children reset (a retry)", () => {
    edgesRender();
    const names = createRoot(
      () => {
        const o = createOwner();
        const pass = () =>
          runWithOwner(o, () => {
            const [s] = createSignal(0);
            return readsOf(() => s());
          });
        const first = pass();
        resetOwnerForRerun(o);
        return [first, pass()];
      },
      { id: "q" }
    );
    expect(names[0]).toHaveLength(1);
    expect(names[1]).toEqual(names[0]);
  });

  test("the hooks are installed only while an edges render is in flight", () => {
    const a = beginEdgesRender();
    const b = beginEdgesRender();
    expect(edgesRenders()).toBe(2);
    a();
    a();
    expect(edgesRenders()).toBe(1);
    b();
    expect(edgesRenders()).toBe(0);
    expect(edgeHooks).toBeNull();
  });
});
