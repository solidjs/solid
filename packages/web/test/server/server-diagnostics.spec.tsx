/**
 * @jsxImportSource @solidjs/web
 */
// Server findings on `OBSERVE.diagnostics` (server-dev-build-plan P1/P2, RFC
// 08 server section). Two kinds of site, two gates:
//
// - WIRING (observe + dev): a fact the runtime reports whichever tier is
//   running — a render error it contained, a subtree it abandoned, a stream
//   the client left, a header write that missed the wire, a server-function
//   error it replaced. Emitted, never console'd by the channel.
// - CHECKS (dev only): guidance for a developer — an invalid preload
//   descriptor, a non-head tag, an unrecognized insert value. Emitted AND
//   reported once on the console.
//
// This suite imports source (`"_SOLID_DEV_"`/`"_SOLID_OBSERVE_"` are the
// unreplaced truthy literals, i.e. the dev tier); the artifact tests at the
// end pin the observe tier's shape on the built `server.observe.js` files.
//
// Component labels (`ownerPath: ["<App>", "<Page>"]`) come from the server
// `createComponent`, which the observe/dev tiers run under a labelled
// transparent owner. This suite compiles with `sourceNames` (see
// vite.config.server.mjs — the vite plugin's dev/observe postures), so a
// compiled `<Page />` is `createComponent(Page, {}, "Page")` rather than the
// prod inline `Page({})`; the labels here come from ordinary JSX.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  Errored,
  Loading,
  commitEventResponse,
  createRequestEvent,
  markSafeError,
  renderToStream,
  renderToString,
  useHead
} from "@solidjs/web";
import {
  OBSERVE,
  createMemo,
  lazy,
  NotReadyError,
  sharedConfig,
  type DiagnosticEvent
} from "solid-js";
import type { JSX } from "@solidjs/web";

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function renderComplete(code: () => any, options: any = {}): Promise<string> {
  return new Promise(resolve => {
    renderToStream(code, options).then(resolve);
  });
}

let capture: ReturnType<NonNullable<typeof OBSERVE>["diagnostics"]["capture"]>;
let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  capture = OBSERVE!.diagnostics.capture();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  capture.stop();
  warn.mockRestore();
  error.mockRestore();
});

const byCode = (code: DiagnosticEvent["code"]) => capture.events.filter(e => e.code === code);

describe("SSR_RENDER_ERROR_CONTAINED (wiring)", () => {
  test("an <Errored> fallback records the error it caught, located by component", async () => {
    function Bad(): JSX.Element {
      throw new Error("bad render");
    }
    function App() {
      return (
        <Errored fallback={<p>caught</p>}>
          <Bad />
        </Errored>
      );
    }
    const html = await renderComplete(() => <App />);
    expect(html).toContain("caught");

    const [event, ...rest] = byCode("SSR_RENDER_ERROR_CONTAINED");
    expect(rest).toHaveLength(0);
    expect(event.kind).toBe("ssr");
    expect(event.severity).toBe("error");
    expect(event.message).toContain("Render error caught by <Errored>: Error: bad render");
    expect(event.data!.handling).toBe("fallback");
    expect((event.data!.error as Error).message).toBe("bad render");
    // The server `createComponent` labels its owner (`<Name>`), the same
    // field and walk as the client — and, as on the client, the compiled
    // `<Errored>` is a component call too. The finding locates where the
    // error was THROWN (the owner scope it escaped, stamped as it did) and
    // names the boundary that met it in `data.boundaryPath`.
    expect(event.ownerPath).toEqual(["<App>", "<Errored>", "<Bad>"]);
    expect(event.data!.boundaryPath).toEqual(["<App>", "<Errored>"]);
    // Wiring in the dev tier: the channel got it AND the console face
    // reported it once, with the location — a developer sees the contained
    // error `renderToStream`'s `onError` never hears. (The observe tier
    // emits only; see the artifact tests below.)
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("[SSR_RENDER_ERROR_CONTAINED]");
    expect(String(error.mock.calls[0][0])).toContain("in <App>");
    expect(warn).not.toHaveBeenCalled();
  });

  test("a <Loading> boundary whose fragment rejects records the client re-render route", async () => {
    function Child() {
      const bad = createMemo(async () => {
        await delay(5);
        throw new Error("late-boom");
      });
      return <div>{bad()}</div>;
    }
    function App() {
      return (
        <Loading fallback={<i>loading</i>}>
          <Child />
        </Loading>
      );
    }
    await renderComplete(() => <App />);

    const events = byCode("SSR_RENDER_ERROR_CONTAINED");
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.every(e => e.data!.handling === "client")).toBe(true);
    expect(events[0].message).toContain("the fragment rejected and the client re-renders it");
    expect(events[0].message).toContain("late-boom");
    expect(events[0].ownerPath).toEqual(["<App>", "<Loading>", "<Child>"]);
    expect(events[0].data!.boundaryPath).toEqual(["<App>", "<Loading>"]);
    expect(typeof events[0].data!.boundary).toBe("string");
  });

  test("a root error with no boundary records the failed request once, beside onError", async () => {
    let first = true;
    const errors: any[] = [];
    await renderComplete(
      () => (
        <div>
          {
            (() => {
              if (first) {
                first = false;
                throw new NotReadyError(Promise.resolve() as any);
              }
              throw new Error("boom on retry");
            }) as unknown as JSX.Element
          }
        </div>
      ),
      { onError: (err: any) => errors.push(err) }
    );
    expect(errors.map(e => e?.message)).toEqual(["boom on retry"]);

    const [event, ...rest] = byCode("SSR_RENDER_ERROR_CONTAINED");
    expect(rest).toHaveLength(0);
    expect(event.data!.handling).toBe("failed");
    expect(event.message).toContain("Render error outside any boundary — the request failed");
    expect(event.message).toContain("boom on retry");
    // No boundary owns it; no location.
    expect(event.ownerPath).toBeUndefined();
  });
});

