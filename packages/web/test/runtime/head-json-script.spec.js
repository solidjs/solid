/**
 * @vitest-environment jsdom
 *
 * Client side of JSON script bodies (application/json, `+json`, importmap,
 * speculationrules): the server writes every `<` in them as `\u003C`, so a
 * server-rendered element's textContent is the escaped text, not the
 * registered children. The registry must claim that element in place
 * instead of removing it and appending a copy, and the elements it creates
 * itself must carry the same text so later applies keep matching them.
 *
 * Lives apart from runtime/head.spec.js because the registry is a module
 * singleton and this file seeds server-shaped head markup.
 */
import * as r from "../../src/client.js";
import { createRoot } from "solid-js";

// Registry applies on a microtask.
const tick = () => Promise.resolve();

const data = { name: "<!--<script>", note: "</script>" };
const raw = JSON.stringify(data);
// The six characters `\u003C`, not the `<` a JS string escape would give.
const escaped = raw.replace(/</g, "\\u003C");

beforeAll(() => {
  document.head.innerHTML = `<script type="application/ld+json" data-dh="script:key:data">${escaped}</script>`;
});

describe("useHead JSON script bodies on the client", () => {
  it("claims the escaped server-rendered element in place", async () => {
    const server = document.head.querySelector('script[data-dh="script:key:data"]');
    let dispose;
    createRoot(d => {
      dispose = d;
      r.useHead({
        tag: "script",
        key: "data",
        props: { type: "application/ld+json", children: raw }
      });
    });
    await tick();
    const scripts = document.head.querySelectorAll('script[data-dh="script:key:data"]');
    expect(scripts.length).toBe(1);
    expect(scripts[0]).toBe(server);
    expect(JSON.parse(scripts[0].textContent)).toEqual(data);

    dispose();
    await tick();
  });

  it("writes the same escaped text into the elements it creates", async () => {
    let dispose;
    createRoot(d => {
      dispose = d;
      r.useHead({ tag: "script", key: "client", props: { type: "importmap", children: raw } });
    });
    await tick();
    const el = document.head.querySelector('script[data-dh="script:key:client"]');
    expect(el.textContent).toBe(escaped);
    expect(JSON.parse(el.textContent)).toEqual(data);

    dispose();
    await tick();
  });

  it("leaves the body of other data blocks as is", async () => {
    let dispose;
    createRoot(d => {
      dispose = d;
      r.useHead([
        { tag: "script", key: "video", props: { type: "video/json", children: "<b>x</b>" } },
        { tag: "script", key: "param", props: { type: "importmap;x", children: "<b>x</b>" } },
        { tag: "script", key: "space", props: { type: " importmap ", children: "<b>x</b>" } },
        { tag: "script", key: "symbol", props: { type: Symbol("plain"), children: "<b>x</b>" } }
      ]);
    });
    await tick();
    for (const key of ["video", "param", "space", "symbol"]) {
      const el = document.head.querySelector(`script[data-dh="script:key:${key}"]`);
      expect(el.textContent).toBe("<b>x</b>");
    }

    dispose();
    await tick();
  });
});
