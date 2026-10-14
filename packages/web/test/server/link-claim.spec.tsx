/**
 * @jsxImportSource @solidjs/web
 *
 * Link claims in server HTML (solidjs/solid#3878): the compiled
 * `ssrLinkClaim` hole after a candidate anchor's attributes, the per-render
 * handler (`setLinkClaim`), the `links` hydration record a render with a
 * handler writes once, the spread anchor's collection in `ssrElement`, and
 * the frame renderer's pass-through for server components.
 */
import { describe, expect, test } from "vitest";
import {
  renderToString,
  renderToStream,
  setLinkClaim,
  hasServerLinkState,
  Loading,
  dynamic,
  type LinkClaimHandler
} from "@solidjs/web";
import { createMemo } from "solid-js";
import {
  frameTransformDirectResult,
  renderServerComponent,
  ServerComponentPlugin
} from "../../frames/src/frame-sink.js";
import { createJSONDataTable } from "../../serialization/src/serializer.js";
import { hydrationRecordKeys } from "../harness/hydration-records.js";

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function collect(code: () => any, options?: any): Promise<string> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(code, options).pipe({
      write: (c: string) => chunks.push(c),
      end: () => resolve(chunks.join(""))
    });
  });
}

/**
 * A router-shaped handler: the request's pathname is "current", a path
 * prefix is "active"; `target` / `download` / `rel~=external` opt out, like
 * `@solidjs/router`'s `managedUrl`. Records every call so the tests can see
 * what the hole handed over.
 */
function routerHandler(pathname: string, calls: Record<string, unknown>[] = []) {
  const handler: LinkClaimHandler = attrs => {
    calls.push(attrs);
    const href = attrs.href;
    if (typeof href !== "string" || !href || attrs.target || attrs.download != null) return "";
    if (typeof attrs.rel === "string" && attrs.rel.split(/\s+/).includes("external")) return "";
    let url: URL;
    try {
      url = new URL(href, "https://app.test" + pathname);
    } catch {
      return "";
    }
    if (url.origin !== "https://app.test") return "";
    const path = url.pathname.replace(/\/$/, "") || "/";
    const loc = pathname.replace(/\/$/, "") || "/";
    if (path === loc) return ' data-active aria-current="page"';
    return path !== "/" && loc.startsWith(path + "/") ? " data-active" : "";
  };
  return handler;
}

/** `<Router>`'s server half: sets the render's handler during setup. */
function Router(props: { pathname: string; calls?: Record<string, unknown>[]; children: any }) {
  setLinkClaim(routerHandler(props.pathname, props.calls));
  return props.children;
}

