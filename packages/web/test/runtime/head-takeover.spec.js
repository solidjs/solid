/**
 * @vitest-environment jsdom
 *
 * Client registry initialization against server-retitled shell markup
 * (docs/head-management-rfc.md): when the server rewrote a static shell
 * <title> — byte rewrite in document mode, retitle script in embedded mode,
 * or a late boundary's "t" op — the element arrives marked (`data-dh`) with
 * the original static text stashed on `data-dhf`. The registry must adopt
 * the stash as its fallback and restore it — stripping both attributes —
 * when every title registration disposes.
 *
 * Lives apart from dom/head.spec.js because the registry is a module
 * singleton: this file needs `initHeadRegistry` to run against the
 * server-shaped DOM, not against an unmarked static title.
 */
import * as r from "../../src/client.js";
import { createRoot } from "solid-js";

// Registry applies on a microtask.
const tick = () => Promise.resolve();

beforeAll(() => {
  // Server-shaped shell: the retitle already happened — winner text applied,
  // ownership marked, original static text stashed.
  document.head.innerHTML = '<title data-dh="title" data-dhf="Static">Server Winner</title>';
});

describe("useHead takeover of a server-retitled shell title", () => {
  it("adopts the data-dhf stash as fallback and restores it on full disposal", async () => {
    let dispose;
    createRoot(d => {
      dispose = d;
      // The hydrating route re-registers the same winner: adoption is an
      // in-place, idempotent write on the marked element.
      r.useHead({ tag: "title", props: { children: "Server Winner" } });
    });
    await tick();
    expect(document.title).toBe("Server Winner");
    expect(document.querySelector("title").getAttribute("data-dh")).toBe("title");

    dispose();
    await tick();
    // All registrations gone: the *static shell* text comes back — not the
    // server winner — and the element sheds both registry attributes.
    expect(document.title).toBe("Static");
    const t = document.querySelector("title");
    expect(t.hasAttribute("data-dh")).toBe(false);
    expect(t.hasAttribute("data-dhf")).toBe(false);
  });

  it("client navigation replaces the title and disposal still restores the stash", async () => {
    let dispose;
    createRoot(d => {
      dispose = d;
      r.useHead({ tag: "title", props: { children: "Route B" } });
    });
    await tick();
    expect(document.title).toBe("Route B");

    dispose();
    await tick();
    expect(document.title).toBe("Static");
    expect(document.querySelector("title").hasAttribute("data-dhf")).toBe(false);
  });
});
