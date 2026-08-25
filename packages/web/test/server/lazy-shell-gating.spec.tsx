/**
 * @jsxImportSource @solidjs/web
 */
// Companion to dynamic-shell-gating.spec.tsx. `lazy()` calls `ctx.block` on
// its module promise, which puts it in the renderer's blocking set and gates
// the shell flush. The question these tests pin down: does an un-preloaded
// lazy() under a <Loading> stall the whole document instead of letting the
// boundary show its fallback and stream the module in?
//
// Note the asset-ordering concern that motivates blocking is handled
// separately, by `assetsPending` and its own NotReadyError inside lazy's
// render memo — not by this block.
import { describe, expect, test } from "vitest";
import { renderToStream, Loading } from "@solidjs/web";
import { lazy } from "solid-js";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function collectTimed(
  code: () => any,
  options?: any
): Promise<{ shell: string; shellAt: number; html: string }> {
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
      end: () => resolve({ shell, shellAt, html: chunks.join("") })
    });
  });
}

describe("lazy() under a boundary", () => {
  const DELAY = 150;
  const manifest = { "./Slow.tsx": { file: "assets/slow.js" } };

  test("defers to the enclosing Loading instead of gating the shell", async () => {
    const Slow = (_props: any) => <b>content</b>;
    const LazySlow = lazy(
      () => wait(DELAY).then(() => ({ default: Slow })),
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

    expect(shellAt).toBeLessThan(DELAY);
    expect(shell).toContain(">waiting…</span>");
    expect(html).toContain(">content</b>");
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
});
