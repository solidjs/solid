import { describe, expect, test } from "vitest";
import { createComponent, createMemo, createResource, Suspense } from "../../src/server/index.js";
import { renderToStream, renderToStringAsync } from "../../web/server/index.js";

const after = <T>(ms: number, value: T) =>
  new Promise<T>(resolve => setTimeout(() => resolve(value), ms));

function withTimeout<T>(p: Promise<T>, label: string) {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} never settled`)), 2000)
    )
  ]);
}

function collect(stream: ReturnType<typeof renderToStream>) {
  return withTimeout(
    new Promise<string>(resolve => {
      let html = "";
      stream.pipe({
        write: (chunk: string) => (html += chunk),
        end: () => resolve(html)
      });
    }),
    "renderToStream"
  );
}

// The outer <Suspense> tracks `count` (read in the component body), so it re-renders `Page`
// when `count` resolves. The inner <Suspense> waits on `list`.
function createApp(countDelay: number, listDelay: number) {
  let renders = 0;
  function Page() {
    const render = ++renders;
    const [count] = createResource(() => after(countDelay, 21), { initialValue: 0 });
    const [list] = createResource(() => after(listDelay, ["a", "b"]), {
      initialValue: [] as string[]
    });
    const doubled = createMemo(() => count() * 2);
    return createComponent(Suspense, {
      fallback: "loading list",
      get children() {
        return `render=${render} count=${count()} doubled=${doubled()} list=${list().length}`;
      }
    });
  }
  return () =>
    createComponent(Suspense, {
      fallback: "loading page",
      get children() {
        return createComponent(Page, {});
      }
    });
}

const strip = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>|<!--[\s\S]*?-->|<template[\s\S]*?<\/template>/g, "");

describe("nested <Suspense> on the server", () => {
  describe.each([
    ["the outer resource resolves first", 10, 50],
    ["the inner resource resolves first", 50, 10]
  ])("when %s", (_, countDelay, listDelay) => {
    test("renderToStringAsync renders the inner boundary from the latest render", async () => {
      const html = await withTimeout(
        renderToStringAsync(createApp(countDelay, listDelay)),
        "renderToStringAsync"
      );
      expect(strip(html)).toContain("render=2 count=21 doubled=42 list=2");
    });

    test("renderToStream renders the inner boundary from the latest render", async () => {
      const html = await collect(renderToStream(createApp(countDelay, listDelay)));
      expect(html).toContain("render=2 count=21 doubled=42 list=2");
      expect(html).not.toContain("render=1");
    });
  });
});
