/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Element claims fire AFTER an element's initial attributes are applied, and
 * compiler-owned writes to a consumer-declared attribute set re-claim (#3923).
 *
 * The consumer half is a router's link-state layer: it is told about each
 * `a[href]` / `form[action]` once per mount — with the attributes it will
 * manage already applied — and again whenever a compiler-owned write lands
 * on an attribute it declared (`href`/`action` by default). Handlers run
 * under the element's creating owner, so per-element state scoped with
 * `onCleanup` disposes with the element.
 */
import { afterEach, describe, expect, test } from "vitest";
import { createMemo, createRoot, createSignal, flush, getOwner, onCleanup, Show } from "solid-js";
import { Dynamic, registerElementClaim, render } from "@solidjs/web";

const delay = <T = void,>(ms: number, value?: T) =>
  new Promise<T>(r => setTimeout(r, ms, value as T));

type Seen = { el: Element; attrs: Record<string, string | null>; owner: boolean };

function snapshot(el: Element): Record<string, string | null> {
  const attrs: Record<string, string | null> = {};
  for (const name of ["href", "action", "target", "rel", "download", "title"])
    attrs[name] = el.getAttribute(name);
  return attrs;
}

// A recording consumer: every claim is logged with the attributes the handler
// observed at claim time and whether it ran under an owner.
function recorder(options?: { attributes?: readonly string[] }) {
  const seen: Seen[] = [];
  const unregister = registerElementClaim(el => {
    seen.push({ el, attrs: snapshot(el), owner: getOwner() !== null });
  }, options);
  cleanups.push(unregister);
  return { seen, unregister, hrefs: () => seen.map(s => s.attrs.href) };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.body.innerHTML = "";
});

function mount(fn: () => any) {
  const div = document.createElement("div");
  document.body.appendChild(div);
  const dispose = render(fn, div);
  cleanups.push(dispose);
  return div;
}

