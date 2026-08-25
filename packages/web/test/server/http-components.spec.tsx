/**
 * @jsxImportSource @solidjs/web
 *
 * The response primitives hoisted from SolidStart: `httpStatus` and
 * `httpHeader` declare against the request event's `response` head during
 * SSR for the lifetime of the calling reactive scope, and retract their
 * writes on disposal (snapshot/restore, not reset-to-default), with both
 * writes and retractions gated on `response.committed`. Also covers the
 * server half of `clientOnly` (fallback-only, import never started).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  httpHeader,
  httpStatus,
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
  committed?: boolean;
}): HttpEvent {
  return {
    request: new Request("http://localhost/"),
    locals: {},
    response: {
      status: init?.status ?? 200,
      statusText: init?.statusText,
      headers: new Headers(init?.headers),
      committed: init?.committed
    }
  };
}

function renderComplete(code: () => any): Promise<string> {
  return new Promise(resolve => {
    renderToStream(code).then(resolve);
  });
}

describe("httpStatus (server primitive)", () => {
  test("declares status and statusText on the event's response during SSR", () => {
    const event = makeEvent();
    const Page = () => {
      httpStatus(404, "Not Found");
      return <div>not found</div>;
    };
    storage.run(event, () => {
      renderToString(() => <Page />);
    });
    // Read synchronously after render — renderToString defers its dispose to
    // a macrotask, so the write is still in place for the integration.
    expect(event.response!.status).toBe(404);
    expect(event.response!.statusText).toBe("Not Found");
  });

  test("restores the snapshotted status on disposal, not a hardcoded 200", () => {
    // A 404 page whose inner boundary declares (then retracts) a different
    // status must come back to 404 — the SolidStart reference stomped this
    // back to 200.
    const event = makeEvent({ status: 404, statusText: "Not Found" });
    storage.run(event, () => {
      createRoot(dispose => {
        httpStatus(500, "Server Error");
        expect(event.response!.status).toBe(500);
        expect(event.response!.statusText).toBe("Server Error");
        dispose();
      });
    });
    expect(event.response!.status).toBe(404);
    expect(event.response!.statusText).toBe("Not Found");
  });

  test("declares and retracts from a conditional (if-branch) in a component body", () => {
    // The primitive form's point: no JSX slot needed — a bare call behind an
    // `if` in the component body declares for the component's scope and
    // un-declares when that scope is disposed.
    const Page = (props: { missing: boolean }) => {
      if (props.missing) httpStatus(404, "Not Found");
      return "page";
    };

    const skipped = makeEvent();
    storage.run(skipped, () => {
      createRoot(dispose => {
        Page({ missing: false });
        expect(skipped.response!.status).toBe(200);
        dispose();
      });
    });
    expect(skipped.response!.status).toBe(200);

    const taken = makeEvent();
    storage.run(taken, () => {
      createRoot(dispose => {
        Page({ missing: true });
        expect(taken.response!.status).toBe(404);
        expect(taken.response!.statusText).toBe("Not Found");
        dispose();
      });
    });
    expect(taken.response!.status).toBe(200);
    expect(taken.response!.statusText).toBeUndefined();
  });

  test("skips the restore once the response head is committed (head sent)", () => {
    const event = makeEvent({ status: 200 });
    storage.run(event, () => {
      createRoot(dispose => {
        httpStatus(404);
        // The integration sent the head mid-render.
        event.response!.committed = true;
        dispose();
      });
    });
    expect(event.response!.status).toBe(404);
  });

  test("write is a no-op when the response head is already committed", () => {
    const event = makeEvent({ status: 200, committed: true });
    storage.run(event, () => {
      createRoot(dispose => {
        httpStatus(404);
        dispose();
      });
    });
    expect(event.response!.status).toBe(200);
  });

  test("is a silent no-op on an event without a response head", () => {
    const event = { request: new Request("http://localhost/"), locals: {} } as HttpEvent;
    let html = "";
    storage.run(event, () => {
      const Page = () => {
        httpStatus(404);
        return <div>body</div>;
      };
      html = renderToString(() => <Page />);
    });
    expect(html).toContain("body");
    expect(html).not.toContain("404");
  });

  test("out-of-order sibling disposal keeps the surviving scope's status (#2984)", () => {
    const event = makeEvent();
    storage.run(event, () => {
      createRoot(disposeAll => {
        let disposeEarly!: () => void;
        createRoot(d => {
          disposeEarly = d;
          httpStatus(404, "Not Found");
        });
        createRoot(() => {
          httpStatus(500, "Server Error");
        });
        expect(event.response!.status).toBe(500);
        // The earlier writer recovers first; the later declaration survives.
        disposeEarly();
        expect(event.response!.status).toBe(500);
        expect(event.response!.statusText).toBe("Server Error");
        disposeAll();
      });
    });
    expect(event.response!.status).toBe(200);
    expect(event.response!.statusText).toBeUndefined();
  });

  test("retracting the later of two live declarations falls back to the earlier one (#2984)", () => {
    const event = makeEvent();
    storage.run(event, () => {
      createRoot(disposeAll => {
        createRoot(() => {
          httpStatus(404, "Not Found");
        });
        let disposeLate!: () => void;
        createRoot(d => {
          disposeLate = d;
          httpStatus(500, "Server Error");
        });
        expect(event.response!.status).toBe(500);
        disposeLate();
        expect(event.response!.status).toBe(404);
        expect(event.response!.statusText).toBe("Not Found");
        disposeAll();
      });
    });
    expect(event.response!.status).toBe(200);
  });

  test("streaming: status declared in the page survives the final dispose once committed", async () => {
    const event = makeEvent();
    const Page = () => {
      httpStatus(404);
      return <div>gone</div>;
    };
    const html = await storage.run(
      event,
      () =>
        new Promise<string>(resolve => {
          const chunks: string[] = [];
          renderToStream(() => <Page />, {
            onCompleteShell() {
              // The integration sends the head when the shell flushes.
              expect(event.response!.status).toBe(404);
              event.response!.committed = true;
            }
          }).pipe({
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

describe("httpHeader (server primitive)", () => {
  test("declares a header on the event's response during SSR", () => {
    const event = makeEvent();
    const Page = () => {
      httpHeader("cache-control", "no-store");
      return <div>body</div>;
    };
    storage.run(event, () => {
      renderToString(() => <Page />);
    });
    expect(event.response!.headers.get("cache-control")).toBe("no-store");
  });

  test("append adds to an existing value instead of replacing it", () => {
    const event = makeEvent({ headers: { link: "</a.css>; rel=preload" } });
    storage.run(event, () => {
      createRoot(() => {
        httpHeader("link", "</b.css>; rel=preload", { append: true });
      });
    });
    expect(event.response!.headers.get("link")).toBe(
      "</a.css>; rel=preload, </b.css>; rel=preload"
    );
  });

  test("restores the prior value on disposal", () => {
    const event = makeEvent({ headers: { "x-frame-options": "DENY" } });
    storage.run(event, () => {
      createRoot(dispose => {
        httpHeader("x-frame-options", "SAMEORIGIN");
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
        httpHeader("x-custom", "yes");
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
        httpHeader("vary", "Accept-Language", { append: true });
        expect(event.response!.headers.get("vary")).toBe("Accept, Accept-Language");
        dispose();
      });
    });
    expect(event.response!.headers.get("vary")).toBe("Accept");
  });

  test("set-cookie retraction is entry-exact: disposal restores the prior entry list", () => {
    // `get("set-cookie")` comma-joins multiple entries and a `set()` restore
    // would collapse them into ONE corrupt header (commas are legal inside a
    // single cookie's `Expires`) — the snapshot/restore rides
    // `getSetCookie()` + re-append instead.
    const event = makeEvent();
    event.response!.headers.append("set-cookie", "a=1; Path=/");
    event.response!.headers.append("set-cookie", "b=2; Path=/");
    storage.run(event, () => {
      createRoot(dispose => {
        httpHeader("set-cookie", "c=3; Path=/", { append: true });
        expect(event.response!.headers.getSetCookie()).toEqual([
          "a=1; Path=/",
          "b=2; Path=/",
          "c=3; Path=/"
        ]);
        dispose();
      });
    });
    expect(event.response!.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
  });

  test("set-cookie recovery: an errored sibling's retraction leaves the survivor's entries whole", () => {
    // Two sibling scopes each append a cookie; the later one errors and
    // recovers (its scope disposes). Its retraction must restore the exact
    // entry list from its write time — the survivor's cookie stays a
    // separate entry, not half of a comma-joined blob.
    const event = makeEvent();
    storage.run(event, () => {
      createRoot(dispose => {
        createRoot(() => {
          httpHeader("set-cookie", "survivor=1; Path=/; HttpOnly", { append: true });
        });
        let disposeErrored!: () => void;
        createRoot(d => {
          disposeErrored = d;
          httpHeader("set-cookie", "errored=1; Path=/", { append: true });
        });
        expect(event.response!.headers.getSetCookie()).toEqual([
          "survivor=1; Path=/; HttpOnly",
          "errored=1; Path=/"
        ]);
        // the boundary errors and recovers — only its own write retracts
        disposeErrored();
        expect(event.response!.headers.getSetCookie()).toEqual(["survivor=1; Path=/; HttpOnly"]);
        dispose();
      });
    });
  });

  test("out-of-order sibling disposal keeps the survivor's set-cookie entries (#2984)", () => {
    // Sibling scopes dispose out of write order when an earlier async
    // boundary recovers while a later sibling stays live. Retraction must
    // remove only the disposed scope's own declaration — a write-time
    // snapshot restore would wipe the later survivor's cookie too.
    const event = makeEvent();
    storage.run(event, () => {
      createRoot(disposeAll => {
        let disposeEarly!: () => void;
        createRoot(d => {
          disposeEarly = d;
          httpHeader("set-cookie", "early=1; Path=/", { append: true });
        });
        createRoot(() => {
          httpHeader("set-cookie", "session=abc; Path=/; HttpOnly", { append: true });
        });
        expect(event.response!.headers.getSetCookie()).toEqual([
          "early=1; Path=/",
          "session=abc; Path=/; HttpOnly"
        ]);
        // The EARLIER writer recovers/disposes while the later one survives.
        disposeEarly();
        expect(event.response!.headers.getSetCookie()).toEqual(["session=abc; Path=/; HttpOnly"]);
        disposeAll();
      });
    });
    expect(event.response!.headers.getSetCookie()).toEqual([]);
  });

  test("out-of-order sibling disposal keeps a later append on a plain header (#2984)", () => {
    const event = makeEvent();
    storage.run(event, () => {
      createRoot(disposeAll => {
        let disposeEarly!: () => void;
        createRoot(d => {
          disposeEarly = d;
          httpHeader("x-shared", "early");
        });
        createRoot(() => {
          httpHeader("x-shared", "late", { append: true });
        });
        expect(event.response!.headers.get("x-shared")).toBe("early, late");
        disposeEarly();
        // The survivor's append stands alone — not null, not "early, late".
        expect(event.response!.headers.get("x-shared")).toBe("late");
        disposeAll();
      });
    });
    expect(event.response!.headers.has("x-shared")).toBe(false);
  });

  test("a fresh declaration after full retraction re-reads the current base (#2984)", () => {
    // Once every declaration for a header retracts, a later declaration must
    // capture whatever the integration wrote in the meantime, not a stale base.
    const event = makeEvent();
    storage.run(event, () => {
      createRoot(dispose => {
        httpHeader("x-phase", "one");
        dispose();
      });
      event.response!.headers.set("x-phase", "integration");
      createRoot(dispose => {
        httpHeader("x-phase", "two", { append: true });
        expect(event.response!.headers.get("x-phase")).toBe("integration, two");
        dispose();
      });
    });
    expect(event.response!.headers.get("x-phase")).toBe("integration");
  });

  test("write and retraction are no-ops once the response head is committed", () => {
    const committed = makeEvent({ headers: { "x-a": "1" }, committed: true });
    storage.run(committed, () => {
      createRoot(dispose => {
        httpHeader("x-a", "2");
        dispose();
      });
    });
    expect(committed.response!.headers.get("x-a")).toBe("1");

    const midway = makeEvent();
    storage.run(midway, () => {
      createRoot(dispose => {
        httpHeader("x-b", "kept");
        midway.response!.committed = true;
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
