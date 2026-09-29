/**
 * @jsxImportSource @solidjs/web
 *
 * `lazy()`'s `preload()` and `moduleUrl` × concurrent renders. Both are
 * called outside the component's own render — a router warming a route, a
 * route data function, an island renderer reading the chunk URL, code after
 * an `await` — and both register the module's assets into a render. The
 * module-global `sharedConfig.context` is whichever render started (or
 * finished) last, so registering into it can put this request's links into
 * another request's page. The render a call belongs to is the caller's own,
 * found through its owner, or none.
 *
 * Each request resolves through its own manifest, so a link or a URL names
 * the render that resolved it.
 */
import { describe, expect, test } from "vitest";
import { renderToStream, renderToString } from "@solidjs/web";
import { createMemo, getOwner, lazy, runWithOwner, type Owner } from "solid-js";

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

const Widget = () => <em>widget</em>;
const LazyWidget = lazy(async () => ({ default: Widget }), undefined, "./Widget.tsx");

const manifestFor = (name: string) => ({
  "./Widget.tsx": { file: `assets/Widget-${name}.js` }
});

function Doc(props: { name: string; children?: any }) {
  return (
    <html>
      <head>
        <title>{props.name}</title>
      </head>
      <body>{props.children}</body>
    </html>
  );
}

// A document whose shell waits on root-level async work. `work` runs in the
// continuation after `holdMs` — no render on the stack, the global context
// possibly another request's — with the page's owner captured before the
// `await`.
function stream(name: string, holdMs: number, work: (owner: Owner) => void = () => {}) {
  return new Promise<string>(resolve => {
    renderToStream(
      () => {
        function Page() {
          const owner = getOwner()!;
          const data = createMemo(async () => {
            await delay(holdMs);
            work(owner);
            return name;
          });
          return <p>{data()}</p>;
        }
        return (
          <Doc name={name}>
            <Page />
          </Doc>
        );
      },
      { manifest: manifestFor(name) }
    ).then(resolve);
  });
}

// A starts, B starts while A is suspended; A's `work` runs while B's render
// is the global context and B's head is still open.
async function interleaved(work: (owner: Owner) => void) {
  const a = stream("A", 10, work);
  await delay(3);
  const b = stream("B", 30);
  const [htmlA, htmlB] = await Promise.all([a, b]);
  expect(htmlA).toMatch(/<p[^>]*>A<\/p>/);
  expect(htmlB).toMatch(/<p[^>]*>B<\/p>/);
  return { a: htmlA, b: htmlB };
}

describe("lazy().preload() outside the component's render", () => {
  test("with its render's owner after an await: hints into that render, not the other request's", async () => {
    const { a, b } = await interleaved(owner => {
      runWithOwner(owner, () => LazyWidget.preload());
    });
    expect(a).toContain('<link rel="modulepreload" href="/assets/Widget-A.js">');
    expect(b).not.toContain("Widget-");
  });

  test("with no owner (a route data function outside any render): hints into no render", async () => {
    const { a, b } = await interleaved(() => {
      LazyWidget.preload();
    });
    expect(a).not.toContain("Widget-");
    expect(b).not.toContain("Widget-");
  });

  test("in the component body during its render pass: hints into its own render", async () => {
    // Guard: the synchronous pass is its own render's either way.
    const b = stream("B", 30);
    await delay(3);
    const a = renderToString(
      () => {
        function Page() {
          LazyWidget.preload();
          return <p>A</p>;
        }
        return (
          <Doc name="A">
            <Page />
          </Doc>
        );
      },
      { manifest: manifestFor("A") }
    );
    expect(a).toContain('<link rel="modulepreload" href="/assets/Widget-A.js">');
    expect(await b).not.toContain("Widget-");
  });
});

describe("lazy().moduleUrl read outside the component's render", () => {
  test("with its render's owner after an await: that render's URL and hint", async () => {
    let url: string | undefined;
    const { a, b } = await interleaved(owner => {
      url = runWithOwner(owner, () => LazyWidget.moduleUrl);
    });
    expect(url).toBe("/assets/Widget-A.js");
    expect(a).toContain('<link rel="modulepreload" href="/assets/Widget-A.js">');
    expect(b).not.toContain("Widget-");
  });

  test("with no owner: the raw specifier, and no render hinted", async () => {
    let url: string | undefined;
    const { a, b } = await interleaved(() => {
      url = LazyWidget.moduleUrl;
    });
    expect(url).toBe("./Widget.tsx");
    expect(a).not.toContain("Widget-");
    expect(b).not.toContain("Widget-");
  });

  test("after another request's string render finished: not resolved through its manifest", () => {
    renderToString(() => <Doc name="B" />, { manifest: manifestFor("B") });
    expect(LazyWidget.moduleUrl).toBe("./Widget.tsx");
  });
});
