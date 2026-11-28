/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #5223, hydrated: a nested `<Loading>` failing after the shell, replayed
 * from the parity harness artifacts (test/server/hydration-harness.spec.tsx)
 * in three arrival orders:
 *
 * - `loaded`: the whole stream is in before the client runs. The page took
 *   the fallback (where one was sent); the client adopts that node: nothing
 *   is rebuilt or asked again, and the fallback's effect runs once.
 * - `piece`: hydrated from the shell, then the stream script by script.
 * - `burst`: hydrated from the shell, then the rest at once.
 *   In both the runtime has started when the fallback arrives: the page
 *   leaves the region alone, no record lands at the Errored id, and the
 *   client renders the failure from the failed `<Loading>`, as before.
 *
 * Every order ends on what a client render shows, with no unhandled
 * rejection and no hydration warning but the key miss main already gives
 * when a sibling's fragment lands after the client replaced the region.
 */
import { describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { sharedConfig } from "solid-js/internal";
import { hydrate, render } from "@solidjs/web";
import {
  postflushNested,
  postflushNestedControl as control,
  postflushNestedName,
  postflushNestedShapes,
  type PostflushNestedShape
} from "../harness/scenarios.jsx";
import { ctl, Inner, plans, shapeName, shapes } from "../harness/errored-postflush-shapes-5223.jsx";
import { bootstrapHydrationGlobal } from "../harness/hydration-bootstrap.js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
function apply(container: HTMLElement, chunk: string, first: boolean) {
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  for (const m of chunk.matchAll(scriptRe)) (0, eval)(m[1]);
}
async function settle(n = 4) {
  for (let i = 0; i < n; i++) {
    await sleep(10);
    flush();
  }
}
// What the page reads and shows, without inert templates, comments or keys.
function textOf(el: Element) {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll("template").forEach(t => t.remove());
  return clone.textContent;
}
function view(el: Element) {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll("template").forEach(t => t.remove());
  return clone.innerHTML.replace(/<!--.*?-->/g, "").replace(/ _hk="?[\w]+"?/g, "");
}
// Records the swap brings: staged (`<id>_ef`) or at the id of an
// Errored whose fallback the stream sent.
const extraRecords = (r: Replay) =>
  Object.keys(r.hy.r).filter(k => k.endsWith("_ef") || r.swapped.includes(k));

type Mode = "loaded" | "piece" | "burst";
type Replay = {
  container: HTMLElement;
  hy: any;
  messages: string[];
  rejections: string[];
  /** The ids of the Errored boundaries whose fallback the stream sent. */
  swapped: string[];
  /** The page's root and fallback nodes before `hydrate()`. */
  root: Element | null;
  before: Element[];
};

/**
 * Replays the artifact `name` in `mode`, hydrating `App`, then runs `check`.
 * `on.shell` runs once the shell is applied, `on.loaded` once the whole
 * stream is (in `loaded`), both before `hydrate()`.
 */
async function replay(
  name: string,
  App: () => any,
  mode: Mode,
  check: (r: Replay) => Promise<void>,
  on: { shell?: (r: Replay) => void; loaded?: (r: Replay) => void } = {}
) {
  const artifact = resolve(
    dirname(fileURLToPath(import.meta.url)),
    `../harness/__artifacts__/${name}.json`
  );
  const { shell, rest } = JSON.parse(readFileSync(artifact, "utf-8"));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const r: Replay = {
    container,
    hy: bootstrapHydrationGlobal(),
    messages: [],
    rejections: [],
    swapped: [...rest.matchAll(/\$dfx\("(\w+)"/g)].map(m => m[1]),
    root: null,
    before: []
  };
  const log = (kind: string) => (a: unknown) =>
    void r.messages.push(`${kind}: ${String(a).slice(0, 160)}`);
  const warn = vi.spyOn(console, "warn").mockImplementation(log("warn"));
  const error = vi.spyOn(console, "error").mockImplementation(log("error"));
  const onRejection = (e: any) => void r.rejections.push(String(e?.message ?? e));
  process.on("unhandledRejection", onRejection);
  let dispose: (() => void) | undefined;
  try {
    apply(container, shell, true);
    on.shell?.(r);
    if (mode === "loaded") {
      apply(container, rest, false);
      on.loaded?.(r);
    }
    r.root = container.firstElementChild;
    r.before = [...container.querySelectorAll("p, circle")];
    dispose = hydrate(() => <App />, container);
    await settle();
    if (mode === "piece")
      for (const piece of rest.match(/[\s\S]*?<\/script>/g) ?? [rest]) {
        apply(container, piece, false);
        await settle();
      }
    if (mode === "burst") {
      apply(container, rest, false);
      await settle();
    }
    await check(r);
  } finally {
    process.off("unhandledRejection", onRejection);
    warn.mockRestore();
    error.mockRestore();
    dispose?.();
    await sleep(0);
    container.remove();
  }
}
const adopted = (r: Replay) =>
  r.before.length > 0 && r.before.every(node => r.container.contains(node));

describe("#5223: the harness's nested shapes, hydrated", () => {
  // `async-fallback`: a fallback with a bare async hole is not sent; the
  // client renders the failure in both orders.
  const failed = (shape: PostflushNestedShape) =>
    `failed: no user 7${shape === "async-fallback" ? " HINT" : ""}`;
  const loading: Record<PostflushNestedShape, string> = {
    element: "titleloading",
    sibling: "loadingtitle",
    "pending-sibling": "sib loadingloading",
    nested: "titleloading",
    "async-fallback": "titleloading"
  };
  const recovered: Record<PostflushNestedShape, string> = {
    element: "titleuser:u8",
    sibling: "user:u8title",
    "pending-sibling": "sibuser:u8",
    nested: "titleuser:u8",
    "async-fallback": "titleuser:u8"
  };
  const cases = postflushNestedShapes.flatMap(shape =>
    (["loaded", "piece"] as const).map(mode => ({ shape, mode }))
  );
  test.each(cases)(
    "$shape [$mode]: ends on the failure (in `loaded`, the page's fallback adopted), then recovers",
    ({ shape, mode }) => {
      const sent = shape !== "async-fallback";
      const asks = control.asks;
      const effects = control.effects;
      const App = postflushNested(shape);
      return replay(
        postflushNestedName(shape),
        App,
        mode,
        async r => {
          const div = r.container.querySelector("div")!;
          expect(div).toBe(r.root);
          if (mode === "piece") {
            // The page took nothing: no fallback template left, no record.
            expect(r.container.querySelectorAll(`template:not([e]):not([id^="pl-"])`).length).toBe(
              shape === "pending-sibling" ? 1 : 0
            );
            expect(extraRecords(r)).toEqual([]);
          }
          expect(textOf(div)).toBe(`${failed(shape)}tail`);
          expect(div.querySelectorAll("p").length).toBe(1);
          expect(sharedConfig.isHydrationInProgress!()).toBe(false);
          // The fallback ran its effect once: built once, never twice.
          expect(control.effects).toBe(effects + 1);
          if (mode === "loaded" && sent) {
            // Adopted: the server's node, no read asked again.
            expect(adopted(r)).toBe(true);
            expect(control.asks).toBe(asks);
          }
          // The Errored tracks the read it holds the failure of (#4273).
          const before = control.asks;
          control.setKey!("u8");
          flush();
          await settle();
          expect(textOf(div)).toBe(`${recovered[shape]}tail`);
          expect(div.querySelector("p")).toBe(null);
          expect(control.asks).toBe(before + 1);
          // `pending-sibling` from the shell: the sibling's fragment lands
          // after the client replaced the region, and the recovered content
          // misses its key. Main's behaviour for this order (the page took
          // nothing here), not this change's.
          const warned = r.messages.filter(m => m.startsWith("warn"));
          if (shape === "pending-sibling" && mode === "piece") {
            expect(warned.length).toBe(1);
            expect(warned[0]).toContain("Hydration key miss");
          } else expect(warned).toEqual([]);
          await sleep(5);
          expect(r.rejections).toEqual([]);
        },
        {
          // The shell: the Errored's content, the loading fallback in it.
          shell: r => expect(textOf(r.container)).toBe(`${loading[shape]}tail`),
          // With no runtime started the page took the fallback: in place of
          // the whole region, nothing left behind (`async-fallback`: nothing
          // was sent; the failed Loading's position is blank).
          loaded: r => {
            expect(textOf(r.container)).toBe(sent ? `${failed(shape)}tail` : "titletail");
            expect(r.container.querySelectorAll("template").length).toBe(0);
            expect(Object.keys(r.hy.r).some(k => k.endsWith("_ef"))).toBe(false);
          }
        }
      );
    }
  );

  // One root has finished hydrating when the fallback arrives, a second root
  // covering the region hydrates later. The runtime had started, so the page
  // took nothing and no record landed at the Errored id: the second root
  // hydrates the content as sent and renders the failure itself. It never
  // meets a record without its markup.
  test("a later hydration root on a page whose runtime had started: it renders the failure, no key miss", () => {
    const other = document.createElement("div");
    document.body.prepend(other);
    let first: (() => void) | undefined;
    const check = async (r: Replay) => {
      expect(textOf(r.container)).toBe("failed: no user 7tail");
      expect(r.messages.filter(m => m.startsWith("warn"))).toEqual([]);
    };
    return replay(postflushNestedName("element"), postflushNested("element"), "loaded", check, {
      shell: () => void (first = hydrate(() => null, other, { renderId: "other" })),
      // Not taken: the region as sent (the runtime holds the failed
      // fragment's own swap until a boundary claims it, as on main).
      loaded: r => {
        expect(textOf(r.container)).toBe("titleloadingtail");
        expect(extraRecords(r)).toEqual([]);
        expect(r.container.querySelector(`template:not([e]):not([id^="pl-"])`)).toBe(null);
      }
    }).finally(() => {
      first?.();
      other.remove();
    });
  });
});

// What a client render of a shape shows once the read has failed.
async function clientRender(key: string) {
  ctl.plan = plans[key];
  ctl.lazyDelay = 0;
  const App = shapes[key.slice(0, 2)];
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(() => <App />, container);
  await sleep(150);
  flush();
  await settle();
  const shown = view(container);
  dispose();
  container.remove();
  return shown;
}

// The further shapes (see
// test/harness/errored-postflush-shapes-5223.tsx). The fallback is live: its
// click handler runs and its effect ran once.
describe("#5223 shapes, hydrated", () => {
  // The fallback's tag; H2 is the Errored in a lazy component, its module
  // still loading (150ms) when the stream arrives: the root gathers when
  // `hydrate()` is called and renders once the module is in, so a fallback
  // arriving in between finds the runtime started and is not taken. H7 is
  // an SVG fallback: the page parses it as the <svg> it goes in reads it.
  const tag: Record<string, string> = {
    H1: "INNER",
    H2: "E",
    H4: "E",
    H4b: "E",
    H5: "E",
    H6: "E",
    H7: "E"
  };
  const cases = Object.keys(tag).flatMap(key =>
    (["loaded", "piece", "burst"] as const).map(mode => ({ key, mode }))
  );
  // The server writes the circle's attributes in another order.
  const sorted = (html: string) =>
    html.replace(/<circle ([^>]*)>/, (_, a) => `<circle ${a.split(" ").sort().join(" ")}>`);
  test.each(cases)(
    "$key [$mode]: ends as a client render does",
    async ({ key, mode }) => {
      const lazyDelay = key === "H2" ? 150 : 0;
      const expected =
        key === "H2" ? `<div><p>E: boom</p><footer>tail</footer></div>` : await clientRender(key);
      if (key === "H7") expect(expected).toContain(`data-error="boom"></circle>`);
      else expect(expected).toContain(`<p>${tag[key]}: boom</p>`);
      if (key === "H1") expect(expected).toContain("<h1>keep</h1>");
      ctl.plan = plans[key];
      ctl.asks = {};
      ctl.clicks = [];
      ctl.effects = [];
      ctl.lazyDelay = lazyDelay;
      await replay(
        shapeName(key),
        shapes[key.slice(0, 2)],
        mode,
        async r => {
          await sleep(lazyDelay ? lazyDelay + 150 : 120);
          flush();
          await settle();
          expect(sorted(view(r.container))).toBe(sorted(expected));
          if (key === "H7")
            expect(r.container.querySelector("circle")?.namespaceURI).toBe(
              "http://www.w3.org/2000/svg"
            );
          // H6 from the shell: the sibling's fragment lands after the client
          // replaced the region, and main warns of a key miss for it (the
          // page took nothing here). Pinned as that, not as wanted.
          if (key === "H6" && mode !== "loaded") {
            expect(r.messages.length).toBe(1);
            expect(r.messages[0]).toContain("Hydration key miss");
          } else expect(r.messages).toEqual([]);
          expect(r.rejections).toEqual([]);
          expect(Object.keys(r.hy.r).filter(k => k.endsWith("_ef"))).toEqual([]);
          if (mode === "loaded") {
            // The server's node, and (but for the lazy root's module) no read
            // asked again: the failed read's rejection and a sibling's value
            // (H6) are adopted.
            expect(adopted(r)).toBe(true);
            if (!lazyDelay) expect(ctl.asks).toEqual({});
          }
          r.container
            .querySelector("p, circle")
            ?.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
          flush();
          await settle(1);
          expect(ctl.clicks).toEqual([tag[key]]);
          if (key !== "H7") expect(ctl.effects).toEqual([tag[key]]);
        },
        {
          shell: r => {
            if (!lazyDelay) return;
            // The lazy module as the manifest names it, loading for `lazyDelay`.
            r.hy.modules = {};
            r.hy.loading = {};
            for (const k of Object.keys(r.hy.r))
              if (k.endsWith("_assets"))
                for (const m of Object.keys(r.hy.r[k]))
                  r.hy.loading[m] = sleep(lazyDelay).then(
                    () => void (r.hy.modules[m] = { default: Inner })
                  );
          }
        }
      );
    },
    20000
  );

  // Known limit: a <NoHydration> zone carries no hydration key, so nothing is
  // sent for it, and no client ever renders it. The page is main's: the
  // failed Loading's position blank when the stream is in before the
  // runtime starts, its loading fallback kept when the runtime started first
  // (it holds a swap nothing claims).
  test.each([
    ["loaded", `<div><b><em>title</em></b><footer>tail</footer></div>`],
    ["piece", `<div><b><em>title</em><i>loading A</i></b><footer>tail</footer></div>`]
  ] as const)(
    "H3 [%s], a <NoHydration> zone: the page as on main (known limit)",
    (mode, shown) => {
      ctl.plan = plans.H3;
      ctl.lazyDelay = 0;
      return replay(shapeName("H3"), shapes.H3, mode, async r => {
        await sleep(120);
        flush();
        await settle();
        expect(view(r.container)).toBe(shown);
        expect(r.messages).toEqual([]);
      });
    },
    20000
  );
});