describe("SSR_SUBTREE_ABANDONED (wiring)", () => {
  test("a rejected fragment that discards nested pending work records what it threw away", async () => {
    // The #3165 shape: the discarded subtree holds a nested <Loading> whose
    // resume loop is parked forever. Its release is the abandonment.
    const never = new Promise<string>(() => {});
    function Inner() {
      const stuck = createMemo(async () => never);
      return <p>{stuck()}</p>;
    }
    function Child() {
      const bad = createMemo(async () => {
        await delay(5);
        throw new Error("late-boom");
      });
      return (
        <div>
          {bad()}
          <Loading fallback={<i>inner</i>}>
            <Inner />
          </Loading>
        </div>
      );
    }
    const completed = renderComplete(() => (
      <html>
        <body>
          <Errored fallback={<p>caught</p>}>
            <Loading fallback={<i>loading</i>}>
              <Child />
            </Loading>
          </Errored>
        </body>
      </html>
    ));
    const ended = await Promise.race([completed.then(() => true), delay(1500).then(() => false)]);
    expect(ended).toBe(true);

    const [event, ...rest] = byCode("SSR_SUBTREE_ABANDONED");
    expect(rest).toHaveLength(0);
    expect(event.kind).toBe("ssr");
    expect(event.severity).toBe("warn");
    expect(typeof event.data!.fragment).toBe("string");
    expect(event.data!.fragments).toBe(1);
    expect((event.data!.error as Error).message).toBe("late-boom");
    expect(event.message).toContain("1 nested fragment(s)");
  });

  test("a leaf fragment's failure alone is not an abandonment", async () => {
    function Child() {
      const bad = createMemo(async () => {
        await delay(5);
        throw new Error("leaf-boom");
      });
      return <div>{bad()}</div>;
    }
    await renderComplete(() => (
      <Loading fallback={<i>loading</i>}>
        <Child />
      </Loading>
    ));
    expect(byCode("SSR_SUBTREE_ABANDONED")).toHaveLength(0);
    expect(byCode("SSR_RENDER_ERROR_CONTAINED").length).toBeGreaterThanOrEqual(1);
  });
});

