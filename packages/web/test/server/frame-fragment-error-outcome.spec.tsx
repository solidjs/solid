/**
 * @jsxImportSource @solidjs/web
 *
 * C12 (c), the server half (frames-rulings 3.3; A0 corollary 4 inward): a
 * server `<Loading>` inside a SERVER COMPONENT that rejects after the first
 * flush has no client twin to render over its position, so the fragment
 * carries what the SERVER rendered for the outcome — never a blank:
 *
 *  - the nearest server `<Errored>`'s fallback for the error, rendered at
 *    the `<Loading>`'s position (the Errored's own subtree is already in
 *    the shell; its fallback replacing the placeholder is the one layout
 *    the fragment can express) — the rule: "a post-flush error inside a
 *    server component's <Loading> shows the nearest <Errored>'s fallback
 *    at the boundary's position";
 *  - with no server `<Errored>`, the error ESCAPES the component: the frame
 *    as one async value errors (the stream face's unkeyed `error` chunk —
 *    `:error`; the document face's frame-addressed `sc:live` error op) and
 *    the position keeps the boundary's own markup, its fallback.
 *
 * `_fr` still rejects (the client's dev diagnostic, c1), the keyed error
 * chunk still rides. Outside a server component nothing changes: the blank
 * the client twin renders fresh over.
 */
import { describe, expect, it } from "vitest";
import vm from "node:vm";
import { createMemo } from "solid-js";
import { Errored, Loading, renderToStream } from "@solidjs/web";
import {
  frameTransformDirectResult,
  renderServerComponent,
  ServerComponentPlugin
} from "../../frames/src/frame-sink.js";

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

/** An async memo that rejects after the shell flushed. */
function lateReject(message: string) {
  return createMemo(async () => {
    await delay(10);
    throw new Error(message);
  });
}

const collectStream = (stream: any) =>
  new Promise<any[]>(resolve => {
    const chunks: any[] = [];
    stream.pipe({ write: (c: any) => chunks.push(c), end: () => resolve(chunks) });
  });

const collectDocument = (code: () => any) =>
  new Promise<string>(resolve => {
    const out: string[] = [];
    renderToStream(code, { plugins: [ServerComponentPlugin], onError() {} } as any).pipe({
      write: (c: string) => out.push(c),
      end: () => resolve(out.join(""))
    });
  });

/** Every `<template id=K>…</template>` of a document, by key. */
function templates(html: string) {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<template id="([^"]+)">([\s\S]*?)<\/template>/g)) out[m[1]] = m[2];
  return out;
}

/** Run a document's scripts as a browser would; the `_$HY.r` table after. */
async function execute(html: string) {
  const sandbox: any = {
    document: { getElementById: () => null, addEventListener() {} },
    _$HY: { r: {}, fe() {} },
    ReadableStream,
    Promise,
    Symbol
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  for (const [, src] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
    vm.runInContext(src, sandbox);
  }
  // A rejected `_fr` nobody in the sandbox reads is ours to own here (the
  // client's dev report is its reader on a real page).
  for (const key in sandbox._$HY.r) {
    const v = sandbox._$HY.r[key];
    if (key.endsWith("_fr") && v && typeof v.catch === "function") v.catch(() => {});
  }
  await delay(0);
  return sandbox._$HY.r as Record<string, any>;
}

/** Text with sibling-hole markers stripped (`<!--$-->x<!--/-->` → `x`). */
const unmarked = (html: string) => html.replace(/<!--\$-->|<!--\/-->/g, "");

async function readChannel(stream: any) {
  const reader = stream.getReader();
  const ops: any[] = [];
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    ops.push(r.value);
  }
  return ops;
}

