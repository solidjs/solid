/**
 * @jsxImportSource @solidjs/web
 */
// Companion to dynamic-shell-gating.spec.tsx. A lazy() module load is CODE,
// not data: the shell's "no new async discovered during the sync render" rule
// cannot be evaluated for a segment whose code has not run yet, so the module
// promise holds the shell even under a <Loading> (#3299). The boundary still
// owns the DATA the loaded code discovers — plain async streams behind the
// fallback as before — and a `deferStream` read inside the chunk behaves
// exactly like one in an eagerly imported component.
//
// Asset ordering is handled separately, by `assetsPending` and its own
// NotReadyError inside lazy's render memo.
//
// Every claim here is about ORDER (shell before/after a source settled) and
// is proven by settling gates by hand — see shell-gating-harness.ts for why
// the wall clock was retired.
import { describe, expect, test } from "vitest";
import { Loading, Errored } from "@solidjs/web";
import { createMemo, lazy } from "solid-js";
import { collect, drain, gate } from "./shell-gating-harness.js";

const manifest = { "./Slow.tsx": { file: "assets/slow.js" } };

describe("lazy() under a boundary", () => {
  test("the shell waits for the module; slow data inside it still streams", async () => {
    const module = gate<{ default: any }>();
    const data = gate<string>();
    const Slow = (_props: any) => {
      const value = createMemo(() => data.promise);
      return <b>{value()}</b>;
    };
    const LazySlow = lazy(() => module.promise, undefined, "./Slow.tsx");

    const r = collect(
      () => (
        <div>
          <Loading fallback={<span>waiting…</span>}>
            <LazySlow />
          </Loading>
        </div>
      ),
      [module, data],
      { manifest }
    );

    // Held for the code: nothing flushes until the module lands…
    await drain();
    expect(r.shellFlushed()).toBe(false);
    module.resolve({ default: Slow });
    const shell = await r.shell;
    // …and not for the data: the fallback covers the fetch.
    expect(r.settledAtShell.has(module)).toBe(true);
    expect(r.settledAtShell.has(data)).toBe(false);
    expect(shell).toContain(">waiting…</span>");
    expect(shell).not.toContain("async content");
    data.resolve("async content");
    const { html } = await r.done;
    expect(html).toContain(">async content</b>");
  });

  test("deferStream inside a lazy chunk holds the shell like the eager control (#3299)", async () => {
    const app = (Comp: any) => () => (
      <div>
        <Loading fallback={<span>waiting…</span>}>
          <Comp />
        </Loading>
      </div>
    );
    const page = (data: Promise<string>) => (_props: any) => {
      const value = createMemo(() => data, { deferStream: true });
      return <h1>{value()}</h1>;
    };

    // Eager control: the shell waits for the deferStream read.
    const eagerData = gate<string>();
    const eager = collect(app(page(eagerData.promise)), [eagerData], { manifest });
    await drain();
    expect(eager.shellFlushed()).toBe(false);
    eagerData.resolve("async content");
    await eager.shell;

    // Lazy: the module lands, then the shell still waits for the read the
    // loaded code made.
    const module = gate<{ default: any }>();
    const lazyData = gate<string>();
    const LazyPage = lazy(() => module.promise, undefined, "./Slow.tsx");
    const lazied = collect(app(LazyPage), [module, lazyData], { manifest });
    await drain();
    expect(lazied.shellFlushed()).toBe(false);
    module.resolve({ default: page(lazyData.promise) });
    await drain();
    expect(lazied.shellFlushed()).toBe(false);
    lazyData.resolve("async content");
    await lazied.shell;
    expect(lazied.settledAtShell.has(lazyData)).toBe(true);

    for (const r of [eager, lazied]) {
      const { html, chunks } = await r.done;
      expect(chunks).toBe(1);
      expect(html).toMatch(/<h1[^>]*>async content<\/h1>/);
      expect(html).not.toContain("waiting…");
    }
  });

  test("a module that resolves in microtasks is discovered before the shell flushes", async () => {
    // Not preloaded, but no real I/O: the boundary resumes during the flush
    // loop's drain. A deferStream read created there must still hold the
    // shell — a blocker registered after the awaited snapshot is re-awaited.
    const data = gate<string>();
    const Page = (_props: any) => {
      const value = createMemo(() => data.promise, { deferStream: true });
      return <h1>{value()}</h1>;
    };
    const LazyWarm = lazy(() => Promise.resolve({ default: Page }), undefined, "./Slow.tsx");

    const r = collect(
      () => (
        <div>
          <Loading fallback={<span>waiting…</span>}>
            <LazyWarm />
          </Loading>
        </div>
      ),
      [data],
      { manifest }
    );

    await drain();
    expect(r.shellFlushed()).toBe(false);
    data.resolve("async content");
    const { html, chunks } = await r.done;
    expect(chunks).toBe(1);
    expect(html).toMatch(/<h1[^>]*>async content<\/h1>/);
  });

  test("a preloaded module still inlines with no fallback flash", async () => {
    const Fast = (_props: any) => <b>content</b>;
    const LazyFast = lazy(() => Promise.resolve({ default: Fast }), undefined, "./Slow.tsx");
    await LazyFast.preload!();

    const { html } = await collect(
      () => (
        <div>
          <Loading fallback={<span>waiting…</span>}>
            <LazyFast />
          </Loading>
        </div>
      ),
      [],
      { manifest }
    ).done;

    expect(html).toContain(">content</b>");
    expect(html).not.toContain(">waiting…</span>");
  });

  test("a module that fails to load releases the shell; the rejection ships to the client", async () => {
    // Same shape an eager `deferStream` read that rejects produces: async
    // errors under a boundary are the client's <Errored> to render, the
    // server serializes the rejection. What this pins is that a rejected
    // block does not hold the shell (or hang the response).
    const module = gate<{ default: any }>();
    const LazyBroken = lazy(() => module.promise, undefined, "./Slow.tsx");

    const r = collect(
      () => (
        <div>
          <Errored fallback={err => <i>{(err() as Error).message}</i>}>
            <Loading fallback={<span>waiting…</span>}>
              <LazyBroken />
            </Loading>
          </Errored>
        </div>
      ),
      [module],
      { manifest }
    );

    await drain();
    expect(r.shellFlushed()).toBe(false);
    module.reject(new Error("chunk 404"));
    // Released by the rejection: `shell` rejects on its own if it never comes.
    const shell = await r.shell;
    expect(shell).toContain('new Error("chunk 404")');
    const { html } = await r.done;
    expect(html).not.toContain("waiting…");
  });

  test("a lazy mounted by a post-shell fragment streams; the closed shell is never held", async () => {
    // Double nesting: the outer boundary's DATA resolves after the shell, and
    // only then does its content mount a lazy. `block` is a no-op once the
    // shell has flushed, so the module (and the deferStream inside it) stream
    // in as fragments — by design.
    const outerData = gate<boolean>();
    const module = gate<{ default: any }>();
    const innerData = gate<string>();
    const Inner = (_props: any) => {
      const value = createMemo(() => innerData.promise, { deferStream: true });
      return <b>{value()}</b>;
    };
    const LazyInner = lazy(() => module.promise, undefined, "./Slow.tsx");
    const Outer = () => {
      const open = createMemo(() => outerData.promise);
      return (
        <div>
          {open() && (
            <Loading fallback={<span>inner-waiting</span>}>
              <LazyInner />
            </Loading>
          )}
        </div>
      );
    };

    const r = collect(
      () => (
        <Loading fallback={<span>outer-waiting</span>}>
          <Outer />
        </Loading>
      ),
      [outerData, module, innerData],
      { manifest }
    );

    // Plain data under a boundary never holds the shell.
    const shell = await r.shell;
    expect(r.settledAtShell.size).toBe(0);
    expect(shell).toContain("outer-waiting");
    // The lazy mounts after the shell closed; nothing left to hold.
    outerData.resolve(true);
    await drain();
    module.resolve({ default: Inner });
    await drain();
    innerData.resolve("inner");
    const { html } = await r.done;
    expect(html).toMatch(/<b[^>]*>inner<\/b>/);
  });
});
