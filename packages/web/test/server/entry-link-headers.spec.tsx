/**
 * @jsxImportSource @solidjs/web
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  renderToStream,
  renderToString,
  createRequestEvent,
  createSSRResponse
} from "@solidjs/web";
import type { RequestEvent, ResponseStub } from "@solidjs/web";

type HttpEvent = RequestEvent & { response: ResponseStub };

const RequestContext = Symbol.for("solid.RequestContext");
let storage: AsyncLocalStorage<HttpEvent>;

beforeAll(() => {
  storage = new AsyncLocalStorage();
  (globalThis as any)[RequestContext] = storage;
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

const manifest = {
  _base: "/",
  "src/entry-client.tsx": {
    file: "assets/entry-client.js",
    isEntry: true,
    imports: ["src/shared.tsx"],
    css: ["assets/entry.css"]
  },
  "src/shared.tsx": { file: "assets/shared.js", css: ["assets/shared.css"] },
  "src/Lazy.tsx": { file: "assets/lazy.js", isDynamicEntry: true }
};

const ENTRY_LINKS =
  "</assets/entry.css>; rel=preload; as=style, </assets/shared.css>; rel=preload; as=style, " +
  "</assets/entry-client.js>; rel=preload; as=script; crossorigin, </assets/shared.js>; rel=preload; as=script; crossorigin";

function App() {
  return (
    <html>
      <head>
        <title>Test</title>
      </head>
      <body>
        <div>Hello</div>
      </body>
    </html>
  );
}

function makeEvent() {
  return createRequestEvent(new Request("http://localhost/")) as HttpEvent;
}

describe("entry Link headers", () => {
  test("a string render adds the entry's scripts and stylesheets to the response", () => {
    const event = makeEvent();
    const html = storage.run(event, () => renderToString(() => <App />, { manifest }));
    expect(event.response.headers.get("link")).toBe(ENTRY_LINKS);
    expect(createSSRResponse(html, event).headers.get("link")).toBe(ENTRY_LINKS);
  });

  test("a streamed render sends them with the shell", async () => {
    const event = makeEvent();
    const response = await storage.run(event, async () =>
      createSSRResponse(
        renderToStream(() => <App />, { manifest }),
        event
      )
    );
    expect(response.headers.get("link")).toBe(ENTRY_LINKS);
    await response.text();
  });

  test("keeps a Link value the host passes as the base response head", () => {
    const event = makeEvent();
    const html = storage.run(event, () => renderToString(() => <App />, { manifest }));
    const response = createSSRResponse(html, event, {
      responseInit: { headers: { Link: '</feed.xml>; rel="alternate"' } }
    });
    expect(response.headers.get("link")).toBe(`</feed.xml>; rel="alternate", ${ENTRY_LINKS}`);
  });

  test("leaves out lazy chunks", () => {
    const event = makeEvent();
    storage.run(event, () => renderToString(() => <App />, { manifest }));
    expect(event.response.headers.get("link")).not.toContain("lazy.js");
  });

  test("keeps a Link value the app set and does not repeat its target", () => {
    const event = makeEvent();
    event.response.headers.set("link", "</assets/entry.css>; rel=preload; as=style");
    storage.run(event, () => renderToString(() => <App />, { manifest }));
    expect(event.response.headers.get("link")).toBe(
      "</assets/entry.css>; rel=preload; as=style, " +
        "</assets/shared.css>; rel=preload; as=style, " +
        "</assets/entry-client.js>; rel=preload; as=script; crossorigin, </assets/shared.js>; rel=preload; as=script; crossorigin"
    );
  });

  test("hints only stylesheets when the page has no scripts", () => {
    const event = makeEvent();
    storage.run(event, () => renderToString(() => <App />, { manifest, noScripts: true }));
    expect(event.response.headers.get("link")).toBe(
      "</assets/entry.css>; rel=preload; as=style, </assets/shared.css>; rel=preload; as=style"
    );
  });

  test("encodes characters a header value cannot carry", () => {
    const event = makeEvent();
    storage.run(event, () =>
      renderToString(() => <App />, {
        manifest: { "src/entry.tsx": { file: "assets/é>😀.js", isEntry: true } }
      })
    );
    expect(event.response.headers.get("link")).toBe(
      "</assets/%C3%A9%3E%F0%9F%98%80.js>; rel=preload; as=script; crossorigin"
    );
  });

  test("does not write to a committed response head", () => {
    const event = makeEvent();
    event.response.committed = true;
    storage.run(event, () => renderToString(() => <App />, { manifest }));
    expect(event.response.headers.get("link")).toBe(null);
  });

  test("renders without a request event", () => {
    expect(renderToString(() => <App />, { manifest })).toContain("/assets/entry.css");
  });

  test("adds nothing for a resolver manifest", () => {
    const event = makeEvent();
    storage.run(event, () =>
      renderToString(() => <App />, { manifest: () => ({ js: [], css: [] }) })
    );
    expect(event.response.headers.get("link")).toBe(null);
  });
});
