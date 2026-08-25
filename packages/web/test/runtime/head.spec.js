/**
 * @vitest-environment jsdom
 *
 * Client half of useHead (docs/head-management-rfc.md): last-committed-group
 * resolution, reactive updates keeping their commit position, disposal
 * restoring the previous winner (stack semantics for title), group set
 * replacement, ownership marking, and resource-class acquisition.
 *
 * The registry is a module singleton, so tests share state deliberately:
 * every test disposes its roots and awaits the flush microtask so it leaves
 * the registry empty. The static fallback title is installed before the
 * first registration and stays for the whole file.
 */
import * as r from "../../src/client.js";
import { createRoot, createSignal, flush, createOwner, runWithOwner } from "solid-js";
import { peekNextChildId } from "@solidjs/signals";

// Registry applies on a microtask.
const tick = () => Promise.resolve();

// Attribute-compared link lookup (href values need no selector escaping).
const findLink = href => {
  const links = document.head.querySelectorAll("link");
  for (let i = 0; i < links.length; i++) {
    if (links[i].getAttribute("href") === href) return links[i];
  }
  return null;
};

beforeAll(() => {
  document.head.innerHTML = "<title>Static</title>";
});

describe("useHead client registry", () => {
  it("applies title and meta with ownership markers, and restores on dispose", async () => {
    let dispose;
    createRoot(d => {
      dispose = d;
      r.useHead([
        { tag: "title", props: { children: "Page" } },
        { tag: "meta", props: { name: "description", content: "desc" } }
      ]);
    });
    await tick();
    expect(document.title).toBe("Page");
    const meta = document.head.querySelector('meta[name="description"]');
    expect(meta.getAttribute("content")).toBe("desc");
    expect(meta.getAttribute("data-dh")).toBe("meta:name:description");
    expect(document.querySelector("title").getAttribute("data-dh")).toBe("title");

    dispose();
    await tick();
    // All registrations gone: static fallback restored, owned tags removed.
    expect(document.title).toBe("Static");
    expect(document.querySelector("title").hasAttribute("data-dh")).toBe(false);
    expect(document.head.querySelector('meta[name="description"]')).toBe(null);
  });

  it("keeps the later commit as winner and restores the previous one on dispose", async () => {
    let disposeOuter, disposeInner;
    createRoot(d => {
      disposeOuter = d;
      r.useHead({ tag: "title", props: { children: "Outer" } });
      createRoot(d2 => {
        disposeInner = d2;
        r.useHead({ tag: "title", props: { children: "Inner" } });
      });
    });
    await tick();
    expect(document.title).toBe("Inner");
    expect(document.querySelectorAll("title").length).toBe(1);

    disposeInner();
    await tick();
    // Commit order acts as the stack: previous winner restored.
    expect(document.title).toBe("Outer");

    disposeOuter();
    await tick();
    expect(document.title).toBe("Static");
  });

  it("updates reactively in place without losing commit position", async () => {
    let dispose, setName;
    createRoot(d => {
      dispose = d;
      const [name, set] = createSignal("First");
      setName = set;
      r.useHead({ tag: "title", props: { children: () => name() } });
      r.useHead({ tag: "title", props: { children: "Second" } });
    });
    await tick();
    expect(document.title).toBe("Second");

    // Updating the earlier registration must not promote it to latest.
    setName("First!");
    flush();
    await tick();
    expect(document.title).toBe("Second");

    dispose();
    await tick();
  });

  it("updates a solo reactive registration's rendered tag", async () => {
    let dispose, setDesc;
    createRoot(d => {
      dispose = d;
      const [desc, set] = createSignal("one");
      setDesc = set;
      r.useHead({ tag: "meta", props: { name: "reactive-desc", content: () => desc() } });
    });
    await tick();
    expect(document.head.querySelector('meta[name="reactive-desc"]').getAttribute("content")).toBe(
      "one"
    );

    setDesc("two");
    flush();
    await tick();
    const metas = document.head.querySelectorAll('meta[name="reactive-desc"]');
    expect(metas.length).toBe(1);
    expect(metas[0].getAttribute("content")).toBe("two");

    dispose();
    await tick();
    expect(document.head.querySelector('meta[name="reactive-desc"]')).toBe(null);
  });

  it("replaces an identity set wholesale and restores it on dispose (og:image)", async () => {
    let disposeBase, disposePage;
    createRoot(d => {
      disposeBase = d;
      r.useHead([
        { tag: "meta", props: { property: "og:image", content: "/a.png" } },
        { tag: "meta", props: { property: "og:image", content: "/b.png" } }
      ]);
      createRoot(d2 => {
        disposePage = d2;
        r.useHead({ tag: "meta", props: { property: "og:image", content: "/c.png" } });
      });
    });
    await tick();
    let imgs = [...document.head.querySelectorAll('meta[property="og:image"]')];
    expect(imgs.map(m => m.getAttribute("content"))).toEqual(["/c.png"]);

    disposePage();
    await tick();
    imgs = [...document.head.querySelectorAll('meta[property="og:image"]')];
    expect(imgs.map(m => m.getAttribute("content"))).toEqual(["/a.png", "/b.png"]);

    disposeBase();
    await tick();
    expect(document.head.querySelectorAll('meta[property="og:image"]').length).toBe(0);
  });

  it("mounts resource hints immediately, dedupes them, and never retracts them", async () => {
    let dispose;
    createRoot(d => {
      dispose = d;
      r.useHead({ tag: "link", props: { rel: "preload", href: "/hero.jpg", as: "image" } });
      r.useHead({ tag: "link", props: { rel: "preload", href: "/hero.jpg", as: "image" } });
    });
    // Resources apply synchronously at registration — no microtask needed.
    const links = document.head.querySelectorAll('link[rel="preload"]');
    expect(links.length).toBe(1);
    expect(links[0].getAttribute("as")).toBe("image");

    dispose();
    await tick();
    // Hints stay: retracting a preload is pointless churn.
    expect(document.head.querySelectorAll('link[rel="preload"]').length).toBe(1);
    links[0].remove();
  });

  it("follows the owner for stylesheet resources (warm, gate, flip, ref-counted removal)", async () => {
    vi.useFakeTimers();
    let dispose;
    createRoot(d => {
      dispose = d;
      r.useHead({ tag: "link", props: { rel: "stylesheet", href: "/page.css" } });
    });
    // Warm at discovery: an inert preload starts the fetch while the reveal
    // gate holds ownership — nothing has flipped live yet.
    const link = findLink("/page.css");
    expect(link.getAttribute("rel")).toBe("preload");
    expect(link.getAttribute("as")).toBe("style");

    link.dispatchEvent(new Event("load"));
    await tick();
    expect(link.getAttribute("rel")).toBe("stylesheet");
    expect(link.hasAttribute("as")).toBe(false);

    dispose();
    await tick();
    vi.runAllTimers();
    expect(link.isConnected).toBe(false);
    vi.useRealTimers();
  });

  it("ignores base/charset on the client (shell-only identities)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let dispose;
    createRoot(d => {
      dispose = d;
      r.useHead({ tag: "base", props: { href: "/nope/" } });
    });
    await tick();
    expect(document.head.querySelector("base")).toBe(null);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("shell-only"));
    warn.mockRestore();
    dispose();
    await tick();
  });

  it("warns on and skips non-head tags", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let dispose;
    createRoot(d => {
      dispose = d;
      r.useHead({ tag: "div", props: { id: "nope" } });
    });
    await tick();
    expect(document.head.querySelector("div")).toBe(null);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    dispose();
    await tick();
  });

  it("re-reads reactive group membership (function form)", async () => {
    let dispose, setTags;
    createRoot(d => {
      dispose = d;
      const [tags, set] = createSignal([
        { tag: "meta", props: { property: "og:image", content: "/a.png" } }
      ]);
      setTags = set;
      r.useHead(() => tags());
    });
    await tick();
    let imgs = [...document.head.querySelectorAll('meta[property="og:image"]')];
    expect(imgs.map(m => m.getAttribute("content"))).toEqual(["/a.png"]);

    setTags([
      { tag: "meta", props: { property: "og:image", content: "/a.png" } },
      { tag: "meta", props: { property: "og:image", content: "/b.png" } }
    ]);
    flush();
    await tick();
    imgs = [...document.head.querySelectorAll('meta[property="og:image"]')];
    expect(imgs.map(m => m.getAttribute("content"))).toEqual(["/a.png", "/b.png"]);

    setTags([]);
    flush();
    await tick();
    expect(document.head.querySelectorAll('meta[property="og:image"]').length).toBe(0);

    dispose();
    await tick();
  });

  it("keeps a reactive group's commit position across membership changes", async () => {
    let dispose, setTags;
    createRoot(d => {
      dispose = d;
      const [tags, set] = createSignal([{ tag: "title", props: { children: "Group" } }]);
      setTags = set;
      r.useHead(() => tags());
      r.useHead({ tag: "title", props: { children: "Later" } });
    });
    await tick();
    expect(document.title).toBe("Later");

    // A membership change must not promote the group past later commits.
    setTags([{ tag: "title", props: { children: "Group!" } }]);
    flush();
    await tick();
    expect(document.title).toBe("Later");

    dispose();
    await tick();
    expect(document.title).toBe("Static");
  });

  it("forks meta identity by media (theme-color light/dark coexist)", async () => {
    let dispose;
    createRoot(d => {
      dispose = d;
      r.useHead({
        tag: "meta",
        props: { name: "theme-color", media: "(prefers-color-scheme: light)", content: "#fff" }
      });
      r.useHead({
        tag: "meta",
        props: { name: "theme-color", media: "(prefers-color-scheme: dark)", content: "#000" }
      });
      // Same name + same media still dedupes last-wins.
      r.useHead({
        tag: "meta",
        props: { name: "theme-color", media: "(prefers-color-scheme: dark)", content: "#111" }
      });
    });
    await tick();
    const metas = [...document.head.querySelectorAll('meta[name="theme-color"]')];
    expect(metas.map(m => m.getAttribute("content")).sort()).toEqual(["#111", "#fff"]);

    dispose();
    await tick();
    expect(document.head.querySelectorAll('meta[name="theme-color"]').length).toBe(0);
  });

  it("treats icons as replaceable: a swapped href replaces, dispose restores", async () => {
    let disposeBase, disposePage;
    createRoot(d => {
      disposeBase = d;
      r.useHead({ tag: "link", props: { rel: "icon", href: "/favicon.ico" } });
      createRoot(d2 => {
        disposePage = d2;
        r.useHead({ tag: "link", props: { rel: "icon", href: "/favicon-alert.ico" } });
      });
    });
    await tick();
    let icons = [...document.head.querySelectorAll('link[rel="icon"]')];
    expect(icons.map(l => l.getAttribute("href"))).toEqual(["/favicon-alert.ico"]);

    disposePage();
    await tick();
    icons = [...document.head.querySelectorAll('link[rel="icon"]')];
    expect(icons.map(l => l.getAttribute("href"))).toEqual(["/favicon.ico"]);

    disposeBase();
    await tick();
    expect(document.head.querySelectorAll('link[rel="icon"]').length).toBe(0);
  });

  it("keeps icon variants (sizes/type/rel) as separate identities", async () => {
    let dispose;
    createRoot(d => {
      dispose = d;
      r.useHead([
        { tag: "link", props: { rel: "icon", href: "/favicon.ico", sizes: "32x32" } },
        { tag: "link", props: { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" } },
        { tag: "link", props: { rel: "apple-touch-icon", href: "/apple.png" } }
      ]);
    });
    await tick();
    expect(document.head.querySelectorAll('link[rel="icon"]').length).toBe(2);
    expect(document.head.querySelectorAll('link[rel="apple-touch-icon"]').length).toBe(1);

    dispose();
    await tick();
    expect(
      document.head.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').length
    ).toBe(0);
  });

  it("leaves foreign head content alone", async () => {
    const foreign = document.createElement("meta");
    foreign.setAttribute("name", "third-party");
    foreign.setAttribute("content", "keep");
    document.head.appendChild(foreign);

    let dispose;
    createRoot(d => {
      dispose = d;
      r.useHead({ tag: "meta", props: { name: "mine", content: "x" } });
    });
    await tick();
    dispose();
    await tick();
    expect(foreign.isConnected).toBe(true);
    foreign.remove();
  });
});

