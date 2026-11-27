/**
 * @jsxImportSource @solidjs/web
 *
 * #5223: an `<Errored>` whose content is more than the failing `<Loading>`,
 * the failure landing after the shell. The server sends the fallback in a
 * template keyed by the Errored id, the error staged at `<id>_ef`, and
 * `$dfx(id, first, last, 1)`, naming the region's ends by what they already
 * carry (a hydration key `"<key>"`, a `<Loading>` placeholder `["<key>"]`).
 * The page swaps that range while no client runtime has started and the
 * range reads as named; otherwise main's page stands and the client renders
 * the failure. `page()` parses the stream with jsdom, scripts on, so the HTML
 * parser is part of every assertion. Most cases are rows of three tables:
 * swapped, nothing sent, and sent but refused by the page.
 */
import { describe, expect, test, vi } from "vitest";
// @ts-expect-error jsdom ships no types; used only to parse the stream as a document
import { JSDOM, VirtualConsole } from "jsdom";
import {
  escape,
  getHydrationWriter,
  HydrationScript,
  renderToStream,
  renderToString,
  ssr,
  useHead
} from "@solidjs/web";
import {
  children,
  createComponent,
  createMemo,
  Errored,
  For,
  lazy,
  Loading,
  onCleanup,
  Reveal,
  Show
} from "solid-js";
import { sharedConfig } from "solid-js/internal";
import { recordStream } from "./artifact-recorder.js";
import { hydrationRecordKeys } from "../harness/hydration-records.js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const strip = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "");
// The `$dfx` calls a stream carries: `"<id>",[first…],[last…],1`.
const swaps = (html: string) => [...html.matchAll(/\$dfx\(("[^)]*)\)/g)].map(m => m[1]);

// What the server error hook heard: `<message> <handling>`.
function hookLog(map?: (e: unknown) => unknown) {
  const heard: string[] = [];
  const onError = (e: unknown, site: { handling: string }) => {
    heard.push(`${e instanceof Error ? e.message : String(e)} ${site.handling}`);
    return map ? map(e) : undefined;
  };
  return { heard, onError };
}

const fail = (ms: number, message: string) =>
  createMemo(async (): Promise<string> => {
    await sleep(ms);
    throw new Error(message);
  });
const ok = (ms: number, value: string) =>
  createMemo(async (): Promise<string> => {
    await sleep(ms);
    return value;
  });
const noUser = () => fail(5, "no user 7");
const slot = (read: () => string, label = "loading") => (
  <Loading fallback={<i>{label}</i>}>
    <span>{read()}</span>
  </Loading>
);
const failed = (e: any) => <p>failed: {e().message}</p>;
// `<main><Errored>` around `content`, which renders under the Errored.
const inMain = (content: () => any, fallback: any = failed) => (
  <main>
    <Errored fallback={fallback}>{content()}</Errored>
  </main>
);
// The issue's shape: markup between the Errored and the failing Loading.
const Basic = (props: { settles?: boolean }) => {
  const user = props.settles ? ok(5, "u7") : noUser();
  return inMain(() => <b>{slot(user)}</b>);
};
const Row = (props: { children: any }) => (
  <tr>
    <td>{props.children}</td>
  </tr>
);
const Card = (props: { children: any }) => <div class="card">{props.children}</div>;
// A <section> failing at 5ms in an Errored, its fallback `error fallback`.
const Section = (props: { fallback?: any }) => (
  <main>
    <Errored fallback={props.fallback ?? <p>error fallback</p>}>
      <section>{slot(fail(5, "bad"))}</section>
    </Errored>
  </main>
);

// The bootstrap a page has before the stream (`<HydrationScript />` writes
// the real one); `booted`: a client runtime has started and owns the reveal
// policy (`_$HY.f`), as after `hydrate()`.
const boot = (booted?: boolean) =>
  `<script>var _$HY={r:new Proxy({},{set:(r,k,v)=>(v instanceof Promise&&v.catch(()=>{}),r[k]=v,!0)}),fe(){}` +
  `${booted ? ",f(e){return $dfr(e)}" : ""}};</script>`;

/**
 * The stream parsed as a document. `document`: the stream is a whole
 * document (its own `<html>`, with `<HydrationScript />`); otherwise it is
 * parsed inside `<body>`.
 */
function page(html: string, options: { booted?: boolean; document?: boolean } = {}) {
  const errors: string[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e: any) => errors.push(String(e.detail ?? e)));
  const dom = new JSDOM(
    options.document
      ? "<!DOCTYPE html>" + html
      : `<!DOCTYPE html><html><head>${boot(options.booted)}</head><body>${html}</body></html>`,
    { runScripts: "dangerously", virtualConsole }
  );
  const doc = dom.window.document;
  const clean = (el: Element) => {
    const copy = el.cloneNode(true) as Element;
    copy.querySelectorAll("script").forEach(s => s.remove());
    return copy.innerHTML.replace(/ _hk="?[\w-]+"?/g, "").replace(/<!--[$/]-->|<!--\/-->/g, "");
  };
  const hy = (dom.window as any)._$HY;
  return {
    doc,
    errors,
    /** `<body>`'s markup: no scripts, hydration keys or `$`/`/` markers. */
    get body() {
      return clean(doc.body);
    },
    get records() {
      return Object.keys(hy.r).sort();
    },
    get queued() {
      return Object.keys(hy.dq || {});
    },
    get templates() {
      return [...doc.querySelectorAll("template")].map(t => t.id);
    }
  };
}
type Page = ReturnType<typeof page>;

/** `<App />` streamed, the error hook heard, and the `$dfx` calls it sent. */
async function stream(App: (props: any) => any, options: Record<string, any> = {}) {
  const { heard, onError } = hookLog();
  const r = await recordStream(() => <App />, { onError, ...options } as any);
  return { ...r, heard, calls: swaps(r.rest) };
}
type Streamed = Awaited<ReturnType<typeof stream>>;

type Case = {
  name: string;
  App: (props: any) => any;
  options?: Record<string, any>;
  /** The one `$dfx` call sent: exactly, or a pattern (the default: any one). */
  swap?: string | RegExp;
  heard?: string[];
  /** `<body>` once every script ran. */
  body?: string;
  document?: boolean;
  /** Templates or queued fragments stay on the page. */
  leftover?: boolean;
  more?: (r: Streamed, p: Page) => void;
};
type Outcome = "swapped" | "nothing sent" | "page refuses";

async function check(c: Case, outcome: Outcome) {
  const r = await stream(c.App, c.options);
  if (outcome === "nothing sent") {
    expect(r.calls).toEqual([]);
    expect(r.rest).not.toContain("$dfx");
  } else if (typeof c.swap === "string") expect(r.calls).toEqual([c.swap]);
  else {
    expect(r.calls).toHaveLength(1);
    if (c.swap) expect(r.calls[0]).toMatch(c.swap);
  }
  if (c.heard) expect(r.heard).toEqual(c.heard);
  const p = page(r.shell + r.rest, { document: c.document });
  expect(p.errors).toEqual([]);
  if (c.body !== undefined) expect(p.body).toBe(c.body);
  if (!c.leftover) {
    expect(p.templates).toEqual([]);
    expect(p.queued).toEqual([]);
  }
  // Main's page: no error recorded for the Errored, staged or moved.
  if (outcome !== "swapped") expect(p.records.some(k => k.endsWith("_ef"))).toBe(false);
  if (outcome === "page refuses") expect(p.records).not.toContain(/^"(\w+)"/.exec(r.calls[0])![1]);
  c.more?.(r, p);
}

// The two boundaries of the review's OVERTAKE and NEVER repros: an inner
// Errored whose fallback has a bare async hole, an outer one whose own
// Loading fails later.
const Overtake = (props: { hint: () => string }) => {
  const first = fail(5, "inner failure");
  const second = fail(10, "outer failure");
  return (
    <div>
      <Errored fallback={<p>outer fallback</p>}>
        <section>
          <Errored fallback={() => <p>inner: {props.hint()}</p>}>
            <article>{slot(first)}</article>
          </Errored>
        </section>
        {slot(second)}
      </Errored>
    </div>
  );
};
// A whole document, `children` its <body>.
const Html = (props: { children: any }) => (
  <html lang="en">
    <head>
      <title>T</title>
      <HydrationScript />
    </head>
    <body>{props.children}</body>
  </html>
);
// A page under an Errored that holds the whole document or its <body>.
const PageMain = () => (
  <main>
    <h1>page</h1>
    {slot(fail(20, "boom"))}
  </main>
);
const intactDocument = (_: Streamed, p: Page) => {
  expect(p.doc.title).toBe("T");
  expect(p.doc.documentElement.lang).toBe("en");
};
// A layout whose Errored holds what it is passed.
const Layout = (props: { children: any }) => (
  <div class="layout">
    <nav>nav</nav>
    <Errored fallback={failed}>{props.children}</Errored>
  </div>
);
const outletPage = () => (
  <>
    <h1>page</h1>
    {slot(fail(5, "x"))}
  </>
);

const swapped: Case[] = [
  {
    name: "the Loading last: the range ends at its closing comment",
    App: () => (
      <main>
        <Errored fallback={failed}>
          <h1>title</h1>
          {slot(noUser())}
        </Errored>
        <footer>tail</footer>
      </main>
    ),
    swap: /^"\w+",\["\w+"\],\[\["\w+"\]\],1$/,
    body: `<main><p>failed: no user 7</p><footer>tail</footer></main>`
  },
  {
    name: "nested Errored boundaries: the nearest one around the failure sends its own region",
    App: () =>
      inMain(
        () => (
          <article>
            <h1>keep</h1>
            <Errored fallback={(e: any) => <p>inner: {e().message}</p>}>
              <b>{slot(noUser())}</b>
            </Errored>
          </article>
        ),
        <p>outer failed</p>
      ),
    heard: ["no user 7 fallback"],
    body: `<main><article><h1>keep</h1><p>inner: no user 7</p></article></main>`,
    more: r => expect(r.rest).not.toContain("outer failed")
  },
  {
    // Both are the outer boundary's, as before the shell (#5225): the inner
    // fallback's failure it draws for, and the content's failure it met.
    name: "an inner fallback that throws is the outer Errored's failure, sent for the outer region",
    App: () =>
      inMain(
        () => (
          <article>
            <h1>title</h1>
            <Errored
              fallback={() => {
                throw new Error("fallback threw");
              }}
            >
              <b>{slot(noUser())}</b>
            </Errored>
          </article>
        ),
        (e: any) => <p>outer: {e().message}</p>
      ),
    heard: ["fallback threw fallback", "no user 7 fallback"],
    body: `<main><p>outer: fallback threw</p></main>`
  },
  // The second fragment's empty template finds no placeholder: dropped.
  ...[false, true].map(later => ({
    name: `two failures in one region${later ? ", the second later" : " at once"}: one fallback sent; the second is reported as before`,
    App: () =>
      inMain(() => (
        <section>
          {slot(fail(5, "a failed"), "a")}
          {slot(fail(later ? 12 : 5, "b failed"), "b")}
        </section>
      )),
    heard: ["a failed fallback", "b failed client"],
    body: `<main><p>failed: a failed</p></main>`
  })),
  {
    // The inner failure is the inner boundary's on the client; the outer
    // failure, in the outer boundary's own content, is sent.
    name: "a fallback with a bare async hole is not finished as it renders: nothing is sent for it, nothing waits for it (review OVERTAKE)",
    App: () => {
      const hint = ok(20, "late hint");
      return <Overtake hint={hint} />;
    },
    heard: ["inner failure client", "outer failure fallback"],
    body: `<div><p>outer fallback</p></div>`,
    more: r => expect(r.rest).not.toContain("inner:")
  },
  {
    name: "the outer region replaced, an inner Errored's Loading failing later: no second fallback, reported as before (review S2)",
    App: () =>
      inMain(
        () => (
          <div>
            {slot(fail(5, "secret A"), "loading A")}
            <Errored fallback={(e: any) => <p>INNER: {e().message}</p>}>
              <em>{slot(fail(20, "secret B"), "loading B")}</em>
            </Errored>
          </div>
        ),
        (e: any) => <p>OUTER: {e().message}</p>
      ),
    heard: ["secret A fallback", "secret B client"],
    body: `<main><p>OUTER: secret A</p></main>`,
    more: r => expect(r.rest).not.toContain("INNER")
  },
  {
    name: "other Loadings in the region still streaming: nothing is released; the page drops what arrives for the replaced region",
    App: () => {
      const sib = ok(30, "sib");
      return inMain(() => (
        <section>
          {slot(sib, "sib loading")}
          {slot(noUser())}
        </section>
      ));
    },
    body: `<main><p>failed: no user 7</p></main>`,
    more: r => {
      // The sibling streams as it did, its value the client's to adopt.
      expect(strip(r.chunks[r.chunks.length - 1])).toMatch(
        /^<template id="\w+"><span _hk=\w+>sib<\/span><\/template>$/
      );
      expect(r.rest).not.toContain("delete _$HY.r");
      // Not taken (a runtime started): the sibling lands, as on main.
      expect(page(r.shell + r.rest, { booted: true }).body).toBe(
        `<main><section><span>sib</span></section></main>`
      );
    }
  },
  {
    name: "Reveal groups: a member settled and held by the group when another fails: no leftover (review REVEAL)",
    App: () => (
      <div>
        <Errored fallback={<p>group error</p>}>
          <Reveal order="together">
            {slot(fail(12, "a failed"), "a")}
            {slot(ok(5, "b ready"), "b")}
          </Reveal>
        </Errored>
      </div>
    ),
    body: `<div><p>group error</p></div>`
  },
  {
    name: "Reveal groups: a sequential group around a failing member, one revealed, one still streaming (review S15)",
    App: () => {
      const [c, a, d] = [ok(5, "C"), fail(30, "boom A"), ok(60, "D")];
      return inMain(() => (
        <ul>
          <Reveal>
            <Loading fallback={<i>loading C</i>}>
              <li>{c()}</li>
            </Loading>
            <Loading fallback={<i>loading A</i>}>
              <li>{a()}</li>
            </Loading>
            <Loading fallback={<i>loading D</i>}>
              <li>{d()}</li>
            </Loading>
          </Reveal>
        </ul>
      ));
    },
    heard: ["boom A fallback"],
    body: `<main><p>failed: boom A</p></main>`
  },
  {
    name: "the parser: rows in an explicit <tbody>: the row is replaced (review Table)",
    App: () => {
      const a = fail(20, "boom");
      return (
        <table>
          <tbody>
            <Row>first row</Row>
            <Errored
              fallback={(e: any) => (
                <tr>
                  <td>row failed: {e().message}</td>
                </tr>
              )}
            >
              <tr>
                <td>cell</td>
                <Loading fallback={<td>loading</td>}>
                  <td>{a()}</td>
                </Loading>
              </tr>
            </Errored>
          </tbody>
        </table>
      );
    },
    body: `<table><tbody><tr><td>first row</td></tr><tr><td>row failed: boom</td></tr></tbody></table>`
  },
  {
    // The fallback where the row was: inside the <tbody> the parser made for
    // the rows, as authored markup this shape always lands.
    name: "the parser: a row a component puts straight into <table>: the parser's <tbody> holds the range whole; the other rows stay, nothing throws (review TABLE)",
    App: () => (
      <table>
        <Row>first row</Row>
        <Errored
          fallback={
            <tbody>
              <Row>row failed</Row>
            </tbody>
          }
        >
          <Row>{slot(fail(5, "row failed"))}</Row>
        </Errored>
        <Row>last row</Row>
      </table>
    ),
    body: `<table><tbody><tr><td>first row</td></tr><tbody><tr><td>row failed</td></tr></tbody><tr><td>last row</td></tr></tbody></table>`
  },
  {
    name: "the parser: an element the parser moves out of its parent (<div> in <p>) is still found by its key",
    App: () => (
      <p>
        <Errored fallback={(e: any) => <span>failed: {e().message}</span>}>
          <div>{slot(noUser())}</div>
        </Errored>
      </p>
    ),
    body: `<p></p><span>failed: no user 7</span><p></p>`
  },
  {
    // Sent with the content's first fragment, before the failure: the swap
    // takes the content, not what it already put in the head. Main's page
    // has the same head tags, with the content.
    name: "known limit: head tags the replaced content already sent stay in the head until the client runs",
    App: () => {
      function Meta(props: { v: string }) {
        useHead({ tag: "title", props: { children: "Item " + props.v } });
        useHead({ tag: "meta", props: { name: "description", content: "item desc" } });
        return <span>{props.v}</span>;
      }
      const item = ok(2, "one");
      return (
        <Html>
          <Errored fallback={<p>error body</p>}>
            <div>
              <Loading fallback={<i>l</i>}>
                <Meta v={item()} />
              </Loading>
              {slot(fail(10, "boom"))}
            </div>
          </Errored>
        </Html>
      );
    },
    document: true,
    body: `<p>error body</p>`,
    more: (_, p) => {
      expect(p.doc.title).toBe("Item one");
      expect(p.doc.querySelector('meta[name="description"]')).not.toBe(null);
    }
  },
  // The second <div> is the last end, not the first.
  ...(["script", "textarea"] as const).map(raw => ({
    name: `the ends: raw text that spells the end's tag (a <${raw}>): the end is still found, the whole region is replaced`,
    App: () => {
      const Raw = (props: { text: string }) =>
        raw === "script" ? (
          <script innerHTML={`var s=${JSON.stringify(props.text)}`} />
        ) : (
          <textarea innerHTML={props.text} />
        );
      const user = noUser();
      return inMain(() => (
        <>
          <div>
            {slot(user)}
            <Raw text="<div>" />
          </div>
          <div>
            tail
            <Raw text="</div>" />
          </div>
        </>
      ));
    },
    swap: `"2",["200"],["203"],1`,
    body: `<main><p>failed: no user 7</p></main>`
  })),
  {
    name: "a render id (beginning with `pl-`): ids and keys share its prefix, a key stays a key, not a placeholder, and the fallback goes in",
    App: Section,
    options: { renderId: "pl-widget" },
    swap: `"pl-widget1",["pl-widget100"],["pl-widget100"],1`,
    body: `<main><p>error fallback</p></main>`,
    more: (_, p) =>
      expect(p.doc.querySelector("main")!.innerHTML).toMatch(
        /^<p _hk="pl-widget\w+">error fallback<\/p>$/
      )
  },
  {
    // The section and the footer: under the Errored (`1`), not the aside.
    name: "an attribute value that spells an outside element's key names nothing: the sibling outside the Errored stays",
    App: () => (
      <>
        <aside data-outside="">outside</aside>
        <Errored fallback={<p>error fallback</p>}>
          <section title="example _hk=0 text">{slot(fail(5, "bad"))}</section>
          <footer>inside boundary</footer>
        </Errored>
      </>
    ),
    swap: `"1",["100"],["102"],1`,
    body: `<aside data-outside="">outside</aside><p>error fallback</p>`,
    more: r => {
      expect(r.shell).toContain(`<aside _hk=0 data-outside>`);
      expect(r.shell).toContain(`<section _hk=100 title="example _hk=0 text">`);
      expect(r.shell).toContain(`<footer _hk=102>`);
    }
  },
  {
    name: "ends named through deep same-name nesting a revealed fragment holds: found, and the fallback goes in",
    App: () => {
      const v = ok(5, "deep");
      const deep = 4000;
      return (
        <main>
          <Errored fallback={<p>error fallback</p>}>
            <section>{slot(fail(15, "bad"))}</section>
            <Loading fallback={<i>deep loading</i>}>
              <div innerHTML={"<div>".repeat(deep) + v() + "</div>".repeat(deep)} />
            </Loading>
          </Errored>
        </main>
      );
    },
    swap: /^"\w+",\["\w+"\],\[\["\w+"\],"\w+"\],1$/,
    body: `<main><p>error fallback</p></main>`
  },
  {
    // The placeholder first, the end of what it settled with next.
    name: "a settled <Loading> end: a <Loading> that streamed first as the first end",
    App: () =>
      inMain(() => (
        <>
          {slot(ok(3, "A"))}
          <p>mid</p>
          {slot(fail(15, "B"))}
        </>
      )),
    swap: `"1",[["1001"],"1001000"],[["1021"]],1`,
    body: `<main><p>failed: B</p></main>`
  },
  {
    // Inlined: the shell has the content, not the placeholder.
    name: "a settled <Loading> end: a <Loading> inlined before the shell, its nested <Loading> failing after it",
    App: () => {
      const a = ok(0, "A");
      const b = fail(15, "B");
      return inMain(() => (
        <Loading fallback={<i>a</i>}>
          <div>
            {a()}
            {slot(b)}
          </div>
        </Loading>
      ));
    },
    swap: `"3",[["300"],"300000"],[["300"],"300000"],1`,
    body: `<main><p>failed: B</p></main>`,
    more: r => expect(r.shell).not.toContain(`id="pl-300"`)
  },
  {
    // [outer], the outer's first end [inner], the inner's first end.
    name: "a settled <Loading> end: a <Loading> spliced into the <Loading> that holds it, both settled before the failure",
    App: () => {
      const a = ok(10, "A");
      const c = ok(3, "C");
      return inMain(() => (
        <>
          <Loading fallback={<i>a</i>}>
            {slot(c, "c")}
            <div>{a()}</div>
          </Loading>
          {slot(fail(30, "B"))}
        </>
      ));
    },
    swap: /^"\w+",\[\["\w+"\],\["\w+"\],"\w+"\],\[\["\w+"\]\],1$/,
    body: `<main><p>failed: B</p></main>`
  },
  {
    // The last end: the placeholder, then the inner fallback's root.
    name: "a settled <Loading> end: an inner Errored's fallback drawn at the end of a <Loading> before it settled: named by the markup drawn, swapped",
    App: () => {
      const a = ok(10, "A");
      return inMain(
        () => (
          <>
            {slot(fail(30, "late"))}
            <Loading fallback={<i>a</i>}>
              <div>{a()}</div>
              <Errored fallback={<p>inner fallback</p>}>
                <em>{slot(fail(3, "early"))}</em>
              </Errored>
            </Loading>
          </>
        ),
        (e: any) => <p>OUTER: {e().message}</p>
      );
    },
    swap: /^"\w+",\[\["\w+"\]\],\[\["\w+"\],"\w+"\],1$/,
    heard: ["early fallback", "late fallback"],
    body: `<main><p>OUTER: late</p></main>`
  },
  {
    // The Errored is `1`: what the wrapper passes through renders under it.
    name: "content passed in: a wrapper component's `props.children`: keyed under the Errored, swapped",
    App: () => {
      const Guard = (props: { children: any }) => (
        <Errored fallback={failed}>{props.children}</Errored>
      );
      return (
        <main>
          <Guard>
            <p>intro</p>
            {slot(fail(5, "x"))}
          </Guard>
        </main>
      );
    },
    swap: `"1",["100"],[["1011"]],1`,
    body: `<main><p>failed: x</p></main>`,
    more: r => expect(strip(r.shell)).toContain(`<p _hk=100>intro</p>`)
  },
  {
    name: "content passed in: a layout's `props.children` through a lazily read outlet (a keyed <Show>, as the router's): swapped",
    App: () => (
      <Layout>
        <Show when={{ page: 1 }} keyed>
          {_ => outletPage()}
        </Show>
      </Layout>
    ),
    body: `<div class="layout"><nav>nav</nav><p>failed: x</p></div>`
  },
  {
    // The parser closes the <p> before the <div>: the <div> and the empty
    // <p> the stray `</p>` makes are after the range. Main's page is
    // `<main><p></p><div>authored</div><p></p></main>`.
    name: "limit (does not fail closed): authored innerHTML the parser moves out of the region's last element stays beside the fallback (the compiler refuses the same nesting in a template)",
    App: () =>
      inMain(
        () => (
          <>
            {slot(fail(5, "x"))}
            <p innerHTML="<div>authored</div>" />
          </>
        ),
        <p>error fallback</p>
      ),
    body: `<main><p>error fallback</p><div>authored</div><p></p></main>`
  },
  {
    // A browser runs it then, as it runs one in a streamed <Loading> fragment.
    name: "a <script> in the fallback goes in with it, once",
    App: () =>
      inMain(
        () => <b>{slot(fail(5, "x"))}</b>,
        <div>
          <p>failed</p>
          <script innerHTML="window.__ran=(window.__ran||0)+1" />
        </div>
      ),
    body: `<main><div><p>failed</p></div></main>`,
    more: (_, p) => expect(p.doc.querySelectorAll("main script").length).toBe(1)
  },
  {
    name: "authored SVG with a self-closed <title/> (not raw text inside <svg>) before the failing section: the ends are read past it",
    App: () => (
      <main>
        <Errored fallback={<p>error</p>}>
          <svg innerHTML={"<title/>"} />
          <section>{slot(noUser())}</section>
        </Errored>
      </main>
    ),
    body: `<main><p>error</p></main>`
  },
  {
    name: "a <pre> fallback starting with a newline: the page's second parse keeps it, as a synchronous render reads it",
    App: () => <Section fallback={<pre>{"\n\nline"}</pre>} />,
    body: `<main><pre>\nline</pre></main>`,
    more: (_, p) => {
      expect(p.doc.querySelector("pre")!.textContent).toBe("\nline");
      const Throw = () => throwBad();
      const sync = page(
        renderToString(() => (
          <Errored fallback={<pre>{"\n\nline"}</pre>}>
            <Throw />
          </Errored>
        ))
      );
      expect(sync.doc.querySelector("pre")?.textContent).toBe("\nline");
    }
  }
];

// Each the page main sends: the client renders the failure.
const nothingSent: Case[] = [
  {
    name: "a fallback that throws with no Errored above: the hook hears `client` (review S14)",
    App: () =>
      inMain(
        () => <b>{slot(noUser())}</b>,
        () => {
          throw new Error("fallback threw");
        }
      ),
    heard: ["no user 7 client"],
    body: `<main><b></b></main>`,
    more: r => expect(strip(r.rest)).toMatch(/^<template id="\w+" e><\/template>$/)
  },
  {
    name: "an inner fallback whose async hole rejects later: the client's, nothing sent for the outer boundary (review ASYNC-THROW)",
    App: () => {
      const hint = fail(15, "fallback failed");
      return (
        <div>
          <Errored fallback={(err: any) => <p>outer: {String(err())}</p>}>
            <section>
              <Errored fallback={() => <p>inner: {hint()}</p>}>
                <article>{slot(fail(5, "item failed"))}</article>
              </Errored>
            </section>
          </Errored>
        </div>
      );
    },
    heard: ["item failed client"],
    body: `<div><section><article></article></section></div>`
  },
  {
    name: "an Errored inside a Loading still pending: drawn in that fragment, as before (review S10)",
    App: () => {
      const slow = ok(30, "SLOW");
      const user = noUser();
      return (
        <main>
          <Loading fallback={<i>outer loading</i>}>
            <article>
              {slow()}
              <Errored fallback={failed}>
                <b>{slot(user)}</b>
              </Errored>
            </article>
          </Loading>
        </main>
      );
    },
    heard: ["no user 7 fallback"],
    body: `<main><article>SLOW<p>failed: no user 7</p></article></main>`
  },
  {
    name: "a document-level Errored (<html> as its content): the document is intact (review Doc)",
    App: () => (
      <Errored
        fallback={(e: any) => (
          <html>
            <body>
              <p>document failed: {e().message}</p>
            </body>
          </html>
        )}
      >
        <html lang="en">
          <head>
            <title>T</title>
            <meta charset="utf-8" />
            <HydrationScript />
          </head>
          <body>
            <PageMain />
          </body>
        </html>
      </Errored>
    ),
    document: true,
    heard: ["boom client"],
    body: `<main><h1>page</h1></main>`,
    more: (r, p) => {
      intactDocument(r, p);
      expect(p.doc.querySelector("meta[charset]")).not.toBe(null);
    }
  },
  {
    name: "an Errored around <body>: the document is intact (review Body)",
    App: () => (
      <html lang="en">
        <head>
          <title>T</title>
          <HydrationScript />
        </head>
        <Errored
          fallback={(e: any) => (
            <body>
              <p>body failed: {e().message}</p>
            </body>
          )}
        >
          <body>
            <PageMain />
          </body>
        </Errored>
      </html>
    ),
    document: true,
    heard: ["boom client"],
    body: `<main><h1>page</h1></main>`,
    more: intactDocument
  },
  {
    name: "known limit: text as the region's first node",
    App: () =>
      inMain(() => (
        <>
          hello
          {slot(noUser())}
        </>
      )),
    heard: ["no user 7 client"],
    body: `<main>hello</main>`
  },
  {
    name: "known limit: text as the region's last node",
    App: () =>
      inMain(() => (
        <>
          <b>{slot(noUser())}</b>
          bye
        </>
      )),
    heard: ["no user 7 client"],
    body: `<main><b></b>bye</main>`
  },
  {
    name: "a stray close tag in authored innerHTML at the end: no end is named",
    App: () =>
      inMain(
        () => (
          <>
            <div>{slot(noUser())}</div>
            <div innerHTML="<b>cms</b></div>" />
          </>
        ),
        <p>failed</p>
      ),
    heard: ["no user 7 client"],
    body: `<main><div></div><div><b>cms</b></div></main>`
  },
  {
    name: "an end keyed outside the Errored (content made by its parent): the page is as before",
    App: () => {
      const made = <em>made outside</em>;
      return inMain(
        () => (
          <>
            {made}
            <section>{slot(fail(5, "bad"))}</section>
          </>
        ),
        <p>error fallback</p>
      );
    },
    body: `<main><em>made outside</em><section></section></main>`
  },
  {
    name: "limit: children resolved before the Errored renders (`children()`): keyed outside it, main's page",
    App: () => {
      const Resolved = (props: { children: any }) => {
        const resolved = children(() => props.children);
        return (
          <section>
            <Errored fallback={failed}>{resolved()}</Errored>
          </section>
        );
      };
      return (
        <main>
          <Resolved>
            <p>intro</p>
            {slot(fail(5, "x"))}
          </Resolved>
        </main>
      );
    },
    heard: ["x client"],
    body: `<main><section><p>intro</p></section></main>`
  },
  {
    name: "limit: an outlet computed outside the Errored (a memo read inside it): main's page",
    App: () => {
      const outlet = createMemo(outletPage);
      return <Layout>{outlet()}</Layout>;
    },
    heard: ["x client"],
    body: `<div class="layout"><nav>nav</nav><h1>page</h1></div>`
  },
  {
    name: "limit: hand-written `ssr()` templates without `ssrHydrationKey()` (the issue's no-compiler repro)",
    App: () =>
      ssr(
        ["<main>", "</main>"],
        createComponent(Errored, {
          fallback: ssr(["<p>unkeyed fallback</p>"]),
          get children() {
            const read = fail(5, "x");
            return ssr(
              ["<b>", "</b>"],
              createComponent(Loading, {
                fallback: ssr(["<i>pending</i>"]),
                get children() {
                  return ssr(["<span>", "</span>"], () => escape(read()));
                }
              })
            );
          }
        })
      ),
    heard: ["x client"],
    body: `<main><b></b></main>`
  },
  {
    // No scripts run: the loading fallback stays, as on main.
    name: "limit: `noScripts`: the stream is main's",
    App: () => inMain(() => <b>{slot(fail(5, "x"))}</b>, <p>error fallback</p>),
    options: { noScripts: true },
    heard: ["x client"],
    body: `<main><b><template id="pl-2011"></template><i>loading</i><!--pl-2011--></b></main><template id="2011" e=""></template>`,
    leftover: true,
    more: r => expect(r.rest).not.toContain("error fallback")
  },
  {
    name: "control: the direct shape is unchanged: the fallback goes into the failed fragment",
    App: () => inMain(() => slot(noUser())),
    heard: ["no user 7 fallback"],
    body: `<main><p>failed: no user 7</p></main>`,
    more: r =>
      expect(strip(r.rest)).toMatch(
        /^<template id="\w+" e><p _hk=\w+>failed: <!--\$-->no user 7<!--\/--><\/p><\/template>$/
      )
  },
  {
    name: "control: before the shell (#5225): drawn in the shell",
    App: () => {
      const user = noUser();
      const hold = ok(15, "outer");
      return (
        <main>
          <Errored fallback={failed}>
            <b>{slot(user)}</b>
          </Errored>
          <i>{hold()}</i>
        </main>
      );
    },
    heard: ["no user 7 fallback"],
    body: `<main><p>failed: no user 7</p><i>outer</i></main>`,
    more: r => {
      expect(strip(r.shell)).toContain(`failed: <!--$-->no user 7<!--/-->`);
      expect(r.shell).not.toContain("$dfx");
    }
  }
];

// The server cannot see the page's parsing context: it sends, and the page,
// finding the ends are not where it named them, leaves them as main does.
const pageRefuses: Case[] = [
  {
    // The caption under <table>, the row under the parser's <tbody>: not
    // siblings, so no range.
    name: "the parser moves the two ends apart (a caption and a row in <table>): nothing is touched, the page is as before",
    App: () => (
      <table>
        <Errored fallback={<caption>failed</caption>}>
          <caption>title</caption>
          <Row>{slot(fail(5, "row failed"))}</Row>
        </Errored>
      </table>
    ),
    body: `<table><caption>title</caption><tbody><tr><td></td></tr></tbody></table>`
  },
  {
    // The server names the <p> as both ends, as it was written; the parser
    // closed it before the card: the card is the boundary's (keyed under it)
    // but outside the range.
    name: "a block in a <p> at the region's end: the parser moves content out of the range, nothing is touched",
    App: () => {
      const user = noUser();
      return inMain(() => (
        <p>
          <Card>{slot(user)}</Card>
        </p>
      ));
    },
    swap: `"2",["200"],["200"],1`,
    body: `<main><p></p><div class="card"></div><p></p></main>`
  },
  {
    // The card before the table, both rows in the parser's <tbody>.
    name: "a block between two rows in a <table>: the parser fosters it out of the range, nothing is touched",
    App: () => (
      <table>
        <Errored fallback={<Row>failed</Row>}>
          <Row>first</Row>
          <Card>note</Card>
          <Row>{slot(fail(5, "row failed"))}</Row>
        </Errored>
      </table>
    ),
    body: `<div class="card">note</div><table><tbody><tr><td>first</td></tr><tr><td></td></tr></tbody></table>`
  },
  {
    // Only the placeholder for the first end, which the page no longer has.
    name: "limit: a settled <Loading> whose content ends in text: the end cannot be named, the page refuses, and is main's page",
    App: () => {
      const a = ok(3, "A");
      const b = fail(15, "B");
      return inMain(() => (
        <Loading fallback={<i>a</i>}>
          {a()}
          {slot(b)}
        </Loading>
      ));
    },
    swap: `"3",[["300"]],[["300"],["3000010"]],1`,
    heard: ["B fallback"],
    body: `<main>A</main>`
  }
];

describe("#5223: a nested Loading failing after the shell", () => {
  test("markup between the two: the fallback is sent for the Errored's region, nothing added to the shell", async () => {
    const { shell, rest, heard, calls } = await stream(Basic);
    // The shell as on main: no marker.
    expect(strip(shell)).toBe(
      `<main _hk=1><b _hk=200><template id="pl-2010"></template><i _hk=20100>loading</i><!--pl-2010--></b></main>`
    );
    // The fallback keyed by the Errored id, then the failed fragment as
    // before (its empty template, its channel rejected).
    expect(strip(rest)).toBe(
      `<template id="2"><p _hk=30>failed: <!--$-->no user 7<!--/--></p></template><template id="2010" e></template>`
    );
    expect(calls).toEqual([`"2",["200"],["200"],1`]);
    expect(rest.indexOf(`$dfx("2"`)).toBeLessThan(rest.indexOf(`$df("2010")`));
    // The error staged, not at the Errored id: the page moves it there with
    // the swap.
    expect(hydrationRecordKeys(shell + rest).sort()).toEqual(["0", "2010_fr", "2_ef"]);
    expect(heard).toEqual(["no user 7 fallback"]);

    const p = page(shell + rest);
    expect(p.errors).toEqual([]);
    expect(p.body).toBe(`<main><p>failed: no user 7</p></main>`);
    expect(p.records).toEqual(["0", "2", "2010_fr"]);
    expect(p.templates).toEqual([]);
    expect(p.queued).toEqual([]);
  });

  test("a client runtime already started: nothing is swapped, the page is as before, no record at the Errored id", async () => {
    const { shell, rest } = await stream(Basic);
    const p = page(shell + rest, { booted: true });
    expect(p.errors).toEqual([]);
    // Main's page: the failed Loading's position blank, for the client to
    // render the failure over.
    expect(p.body).toBe(`<main><b></b></main>`);
    expect(p.records).toEqual(["0", "2010_fr"]);
    expect(p.templates).toEqual([]);
  });

  describe("sent and swapped", () => {
    test.each(swapped)("$name", c => check(c, "swapped"));
  });
  describe("nothing sent, the stream is main's and the client renders the failure", () => {
    test.each(nothingSent)("$name", c => check(c, "nothing sent"));
  });
  describe("sent, but the page refuses the range: main's page", () => {
    test.each(pageRefuses)("$name", c => check(c, "page refuses"));
  });

  test("a source that never settles holds the response as on main; the fallback that read it adds no wait (review NEVER)", async () => {
    // The source is serialized when it is created, read or not: the
    // response stays open on it with or without this change. What this pins
    // is that everything else goes out, the outer boundary's fallback
    // included, without waiting on the inner one's.
    const { heard, onError } = hookLog();
    let out = "";
    let ended = false;
    renderToStream(
      () => {
        const hint = createMemo(() => new Promise<string>(() => {}));
        return <Overtake hint={hint} />;
      },
      { onError }
    ).pipe({ write: (c: string) => void (out += c), end: () => void (ended = true) } as any);
    await sleep(60);
    expect(ended).toBe(false);
    expect(swaps(out).length).toBe(1);
    expect(out).not.toContain("inner:");
    expect(heard).toEqual(["inner failure client", "outer failure fallback"]);
    const p = page(out);
    expect(p.errors).toEqual([]);
    expect(p.body).toBe(`<div><p>outer fallback</p></div>`);
    expect(p.templates).toEqual([]);
  });

  test("the hook's mapping is what the fallback and the record carry", async () => {
    const { heard, onError } = hookLog(() => new Error("sanitized"));
    const { shell, rest } = await recordStream(() => <Basic />, { onError });
    expect(heard).toEqual(["no user 7 fallback"]);
    expect(strip(rest)).toContain(`failed: <!--$-->sanitized<!--/-->`);
    expect(rest).toMatch(/_\$HY\.r\["2_ef"\]=\$R\[\d+\]=new Error\("sanitized"\)/);
    const p = page(shell + rest);
    expect(p.body).toBe(`<main><p>failed: sanitized</p></main>`);
    expect((p.doc.defaultView as any)._$HY.r["2"].message).toBe("sanitized");
  });

  // A hook that throws: the default wire value stands. A hook that answers
  // a promise: the record is what the fallback read.
  test.each([
    [
      "throws",
      () => {
        throw new Error("hook threw");
      },
      `<main><p>failed: no user 7</p></main>`
    ],
    ["answers a promise", async () => new Error("mapped async"), undefined]
  ] as const)(
    "the record survives the swap when the hook %s (review S4a, S4b)",
    async (_, onError, body) => {
      const { shell, rest } = await recordStream(() => <Basic />, { onError } as any);
      const p = page(shell + rest);
      expect(p.errors).toEqual([]);
      if (body) expect(p.body).toBe(body);
      expect(p.records).toContain("2");
      expect(rest).not.toContain(`delete _$HY.r["2"]`);
    }
  );

  const race = {
    sync: (go: () => void) => go(),
    micro: queueMicrotask,
    immediate: (go: () => void) => void setImmediate(go),
    t0: (go: () => void) => void setTimeout(go, 0)
  };
  test.each(Object.keys(race) as (keyof typeof race)[])(
    "a failure racing the shell's completion (%s) is sent like any other after it (review S8, SHELL-RACE)",
    async when => {
      let reject!: (e: any) => void;
      const App = () => {
        const p = new Promise<string>((_, j) => (reject = j));
        p.catch(() => {});
        const a = createMemo(() => p);
        return inMain(() => (
          <>
            <span>keep</span>
            {slot(a)}
          </>
        ));
      };
      const options = {
        onCompleteShell: () => race[when](() => reject(new Error("race " + when)))
      };
      const body = `<main><p>failed: race ${when}</p></main>`;
      await check({ name: when, App, options, heard: [`race ${when} fallback`], body }, "swapped");
    }
  );

  test("a transport sink has no page to swap in: nothing is sent (known limit)", async () => {
    const fragments: [string, string][] = [];
    const { heard, onError } = hookLog();
    await new Promise<void>(done => {
      renderToStream(() => <Basic />, {
        onError,
        sink: { fragment: (key: string, value: string) => void fragments.push([key, value]) }
      } as any).pipe({ write() {}, end: () => done() } as any);
    });
    expect(fragments.map(f => f[1])).toEqual([""]);
    expect(heard).toEqual(["no user 7 client"]);
  });

  test("an end held on the page by a stylesheet (a style-gated reveal): the placeholder is the end; the gated content, revealed later, is dropped", async () => {
    const LazyStyled = lazy(
      () => sleep(3).then(() => ({ default: () => <section>styled</section> })),
      undefined,
      "./Styled.tsx"
    );
    // Rendered only once its data is in: its module, and so its stylesheet,
    // is met after the shell.
    const Gate = () => {
      const ready = ok(3, "ready");
      return <>{ready() && <LazyStyled />}</>;
    };
    const { shell, rest, calls } = await stream(
      () => {
        const user = fail(20, "no user 7");
        return inMain(() => (
          <>
            {slot(user)}
            <Loading fallback={<i>styling</i>}>
              <Gate />
            </Loading>
          </>
        ));
      },
      { manifest: { "./Styled.tsx": { file: "assets/styled.js", css: ["assets/styled.css"] } } }
    );
    // The styled fragment went out first, gated on its stylesheet; its
    // placeholder first among the last end's candidates, its content's own
    // end next.
    expect(rest.indexOf("$dfs(")).toBeGreaterThanOrEqual(0);
    expect(rest.indexOf("$dfs(")).toBeLessThan(rest.indexOf("$dfx("));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^"2",\[\["\w+"\]\],\[\["(\w+)"\],"\w+"\],1$/);
    const p = page(shell + rest);
    expect(p.errors).toEqual([]);
    // No stylesheet loads under jsdom: the content stays held, so the
    // placeholder is the live end and the range closes at its comment.
    const gated = /\$dfs\("(\w+)"/.exec(rest)![1];
    expect(p.body.replace(/<link[^>]*>/g, "")).toBe(
      `<main><p>failed: no user 7</p></main><template id="${gated}"><section>styled</section></template>`
    );
    expect(p.records).toContain("2");
    // The stylesheet loading later reveals into nothing: the template goes.
    (p.doc.defaultView as any).$dfc(gated);
    expect(p.doc.getElementById(gated)).toBe(null);
    expect(p.doc.body.innerHTML).not.toContain("styled</section>");
  });

  test("a second render's fragment script, sent after the swap, re-declares $dfr: a late fragment of the replaced region stays as an inert queued template, the page is otherwise as swapped", async () => {
    const { shell, chunks } = await stream(() =>
      inMain(() => (
        <>
          <span>keep</span>
          {slot(fail(5, "A"))}
          {slot(ok(40, "late B"))}
        </>
      ))
    );
    const all = shell + chunks.join("");
    // This render's own fragment script, as a second render in the same
    // document sends it.
    const replace = /function \$df\(e\)[\s\S]*?document\.addEventListener\("error",\$dfe,!0\)/.exec(
      all
    )![0];
    const at = chunks.findIndex(c => c.includes("$dfx("));
    expect(at).toBeGreaterThanOrEqual(0);
    const p = page(
      shell +
        chunks.slice(0, at + 1).join("") +
        `<script>${replace}</script>` +
        chunks.slice(at + 1).join("")
    );
    expect(p.errors).toEqual([]);
    expect(p.body.replace(/<template[\s\S]*?<\/template>/g, "")).toBe(
      `<main><p>failed: A</p></main>`
    );
    // Without the wrapper the late fragment queues for its placeholder,
    // which went with the region: inert, never shown.
    expect(p.queued).toEqual(["1021"]);
    expect(p.templates).toEqual(["1021"]);
    // With the wrapper (one render), nothing stays.
    const one = page(all);
    expect([one.queued, one.templates]).toEqual([[], []]);
  });

  test("two streams on one page, each sending a swap: neither wraps the other's wrapper, and every later fragment of both reveals", async () => {
    const App = (props: { label: string }) => (
      <main data-root={props.label}>
        {slot(ok(5, props.label + " early"))}
        <Errored fallback={<p>{props.label} fallback</p>}>
          <section>{slot(fail(15, "bad"))}</section>
        </Errored>
        {slot(ok(30, props.label + " late"))}
      </main>
    );
    const a = await recordStream(() => <App label="A" />, { renderId: "rootA" } as any);
    const b = await recordStream(() => <App label="B" />, { renderId: "rootB" } as any);
    expect([a.chunks.length, b.chunks.length]).toEqual([3, 3]);
    // Interleaved: A's swap installs the wrapper, B's finds it installed.
    const p = page(a.shell + b.shell + [0, 1, 2].map(i => a.chunks[i] + b.chunks[i]).join(""));
    expect(p.errors).toEqual([]);
    expect([...p.doc.querySelectorAll("main")].map(el => el.textContent)).toEqual([
      "A earlyA fallbackA late",
      "B earlyB fallbackB late"
    ]);
    expect([p.templates, p.queued]).toEqual([[], []]);
  });

  // The page parses the fallback in the place it goes, as the document
  // around it reads it: the same nodes a synchronous render gives.
  const Cell = (props: { sync?: boolean }) =>
    props.sync ? throwBad() : <td>{slot(fail(5, "bad"))}</td>;
  test.each([
    [
      "a fallback in <svg> is SVG",
      (props: { sync?: boolean }) => (
        <svg>
          <Errored fallback={<circle data-error="" cx="10" cy="10" r="5" />}>
            <g>
              <Loading fallback={<text>pending</text>}>
                <text>{props.sync ? throwBad() : fail(5, "bad")()}</text>
              </Loading>
            </g>
          </Errored>
        </svg>
      ),
      `<svg><circle data-error="" cx="10" cy="10" r="5"></circle></svg>`
    ],
    [
      "a row fallback for a <tbody> in <table> is in the <tbody> the parser implies",
      (props: { sync?: boolean }) => (
        <table>
          <Errored fallback={<Row>error row</Row>}>
            <tbody>
              <tr>
                <Cell sync={props.sync} />
              </tr>
            </tbody>
          </Errored>
        </table>
      ),
      `<table><tbody><tr><td>error row</td></tr></tbody></table>`
    ]
  ] as const)("%s, as a synchronous server render gives it", async (_, App, body) => {
    const { shell, rest, calls } = await stream(App);
    expect(calls).toHaveLength(1);
    const streamed = page(shell + rest);
    const sync = page(renderToString(() => <App sync />));
    expect(streamed.errors).toEqual([]);
    expect(streamed.body).toBe(body);
    expect(streamed.body).toBe(sync.body);
    const ns = (p: Page) =>
      [...p.doc.querySelectorAll("svg, svg *, table, table *")].map(n => n.namespaceURI);
    expect(ns(streamed)).toEqual(ns(sync));
  });

  // Only plain markup is sent: a fallback that registers anything (head
  // tags, stylesheets, inline styles, lazy modules, records) or has a
  // <Loading> of its own is not, and registers nothing while it is tried.
  // The page is main's, and a later <Loading> that renders the same
  // component sends what it registers, as on main.
  const LazyFallback = lazy(
    async () => ({ default: () => <p>error fallback</p> }),
    undefined,
    "./Fallback5223.tsx"
  );
  const manifest = {
    "./Fallback5223.tsx": { file: "assets/fallback.js", css: ["assets/fallback.css"] }
  };
  const notPlain: [string, () => any, string][] = [
    [
      "a useHead stylesheet",
      () => {
        useHead({ tag: "link", props: { rel: "stylesheet", href: "/fallback.css" } });
        return <p>error fallback</p>;
      },
      "/fallback.css"
    ],
    ["a lazy component's stylesheet and module", LazyFallback, "assets/fallback.js"],
    [
      "a deferred useHead group",
      () => {
        useHead(() => ({
          tag: "link",
          props: { rel: "stylesheet", href: "/deferred.css", crossorigin: "anonymous" }
        }));
        return <p>error fallback</p>;
      },
      "/deferred.css"
    ],
    [
      "an inline style",
      () => {
        (sharedConfig as any).context.registerAsset("inline-style", {
          id: "wide",
          content: "#outside{display:none}"
        });
        return <p>error fallback</p>;
      },
      "#outside{display:none}"
    ],
    [
      "a head title",
      () => {
        useHead({ tag: "title", props: { children: "Error title" } });
        return <p>error fallback</p>;
      },
      "Error title"
    ],
    [
      "a <Loading> of its own (review S3)",
      () => <p>error fallback{slot(ok(30, "help"))}</p>,
      "help"
    ],
    [
      "a <Loading> of its own whose content registers a stylesheet later",
      () => (
        <p>
          error fallback
          <Loading fallback={<i>help loading</i>}>
            {(() => {
              const ready = ok(30, "ready");
              const Late = () => {
                useHead({ tag: "link", props: { rel: "stylesheet", href: "/later.css" } });
                return <b>help</b>;
              };
              return <>{ready() && <Late />}</>;
            })()}
          </Loading>
        </p>
      ),
      "/later.css"
    ],
    [
      "a getHydrationWriter value (the key stays free for the later write)",
      () => {
        getHydrationWriter()!.write("sq:user5223", { name: "user-5223" });
        return <p>error fallback</p>;
      },
      "user-5223"
    ]
  ];
  test.each(notPlain)("a fallback with %s: nothing sent, main's page", async (_, F, sent) => {
    await LazyFallback.preload();
    const Later = () => {
      const ready = ok(40, "x");
      return <>{ready() && <F />}</>;
    };
    await check(
      {
        name: _,
        App: () => (
          <>
            <Section fallback={<F />} />
            <Loading fallback={<i>later</i>}>
              <Later />
            </Loading>
          </>
        ),
        options: { manifest },
        heard: ["bad client"],
        leftover: true,
        more: (r, p) => {
          expect(p.body).toMatch(/^<main><section><\/section><\/main>/);
          // Sent by the later <Loading> alone, after the failure.
          expect(r.rest.indexOf(sent)).toBeGreaterThan(r.rest.indexOf(`<template id="1010"`));
          expect(p.records.filter(k => k.startsWith("1"))).toEqual(["1010", "1011_fr"]);
        }
      },
      "nothing sent"
    );
  });

  test("an unfinished fallback sends nothing: not its stylesheet either", async () => {
    const Unfinished = () => {
      useHead({ tag: "link", props: { rel: "stylesheet", href: "/unsent.css", media: "all" } });
      return <p>{ok(30, "hint")()}</p>;
    };
    const { rest, calls } = await stream(() => <Section fallback={<Unfinished />} />);
    expect(calls).toEqual([]);
    expect(rest).not.toContain("unsent.css");
  });

  test("a fallback cleanup that throws as the trial discards it: the trial ends, the stream completes as on main", async () => {
    const Throws = () => {
      onCleanup(() => {
        throw new Error("cleanup threw");
      });
      useHead({ tag: "link", props: { rel: "stylesheet", href: "/cleanup.css" } });
      return <p>error fallback</p>;
    };
    const Later = () => <b>{ok(30, "later")()}</b>;
    const r = await Promise.race([
      stream(() => (
        <>
          <Section fallback={<Throws />} />
          <Loading fallback={<i>later</i>}>
            <Later />
          </Loading>
        </>
      )),
      sleep(2000).then(() => {
        throw new Error("the render did not end");
      })
    ]);
    expect(r.calls).toEqual([]);
    expect(r.heard).toEqual(["bad client"]);
    expect(r.rest).not.toContain("cleanup.css");
    expect(page(r.shell + r.rest).body).toBe("<main><section></section></main><b>later</b>");
  });

  test("a second root whose render id extends this boundary's id: the swap takes only its own root's fragments, the other root's late fragment still reveals", async () => {
    const a = await recordStream(() => <Section />, { renderId: "root" } as any);
    const TextLoading = (props: { ms: number; text: string; keyed?: boolean }) => {
      const read = ok(props.ms, props.text);
      return <Loading fallback="waiting">{props.keyed ? <u>{read()}</u> : read()}</Loading>;
    };
    const b = await recordStream(
      () =>
        ssr(
          ["<aside>", "", "</aside>"],
          <TextLoading ms={5} text="B early" />,
          <TextLoading ms={30} text="B late" keyed />
        ),
      { renderId: "root1widget" } as any
    );
    expect(swaps(a.rest)).toHaveLength(1);
    const p = page(a.shell + b.shell + b.chunks[0] + a.rest + b.chunks.slice(1).join(""));
    expect(p.errors).toEqual([]);
    expect(p.body).toBe(`<main><p>error fallback</p></main><aside>B early<u>B late</u></aside>`);
    expect([p.templates, p.queued]).toEqual([[], []]);
  });

  test("known limit: a second root whose render id extends this boundary's id reads as its content, so the swap is refused and both roots are as before", async () => {
    const a = await recordStream(() => <Section />, { renderId: "root" } as any);
    expect(swaps(a.rest)).toEqual([`"root1",["root100"],["root100"],1`]);
    const b = await recordStream(() => <aside data-b="">other root</aside>, {
      renderId: "root1widget"
    } as any);
    const p = page(a.shell + b.shell + a.rest);
    expect(p.errors).toEqual([]);
    expect(p.body).toBe(`<main><section></section></main><aside data-b="">other root</aside>`);
  });

  test("unsupported: two roots in one document sharing a render id share keys; the page sees the other root's copies outside the range and refuses", async () => {
    const App = (props: { label: string; failing?: boolean }) => (
      <main data-root={props.label}>
        <Errored fallback={<p>error {props.label}</p>}>
          <section>{slot(props.failing ? fail(5, "x") : ok(5, props.label))}</section>
        </Errored>
      </main>
    );
    const a = await recordStream(() => <App label="A" />);
    const b = await recordStream(() => <App label="B" failing />);
    expect(swaps(b.rest).length).toBe(1);
    const p = page(a.shell + b.shell + a.rest + b.rest);
    expect(p.errors).toEqual([]);
    // Nothing of either root replaced: main's page. (Shared ids also leave
    // main's own fragment swap to find whichever copy comes first.)
    expect(p.body).toBe(
      `<main data-root="A"><section><span>A</span></section></main><main data-root="B"><section></section></main>`
    );
  });

  describe("controls: nothing of the swap where nothing fails after the shell", () => {
    test("authored markup that looks like a stream range is sent as written (review AUTHORED)", async () => {
      const html = `<template id="pl-editor" e></template><b>authored</b><!--pl-editor-->`;
      const { shell } = await recordStream(() => <div innerHTML={html} />);
      expect(shell).toContain(html);
    });

    test("a Loading that settles after the shell: no fallback, no swap function, the stream as before", async () => {
      const { shell, rest, heard } = await stream(() => <Basic settles />);
      expect(strip(shell)).toBe(
        `<main _hk=1><b _hk=200><template id="pl-2010"></template><i _hk=20100>loading</i><!--pl-2010--></b></main>`
      );
      expect(strip(rest)).toBe(`<template id="2010"><span _hk=2010000>u7</span></template>`);
      expect(shell + rest).not.toContain("$dfx");
      expect(shell + rest).not.toContain("_ef");
      expect(heard).toEqual([]);
      expect(page(shell + rest).body).toBe(`<main><b><span>u7</span></b></main>`);
    });

    test("awaited renderToStream: drawn in the document, no swap; renderToString: the Loading's fallback, nothing else", async () => {
      const awaited = await renderToStream(() => <Basic />);
      expect(awaited).not.toContain("$dfx");
      expect(strip(awaited)).toBe(
        `<main _hk=1><p _hk=30>failed: <!--$-->no user 7<!--/--></p></main>`
      );
      const string = renderToString(() => <Basic />);
      expect(string).not.toContain("$dfx");
      expect(strip(string)).toBe(`<main _hk=1><b _hk=200><i _hk=20100>loading</i></b></main>`);
    });

    test("many rows that settle: no fallback machinery in the output (review S5)", async () => {
      const Item = (props: { i: number }) => {
        const a = createMemo(async () => {
          await Promise.resolve();
          return "v" + props.i;
        });
        return (
          <Errored fallback={<p>f</p>}>
            <tr>
              <td>{props.i}</td>
              <Loading fallback={<td>l</td>}>
                <td>{a()}</td>
              </Loading>
            </tr>
          </Errored>
        );
      };
      const items = Array.from({ length: 300 }, (_, i) => i);
      const { heard, onError } = hookLog();
      const html = await renderToStream(
        () => (
          <table>
            <For each={items}>{i => <Item i={i} />}</For>
          </table>
        ),
        { onError }
      );
      expect(heard).toEqual([]);
      expect(html).not.toContain("$dfx");
      expect(html).not.toContain(" e>");
      expect(html).toContain("v299");
    });

    test("a successful render under a root Errored reads no markup: `locate` is never asked, no tag is read, while a failure does both", async () => {
      // Counts the renderer's `locate` calls, the only place the after-shell
      // swap reads markup (its own and, through `region()`, a settled
      // <Loading>'s), and the tags its end reader (`markupEdges`) reads: its
      // tag-name pattern, sticky, is used nowhere else.
      const measure = async (failing: boolean) => {
        const calls: string[] = [];
        const Spy = () => {
          const shell = (sharedConfig as any).context.shell;
          const locate = shell.locate;
          shell.locate = (id: string, ...args: any[]) => (calls.push(id), locate(id, ...args));
          return <></>;
        };
        const read = () => (failing ? fail(40, "bad") : ok(40, "fine"));
        let tags = 0;
        const exec = RegExp.prototype.exec;
        const spy = vi.spyOn(RegExp.prototype, "exec").mockImplementation(function (
          this: RegExp,
          text: string
        ) {
          if (this.sticky && this.source === "[^\\s/>]+") tags++;
          return exec.call(this, text);
        });
        try {
          const r = await recordStream(() => (
            <Errored fallback={<p>error fallback</p>}>
              <Spy />
              <main>
                <h1>title</h1>
                {slot(ok(5, "a"))}
                <section>
                  {slot(ok(3, "b"))}
                  {slot(read())}
                </section>
                <ul>
                  <For each={[1, 2, 3]}>{n => <li>{slot(ok(4 + n, `row ${n}`))}</li>}</For>
                </ul>
              </main>
            </Errored>
          ));
          return { ...r, calls, tags };
        } finally {
          spy.mockRestore();
        }
      };
      const fine = await measure(false);
      expect(fine.shell).not.toContain("error fallback");
      expect(fine.rest).toContain("row 3");
      expect(fine.rest).toContain("fine");
      expect(fine.rest).not.toContain("$dfx");
      expect(fine.calls).toEqual([]);
      expect(fine.tags).toBe(0);
      // The control: the same tree with one read failing after the shell
      // asks once.
      const failing = await measure(true);
      expect(failing.calls.length).toBe(1);
      expect(failing.tags).toBeGreaterThan(0);
      expect(swaps(failing.rest).length).toBe(1);
    });
  });
});

function throwBad(): never {
  throw new Error("bad");
}
