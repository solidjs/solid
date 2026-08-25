/**
 * @vitest-environment jsdom
 *
 * The "inline-style" asset type carries CSS content instead of a URL —
 * primarily dev-mode CSS collected from the bundler's module graph, where no
 * .css file exists to link. Entries dedupe by id, emit as <style data-asset>
 * tags (in <head> for anything known before the shell flushes, inline in the
 * stream for late boundary styles), and never participate in $dfs load
 * gating since a parsed <style> is already applied.
 */
import * as r from "../../src/server.js";
import { sharedConfig } from "solid-js";

globalThis.TextEncoder = function () {
  return { encode: v => v };
};

function pipeToString(stream) {
  return new Promise(resolve => {
    const chunks = [];
    stream.pipe({
      write(v) {
        chunks.push(v);
      },
      end() {
        resolve(chunks.join(""));
      }
    });
  });
}

describe("renderToString inline-style assets", () => {
  it("injects registered inline styles into <head>", () => {
    const html = r.renderToString(() => {
      sharedConfig.context.registerAsset("inline-style", {
        id: "/src/routes/Home.css",
        content: ".home{color:red}"
      });
      return r.ssr`<html><head></head><body><div>x</div></body></html>`;
    });
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toContain('<style data-asset="/src/routes/Home.css">.home{color:red}</style>');
  });

  it("dedupes repeated registrations by id", () => {
    const html = r.renderToString(() => {
      const ctx = sharedConfig.context;
      ctx.registerAsset("inline-style", { id: "dup.css", content: ".a{}" });
      ctx.registerAsset("inline-style", { id: "dup.css", content: ".a{}" });
      return r.ssr`<html><head></head><body><div>x</div></body></html>`;
    });
    expect(html.split('data-asset="dup.css"').length - 1).toBe(1);
  });

  it("passes through extra attributes and applies the nonce", () => {
    const html = r.renderToString(
      () => {
        sharedConfig.context.registerAsset("inline-style", {
          id: "dev.css",
          content: ".x{}",
          attrs: { "data-vite-dev-id": "/abs/path/dev.css" }
        });
        return r.ssr`<html><head></head><body><div>x</div></body></html>`;
      },
      { nonce: "n0nce" }
    );
    expect(html).toContain(
      '<style nonce="n0nce" data-asset="dev.css" data-vite-dev-id="/abs/path/dev.css">.x{}</style>'
    );
  });

  it("neutralizes </style> sequences in content", () => {
    const html = r.renderToString(() => {
      sharedConfig.context.registerAsset("inline-style", {
        id: "evil.css",
        content: '.x{content:"</style><script>alert(1)</script>"}'
      });
      return r.ssr`<html><head></head><body><div>x</div></body></html>`;
    });
    expect(html).not.toContain("</style><script>alert(1)</script>");
    expect(html).toContain("<\\/style>");
  });

  it("tracks boundary-attributed inline styles without breaking head emission", () => {
    const html = r.renderToString(() => {
      const ctx = sharedConfig.context;
      ctx._currentBoundaryId = "b1";
      ctx.registerAsset("inline-style", { id: "boundary.css", content: ".b{}" });
      ctx._currentBoundaryId = null;
      return r.ssr`<html><head></head><body><div>x</div></body></html>`;
    });
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toContain('data-asset="boundary.css"');
  });
});

describe("renderToStream inline-style assets", () => {
  it("emits pre-shell inline styles in <head> and does not re-emit them with fragments", async () => {
    let done;
    const html = await pipeToString(
      r.renderToStream(() => {
        const ctx = sharedConfig.context;
        // Registered before the shell flushes, attributed to the boundary —
        // head injection wins and the fragment flush must skip it.
        ctx._currentBoundaryId = "pre";
        ctx.registerAsset("inline-style", { id: "pre.css", content: ".pre{}" });
        ctx._currentBoundaryId = null;
        done = ctx.registerFragment("pre");
        setTimeout(() => done("<span>late</span>"), 10);
        return r.ssr`<html><head></head><body><div><template id="pl-pre"></template><!--pl-pre--></div></body></html>`;
      })
    );
    expect(html.split('data-asset="pre.css"').length - 1).toBe(1);
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toContain('data-asset="pre.css"');
  });

  it("emits post-shell boundary inline styles with the fragment, ungated", async () => {
    let done;
    const html = await pipeToString(
      r.renderToStream(() => {
        const ctx = sharedConfig.context;
        done = ctx.registerFragment("frag");
        setTimeout(() => {
          ctx._currentBoundaryId = "frag";
          ctx.registerAsset("inline-style", { id: "late.css", content: ".late{}" });
          ctx._currentBoundaryId = null;
          done("<span>loaded</span>");
        }, 10);
        return r.ssr`<div><template id="pl-frag"></template><!--pl-frag--></div>`;
      })
    );
    expect(html).toContain('<style data-asset="late.css">.late{}</style>');
    // No stylesheet links → the fragment activates immediately via $df, and
    // no $dfs pending-style count is registered.
    expect(html).toContain('$df("frag")');
    expect(html).not.toContain('$dfs("frag"');
    // The style tag lands before the fragment's template payload.
    expect(html.indexOf('data-asset="late.css"')).toBeLessThan(html.indexOf('<template id="frag"'));
  });

  it("counts only link styles in $dfs when a boundary has both kinds", async () => {
    let done;
    const html = await pipeToString(
      r.renderToStream(() => {
        const ctx = sharedConfig.context;
        done = ctx.registerFragment("mix");
        setTimeout(() => {
          ctx._currentBoundaryId = "mix";
          ctx.registerAsset("style", "/mix-a.css");
          ctx.registerAsset("style", "/mix-b.css");
          ctx.registerAsset("inline-style", { id: "mix-inline.css", content: ".m{}" });
          ctx._currentBoundaryId = null;
          done("<span>mixed</span>");
        }, 10);
        return r.ssr`<div><template id="pl-mix"></template><!--pl-mix--></div>`;
      })
    );
    expect(html).toContain('$dfs("mix",2,0)');
    expect(html).toContain('data-asset="mix-inline.css"');
    expect(html).toContain('href="/mix-a.css"');
    expect(html).toContain('href="/mix-b.css"');
  });

  it("writes late non-boundary inline styles straight into the stream", async () => {
    let done;
    const html = await pipeToString(
      r.renderToStream(() => {
        const ctx = sharedConfig.context;
        done = ctx.registerFragment("nb");
        setTimeout(() => {
          // No boundary attribution — nothing else would flush this entry.
          ctx.registerAsset("inline-style", { id: "global-late.css", content: ".g{}" });
          done("<span>done</span>");
        }, 10);
        return r.ssr`<div><template id="pl-nb"></template><!--pl-nb--></div>`;
      })
    );
    expect(html).toContain('<style data-asset="global-late.css">.g{}</style>');
  });
});