describe("element claims fire after initial attributes (#3923)", () => {
  test("a static anchor is claimed with its attributes", () => {
    const r = recorder();
    mount(() => <a href="/static">static</a>);
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0].attrs.href).toBe("/static");
    expect(r.seen[0].owner).toBe(true);
  });

  test("dynamic href/target/rel/download are applied before the mount claim", () => {
    const r = recorder();
    const [href] = createSignal("/docs");
    const [target] = createSignal("_blank");
    const [rel] = createSignal("noopener");
    const [download] = createSignal("guide.pdf");
    const div = mount(() => (
      <a href={href()} target={target()} rel={rel()} download={download()}>
        docs
      </a>
    ));
    const a = div.querySelector("a")!;
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0].el).toBe(a);
    expect(r.seen[0].attrs).toMatchObject({
      href: "/docs",
      target: "_blank",
      rel: "noopener",
      download: "guide.pdf"
    });
    expect(r.seen[0].owner).toBe(true);
  });

  test("a single dynamic binding is applied before the claim", () => {
    const r = recorder();
    const [href] = createSignal("/one");
    mount(() => <a href={href()}>one</a>);
    expect(r.hrefs()).toEqual(["/one"]);
  });

  test("a dynamic form action is applied before the claim", () => {
    const r = recorder();
    const [action] = createSignal("/submit");
    mount(() => <form action={action()} method="post" />);
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0].attrs.action).toBe("/submit");
  });

  test("a non-reactive expression href is applied before the claim", () => {
    const r = recorder();
    const base = "/base";
    mount(() => <a href={base + "/path"}>path</a>);
    expect(r.hrefs()).toEqual(["/base/path"]);
  });

  test("nested anchors in one template each claim once, after their own bindings", () => {
    const r = recorder();
    const [first] = createSignal("/first");
    const [title] = createSignal("t");
    const div = mount(() => (
      <div>
        <a href={first()}>first</a>
        <span title={title()} />
        <a href="/second">second</a>
      </div>
    ));
    const anchors = Array.from(div.querySelectorAll("a"));
    expect(r.seen.map(s => s.el)).toEqual(expect.arrayContaining(anchors));
    expect(r.seen).toHaveLength(2);
    expect(r.hrefs().sort()).toEqual(["/first", "/second"]);
  });

  test("late mount under <Show> claims once with final attributes under the branch owner", () => {
    const r = recorder();
    const cleaned: string[] = [];
    cleanups.push(
      registerElementClaim(el => {
        const href = el.getAttribute("href")!;
        onCleanup(() => cleaned.push(href));
      })
    );
    const [show, setShow] = createSignal(false);
    const [href] = createSignal("/late");
    const [target] = createSignal("_self");
    mount(() => (
      <Show when={show()}>
        <a href={href()} target={target()}>
          late
        </a>
      </Show>
    ));
    expect(r.seen).toHaveLength(0);
    setShow(true);
    flush();
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0].attrs).toMatchObject({ href: "/late", target: "_self" });
    expect(r.seen[0].owner).toBe(true);
    expect(cleaned).toEqual([]);
    setShow(false);
    flush();
    // The claim ran under the branch's owner: its onCleanup fires with the branch.
    expect(cleaned).toEqual(["/late"]);
  });

  test("a held mount (branch gated by an async read) claims once at landing under its owner", async () => {
    const r = recorder();
    const cleaned: string[] = [];
    cleanups.push(
      registerElementClaim(el => {
        const href = el.getAttribute("href")!;
        onCleanup(() => cleaned.push(href));
      })
    );
    const [show, setShow] = createSignal(false);
    const [href] = createSignal("/held");
    const div = mount(() => {
      const gate = createMemo(() => delay(40, show()));
      return (
        <Show when={gate()}>
          <a href={href()} target="_blank">
            held
          </a>
        </Show>
      );
    });
    await delay(60);
    flush();
    expect(r.seen).toHaveLength(0);
    setShow(true);
    flush();
    // The branch is held behind the async gate — nothing mounted, no claim.
    expect(div.querySelector("a")).toBeNull();
    expect(r.seen).toHaveLength(0);
    await delay(60);
    flush();
    const a = div.querySelector("a")!;
    expect(a).not.toBeNull();
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0].el).toBe(a);
    expect(r.seen[0].attrs).toMatchObject({ href: "/held", target: "_blank" });
    // The landing ran the binding effect ownerless; the claim still carries
    // the owner captured at creation.
    expect(r.seen[0].owner).toBe(true);
    setShow(false);
    flush();
    await delay(60);
    flush();
    expect(div.querySelector("a")).toBeNull();
    expect(cleaned).toEqual(["/held"]);
  });

  test("a spread anchor is claimed after the spread's first application", () => {
    const r = recorder();
    const [href] = createSignal("/spread");
    const props = {
      get href() {
        return href();
      },
      target: "_blank"
    };
    const div = mount(() => <a {...props}>spread</a>);
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0].el).toBe(div.querySelector("a"));
    expect(r.seen[0].attrs).toMatchObject({ href: "/spread", target: "_blank" });
    expect(r.seen[0].owner).toBe(true);
  });

  test("a spread mixed with attributes is claimed once with everything applied", () => {
    const r = recorder();
    const [href] = createSignal("/mixed");
    const rest = { rel: "noreferrer" };
    mount(() => (
      <a href={href()} {...rest} target="_blank">
        mixed
      </a>
    ));
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0].attrs).toMatchObject({ href: "/mixed", rel: "noreferrer", target: "_blank" });
  });

  test('a <Dynamic component="a"> anchor is claimed with its href', () => {
    const r = recorder();
    const [href] = createSignal("/dynamic");
    const div = mount(() => <Dynamic component="a" href={href()} />);
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0].el).toBe(div.querySelector("a"));
    expect(r.seen[0].attrs.href).toBe("/dynamic");
  });

  test("a spread form is claimed after its action is applied", () => {
    const r = recorder();
    const props = { action: "/post", method: "post" as const };
    mount(() => <form {...props} />);
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0].attrs.action).toBe("/post");
  });
});

