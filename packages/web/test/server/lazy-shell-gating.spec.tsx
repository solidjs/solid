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
import { describe, expect, test } from "vitest";
import { renderToStream, Loading, Errored } from "@solidjs/web";
import { createMemo, lazy } from "solid-js";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function collectTimed(
  code: () => any,
  options?: any
): Promise<{ shell: string; shellAt: number; html: string; chunks: number }> {
  return new Promise(resolve => {
    const t0 = Date.now();
    const chunks: string[] = [];
    let shell = "";
    let shellAt = -1;
    renderToStream(code, options).pipe({
      write: (c: string) => {
        if (shellAt < 0) {
          shellAt = Date.now() - t0;
          shell = c;
        }
        chunks.push(c);
      },
      end: () => resolve({ shell, shellAt, html: chunks.join(""), chunks: chunks.length })
    });
  });
}

const manifest = { "./Slow.tsx": { file: "assets/slow.js" } };
const MODULE = 50;
const DATA = 100;

describe("lazy() under a boundary", () => {
  test("the shell waits for the module; slow data inside it still streams", async () => {
    const Slow = (_props: any) => {
      const data = createMemo(() => wait(DATA).then(() => "async content"));
      return <b>{data()}</b>;
    };
    const LazySlow = lazy(
      () => wait(MODULE).then(() => ({ default: Slow })),
      undefined,
      "./Slow.tsx"
    );

    const { shell, shellAt, html } = await collectTimed(
      () => (
        <div>
          <Loading fallback={<span>waiting…</span>}>
            <LazySlow />
          </Loading>
        </div>
      ),
      { manifest }
    );

    // Held for the code, not for the data: the fallback covers the fetch.
    expect(shellAt).toBeGreaterThanOrEqual(MODULE - 5);
    expect(shellAt).toBeLessThan(DATA);
    expect(shell).toContain(">waiting…</span>");
    expect(shell).not.toContain("async content");
    expect(html).toContain(">async content</b>");
  });

  test("deferStream inside a lazy chunk holds the shell like the eager control (#3299)", async () => {
    const Page = (_props: any) => {
      const data = createMemo(() => wait(DATA).then(() => "async content"), {
        deferStream: true
      });
      return <h1>{data()}</h1>;
    };
    const LazyPage = lazy(
      () => wait(MODULE).then(() => ({ default: Page })),
      undefined,
      "./Slow.tsx"
    );
    const app = (Comp: any) => () => (
      <div>
        <Loading fallback={<span>waiting…</span>}>
          <Comp />
        </Loading>
      </div>
    );

    const eager = await collectTimed(app(Page), { manifest });
    const lazied = await collectTimed(app(LazyPage), { manifest });

    for (const r of [eager, lazied]) {
      expect(r.chunks).toBe(1);
      expect(r.shell).toMatch(/<h1[^>]*>async content<\/h1>/);
      expect(r.shell).not.toContain("waiting…");
    }
    expect(eager.shellAt).toBeGreaterThanOrEqual(DATA - 5);
    expect(lazied.shellAt).toBeGreaterThanOrEqual(MODULE + DATA - 10);
  });

  test("a module that resolves in microtasks is discovered before the shell flushes", async () => {
    // Not preloaded, but no real I/O: the boundary resumes during the flush
    // loop's drain. A deferStream read created there must still hold the
    // shell — a blocker registered after the awaited snapshot is re-awaited.
    const Page = (_props: any) => {
      const data = createMemo(() => wait(DATA).then(() => "async content"), {
        deferStream: true
      });
      return <h1>{data()}</h1>;
    };
    const LazyWarm = lazy(() => Promise.resolve({ default: Page }), undefined, "./Slow.tsx");

    const { shell, chunks } = await collectTimed(
      () => (
        <div>
          <Loading fallback={<span>waiting…</span>}>
            <LazyWarm />
          </Loading>
        </div>
      ),
      { manifest }
    );

    expect(chunks).toBe(1);
    expect(shell).toMatch(/<h1[^>]*>async content<\/h1>/);
  });

  test("a preloaded module still inlines with no fallback flash", async () => {
    const Fast = (_props: any) => <b>content</b>;
    const LazyFast = lazy(() => Promise.resolve({ default: Fast }), undefined, "./Slow.tsx");
    await LazyFast.preload!();

    const { html } = await collectTimed(
      () => (
        <div>
          <Loading fallback={<span>waiting…</span>}>
            <LazyFast />
          </Loading>
        </div>
      ),
      { manifest }
    );

    expect(html).toContain(">content</b>");
    expect(html).not.toContain(">waiting…</span>");
  });

  test("a module that fails to load releases the shell; the rejection ships to the client", async () => {
    // Same shape an eager `deferStream` read that rejects produces: async
    // errors under a boundary are the client's <Errored> to render, the
    // server serializes the rejection. What this pins is that a rejected
    // block does not hold the shell (or hang the response).
    const LazyBroken = lazy(
      () => wait(MODULE).then(() => Promise.reject(new Error("chunk 404"))),
      undefined,
      "./Slow.tsx"
    );

    const { shell, shellAt, html } = await collectTimed(
      () => (
        <div>
          <Errored fallback={err => <i>{(err as Error).message}</i>}>
            <Loading fallback={<span>waiting…</span>}>
              <LazyBroken />
            </Loading>
          </Errored>
        </div>
      ),
      { manifest }
    );

    expect(shellAt).toBeGreaterThanOrEqual(MODULE - 5);
    expect(shellAt).toBeLessThan(MODULE + 50);
    expect(shell).toContain('new Error("chunk 404")');
    expect(html).not.toContain("waiting…");
  });

  test("a lazy mounted by a post-shell fragment streams; the closed shell is never held", async () => {
    // Double nesting: the outer boundary's DATA resolves after the shell, and
    // only then does its content mount a lazy. `block` is a no-op once the
    // shell has flushed, so the module (and the deferStream inside it) stream
    // in as fragments — by design.
    const Inner = (_props: any) => {
      const data = createMemo(() => wait(30).then(() => "inner"), { deferStream: true });
      return <b>{data()}</b>;
    };
    const LazyInner = lazy(
      () => wait(MODULE).then(() => ({ default: Inner })),
      undefined,
      "./Slow.tsx"
    );
    const Outer = () => {
      const gate = createMemo(() => wait(DATA).then(() => true));
      return (
        <div>
          {gate() && (
            <Loading fallback={<span>inner-waiting</span>}>
              <LazyInner />
            </Loading>
          )}
        </div>
      );
    };

    const { shell, shellAt, html } = await collectTimed(
      () => (
        <Loading fallback={<span>outer-waiting</span>}>
          <Outer />
        </Loading>
      ),
      { manifest }
    );

    expect(shellAt).toBeLessThan(DATA);
    expect(shell).toContain("outer-waiting");
    expect(html).toMatch(/<b[^>]*>inner<\/b>/);
  });
});
