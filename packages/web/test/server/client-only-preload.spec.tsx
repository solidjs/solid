/**
 * @jsxImportSource @solidjs/web
 */
// The bundler's module-URL pass annotates `clientOnly(() => import("x"))`
// the same way it annotates `lazy()` (padding the options slot, so the URL
// is always the third argument). These tests pin the server half's contract
// for that annotation: the module's assets are emitted as PLAIN link hints
// (modulepreload / stylesheet) so the client fetch can start on HTML
// arrival, and they must NOT enter the serialized hydration asset map — the
// module is not required for hydration (the fallback is what hydrates), so
// filing it there would make the client's "was not preloaded before
// hydration" check lie. `lazy()` renders alongside as the contrast: its
// module legitimately appears in both places.
import { describe, expect, test } from "vitest";
import { renderToStream, clientOnly } from "@solidjs/web";
import { lazy } from "solid-js";

function collect(code: () => any, options?: any): Promise<string> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(code, options).pipe({
      write: (c: string) => chunks.push(c),
      end: () => resolve(chunks.join(""))
    });
  });
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

// The server half never starts the import; this stands in for the browser-only
// module a real call site would dynamically import.
const NeverRendered = (_props: any) => <i>never</i>;

describe("clientOnly preload hints", () => {
  const manifest = {
    "./Chart.tsx": {
      file: "assets/chart.js",
      css: ["assets/chart.css"],
      preloads: [
        {
          href: "assets/chart-font.woff2",
          as: "font" as const,
          type: "font/woff2",
          crossorigin: "" as const
        }
      ]
    },
    "./Widget.tsx": { file: "assets/widget.js" }
  };

  const Document = (props: { children: any }) => (
    <html>
      <head>
        <title>t</title>
      </head>
      <body>{props.children}</body>
    </html>
  );

  test("an annotated clientOnly emits plain link hints but no hydration-map entry", async () => {
    // Third argument as the compiler's module-URL pass injects it.
    const Chart = clientOnly(() => Promise.resolve({ default: NeverRendered }), {}, "./Chart.tsx");
    const Widget = (_props: any) => <b>widget</b>;
    const LazyWidget = lazy(() => Promise.resolve({ default: Widget }), undefined, "./Widget.tsx");

    const html = await collect(
      () => (
        <Document>
          <Chart fallback={<span>fallback</span>} />
          <LazyWidget />
        </Document>
      ),
      { manifest }
    );

    // Plain hints in the head, fallback in the body.
    expect(html).toContain('<link rel="modulepreload" href="/assets/chart.js">');
    expect(html).toContain('<link rel="stylesheet" href="/assets/chart.css">');
    expect(html).toContain(
      '<link rel="preload" href="/assets/chart-font.woff2" as="font" type="font/woff2" crossorigin="">'
    );
    expect(html).toContain("<span");

    // The contrast: lazy's module rides as both the preload link and the
    // serialized hydration-map entry (an `_assets` record), so its URL
    // appears twice. clientOnly's must appear exactly once — the link.
    expect(count(html, "assets/widget.js")).toBe(2);
    expect(count(html, "assets/chart.js")).toBe(1);
  });

  test("multiple instances register the hint once", async () => {
    const Chart = clientOnly(() => Promise.resolve({ default: NeverRendered }), {}, "./Chart.tsx");
    const html = await collect(
      () => (
        <Document>
          <Chart fallback={<span>a</span>} />
          <Chart fallback={<span>b</span>} />
        </Document>
      ),
      { manifest }
    );
    expect(count(html, "assets/chart.js")).toBe(1);
  });

  test("no manifest: annotated clientOnly still renders its fallback (no hints, no throw)", async () => {
    const Chart = clientOnly(() => Promise.resolve({ default: NeverRendered }), {}, "./Chart.tsx");
    const html = await collect(() => (
      <Document>
        <Chart fallback={<span>fallback</span>} />
      </Document>
    ));
    expect(html).toContain("fallback");
    expect(html).not.toContain("modulepreload");
  });

  test("no moduleUrl (untransformed code): behavior unchanged", async () => {
    const Chart = clientOnly(() => Promise.resolve({ default: NeverRendered }));
    const html = await collect(
      () => (
        <Document>
          <Chart fallback={<span>fallback</span>} />
        </Document>
      ),
      { manifest }
    );
    expect(html).toContain("fallback");
    expect(html).not.toContain("assets/chart.js");
  });
});
