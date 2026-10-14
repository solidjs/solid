/**
 * @jsxImportSource @solidjs/web
 */
// #4032: an in-tag hole that escalates (its value is still pending) drops
// its attribute capture. The address that capture spliced into the tag must
// go with it: the resume re-renders the same open tag and mints again, and
// a leftover address both duplicated `data-lha` on the element and rode in
// every later attr op for it, moving the element off its bound address.
import { describe, expect, test } from "vitest";
import { renderToStream, Loading } from "@solidjs/web";
import { createMemo } from "solid-js";
import { frameTransformDirectResult, ServerComponentPlugin } from "../../frames/src/frame-sink.js";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function collect(code: () => any): Promise<string> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(code, { plugins: [ServerComponentPlugin] } as any).pipe({
      write: (c: string) => chunks.push(c),
      end: () => resolve(chunks.join(""))
    });
  });
}

const addressesPerTag = (html: string) =>
  [...html.matchAll(/<[a-z]+\b[^>]*>/g)]
    .map(m => (m[0].match(/data-lha=/g) || []).length)
    .filter(n => n > 0);

describe("an escalated in-tag hole leaves one address on its element (#4032)", () => {
  test("a pending attribute inside <Loading>", async () => {
    const S = () => {
      const ready = createMemo(async () => (await wait(5), "r"));
      const tick = createMemo(async function* () {
        yield 0;
        await wait(20);
        yield 1;
      });
      const label = createMemo(() => ready() + ":" + tick());
      return (
        <Loading fallback={<span>FB</span>}>
          <ul data-l={label()}>
            <li>x</li>
          </ul>
        </Loading>
      );
    };
    const Inline = frameTransformDirectResult(S, { id: "r/4032-a" }) as any;
    const html = await collect(() => Inline({}));

    expect(html).toMatch(/<ul data-lha="\d+" data-l="r:0">/);
    expect(addressesPerTag(html)).toEqual([1]);
    // The later value rides an attr op whose text carries no address.
    expect(html).toContain("r:1");
    expect(html).not.toMatch(/attrs:"[^"]*data-lha/);
  });

  test("pending attributes on nested elements", async () => {
    const S = () => {
      const ready = createMemo(async () => (await wait(5), "r"));
      const tick = createMemo(async function* () {
        yield 0;
        await wait(20);
        yield 1;
      });
      const label = createMemo(() => ready() + ":" + tick());
      return (
        <Loading fallback={<span>FB</span>}>
          <ul data-l={label()}>
            <li data-l={label()}>x</li>
          </ul>
        </Loading>
      );
    };
    const Inline = frameTransformDirectResult(S, { id: "r/4032-b" }) as any;
    const html = await collect(() => Inline({}));

    expect(addressesPerTag(html)).toEqual([1, 1]);
    expect(html).not.toMatch(/attrs:"[^"]*data-lha/);
  });
});