// Client CSS reveal gating (docs/client-css-reveal-gating.md): a gateable
// useHead stylesheet warms at discovery (inert preload — the fetch overlaps
// any data wait) and reads as not-ready until it settles, holding commit;
// acquire flips the preload live. Load state is observed through jsdom by
// dispatching link load/error events.
describe("useHead stylesheet reveal gating", () => {
  it("gates acquisition on load while replaceable tags apply un-gated", async () => {
    let dispose;
    createRoot(d => {
      dispose = d;
      r.useHead([
        { tag: "title", props: { children: "Gated Page" } },
        { tag: "link", props: { rel: "stylesheet", href: "/gate-a.css" } }
      ]);
    });
    await tick();
    // Title lives in the group computation, CSS in a per-resource one:
    // title/meta never wait on a stylesheet fetch.
    expect(document.title).toBe("Gated Page");
    const link = findLink("/gate-a.css");
    expect(link.getAttribute("rel")).toBe("preload");
    expect(link.getAttribute("as")).toBe("style");

    link.dispatchEvent(new Event("load"));
    await tick();
    expect(link.getAttribute("rel")).toBe("stylesheet");
    expect(link.hasAttribute("as")).toBe(false);

    dispose();
    await tick();
    link.remove();
  });

  it("releases the gate on error (parity with the server gate's onerror)", async () => {
    let dispose;
    createRoot(d => {
      dispose = d;
      r.useHead({ tag: "link", props: { rel: "stylesheet", href: "/gate-err.css" } });
    });
    const link = findLink("/gate-err.css");
    expect(link.getAttribute("rel")).toBe("preload");

    link.dispatchEvent(new Event("error"));
    await tick();
    // An errored sheet must not hold the reveal forever — ownership is
    // still taken and the link flips live.
    expect(link.getAttribute("rel")).toBe("stylesheet");

    dispose();
    await tick();
    link.remove();
  });

  it("adds no wait for an already-loaded sheet (second owner acquires synchronously)", async () => {
    vi.useFakeTimers();
    let dispose1, dispose2;
    createRoot(d => {
      dispose1 = d;
      r.useHead({ tag: "link", props: { rel: "stylesheet", href: "/gate-cached.css" } });
    });
    const link = findLink("/gate-cached.css");
    link.dispatchEvent(new Event("load"));
    await tick();
    expect(link.getAttribute("rel")).toBe("stylesheet");

    createRoot(d => {
      dispose2 = d;
      r.useHead({ tag: "link", props: { rel: "stylesheet", href: "/gate-cached.css" } });
    });
    // The second owner's acquire ran synchronously (settled promise, no
    // retry): releasing the first owner leaves the sheet held by the second.
    dispose1();
    await tick();
    vi.runAllTimers();
    expect(link.isConnected).toBe(true);

    dispose2();
    await tick();
    vi.runAllTimers();
    expect(link.isConnected).toBe(false);
    vi.useRealTimers();
  });

  it("does not gate condition-qualified sheets (media)", async () => {
    let dispose;
    createRoot(d => {
      dispose = d;
      r.useHead({
        tag: "link",
        props: { rel: "stylesheet", href: "/gate-print.css", media: "print" }
      });
    });
    // Warmed, but never gated: acquisition happened in the same flush.
    const link = findLink("/gate-print.css");
    expect(link.getAttribute("rel")).toBe("stylesheet");
    expect(link.getAttribute("media")).toBe("print");

    dispose();
    await tick();
    link.remove();
  });

  it("keeps fetch-metadata sheets gateable and carries qualifiers through the flip", async () => {
    let dispose;
    createRoot(d => {
      dispose = d;
      r.useHead({
        tag: "link",
        props: { rel: "stylesheet", href: "/gate-cors.css", crossorigin: "anonymous" }
      });
    });
    const link = findLink("/gate-cors.css");
    // crossorigin is pure fetch metadata: still gated, and the qualifier
    // must ride the preload or the flip would bypass the preload cache.
    expect(link.getAttribute("rel")).toBe("preload");
    expect(link.getAttribute("crossorigin")).toBe("anonymous");

    link.dispatchEvent(new Event("load"));
    await tick();
    expect(link.getAttribute("rel")).toBe("stylesheet");
    expect(link.getAttribute("crossorigin")).toBe("anonymous");

    dispose();
    await tick();
    link.remove();
  });

  it("leaves only an inert preload when a branch is disposed before commit", async () => {
    let dispose;
    createRoot(d => {
      dispose = d;
      r.useHead({ tag: "link", props: { rel: "stylesheet", href: "/gate-zombie.css" } });
    });
    const link = findLink("/gate-zombie.css");
    expect(link.getAttribute("rel")).toBe("preload");

    // Superseded before the sheet settled: the cancelled apply never
    // acquires, so the load must not flip anything live.
    dispose();
    await tick();
    link.dispatchEvent(new Event("load"));
    await tick();
    expect(link.getAttribute("rel")).toBe("preload");
    link.remove();
  });

  it("adopts a server-emitted stylesheet as loaded — no re-fetch, no gate stall", async () => {
    vi.useFakeTimers();
    const ssr = document.createElement("link");
    ssr.setAttribute("rel", "stylesheet");
    ssr.setAttribute("href", "/gate-ssr.css");
    // A server-emitted sheet is loaded by reveal time; jsdom never loads
    // resources, so model the loaded state directly.
    Object.defineProperty(ssr, "sheet", { value: {} });
    document.head.appendChild(ssr);

    let dispose;
    createRoot(d => {
      dispose = d;
      r.useHead({ tag: "link", props: { rel: "stylesheet", href: "/gate-ssr.css" } });
    });
    // Adopted in place and acquired synchronously: one element, no preload.
    const links = document.head.querySelectorAll("link");
    let count = 0;
    for (let i = 0; i < links.length; i++) {
      if (links[i].getAttribute("href") === "/gate-ssr.css") count++;
    }
    expect(count).toBe(1);
    expect(ssr.getAttribute("rel")).toBe("stylesheet");

    dispose();
    await tick();
    vi.runAllTimers();
    expect(ssr.isConnected).toBe(false);
    vi.useRealTimers();
  });

  it("adopts a hand-authored preload and flips it at commit", async () => {
    const manual = document.createElement("link");
    manual.setAttribute("rel", "preload");
    manual.setAttribute("as", "style");
    manual.setAttribute("href", "/gate-manual.css");
    document.head.appendChild(manual);

    let dispose;
    createRoot(d => {
      dispose = d;
      r.useHead({ tag: "link", props: { rel: "stylesheet", href: "/gate-manual.css" } });
    });
    // No duplicate mount; the gate rides the existing preload's load.
    expect(findLink("/gate-manual.css")).toBe(manual);
    expect(manual.getAttribute("rel")).toBe("preload");

    manual.dispatchEvent(new Event("load"));
    await tick();
    expect(manual.getAttribute("rel")).toBe("stylesheet");
    expect(manual.hasAttribute("as")).toBe(false);

    dispose();
    await tick();
    manual.remove();
  });

  it("stamps blocking=render on links warmed before the document has a body", async () => {
    const body = document.body;
    body.remove();
    let dispose;
    try {
      createRoot(d => {
        dispose = d;
        r.useHead({ tag: "link", props: { rel: "stylesheet", href: "/gate-prepaint.css" } });
      });
    } finally {
      document.documentElement.appendChild(body);
    }
    const link = findLink("/gate-prepaint.css");
    expect(link.getAttribute("blocking")).toBe("render");

    dispose();
    await tick();
    link.remove();
  });

  it("warms modulepreload links at discovery without gating", async () => {
    let dispose;
    createRoot(d => {
      dispose = d;
      r.useHead({ tag: "link", props: { rel: "modulepreload", href: "/gate-chunk.js" } });
    });
    const link = findLink("/gate-chunk.js");
    // Never gated: warmed and acquired in the same flush.
    expect(link.getAttribute("rel")).toBe("modulepreload");

    dispose();
    await tick();
    link.remove();
  });

  it("consumes no hydration id slots (server/client id alignment)", async () => {
    // Server useHead creates zero owners (pure registration into the render
    // context), so the client half must be id-neutral too or every id
    // allocated after a useHead call desyncs from the server's. The group
    // effect and the per-resource gating computations are transparent
    // (render `effect` without `scope`) — they inherit the enclosing owner's
    // id without consuming a child slot — and the seam's gate node is
    // created detached. Pin that: the owner's child counter must not move
    // across registration, the gated flush, a settle retry, or a reactive
    // membership rerun that recreates the per-resource computations.
    let dispose, setTags, owner;
    let before, after;
    createRoot(d => {
      dispose = d;
      owner = createOwner({ id: "h0" });
      runWithOwner(owner, () => {
        const [tags, set] = createSignal([
          { tag: "title", props: { children: "Id Neutral" } },
          { tag: "link", props: { rel: "stylesheet", href: "/gate-ids.css" } },
          { tag: "link", props: { rel: "preload", href: "/gate-ids.png", as: "image" } },
          { tag: "link", props: { rel: "modulepreload", href: "/gate-ids.js" } }
        ]);
        setTags = set;
        before = peekNextChildId(owner);
        r.useHead(() => tags());
        after = peekNextChildId(owner);
      });
    });
    expect(after).toBe(before);
    // The per-resource computation really ran under this owner (not vacuous).
    const link = findLink("/gate-ids.css");
    expect(link.getAttribute("rel")).toBe("preload");
    expect(peekNextChildId(owner)).toBe(before);

    // Settle retry (gate release) allocates nothing.
    link.dispatchEvent(new Event("load"));
    await tick();
    expect(link.getAttribute("rel")).toBe("stylesheet");
    expect(peekNextChildId(owner)).toBe(before);

    // Membership rerun disposes and recreates the per-resource computations.
    setTags([
      { tag: "title", props: { children: "Id Neutral!" } },
      { tag: "link", props: { rel: "stylesheet", href: "/gate-ids.css" } }
    ]);
    flush();
    await tick();
    expect(peekNextChildId(owner)).toBe(before);

    dispose();
    await tick();
    link.remove();
    const hint = findLink("/gate-ids.png");
    hint && hint.remove();
    const mod = findLink("/gate-ids.js");
    mod && mod.remove();
  });
});