// The anchors' open tags, hydration keys aside (the server suite compiles
// hydratable, so every root anchor carries one).
const anchors = (html: string) =>
  (html.match(/<a\b(?:[^>"]|"[^"]*")*>/g) || []).map(tag => tag.replace(/ _hk=\S+/, ""));
const stripLinkState = (html: string) => html.replace(/ data-active| aria-current="page"/g, "");
const hasLinksRecord = (html: string) => /_\$HY\.r\["links"\]=1/.test(html);

describe("ssrLinkClaim: the compiled hole", () => {
  test("a render with no handler writes nothing: the HTML has no link state and no record", () => {
    const html = renderToString(() => (
      <nav>
        <a href="/">Home</a>
        <a href="/about">About</a>
        <a href={"/users/" + "x"}>Dyn</a>
      </nav>
    ));
    expect(anchors(html)).toEqual(['<a href="/">', '<a href="/about">', '<a href="/users/x">']);
    expect(hydrationRecordKeys(html)).not.toContain("links");
  });

  test("static anchors: the handler's markup lands after the anchor's attributes", () => {
    const calls: Record<string, unknown>[] = [];
    const html = renderToString(() => (
      <Router pathname="/about/team" calls={calls}>
        <nav>
          <a href="/">Home</a>
          <a href="/about">About</a>
          <a href="/about/team" rel="noopener">
            Team
          </a>
          <a href="/docs" link>
            Docs
          </a>
        </nav>
      </Router>
    ));
    expect(anchors(html)).toEqual([
      '<a href="/">',
      '<a href="/about" data-active>',
      '<a href="/about/team" rel="noopener" data-active aria-current="page">',
      '<a href="/docs" link>'
    ]);
    // The hoisted attributes object carries exactly the link-relevant
    // attributes present, as written; a bare attribute as "".
    expect(calls).toEqual([
      { href: "/" },
      { href: "/about" },
      { href: "/about/team", rel: "noopener" },
      { href: "/docs", link: "" }
    ]);
  });

  test("dynamic anchors: the handler sees the raw href the attribute hole evaluated", () => {
    const calls: Record<string, unknown>[] = [];
    const to = "/search?q=a&b=<c>";
    const blank = () => "_blank";
    const html = renderToString(() => (
      <Router pathname="/users/42" calls={calls}>
        <a href={to}>member</a>
        <a href={`/users/${21 * 2}`}>template</a>
        <a href={to} target={blank()}>
          dynamic target
        </a>
      </Router>
    ));
    expect(anchors(html)).toEqual([
      '<a href="/search?q=a&amp;b=&lt;c>">',
      '<a href="/users/42" data-active aria-current="page">',
      '<a href="/search?q=a&amp;b=&lt;c>" target="_blank">'
    ]);
    // Raw values — not attribute-escaped — and the evaluated `target`.
    expect(calls).toEqual([{ href: to }, { href: "/users/42" }, { href: to, target: "_blank" }]);
  });

  test("the compiler rules out anchors that can never be the current page: the handler is never asked", () => {
    const calls: Record<string, unknown>[] = [];
    const html = renderToString(() => (
      <Router pathname="/x" calls={calls}>
        <a href="/x" target="_blank">
          target
        </a>
        <a href="/x" download>
          download
        </a>
        <a href="/x" rel="nofollow external">
          external
        </a>
        <a href="mailto:a@b.c">mailto</a>
        <a href="tel:+1">tel</a>
        <a href="">empty</a>
        <a>none</a>
      </Router>
    ));
    expect(calls).toEqual([]);
    expect(html).not.toContain("data-active");
  });

  test("an author-written aria-current wins: static ones get no hole, dynamic ones skip the handler", () => {
    const calls: Record<string, unknown>[] = [];
    const html = renderToString(() => (
      <Router pathname="/x" calls={calls}>
        <a href="/x" aria-current="step">
          static
        </a>
        <a href="/x" aria-current={"page"}>
          literal container
        </a>
        <a href="/x" aria-current={"step" as "step" | undefined}>
          dynamic, set
        </a>
        <a href="/x" aria-current={undefined as "step" | undefined}>
          dynamic, unset
        </a>
      </Router>
    ));
    expect(anchors(html)).toEqual([
      '<a href="/x" aria-current="step">',
      '<a href="/x" aria-current="page">',
      '<a href="/x" aria-current="step">',
      '<a href="/x" data-active aria-current="page">'
    ]);
    // The dynamic positions reach the hole; only the unset one reaches the
    // handler.
    expect(calls).toEqual([{ href: "/x" }]);
  });

  test("spread anchors: ssrElement collects the winning link attributes, trailing ones included", () => {
    const calls: Record<string, unknown>[] = [];
    const rest = { class: "nav", href: "/x" };
    const external = { href: "/x", target: "_blank" };
    const authored = { href: "/x", "aria-current": "page" as const };
    const html = renderToString(() => (
      <Router pathname="/x/deep" calls={calls}>
        <a {...rest}>spread</a>
        <a {...rest} href="/x/deep" class="c">
          trailing static href
        </a>
        <a {...rest} href={"/else"}>
          trailing dynamic href
        </a>
        <a {...external}>external</a>
        <a {...authored}>authored</a>
        <a {...{ class: "no-link" }}>no href</a>
      </Router>
    ));
    expect(anchors(html)).toEqual([
      '<a class="nav" href="/x" data-active>',
      // the trailing `href` stays a source (walked), the trailing `class` is
      // baked tail markup after it
      '<a href="/x/deep" class="c" data-active aria-current="page">',
      '<a class="nav" href="/else">',
      '<a href="/x" target="_blank">',
      '<a href="/x" aria-current="page">',
      '<a class="no-link">'
    ]);
    expect(calls).toEqual([
      { href: "/x" },
      { href: "/x/deep" },
      { href: "/else" },
      { href: "/x", target: "_blank" }
    ]);
  });

  test("hydration ids are the same with and without a handler", () => {
    const Page = () => (
      <div>
        <a href="/">Home</a>
        <Show />
        <a href={"/u/" + 1}>{"dyn"}</a>
        <ul>
          {[1, 2].map(i => (
            <li>
              <a href={`/i/${i}`}>{i}</a>
            </li>
          ))}
        </ul>
      </div>
    );
    function Show() {
      return <span>{createMemo(() => "x")()}</span>;
    }
    const plain = renderToString(() => <Page />);
    const marked = renderToString(() => (
      <Router pathname="/">
        <Page />
      </Router>
    ));
    expect(marked).toContain('<a href="/" data-active aria-current="page">');
    expect(stripLinkState(marked.replace(/<script>[\s\S]*<\/script>/, ""))).toBe(
      plain.replace(/<script>[\s\S]*<\/script>/, "")
    );
  });
});

describe("setLinkClaim: the per-render handler and its record", () => {
  test("returns false outside a render; the server's hasServerLinkState is false", () => {
    expect(setLinkClaim(() => "")).toBe(false);
    expect(hasServerLinkState()).toBe(false);
  });

  test("writes the `links` record once for the response, only when a handler is set", () => {
    const html = renderToString(() => (
      <Router pathname="/">
        <Router pathname="/">
          <a href="/">Home</a>
        </Router>
      </Router>
    ));
    const keys = hydrationRecordKeys(html);
    expect(keys.filter(k => k === "links")).toEqual(["links"]);
    expect((html.match(/_\$HY\.r\["links"\]/g) || []).length).toBe(1);
    expect(hydrationRecordKeys(renderToString(() => <a href="/">Home</a>))).not.toContain("links");
  });

  test("`undefined` clears the handler for the anchors that follow", () => {
    const html = renderToString(() => {
      setLinkClaim(routerHandler("/a"));
      const first = <a href="/a">a</a>;
      setLinkClaim(undefined);
      return [first, <a href="/a">b</a>];
    });
    expect(anchors(html)).toEqual([
      '<a href="/a" data-active aria-current="page">',
      '<a href="/a">'
    ]);
  });

  test("a handler set inside a Loading boundary covers the streamed fragment and the record rides the shell", async () => {
    const hold = wait(20);
    function Held() {
      const m = createMemo(async () => {
        await hold;
        return "/late";
      });
      return <a href={m()}>late</a>;
    }
    const html = await collect(() => (
      <Loading fallback={<i>...</i>}>
        <Router pathname="/late">
          <a href="/late">early</a>
          <Held />
        </Router>
      </Loading>
    ));
    expect(anchors(html)).toEqual([
      '<a href="/late" data-active aria-current="page">',
      '<a href="/late" data-active aria-current="page">'
    ]);
    // Written during the shell pass: the record is in the shell's script,
    // ahead of the fragment.
    expect(html.indexOf('_$HY.r["links"]=1')).toBeLessThan(html.indexOf('<template id="0">'));
    expect(hydrationRecordKeys(html)).toContain("links");
  });

  test("concurrent streams each mark against their own request", async () => {
    const holdA = wait(30);
    const holdB = wait(5);
    const page = (pathname: string, hold: Promise<void>) => () => {
      function Held() {
        const m = createMemo(async () => {
          await hold;
          return "held";
        });
        return (
          <nav>
            <a href="/about">About</a>
            <a href="/">Home</a>
            <i>{m()}</i>
          </nav>
        );
      }
      return (
        <Router pathname={pathname}>
          <Loading fallback={<i>...</i>}>
            <Held />
          </Loading>
        </Router>
      );
    };
    // B starts after A and settles first.
    const a = collect(page("/about", holdA));
    const b = collect(page("/", holdB));
    const [htmlA, htmlB] = await Promise.all([a, b]);
    expect(anchors(htmlA)).toEqual([
      '<a href="/about" data-active aria-current="page">',
      '<a href="/">'
    ]);
    expect(anchors(htmlB)).toEqual([
      '<a href="/about">',
      '<a href="/" data-active aria-current="page">'
    ]);
  });
});

describe("server components", () => {
  test("document face: a server component inline in the page renders under the page's handler", async () => {
    const ServerComp = (props: any) => (
      <section>
        <a href="/story/1">story</a>
        <a href={"/users/" + "u"}>user</a>
        {props.children}
      </section>
    );
    const Inline = frameTransformDirectResult(ServerComp, { id: "lc-doc" }) as any;
    const html = await collect(
      () => (
        <Router pathname="/story/1">
          <Inline>
            <a href="/story/1">fill</a>
          </Inline>
        </Router>
      ),
      { plugins: [ServerComponentPlugin] }
    );
    expect(html).toContain('<a href="/story/1" data-active aria-current="page">story</a>');
    expect(html).toContain('<a href="/users/u">user</a>');
    expect(html).toContain('data-active aria-current="page">fill</a>');
    expect(hasLinksRecord(html)).toBe(true);
  });

  test("document face: a late server component (dynamic import) still inherits the handler", async () => {
    const ServerComp = () => (
      <Loading fallback={<i>...</i>}>
        <a href="/s">late sc</a>
      </Loading>
    );
    const Inline = frameTransformDirectResult(ServerComp, { id: "lc-late" }) as any;
    const Story = dynamic(() => wait(10).then(() => Inline));
    const html = await collect(
      () => (
        <Router pathname="/s">
          <Loading fallback={<span>fb</span>}>
            <Story />
          </Loading>
        </Router>
      ),
      { plugins: [ServerComponentPlugin] }
    );
    expect(html).toContain('<a href="/s" data-active aria-current="page">late sc</a>');
  });

  test("stream face: a server component's own render has no handler unless it sets one; the record rides the response", async () => {
    const Plain = () => <a href="/x">plain</a>;
    const plain: any[] = await renderServerComponent(Plain, { frame: { id: "lc-plain" } });
    expect(plain.find(c => c.type === "html").html).toContain('<a href="/x">plain</a>');
    expect(plain.filter(c => c.type === "data")).toEqual([]);

    const Routed = () => (
      <Router pathname="/x">
        <a href="/x">routed</a>
      </Router>
    );
    const routed: any[] = await renderServerComponent(Routed, { frame: { id: "lc-routed" } });
    expect(routed.find(c => c.type === "html").html).toContain(
      '<a href="/x" data-active aria-current="page">routed</a>'
    );
    const table = createJSONDataTable();
    for (const c of routed.filter(x => x.type === "data")) table.apply(c);
    expect(table.resolve({ $ref: "links" })).toBe(1);
  });
});
