/**
 * @vitest-environment jsdom
 *
 * The stylesheet gate of streamed fragments (#3747). A fragment whose boundary
 * registered stylesheet links swaps in once every link has loaded or failed.
 * The links carry `data-dfc` and a capture-phase listener installed by the
 * fragment helpers counts them down, so a strict `script-src` CSP (nonce, no
 * 'unsafe-inline') can't block the gate the way it blocks inline `onload`
 * handlers. The content template is written ahead of the links, so a sheet
 * that loads as soon as its link is parsed still finds the template.
 */
import * as r from "../../src/server.js";
import { sharedConfig } from "solid-js/internal";

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

// Streams one post-shell fragment whose boundary registered `links`.
function renderGatedFragment(links, options) {
  let done;
  return pipeToString(
    r.renderToStream(() => {
      const ctx = sharedConfig.context;
      done = ctx.registerFragment("gated");
      setTimeout(() => {
        ctx._currentBoundaryId = "gated";
        for (const href of links) ctx.registerAsset("style", href);
        ctx._currentBoundaryId = null;
        done('<span id="content">content</span>');
      }, 10);
      return r.ssr`<div><template id="pl-gated"></template><span id="fallback">fallback</span><!--pl-gated--></div>`;
    }, options)
  );
}

const SCRIPT = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;

// What the parser has seen right after the last stylesheet link: anything
// written later in the stream hasn't been parsed yet when a cached sheet
// fires load.
function throughLastLink(html) {
  return html.slice(0, html.indexOf(">", html.lastIndexOf('<link rel="stylesheet"')) + 1);
}

// Markup into the document, then each inline script evaluated in global
// scope, the way the stream's scripts run.
function apply(container, html) {
  const scripts = [...html.matchAll(SCRIPT)].map(m => m[1]);
  container.insertAdjacentHTML("beforeend", html.replace(SCRIPT, ""));
  for (const script of scripts) (0, eval)(script);
  return scripts;
}

describe("streamed fragment stylesheet gate", () => {
  let container;
  let listeners;

  beforeEach(() => {
    globalThis._$HY = { r: {}, fe() {} };
    container = document.createElement("div");
    document.body.appendChild(container);
    // The helpers install their gate listener on the shared jsdom document;
    // record each one so a test only sees the listeners its own scripts added.
    listeners = [];
    const add = document.addEventListener.bind(document);
    vi.spyOn(document, "addEventListener").mockImplementation((...args) => {
      listeners.push(args);
      add(...args);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const args of listeners) document.removeEventListener(...args);
    container.remove();
    delete globalThis._$HY;
  });

  it("marks gated links with data-dfc instead of inline handlers", async () => {
    const html = await renderGatedFragment(["/a.css", "/b.css"]);
    expect(html).toContain('$dfs("gated",2,0)');
    expect(html).toContain('<link rel="stylesheet" href="/a.css" data-dfc="gated">');
    expect(html).toContain('<link rel="stylesheet" href="/b.css" data-dfc="gated">');
    expect(html).not.toMatch(/\son(?:load|error)=/);
  });

  it("installs the gate listener from a script that carries the nonce", async () => {
    const html = await renderGatedFragment(["/a.css"], { nonce: "abc" });
    expect(html).toMatch(
      /<script nonce="abc">(?:(?!<\/script>)[\s\S])*document\.addEventListener\("load",\$dfe,!0\);document\.addEventListener\("error",\$dfe,!0\)/
    );
  });

  it("writes the template after the gate and ahead of its links", async () => {
    const html = await renderGatedFragment(["/a.css"]);
    const gate = html.indexOf('$dfs("gated"');
    const template = html.indexOf('<template id="gated">');
    const link = html.indexOf('href="/a.css"');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(template);
    expect(template).toBeLessThan(link);
  });

  it("reveals the fragment once every sheet settles, from loads fired as soon as the links are parsed", async () => {
    const html = await renderGatedFragment(["/a.css", "/b.css"]);
    apply(container, throughLastLink(html));
    const [a, b] = container.querySelectorAll('link[rel="stylesheet"]');

    a.dispatchEvent(new Event("load"));
    expect(container.querySelector("#content")).toBeNull();
    expect(container.querySelector("#fallback")).not.toBeNull();

    // A failed sheet releases the gate too.
    b.dispatchEvent(new Event("error"));
    expect(container.querySelector("#content")).not.toBeNull();
    expect(container.querySelector("#fallback")).toBeNull();
  });

  it("counts each link once, even with a listener from another render's script", async () => {
    const html = await renderGatedFragment(["/a.css", "/b.css"]);
    const scripts = apply(container, throughLastLink(html));
    // A second render's copy of the helpers installs another listener.
    for (const script of scripts) (0, eval)(script);
    const [a, b] = container.querySelectorAll('link[rel="stylesheet"]');

    a.dispatchEvent(new Event("load"));
    a.dispatchEvent(new Event("load"));
    expect(container.querySelector("#content")).toBeNull();

    b.dispatchEvent(new Event("load"));
    expect(container.querySelector("#content")).not.toBeNull();
  });
});
