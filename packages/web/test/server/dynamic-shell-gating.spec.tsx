/**
 * @jsxImportSource @solidjs/web
 */
// A promise-backed dynamic() must suspend on READ and let the nearest
// <Loading> own the wait. By default it must not gate the shell flush on its
// source: unlike a lazy() module load (code — always held, see
// lazy-shell-gating.spec.tsx) a dynamic() source is data of unknown cost, and
// the author opts into holding the shell with `deferStream`.
//
// Found in the hackernews server-components example: a slow server component
// under a <Loading> pushed the whole document's first flush out by the full
// duration of the server work, and the boundary's fallback was never emitted
// — the shell just sat there. Nothing streamed, so every byte of the page
// waited on the slowest server function.
//
// Ordering is proven by settling gates by hand — see shell-gating-harness.ts.
import { describe, expect, test } from "vitest";
import { Loading, dynamic } from "@solidjs/web";
import { createMemo } from "solid-js";
import { collect, drain, gate } from "./shell-gating-harness.js";

describe("promise-backed dynamic() under a boundary", () => {
  test("defers to the enclosing Loading instead of gating the shell", async () => {
    const source = gate<() => any>();
    const Slow = dynamic(() => source.promise);

    const r = collect(
      () => (
        <div>
          <Loading fallback={<span>waiting…</span>}>
            <Slow />
          </Loading>
        </div>
      ),
      [source]
    );

    // The shell must not wait on the source: it flushes with the source open.
    const shell = await r.shell;
    expect(r.settledAtShell.has(source)).toBe(false);
    // The boundary — not the renderer — owns the wait.
    expect(shell).toContain(">waiting…</span>");
    // And the content still arrives, streamed in behind the placeholder.
    source.resolve(() => <b>content</b>);
    const { html } = await r.done;
    expect(html).toContain(">content</b>");
  });

  test("a near-instant source still inlines with no fallback flash", async () => {
    const Fast = dynamic(() => Promise.resolve(() => <b>content</b>));

    const { html } = await collect(() => (
      <div>
        <Loading fallback={<span>waiting…</span>}>
          <Fast />
        </Loading>
      </div>
    )).done;

    expect(html).toContain(">content</b>");
    expect(html).not.toContain(">waiting…</span>");
  });

  test("deferStream opts the source into holding the shell", async () => {
    const source = gate<() => any>();
    const Slow = dynamic(() => source.promise, { deferStream: true });

    const r = collect(
      () => (
        <div>
          <Loading fallback={<span>waiting…</span>}>
            <Slow />
          </Loading>
        </div>
      ),
      [source]
    );

    await drain();
    expect(r.shellFlushed()).toBe(false);
    source.resolve(() => <b>content</b>);
    const shell = await r.shell;
    expect(r.settledAtShell.has(source)).toBe(true);
    expect(shell).toContain(">content</b>");
    const { html } = await r.done;
    expect(html).not.toContain(">waiting…</span>");
  });

  test("deferStream holds the shell for the source only; the resolved component's data still streams", async () => {
    const source = gate<() => any>();
    const data = gate<string>();
    const Slow = dynamic(() => source.promise, { deferStream: true });

    const r = collect(
      () => (
        <div>
          <Loading fallback={<span>waiting…</span>}>
            <Slow />
          </Loading>
        </div>
      ),
      [source, data]
    );

    await drain();
    expect(r.shellFlushed()).toBe(false);
    source.resolve(() => {
      const value = createMemo(() => data.promise);
      return <b>{value()}</b>;
    });
    const shell = await r.shell;
    expect(r.settledAtShell.has(source)).toBe(true);
    expect(r.settledAtShell.has(data)).toBe(false);
    expect(shell).toContain(">waiting…</span>");
    data.resolve("data");
    const { html } = await r.done;
    expect(html).toContain(">data</b>");
  });

  test("with no boundary to defer to, the shell still waits for the source", async () => {
    const source = gate<() => any>();
    const Slow = dynamic(() => source.promise);

    const r = collect(
      () => (
        <div>
          <Slow />
        </div>
      ),
      [source]
    );

    // Nothing to stream behind, so the root hole keeps the shell back and the
    // content is inline in the first chunk rather than lost.
    await drain();
    expect(r.shellFlushed()).toBe(false);
    source.resolve(() => <b>content</b>);
    const shell = await r.shell;
    expect(shell).toContain(">content</b>");
  });
});
