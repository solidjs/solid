/**
 * Pins for the uninitialized (loading) window of derived optimistic
 * stores/signals — the #2910 rulings.
 *
 * 1. Loading is not pending (A16/A19 exc. 1): while a derived store is
 *    uninitialized, `isPending` probes report false — even when the probe
 *    thunk routes through data that carries an affects() mark — because the
 *    read throws at the uninitialized firewall before reaching the marked
 *    data, and no dependency edge exists before the first landing. The mark
 *    IS witnessed on the marked store itself (the trap witnesses before the
 *    firewall throws). Once the derive lands and families share the raw,
 *    marks flow (#2904 pins).
 *
 * 2. Write-visibility corollary (A25, ruled 2026-07-17): the seed is a
 *    legitimate WRITE base. Setter function-form arguments (store draft,
 *    signal `prev`) read the raw current state — seed / `undefined` — while
 *    every read channel throws, so no consumer can rely on it.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  affects,
  createMemo,
  createOptimistic,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  flush,
  isPending,
  NotReadyError
} from "../src/index.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

const settle = async () => {
  await new Promise(r => setTimeout(r, 0));
  flush();
};

describe("loading vs pending: uninitialized derived stores (#2910)", () => {
  it("probes report false through an uninitialized derived store, true on the marked store itself", async () => {
    const dS = deferred<{ a: number }>();
    const dS3 = deferred<void>();

    let s!: any, s3!: any, dispose!: () => void;
    createRoot(d => {
      dispose = d;
      [s] = createOptimisticStore(async () => dS.promise, { a: 0 });
      [s3] = createOptimisticStore(
        async () => {
          await dS3.promise;
          return s;
        },
        { a: 0 } as any
      );
      createRenderEffect(
        () => [s, s3],
        () => {}
      );
    });
    flush();

    // Both uninitialized: loading, not pending.
    expect(isPending(() => s.a)).toBe(false);
    expect(isPending(() => s3.a)).toBe(false);

    affects(s, "a");
    // The mark is witnessed on s itself even while s is uninitialized —
    // the trap witnesses before the firewall throws.
    expect(isPending(() => s.a)).toBe(true);
    // But no edge exists from s3 to s before s3's derive lands: the probe
    // dies at s3's uninitialized firewall. Loading stays a boundary concern.
    expect(isPending(() => s3.a)).toBe(false);

    // The ambient mark releases at flush end (#2899); once everything lands
    // nothing is pending and the derived store shows the source's value.
    // (Cross-family flow of a HELD mark after landing is pinned by the
    // #2904 tests with action-held marks.) Land s first: s3's derive reads
    // s at commit time and re-suspends until s has initialized.
    dS.resolve({ a: 7 });
    await settle();
    dS3.resolve();
    await settle();
    expect(isPending(() => s3.a)).toBe(false);
    expect(s3.a).toBe(7);
    dispose();
  });

  it("a landed derived store holding the source proxy witnesses marks through it", async () => {
    const dS = deferred<{ a: number }>();

    let s!: any, s2!: any, dispose!: () => void;
    createRoot(d => {
      dispose = d;
      [s] = createOptimisticStore(async () => dS.promise, { a: 0 });
      [s2] = createOptimisticStore(async () => ({ s, b: 2 }), { a: 0 } as any);
      createRenderEffect(
        () => [s, s2],
        () => {}
      );
    });
    flush();
    await settle(); // s2 lands immediately; s still in flight

    affects(s, "a");
    expect(isPending(() => s.a)).toBe(true);
    expect(isPending(() => s2.s?.a)).toBe(true); // reads through s's proxy

    dS.resolve({ a: 1 });
    await settle();
    dispose();
  });
});

/**
 * affects() throw surface (ruled 2026-07-17): affects() itself never throws
 * on any target form — the keyless scope walk reads raw values (never
 * traps), keyed marks resolve via overlay/raw, and the accessor form uses
 * the $REFRESH backref without calling the accessor. The ONLY throw surface
 * is the caller's argument expression: `affects(s.nested, "b")` reads
 * `s.nested` under normal read semantics, which throw during the
 * uninitialized window (A25) — before affects() is entered. Nothing to be
 * done API-side ("even wrapped in a function it'd throw before it returned
 * the desired store"); during initial load, mark the root instead.
 */
