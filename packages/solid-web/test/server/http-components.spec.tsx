/**
 * @jsxImportSource @solidjs/web
 *
 * The JSX response components hoisted from SolidStart: `HttpStatusCode` and
 * `HttpHeader` write to the request event's `response` head during SSR and
 * retract their writes on disposal (snapshot/restore, not reset-to-default),
 * with both writes and retractions gated on `event.complete`. Also covers
 * the server half of `clientOnly` (fallback-only, import never started).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  HttpHeader,
  HttpStatusCode,
  clientOnly,
  renderToString,
  renderToStream,
  Loading
} from "@solidjs/web";
import type { RequestEvent, ResponseStub } from "@solidjs/web";
import { createRoot, type Component } from "solid-js";

// `response` is integration-augmented (see core's ResponseStub); model an
// integration event here.
type HttpEvent = RequestEvent & { response?: ResponseStub };

// The event scope the components read through getRequestEvent(): the
// AsyncLocalStorage @solidjs/web/storage's provideRequestEvent parks on the
// global under the registered RequestContext symbol.
const RequestContext = Symbol.for("solid.RequestContext");
let storage: AsyncLocalStorage<HttpEvent>;

beforeAll(() => {
  storage = new AsyncLocalStorage();
  (globalThis as any)[RequestContext] = storage;
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

function makeEvent(init?: {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  complete?: boolean;
}): HttpEvent {
  return {
    request: new Request("http://localhost/"),
    locals: {},
    response: {
      status: init?.status ?? 200,
      statusText: init?.statusText,
      headers: new Headers(init?.headers)
    },
    complete: init?.complete
  };
}

function renderComplete(code: () => any): Promise<string> {
  return new Promise(resolve => {
    renderToStream(code).then(resolve);
  });
}

describe("HttpStatusCode (server)", () => {
  test("sets status and statusText on the event's response during SSR", () => {
    const event = makeEvent();
    storage.run(event, () => {
      renderToString(() => (
        <div>
          <HttpStatusCode code={404} text="Not Found" />
          not found
        </div>
      ));
    });
    // Read synchronously after render — renderToString defers its dispose to
    // a macrotask, so the write is still in place for the integration.
    expect(event.response!.status).toBe(404);
    expect(event.response!.statusText).toBe("Not Found");
  });

  test("restores the snapshotted status on disposal, not a hardcoded 200", () => {
    // A 404 page whose inner boundary sets (then retracts) a different
    // status must come back to 404 — the SolidStart reference stomped this
    // back to 200.
    const event = makeEvent({ status: 404, statusText: "Not Found" });
    storage.run(event, () => {
      createRoot(dispose => {
        HttpStatusCode({ code: 500, text: "Server Error" });
        expect(event.response!.status).toBe(500);
        expect(event.response!.statusText).toBe("Server Error");
        dispose();
      });
    });
    expect(event.response!.status).toBe(404);
    expect(event.response!.statusText).toBe("Not Found");
  });

  test("skips the restore once the event is complete (head sent)", () => {
    const event = makeEvent({ status: 200 });
    storage.run(event, () => {
      createRoot(dispose => {
        HttpStatusCode({ code: 404 });
        // The integration sent the head mid-render.
        event.complete = true;
        dispose();
      });
    });
    expect(event.response!.status).toBe(404);
  });

  test("write is a no-op when the event is already complete", () => {
    const event = makeEvent({ status: 200, complete: true });
    storage.run(event, () => {
      createRoot(dispose => {
        HttpStatusCode({ code: 404 });
        dispose();
      });
    });
    expect(event.response!.status).toBe(200);
  });

  test("renders nothing and survives an event without a response head", () => {
    const event = { request: new Request("http://localhost/"), locals: {} } as HttpEvent;
    let html = "";
    storage.run(event, () => {
      html = renderToString(() => (
        <div>
          <HttpStatusCode code={404} />
          body
        </div>
      ));
    });
    expect(html).toContain("body");
    expect(html).not.toContain("404");
  });

  test("streaming: status set in the page survives the final dispose once complete", async () => {
    const event = makeEvent();
    const html = await storage.run(
      event,
      () =>
        new Promise<string>(resolve => {
          const chunks: string[] = [];
          renderToStream(
            () => (
              <div>
                <HttpStatusCode code={404} />
                gone
              </div>
            ),
            {
              onCompleteShell() {
                // The integration sends the head when the shell flushes.
                expect(event.response!.status).toBe(404);
                event.complete = true;
              }
            }
          ).pipe({
            write(v: string) {
              chunks.push(v);
            },
            end() {
              resolve(chunks.join(""));
            }
          });
        })
    );
    expect(html).toContain("gone");
    // The render tree was disposed at stream end, but the head had been
    // sent — the retraction is a no-op and the status stands.
    expect(event.response!.status).toBe(404);
  });
});

describe("HttpHeader (server)", () => {
  test("sets a header on the event's response during SSR", () => {
    const event = makeEvent();
    storage.run(event, () => {
      renderToString(() => (
        <div>
          <HttpHeader name="cache-control" value="no-store" />
          body
        </div>
      ));
    });
    expect(event.response!.headers.get("cache-control")).toBe("no-store");
  });

  test("append adds to an existing value instead of replacing it", () => {
    const event = makeEvent({ headers: { link: "</a.css>; rel=preload" } });
    storage.run(event, () => {
      renderToString(() => (
        <div>
          <HttpHeader name="link" value="</b.css>; rel=preload" append />
        </div>
      ));
    });
    expect(event.response!.headers.get("link")).toBe(
      "</a.css>; rel=preload, </b.css>; rel=preload"
    );
  });

  test("restores the prior value on disposal", () => {
    const event = makeEvent({ headers: { "x-frame-options": "DENY" } });
    storage.run(event, () => {
      createRoot(dispose => {
        HttpHeader({ name: "x-frame-options", value: "SAMEORIGIN" });
        expect(event.response!.headers.get("x-frame-options")).toBe("SAMEORIGIN");
        dispose();
      });
    });
    expect(event.response!.headers.get("x-frame-options")).toBe("DENY");
  });

  test("deletes the header on disposal when there was no prior value", () => {
    const event = makeEvent();
    storage.run(event, () => {
      createRoot(dispose => {
        HttpHeader({ name: "x-custom", value: "yes" });
        expect(event.response!.headers.get("x-custom")).toBe("yes");
        dispose();
      });
    });
    expect(event.response!.headers.has("x-custom")).toBe(false);
  });

  test("append retraction restores the pre-append value whole (no comma-splitting)", () => {
    // The SolidStart reference tried to splice its own value back out of the
    // joined string (splitting on ", " but joining with ",") — the snapshot
    // restore replaces that with an exact revert.
    const event = makeEvent({ headers: { vary: "Accept" } });
    storage.run(event, () => {
      createRoot(dispose => {
        HttpHeader({ name: "vary", value: "Accept-Language", append: true });
        expect(event.response!.headers.get("vary")).toBe("Accept, Accept-Language");
        dispose();
      });
    });
    expect(event.response!.headers.get("vary")).toBe("Accept");
  });

  test("write and retraction are no-ops once the event is complete", () => {
    const completed = makeEvent({ headers: { "x-a": "1" }, complete: true });
    storage.run(completed, () => {
      createRoot(dispose => {
        HttpHeader({ name: "x-a", value: "2" });
        dispose();
      });
    });
    expect(completed.response!.headers.get("x-a")).toBe("1");

    const midway = makeEvent();
    storage.run(midway, () => {
      createRoot(dispose => {
        HttpHeader({ name: "x-b", value: "kept" });
        midway.complete = true;
        dispose();
      });
    });
    expect(midway.response!.headers.get("x-b")).toBe("kept");
  });
});

describe("clientOnly (server)", () => {
  test("SSRs the fallback and never starts the import", () => {
    const importer = vi.fn(() => Promise.resolve({ default: (() => null) as Component<{}> }));
    const Widget = clientOnly(importer);
    const html = renderToString(() => (
      <div>
        <Widget fallback={<span>placeholder</span>} />
      </div>
    ));
    expect(html).toContain("placeholder");
    expect(importer).not.toHaveBeenCalled();
  });

  test("renders nothing without a fallback", () => {
    const Widget = clientOnly(() => Promise.resolve({ default: (() => null) as Component<{}> }));
    const html = renderToString(() => (
      <div>
        before
        <Widget />
        after
      </div>
    ));
    expect(html).toContain("before");
    expect(html).toContain("after");
  });

  test("streams the fallback in async trees", async () => {
    const Widget = clientOnly(() => Promise.resolve({ default: (() => null) as Component<{}> }));
    const html = await renderComplete(() => (
      <Loading fallback="loading…">
        <div>
          <Widget fallback={<span>placeholder</span>} />
        </div>
      </Loading>
    ));
    expect(html).toContain("placeholder");
  });
});