describe("C12 (c) server half — a rejected server <Loading> inside a server component renders its outcome", () => {
  describe("stream face", () => {
    it("with a server <Errored>: the fragment carries the Errored's fallback at the boundary's position; the keyed error rides; no `:error`", async () => {
      const Comp = () => {
        const value = lateReject("boom");
        return (
          <section>
            <h1>head</h1>
            <Errored fallback={e => <em class="fail">failed: {(e() as Error).message}</em>}>
              <p>kept</p>
              <Loading fallback={<i>loading</i>}>
                <b>{value()}</b>
              </Loading>
            </Errored>
          </section>
        );
      };
      const chunks = await collectStream(
        renderServerComponent(Comp, { frame: { id: "eo" }, onError() {} })
      );
      const fragment = chunks.find(c => c.type === "fragment");
      expect(fragment).toBeDefined();
      // The outcome at the <Loading>'s position: the Errored's fallback,
      // not a blank; the Errored's own subtree (`<p>kept</p>`) is the
      // shell's and stays.
      expect(unmarked(fragment.html)).toBe('<em class="fail">failed: boom</em>');
      expect(chunks.find(c => c.type === "html").html).toContain("<p>kept</p>");
      // Revealed, like any settled fragment.
      expect(chunks.some(c => c.type === "reveal" && c.keys.includes(fragment.key))).toBe(true);
      // The failure is still surfaced as the keyed diagnostic (a hole-keyed
      // one may ride beside it — the live hole inside the boundary meeting
      // the same rejection on its sweep, the existing per-hole diagnostic)...
      expect(chunks.some(c => c.type === "error" && c.key === fragment.key)).toBe(true);
      // ...and NOT as the frame's own error: the server handled it.
      expect(chunks.some(c => c.type === "error" && !c.key)).toBe(false);
      expect(chunks[chunks.length - 1].type).toBe("complete");
    });

    it("without a server <Errored>: the error escapes — the frame's `:error` — and the position keeps the boundary's own fallback", async () => {
      const Comp = () => {
        const value = lateReject("boom");
        return (
          <section>
            <Loading fallback={<i>loading</i>}>
              <b>{value()}</b>
            </Loading>
          </section>
        );
      };
      const chunks = await collectStream(
        renderServerComponent(Comp, { frame: { id: "eo-escape" }, onError() {} })
      );
      const fragment = chunks.find(c => c.type === "fragment");
      expect(fragment).toBeDefined();
      // Never a blank: the boundary's own markup.
      expect(fragment.html).toBe("<i>loading</i>");
      // The frame as one async value errored (the outward face), ahead of
      // the fragment's settle; the keyed diagnostic rides too.
      const unkeyed = chunks.findIndex(c => c.type === "error" && !c.key);
      expect(unkeyed).toBeGreaterThan(-1);
      expect(unkeyed).toBeLessThan(chunks.indexOf(fragment));
      expect(chunks[unkeyed].error).toBe("boom");
      expect(chunks.some(c => c.type === "error" && c.key === fragment.key)).toBe(true);
      expect(chunks[chunks.length - 1].type).toBe("complete");
    });

    it("a <Loading> between the failing one and the <Errored> passes the question up", async () => {
      const Comp = () => {
        const value = lateReject("deep");
        return (
          <Errored fallback={e => <em>{(e() as Error).message}</em>}>
            <Loading fallback={<i>outer</i>}>
              <Loading fallback={<i>inner</i>}>
                <b>{value()}</b>
              </Loading>
            </Loading>
          </Errored>
        );
      };
      const chunks = await collectStream(
        renderServerComponent(Comp, { frame: { id: "eo-nested" }, onError() {} })
      );
      const fragments = chunks.filter(c => c.type === "fragment");
      // The inner boundary carries the outcome; the outer settles with its
      // content (the inner's placeholder) as usual.
      expect(fragments.map(f => unmarked(f.html))).toContain("<em>deep</em>");
      expect(chunks.some(c => c.type === "error" && !c.key)).toBe(false);
    });
  });

  describe("document face", () => {
    it("with a server <Errored>: the fragment template carries its fallback (not a blank); `_fr` rejects", async () => {
      const Comp = () => {
        const value = lateReject("doc-boom");
        return (
          <Errored fallback={e => <em class="fail">failed: {(e() as Error).message}</em>}>
            <Loading fallback={<i>loading</i>}>
              <b>{value()}</b>
            </Loading>
          </Errored>
        );
      };
      const Inline = frameTransformDirectResult(Comp, { id: "eo/doc" }) as any;
      const html = await collectDocument(() => Inline({}));
      const tpls = templates(html);
      const key = Object.keys(tpls).find(k => !k.startsWith("pl-"))!;
      expect(key).toBeDefined();
      expect(unmarked(tpls[key])).toBe('<em class="fail">failed: doc-boom</em>');
      expect(html).toContain(`$df("${key}")`);
      // The hydration record rejected (the client's dev report reads it).
      const r = await execute(html);
      const fr = r[`${key}_fr`];
      expect(fr).toBeDefined();
      expect(fr.s).toBe(2);
      // Handled by the server's own <Errored>: no frame error on the channel.
      const ops = await readChannel(r["sc:live"]);
      expect(ops.filter(op => op.type === "error" && !op.key)).toEqual([]);
    });

    it("without a server <Errored>: the template keeps the boundary's fallback and the channel carries the frame's error, addressed to it", async () => {
      const Comp = () => {
        const value = lateReject("doc-escape");
        return (
          <Loading fallback={<i>loading</i>}>
            <b>{value()}</b>
          </Loading>
        );
      };
      const Inline = frameTransformDirectResult(Comp, { id: "eo/doc-escape" }) as any;
      const html = await collectDocument(() => Inline({}));
      const tpls = templates(html);
      const key = Object.keys(tpls).find(k => !k.startsWith("pl-"))!;
      expect(tpls[key]).toBe("<i>loading</i>");
      const r = await execute(html);
      expect(r[`${key}_fr`].s).toBe(2);
      // The frame-addressed op (a hole-keyed one may ride beside it: the
      // live hole inside the boundary met the same rejection on its sweep —
      // the existing per-hole diagnostic, geometry-routed).
      const ops = await readChannel(r["sc:live"]);
      expect(ops.filter(op => op.type === "error" && !op.key)).toEqual([
        { type: "error", fid: "eo/doc-escape", error: "doc-escape" }
      ]);
    });

    it("outside a server component nothing changes: the blank the client twin renders fresh over", async () => {
      const App = () => {
        const value = lateReject("plain");
        return (
          <Errored fallback={<em>app-fallback</em>}>
            <Loading fallback={<i>loading</i>}>
              <b>{value()}</b>
            </Loading>
          </Errored>
        );
      };
      const html = await collectDocument(() => <App />);
      const tpls = templates(html);
      const key = Object.keys(tpls).find(k => !k.startsWith("pl-"))!;
      expect(tpls[key]).toBe(" ");
      expect(html).not.toContain("app-fallback");
    });
  });
});
