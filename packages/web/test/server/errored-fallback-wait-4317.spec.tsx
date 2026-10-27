/**
 * @jsxImportSource @solidjs/web
 *
 * #4317: a post-flush `<Loading>` failure waits for the enclosing
 * `<Errored>`'s fallback to finish before it streams the outcome (#4306).
 * That wait is a resume loop, and keeps the `<Loading>` resume loop's two
 * guards:
 *
 * - its convergence budget: a fallback hole that answers a fresh pending
 *   source on every pass stops being waited for, and the failure streams
 *   the outcome that is available — no finished fallback, so none: the
 *   fragment rejects as for any unfinished fallback, and the response ends;
 * - the render's teardown: an aborted request stops waiting at once, and
 *   the fallback is not rendered again when its pending source lands.
 */
import { describe, expect, test } from "vitest";
import { Errored, Loading, NotReadyError, createMemo } from "solid-js";
import { renderToStream } from "@solidjs/web";

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const MAX_RESUME_PASSES = 10000;

function App(props: { hint: () => string; onRender?: () => void }) {
  const user = createMemo(async (): Promise<string> => {
    await sleep(5);
    throw new Error("no user 7");
  });
  return (
    <div>
      <Errored
        fallback={(e: any) => (
          <p>
            failed: {e().message} {props.hint()}
          </p>
        )}
      >
        <Loading fallback={<i>loading</i>}>
          <span>user:{user()}</span>
        </Loading>
      </Errored>
      <span>tail</span>
    </div>
  );
}

describe("#4317: the wait for an Errored fallback's async holes", () => {
  test("stops at the resume loop's pass budget and streams what is available", async () => {
    let asks = 0;
    // Pathological: a fresh pending source on every pass, settling a turn
    // later, so the wait never converges (and a deadline can still fire).
    const hint = (): string => {
      asks++;
      throw new NotReadyError(new Promise(r => setImmediate(r)) as any);
    };
    const chunks: string[] = [];
    const errors: unknown[] = [];
    const ended = new Promise<void>(resolve =>
      renderToStream(() => <App hint={hint} />, { onError: e => void errors.push(e) }).pipe({
        write: (c: string) => void chunks.push(c),
        end: resolve
      })
    );
    const outcome = await Promise.race([
      ended.then(() => "ended"),
      sleep(15000).then(() => "still waiting")
    ]);
    expect(outcome).toBe("ended");
    // The discovery render plus one per budgeted pass, never more.
    expect(asks).toBe(MAX_RESUME_PASSES + 1);
    const html = chunks.join("");
    // No finished fallback: the fragment rejects with nothing drawn, and no
    // error record claims a fallback that was never sent.
    expect(html).toMatch(/<template id="[^"]+" e><\/template>/);
    expect(html).not.toContain("failed:");
    expect(html).toContain('new Error("no user 7")');
  }, 20000);

  test("an aborted render stops waiting and renders the fallback no further", async () => {
    let asks = 0;
    let land!: () => void;
    const pending = new Promise<void>(r => (land = r));
    let settled = false;
    const hint = (): string => {
      asks++;
      if (!settled) throw new NotReadyError(pending as any);
      return "HINT";
    };
    const controller = new AbortController();
    const chunks: string[] = [];
    renderToStream(() => <App hint={hint} />, {
      signal: controller.signal,
      onError() {}
    }).pipe({
      write: (c: string) => void chunks.push(c),
      end() {}
    });
    // The read fails at 5ms; the failure waits on the fallback's hole.
    await sleep(30);
    const asked = asks;
    expect(asked).toBeGreaterThan(0);
    const written = chunks.length;
    controller.abort();
    await sleep(0);
    // The source lands after the teardown: nothing renders the fallback
    // again, and nothing more is written.
    settled = true;
    land();
    await sleep(30);
    expect(asks).toBe(asked);
    expect(chunks.length).toBe(written);
    expect(chunks.join("")).not.toContain("HINT");
  });
});
