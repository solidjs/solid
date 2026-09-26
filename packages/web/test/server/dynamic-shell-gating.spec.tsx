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
//
// The sources resolve to SERVER COMPONENTS (`frameTransformDirectResult`,
// what an in-process server component call answers with): since #3666 an
// async dynamic() instance is an ordinary async memo whose landing serializes
// for the client to adopt, and a server component is the shape that crosses
// (as a flight reference — hence the codec plugin on every render here). A
// promise of a client component function is the one shape that cannot, and
// is a dev error (dynamic-async-component-diagnostic.spec.tsx).
import { describe, expect, test } from "vitest";
import { Loading, dynamic } from "@solidjs/web";
import { createMemo } from "solid-js";
import { frameTransformDirectResult, ServerComponentPlugin } from "../../frames/src/frame-sink.js";
import { collect, drain, gate, type Gate } from "./shell-gating-harness.js";

const plugins = { plugins: [ServerComponentPlugin] };
let n = 0;
/** A server component answering the call `id`, as the in-process call would. */
const serverComponent = (component: (props: any) => any) =>
  frameTransformDirectResult(component, { id: `shell-gating/${n++}`, args: [] });
/** A gate whose answer is a server component. */
const sourceGate = () => gate<any>();
const settle = (g: Gate<any>, component: (props: any) => any) =>
  g.resolve(serverComponent(component));

describe("promise-backed dynamic() under a boundary", () => {
  test("defers to the enclosing Loading instead of gating the shell", async () => {
    const source = sourceGate();
    const Slow = dynamic(() => source.promise);

    const r = collect(
      () => (
        <div>
          <Loading fallback={<span>waiting…</span>}>
            <Slow />
          </Loading>
        </div>
      ),
      [source],
      plugins
    );

    // The shell must not wait on the source: it flushes with the source open.
    const shell = await r.shell;
    expect(r.settledAtShell.has(source)).toBe(false);
    // The boundary — not the renderer — owns the wait.
    expect(shell).toContain(">waiting…</span>");
    // And the content still arrives, streamed in behind the placeholder.
    settle(source, () => <b>content</b>);
    const { html } = await r.done;
    expect(html).toContain(">content</b>");
  });

  test("a near-instant source still inlines with no fallback flash", async () => {
    const Fast = dynamic(() => Promise.resolve(serverComponent(() => <b>content</b>)));

    const { html } = await collect(
      () => (
        <div>
          <Loading fallback={<span>waiting…</span>}>
            <Fast />
          </Loading>
        </div>
      ),
      [],
      plugins
    ).done;

    expect(html).toContain(">content</b>");
    expect(html).not.toContain(">waiting…</span>");
  });

  test("deferStream opts the source into holding the shell", async () => {
    const source = sourceGate();
    const Slow = dynamic(() => source.promise, { deferStream: true });

    const r = collect(
      () => (
        <div>
          <Loading fallback={<span>waiting…</span>}>
            <Slow />
          </Loading>
        </div>
      ),
      [source],
      plugins
    );

    await drain();
    expect(r.shellFlushed()).toBe(false);
    settle(source, () => <b>content</b>);
    const shell = await r.shell;
    expect(r.settledAtShell.has(source)).toBe(true);
    expect(shell).toContain(">content</b>");
    const { html } = await r.done;
    expect(html).not.toContain(">waiting…</span>");
  });

  test("deferStream holds the shell for the source only; the resolved component's data still streams", async () => {
    const source = sourceGate();
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
      [source, data],
      plugins
    );

    await drain();
    expect(r.shellFlushed()).toBe(false);
    settle(source, () => {
      const value = createMemo(() => data.promise);
      return <b>{value()}</b>;
    });
    const shell = await r.shell;
    expect(r.settledAtShell.has(source)).toBe(true);
    expect(r.settledAtShell.has(data)).toBe(false);
    expect(shell).toContain(">waiting…</span>");
    data.resolve("data");
    const { html } = await r.done;
    // The frame marks its text holes (`<!--lh:…-->`) around the value.
    expect(html).toMatch(/<b>(?:<!--[^>]*-->)*data(?:<!--[^>]*-->)*<\/b>/);
  });

  test("with no boundary to defer to, the shell still waits for the source", async () => {
    const source = sourceGate();
    const Slow = dynamic(() => source.promise);

    const r = collect(
      () => (
        <div>
          <Slow />
        </div>
      ),
      [source],
      plugins
    );

    // Nothing to stream behind, so the root hole keeps the shell back and the
    // content is inline in the first chunk rather than lost.
    await drain();
    expect(r.shellFlushed()).toBe(false);
    settle(source, () => <b>content</b>);
    const shell = await r.shell;
    expect(shell).toContain(">content</b>");
  });
});