describe("SSR_STREAM_ABANDONED (wiring)", () => {
  test("a sink that throws mid-stream records the disconnect and the pending work", async () => {
    const never = new Promise<string>(() => {});
    function Slow() {
      const stuck = createMemo(async () => never);
      return <p>{stuck()}</p>;
    }
    let writes = 0;
    renderToStream(() => (
      <html>
        <body>
          <Loading fallback={<i>loading</i>}>
            <Slow />
          </Loading>
        </body>
      </html>
    )).pipe({
      write() {
        writes++;
        throw new Error("EPIPE");
      },
      end() {}
    });
    await delay(20);
    expect(writes).toBeGreaterThan(0);

    const [event, ...rest] = byCode("SSR_STREAM_ABANDONED");
    expect(rest).toHaveLength(0);
    expect(event.kind).toBe("ssr");
    expect(event.severity).toBe("warn");
    expect(event.data!.reason).toBe("sink");
    expect(event.data!.pendingFragments).toBe(1);
    expect(event.message).toContain("(sink)");
    expect(event.ownerPath).toBeUndefined();
    expect(error).not.toHaveBeenCalled();
  });

  test("the request's signal aborting records the disconnect, and nothing more reaches the sink", async () => {
    const never = new Promise<string>(() => {});
    function Slow() {
      const stuck = createMemo(async () => never);
      return <p>{stuck()}</p>;
    }
    const controller = new AbortController();
    let writes = 0;
    let ended = 0;
    renderToStream(
      () => (
        <html>
          <body>
            <Loading fallback={<i>loading</i>}>
              <Slow />
            </Loading>
          </body>
        </html>
      ),
      { signal: controller.signal }
    ).pipe({
      write() {
        writes++;
      },
      end() {
        ended++;
      }
    });
    await delay(10);
    expect(writes).toBeGreaterThan(0);
    const before = writes;

    controller.abort();
    await delay(10);
    const [event, ...rest] = byCode("SSR_STREAM_ABANDONED");
    expect(rest).toHaveLength(0);
    expect(event.data!.reason).toBe("signal");
    expect(event.data!.pendingFragments).toBe(1);
    expect(event.data!.shellFlushed).toBe(true);
    expect(event.message).toContain("(signal)");
    // A disconnect: the sink is never touched again, not even to end it.
    expect(writes).toBe(before);
    expect(ended).toBe(0);
    expect(error).not.toHaveBeenCalled();
  });

  test("a render failure winds down silently — it is the render error's finding, not a disconnect", async () => {
    let first = true;
    await renderComplete(
      () => (
        <div>
          {
            (() => {
              if (first) {
                first = false;
                throw new NotReadyError(Promise.resolve() as any);
              }
              throw new Error("boom on retry");
            }) as unknown as JSX.Element
          }
        </div>
      ),
      { onError() {} }
    );
    expect(byCode("SSR_STREAM_ABANDONED")).toHaveLength(0);
    expect(byCode("SSR_RENDER_ERROR_CONTAINED")).toHaveLength(1);
  });
});