describe("consumer-declared re-claim attributes", () => {
  test("default set: href and action writes re-claim; other writes do not", () => {
    const r = recorder();
    const [href, setHref] = createSignal("/a");
    const [target, setTarget] = createSignal("_self");
    const [title, setTitle] = createSignal("t1");
    mount(() => (
      <a href={href()} target={target()} title={title()}>
        x
      </a>
    ));
    expect(r.hrefs()).toEqual(["/a"]);
    setTarget("_blank");
    flush();
    expect(r.seen).toHaveLength(1);
    setTitle("t2");
    flush();
    expect(r.seen).toHaveLength(1);
    setHref("/b");
    flush();
    expect(r.hrefs()).toEqual(["/a", "/b"]);
    expect(r.seen[1].attrs.target).toBe("_blank");
  });

  test("declared set: each declared attribute write re-claims, undeclared writes do not", () => {
    const r = recorder({ attributes: ["href", "target", "rel", "download"] });
    const [href, setHref] = createSignal("/a");
    const [target, setTarget] = createSignal("_self");
    const [rel, setRel] = createSignal("noopener");
    const [download, setDownload] = createSignal<string | undefined>(undefined);
    const [title, setTitle] = createSignal("t1");
    mount(() => (
      <a href={href()} target={target()} rel={rel()} download={download()} title={title()}>
        x
      </a>
    ));
    expect(r.seen).toHaveLength(1);
    setTarget("_blank");
    flush();
    expect(r.seen).toHaveLength(2);
    expect(r.seen[1].attrs.target).toBe("_blank");
    setRel("external");
    flush();
    expect(r.seen).toHaveLength(3);
    expect(r.seen[2].attrs.rel).toBe("external");
    setDownload("file.txt");
    flush();
    expect(r.seen).toHaveLength(4);
    expect(r.seen[3].attrs.download).toBe("file.txt");
    setHref("/b");
    flush();
    expect(r.seen).toHaveLength(5);
    // Undeclared: title.
    setTitle("t2");
    flush();
    expect(r.seen).toHaveLength(5);
    // Removing a declared attribute is a write to it too.
    setDownload(undefined);
    flush();
    expect(r.seen).toHaveLength(6);
    expect(r.seen[5].attrs.download).toBeNull();
  });

  test("the write sites consult the union of every registered set", () => {
    const base = recorder();
    const wide = recorder({ attributes: ["href", "target"] });
    const [target, setTarget] = createSignal("_self");
    mount(() => (
      <a href="/u" target={target()}>
        x
      </a>
    ));
    expect(base.seen).toHaveLength(1);
    expect(wide.seen).toHaveLength(1);
    setTarget("_blank");
    flush();
    // Both handlers fire — the union gates the write site; relevance is the
    // consumer's to check.
    expect(base.seen).toHaveLength(2);
    expect(wide.seen).toHaveLength(2);
    wide.unregister();
    setTarget("_top");
    flush();
    // With the wide consumer gone the union shrinks back to the default.
    expect(base.seen).toHaveLength(2);
  });

  test("a declared set without href still re-claims on the declared names only", () => {
    const r = recorder({ attributes: ["target"] });
    const [href, setHref] = createSignal("/a");
    const [target, setTarget] = createSignal("_self");
    mount(() => (
      <a href={href()} target={target()}>
        x
      </a>
    ));
    expect(r.seen).toHaveLength(1);
    setHref("/b");
    flush();
    expect(r.seen).toHaveLength(1);
    setTarget("_blank");
    flush();
    expect(r.seen).toHaveLength(2);
  });

  test("writes before the mount claim never re-claim: one mount is one claim", () => {
    const r = recorder({ attributes: ["href", "target", "rel", "download"] });
    const [href] = createSignal("/a");
    mount(() => (
      <a href={href()} target="_blank" rel="noopener" download="f">
        x
      </a>
    ));
    expect(r.seen).toHaveLength(1);
  });

  test("prop:href through a spread re-claims as href", () => {
    const r = recorder();
    const [href, setHref] = createSignal("https://example.com/a");
    const props = {
      get "prop:href"() {
        return href();
      }
    };
    const div = mount(() => <a {...props}>x</a>);
    const a = div.querySelector("a") as HTMLAnchorElement;
    expect(r.seen).toHaveLength(1);
    expect(a.href).toBe("https://example.com/a");
    setHref("https://example.com/b");
    flush();
    expect(r.seen).toHaveLength(2);
    expect(a.href).toBe("https://example.com/b");
  });

  test("xlink:href re-claims as href (compiled namespaced write and spread)", () => {
    const r = recorder();
    const [x, setX] = createSignal("#a");
    mount(() => (
      // `xlink:href` is not on AnchorHTMLAttributes. Adding it would be a JSX
      // API change, so the namespaced write stays in the fixture and the
      // excess property is suppressed here.
      // @ts-expect-error xlink:href is a namespaced attribute the anchor JSX type does not list
      <a href="/svg" xlink:href={x()}>
        x
      </a>
    ));
    expect(r.seen).toHaveLength(1);
    setX("#b");
    flush();
    expect(r.seen).toHaveLength(2);

    const [y, setY] = createSignal("#c");
    const props = {
      get "xlink:href"() {
        return y();
      }
    };
    const div = mount(() => <a {...props}>y</a>);
    const a = div.querySelector("a")!;
    expect(r.seen).toHaveLength(3);
    expect(a.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe("#c");
    setY("#d");
    flush();
    expect(r.seen).toHaveLength(4);
  });

  test("a spread rerun that writes a declared attribute re-claims; an undeclared one does not", () => {
    const r = recorder();
    const [href, setHref] = createSignal("/a");
    const [title, setTitle] = createSignal("t1");
    const props = {
      get href() {
        return href();
      },
      get title() {
        return title();
      }
    };
    mount(() => <a {...props}>x</a>);
    expect(r.seen).toHaveLength(1);
    setTitle("t2");
    flush();
    expect(r.seen).toHaveLength(1);
    setHref("/b");
    flush();
    expect(r.hrefs()).toEqual(["/a", "/b"]);
  });

  test("unregistering removes the handler and its declared names", () => {
    const r = recorder({ attributes: ["target"] });
    const [target, setTarget] = createSignal("_self");
    mount(() => (
      <a href="/a" target={target()}>
        x
      </a>
    ));
    expect(r.seen).toHaveLength(1);
    r.unregister();
    setTarget("_blank");
    flush();
    expect(r.seen).toHaveLength(1);
  });
});

describe("router-shaped consumer", () => {
  // A link-state layer: keyed per element, resolves the href at claim time,
  // scopes its entry with onCleanup of the claim owner. It is never told
  // about an anchor without its href and never twice for one mount.
  function linkState(attributes?: readonly string[]) {
    const entries = new Map<Element, { href: string; claims: number }>();
    const violations: string[] = [];
    const disposed: string[] = [];
    cleanups.push(
      registerElementClaim(el => {
        if (el.localName !== "a") return;
        const href = el.getAttribute("href");
        if (href === null) {
          violations.push("claimed without href");
          return;
        }
        const entry = entries.get(el);
        if (entry) {
          entry.claims++;
          entry.href = href;
          return;
        }
        entries.set(el, { href, claims: 1 });
        onCleanup(() => {
          disposed.push(href);
          entries.delete(el);
        });
      }, attributes && { attributes })
    );
    return { entries, violations, disposed };
  }

  test("never claimed without href, exactly once per mount, disposes with the element", () => {
    const ls = linkState();
    const [items, setItems] = createSignal(["/a", "/b", "/c"]);
    const [show, setShow] = createSignal(true);
    const div = mount(() => (
      <Show when={show()}>
        <nav>
          {items().map(href => (
            <a href={href} target="_blank">
              {href}
            </a>
          ))}
          <a {...{ href: "/spread" }}>spread</a>
        </nav>
      </Show>
    ));
    expect(ls.violations).toEqual([]);
    expect([...ls.entries.values()].map(e => e.href).sort()).toEqual(["/a", "/b", "/c", "/spread"]);
    expect([...ls.entries.values()].every(e => e.claims === 1)).toBe(true);
    for (const a of div.querySelectorAll("a")) expect(ls.entries.has(a)).toBe(true);

    setItems(["/d"]);
    flush();
    expect(ls.violations).toEqual([]);
    expect([...ls.entries.values()].map(e => e.href).sort()).toEqual(["/d", "/spread"]);
    expect([...ls.entries.values()].every(e => e.claims === 1)).toBe(true);

    setShow(false);
    flush();
    expect(ls.entries.size).toBe(0);
    expect(ls.disposed.sort()).toEqual(["/a", "/b", "/c", "/d", "/spread"]);
    expect(ls.violations).toEqual([]);
  });

  test("declaring target lets the consumer track target changes through re-claims", () => {
    const ls = linkState(["href", "target"]);
    const [target, setTarget] = createSignal("_self");
    const div = mount(() => (
      <a href="/t" target={target()}>
        t
      </a>
    ));
    const a = div.querySelector("a")!;
    expect(ls.entries.get(a)).toEqual({ href: "/t", claims: 1 });
    setTarget("_blank");
    flush();
    expect(ls.entries.get(a)).toEqual({ href: "/t", claims: 2 });
    expect(ls.violations).toEqual([]);
  });

  test("the mount claim in a plain root carries the root owner", () => {
    const owners: boolean[] = [];
    cleanups.push(registerElementClaim(() => owners.push(getOwner() !== null)));
    const [href] = createSignal("/root");
    createRoot(dispose => {
      cleanups.push(dispose);
      return <a href={href()}>x</a>;
    });
    expect(owners).toEqual([true]);
  });
});