describe("affects() throw surface on uninitialized targets", () => {
  it("never throws for keyless/keyed/accessor forms; only the nested arg fetch throws", async () => {
    const dStore = deferred<{ a: number; nested: { b: number } }>();
    const dMemo = deferred<number>();
    let s!: any, m!: any, dispose!: () => void;
    createRoot(disp => {
      dispose = disp;
      [s] = createOptimisticStore(async () => dStore.promise, { a: 0, nested: { b: 1 } });
      m = createMemo(async () => dMemo.promise);
      createRenderEffect(
        () => {
          try {
            m();
          } catch {}
          return s;
        },
        () => {}
      );
    });
    flush();

    // All three target forms register without reading through the proxy.
    expect(() => affects(s)).not.toThrow();
    expect(() => affects(s, "a")).not.toThrow();
    expect(() => affects(m)).not.toThrow();
    expect(isPending(() => s.a)).toBe(true);

    // The argument expression is the one throw surface: `s.nested` is an
    // ordinary read and reads throw while uninitialized.
    expect(() => affects(s.nested, "b")).toThrow(NotReadyError);

    dStore.resolve({ a: 1, nested: { b: 2 } });
    dMemo.resolve(1);
    await settle();
    // Once landed, the same fetch is fine even mid-refetch/mark windows
    // (marks are value-transparent; untracked reads see the landed value).
    expect(() => affects(s.nested, "b")).not.toThrow();
    dispose();
  });

  it("inside an action, an uninitialized nested arg fetch rejects the action (loud, typed)", async () => {
    const d = deferred<{ nested: { b: number } }>();
    let s!: any, dispose!: () => void;
    createRoot(disp => {
      dispose = disp;
      [s] = createOptimisticStore(async () => d.promise, { nested: { b: 0 } });
      createRenderEffect(
        () => s,
        () => {}
      );
    });
    flush();

    const gate = deferred<void>();
    const act = action(function* () {
      affects(s.nested, "b"); // throws fetching s.nested — action rejects
      yield gate.promise;
    });
    await expect(act()).rejects.toBeInstanceOf(NotReadyError);

    d.resolve({ nested: { b: 2 } });
    await settle();
    dispose();
  });
});

describe("A25 write-visibility corollary: seed visible on the write path", () => {
  it("store: getter throws while uninitialized, setter draft reads the seed", async () => {
    const d = deferred<{ a: number }>();
    let s!: any, ss!: any, dispose!: () => void;
    createRoot(disp => {
      dispose = disp;
      [s, ss] = createOptimisticStore(async () => d.promise, { a: 0 });
      createRenderEffect(
        () => s,
        () => {}
      );
    });
    flush();

    // Read channel: throws.
    expect(() => s.a).toThrow(NotReadyError);
    // Write channel: seed is the draft base.
    let seen: any;
    ss((draft: any) => {
      seen = draft.a;
      draft.a = draft.a + 1; // relative write against the seed is legal
    });
    expect(seen).toBe(0);

    d.resolve({ a: 7 });
    await settle();
    expect(s.a).toBe(7); // landing consumed the optimistic layer
    dispose();
  });

  it("optimistic computed: getter throws while uninitialized, prev is undefined", async () => {
    const d = deferred<number>();
    let get!: any, set!: any, dispose!: () => void;
    createRoot(disp => {
      dispose = disp;
      [get, set] = createOptimistic<number>(async () => d.promise);
      createRenderEffect(
        () => {
          try {
            get();
          } catch {}
        },
        () => {}
      );
    });
    flush();

    expect(() => get()).toThrow(NotReadyError);
    let prevSeen: any = "not-run";
    set((prev: any) => {
      prevSeen = prev; // no seed argument exists: raw state is undefined
      return 99;
    });
    expect(prevSeen).toBe(undefined);

    d.resolve(1);
    await settle();
    dispose();
  });

  it("once initialized, the setter argument is the displayed value", async () => {
    let get!: any, set!: any, dispose!: () => void;
    createRoot(disp => {
      dispose = disp;
      [get, set] = createOptimistic<number>(5);
      createRenderEffect(
        () => get(),
        () => {}
      );
    });
    flush();

    set(10); // active override
    let prevSeen: any;
    set((prev: number) => {
      prevSeen = prev;
      return prev + 1;
    });
    expect(prevSeen).toBe(10); // write base = what the user sees
    dispose();
  });
});