describe("LATE_HEADER_WRITE (wiring)", () => {
  test("dev: recorded on the channel, then thrown — the throw is the console face", () => {
    const event = createRequestEvent(new Request("http://localhost/"));
    commitEventResponse(new Response("body"), event);
    expect(() => event.response.headers.set("x-late", "1")).toThrow(
      /\[LATE_HEADER_WRITE\] Response header write dropped/
    );

    const [finding, ...rest] = byCode("LATE_HEADER_WRITE");
    expect(rest).toHaveLength(0);
    expect(finding.kind).toBe("head");
    expect(finding.severity).toBe("error");
    expect(finding.data).toEqual({ method: "set", name: "x-late" });
    // Recorded, not reported: one console entry per finding, and here that
    // entry is the thrown error.
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("dev checks: emitted and reported once", () => {
  test("HEAD_TAG_INVALID: a non-head tag in useHead, located by component", () => {
    function Page() {
      useHead([{ tag: "div", props: {} } as any]);
      return <p>page</p>;
    }
    function App() {
      return <Page />;
    }
    renderToString(() => <App />);

    const [event, ...rest] = byCode("HEAD_TAG_INVALID");
    expect(rest).toHaveLength(0);
    expect(event.kind).toBe("head");
    expect(event.severity).toBe("warn");
    expect(event.data!.reason).toBe("non-head-tag");
    expect(event.message).toContain("ignoring non-head tag <div>");
    expect(event.ownerPath).toEqual(["<App>", "<Page>"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("[HEAD_TAG_INVALID]");
    expect(String(warn.mock.calls[0][0])).toContain("in <App> › <Page>");
  });

  test("HEAD_TAG_INVALID: an invalid attribute name", () => {
    renderToString(() => {
      useHead([{ tag: "meta", props: { "bad name": "x", name: "ok", content: "c" } } as any]);
      return <p>page</p>;
    });
    const [event] = byCode("HEAD_TAG_INVALID");
    expect(event.data).toEqual({ reason: "invalid-attribute", detail: "bad name" });
  });

  test("HEAD_TAG_INVALID: useHead outside a server render", () => {
    // A completed render leaves its context on `sharedConfig` (pre-existing);
    // "outside a render" means none is current.
    (sharedConfig as any).context = undefined;
    useHead([{ tag: "title", props: { children: "x" } } as any]);
    const [event] = byCode("HEAD_TAG_INVALID");
    expect(event.data).toEqual({ reason: "outside-render" });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("PRELOAD_DESCRIPTOR_INVALID: a manifest preload with no source and an unsupported destination", async () => {
    const manifest = () => ({
      js: ["/assets/mod.js"],
      css: [],
      preloads: [{ as: "script" }, { as: "video", href: "/v.mp4" }]
    });
    const Mod = () => <b>mod</b>;
    const LazyMod = lazy(() => Promise.resolve({ default: Mod }), undefined, "./Mod.tsx");
    await renderComplete(() => <LazyMod />, { manifest });

    const events = byCode("PRELOAD_DESCRIPTOR_INVALID");
    expect(events.map(e => e.data!.field).sort()).toEqual(["as", "href"]);
    expect(events.every(e => e.kind === "head" && e.severity === "warn")).toBe(true);
    const as = events.find(e => e.data!.field === "as")!;
    expect(as.data!.value).toBe("video");
    expect(as.message).toContain('unsupported as destination "video"');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  test("UNRECOGNIZED_INSERT_VALUE: a plain object at an insert position", () => {
    function App() {
      return <div>{{ not: "a template" } as any}</div>;
    }
    const html = renderToString(() => <App />);
    expect(html).toContain("<div");
    const [event, ...rest] = byCode("UNRECOGNIZED_INSERT_VALUE");
    expect(rest).toHaveLength(0);
    expect(event.kind).toBe("render");
    expect(event.data!.type).toBe("object");
    expect(event.ownerPath).toEqual(["<App>"]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("the observe tier, in the built artifacts", () => {
  test("LATE_HEADER_WRITE: recorded, reported through console.error, never thrown", async () => {
    // @ts-ignore — the dist file has no adjacent type declarations.
    const observe = await import("../../dist/server.observe.js");
    const event = observe.createRequestEvent(new Request("http://localhost/"));
    observe.commitEventResponse(new Response("body"), event);
    expect(() => event.response.headers.set("x-late", "1")).not.toThrow();
    expect(event.response.headers.get("x-late")).toBeNull();

    // The production behavior (report and drop) is intact…
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("[LATE_HEADER_WRITE]");
    // …and the observe tier adds the structured record, on the one channel
    // the test's own `solid-js` import sees (the artifact reaches it through
    // `solid-js`, one instance).
    const [finding, ...rest] = byCode("LATE_HEADER_WRITE");
    expect(rest).toHaveLength(0);
    expect(finding.data).toEqual({ method: "set", name: "x-late" });
    expect(warn).not.toHaveBeenCalled();
  });

  test("SERVER_ERROR_SANITIZED (server-function): the replaced error is the record", async () => {
    // @ts-ignore — the dist file has no adjacent type declarations.
    const sf = await import("../../server-functions/dist/server.observe.js");
    const original = new Error("SELECT * FROM users WHERE token = 'secret'");
    const replaced = sf.sanitizeServerError(original);
    expect(replaced).not.toBe(original);
    expect((replaced as Error).message).not.toContain("secret");

    const [finding, ...rest] = byCode("SERVER_ERROR_SANITIZED");
    expect(rest).toHaveLength(0);
    expect(finding.kind).toBe("ssr");
    // The server-function road is `error` where SSR's is advisory: no other
    // finding carries this failure.
    expect(finding.severity).toBe("error");
    expect(finding.data!.source).toBe("server-function");
    expect(finding.data!.error).toBe(original);
    expect(finding.data!.wire).toBe(replaced);
    expect(finding.message).toContain("[SERVER_ERROR_SANITIZED] Server function error");
    expect(finding.message).toContain("replaced with a generic Error");
    expect(finding.message).toContain("secret");
    expect(error).not.toHaveBeenCalled();

    // A branded-safe error passes through and records nothing.
    capture.clear();
    const safe = markSafeError(new Error("shown to the client"));
    expect(sf.sanitizeServerError(safe)).toBe(safe);
    expect(byCode("SERVER_ERROR_SANITIZED")).toHaveLength(0);
  });

  test("dev checks fold out of the observe artifact; wiring rides it", () => {
    const root = resolve(import.meta.dirname, "../..");
    const read = (p: string) => readFileSync(resolve(root, p), "utf8");
    const observe = read("dist/server.observe.js");
    const prod = read("dist/server.js");
    for (const wiring of [
      "SSR_RENDER_ERROR_CONTAINED",
      "SSR_SUBTREE_ABANDONED",
      "SSR_STREAM_ABANDONED"
    ]) {
      expect(observe, wiring).toContain(`[${wiring}]`);
      expect(prod, wiring).not.toContain(`[${wiring}]`);
    }
    for (const check of [
      "HEAD_TAG_INVALID",
      "PRELOAD_DESCRIPTOR_INVALID",
      "UNRECOGNIZED_INSERT_VALUE"
    ]) {
      expect(observe, check).not.toContain(`[${check}]`);
      expect(prod, check).not.toContain(`[${check}]`);
      expect(read("dist/server.dev.js"), check).toContain(`[${check}]`);
    }
  });
});
