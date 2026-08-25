/**
 * @jsxImportSource @solidjs/web
 */
// A promise-backed dynamic() must suspend on READ and let the nearest
// <Loading> own the wait. It must not gate the shell flush on its source.
//
// Found in the hackernews server-components example: a slow server component
// under a <Loading> pushed the whole document's first flush out by the full
// duration of the server work, and the boundary's fallback was never emitted
// — the shell just sat there. Nothing streamed, so every byte of the page
// waited on the slowest server function.
import { describe, expect, test } from "vitest";
import { renderToStream, Loading, dynamic } from "@solidjs/web";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Resolves with the shell (first chunk) and the time it took to arrive. */
function collectTimed(code: () => any): Promise<{ shell: string; shellAt: number; html: string }> {
  return new Promise(resolve => {
    const t0 = Date.now();
    const chunks: string[] = [];
    let shell = "";
    let shellAt = -1;
    renderToStream(code).pipe({
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

describe("promise-backed dynamic() under a boundary", () => {
  const DELAY = 150;

  test("defers to the enclosing Loading instead of gating the shell", async () => {
    const Slow = dynamic(() => wait(DELAY).then(() => () => <b>content</b>));

    const { shell, shellAt, html } = await collectTimed(() => (
      <div>
        <Loading fallback={<span>waiting…</span>}>
          <Slow />
        </Loading>
      </div>
    ));

    // The shell must not wait on the source.
    expect(shellAt).toBeLessThan(DELAY);
    // The boundary — not the renderer — owns the wait.
    expect(shell).toContain(">waiting…</span>");
    // And the content still arrives, streamed in behind the placeholder.
    expect(html).toContain(">content</b>");
  });

  test("a near-instant source still inlines with no fallback flash", async () => {
    const Fast = dynamic(() => Promise.resolve(() => <b>content</b>));

    const { html } = await collectTimed(() => (
      <div>
        <Loading fallback={<span>waiting…</span>}>
          <Fast />
        </Loading>
      </div>
    ));

    expect(html).toContain(">content</b>");
    expect(html).not.toContain(">waiting…</span>");
  });

  test("with no boundary to defer to, the shell still waits for the source", async () => {
    const Slow = dynamic(() => wait(DELAY).then(() => () => <b>content</b>));

    const { shell } = await collectTimed(() => (
      <div>
        <Slow />
      </div>
    ));

    // Nothing to stream behind, so the root hole keeps the shell back and the
    // content is inline in the first chunk rather than lost.
    expect(shell).toContain(">content</b>");
  });
});
