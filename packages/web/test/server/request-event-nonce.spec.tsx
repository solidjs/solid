/**
 * @jsxImportSource @solidjs/web
 *
 * `RequestEvent.nonce`: renders and responses under a request scope use the
 * event's CSP nonce when they get no explicit `nonce` option, so middleware
 * can set it once on the event. An explicit option wins, and an explicit
 * `null`/`""`/`{ script: false, style: false }` sends none.
 *
 * Also covers event-first middleware: `composeMiddleware` hands each
 * middleware the event, `next()` takes no arguments, and a substituted
 * request is `event.request`.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  HydrationScript,
  Loading,
  composeMiddleware,
  createRequestEvent,
  createSSRResponse,
  getRequestEvent,
  renderToStream,
  renderToString
} from "@solidjs/web";
import type { CSPNonce, FetchMiddleware, RequestEvent } from "@solidjs/web";
import { createMemo } from "solid-js";

const RequestContext = Symbol.for("solid.RequestContext");
let storage: AsyncLocalStorage<RequestEvent>;
let previous: unknown;

beforeAll(() => {
  previous = (globalThis as any)[RequestContext];
  storage = new AsyncLocalStorage();
  (globalThis as any)[RequestContext] = storage;
});

afterAll(() => {
  (globalThis as any)[RequestContext] = previous;
});

function makeEvent(nonce?: CSPNonce) {
  const event = createRequestEvent(new Request("http://localhost/"));
  if (nonce !== undefined) event.nonce = nonce;
  return event;
}

const Doc = () => (
  <html>
    <head>
      <HydrationScript />
    </head>
    <body>
      <div>page</div>
    </body>
  </html>
);

describe("RequestEvent.nonce", () => {
  test("renderToString uses the event's nonce when no option is passed", () => {
    const html = storage.run(makeEvent("evt"), () => renderToString(() => <Doc />));
    expect(html).toContain('<script nonce="evt">window._$HY');
  });

  test("renderToStream uses the event's nonce", async () => {
    const event = makeEvent("evt");
    const response = await storage.run(event, () =>
      createSSRResponse(
        renderToStream(() => <Doc />),
        event
      )
    );
    expect(await response.text()).toContain('<script nonce="evt">window._$HY');
  });

  test("the { script, style } form routes the script half to scripts", () => {
    const html = storage.run(makeEvent({ script: "s", style: false }), () =>
      renderToString(() => <Doc />)
    );
    expect(html).toContain('<script nonce="s">window._$HY');
  });

  test("an explicit nonce option wins over the event's", () => {
    const html = storage.run(makeEvent("evt"), () =>
      renderToString(() => <Doc />, { nonce: "opt" })
    );
    expect(html).toContain('<script nonce="opt">window._$HY');
    expect(html).not.toContain("evt");
  });

  test.each([null, "", { script: false, style: false }] as const)(
    "an explicit %j option renders without a nonce",
    nonce => {
      const html = storage.run(makeEvent("evt"), () =>
        renderToString(() => <Doc />, { nonce: nonce as CSPNonce | null })
      );
      expect(html).toContain("<script>window._$HY");
      expect(html).not.toContain("nonce=");
    }
  );

  test("no request scope, no nonce", () => {
    const html = renderToString(() => <Doc />);
    expect(html).toContain("<script>window._$HY");
  });

  test("the event's nonce is read when the render starts", () => {
    const event = makeEvent();
    const html = storage.run(event, () => {
      const out = renderToString(() => <Doc />);
      event.nonce = "late";
      return out;
    });
    expect(html).not.toContain("nonce=");
  });

  test("createSSRResponse's post-flush redirect fallback carries the event's nonce", async () => {
    const event = makeEvent("evt");
    const Late = () => {
      const value = createMemo(async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        event.response.headers.set("Location", "/elsewhere");
        return "late";
      });
      return <span>{value()}</span>;
    };
    const response = await storage.run(event, () =>
      createSSRResponse(
        renderToStream(() => (
          <html>
            <head />
            <body>
              <Loading fallback={<span>loading</span>}>
                <Late />
              </Loading>
            </body>
          </html>
        )),
        event
      )
    );
    const html = await response.text();
    expect(html).toContain('<script nonce="evt">window.location=');
    expect(html).not.toMatch(/<script>/);
  });

  test("createSSRResponse's explicit nonce option wins, null disables", async () => {
    for (const [nonce, expected] of [
      ["opt", '<script nonce="opt">window.location='],
      [null, "<script>window.location="]
    ] as const) {
      const event = makeEvent("evt");
      const Late = () => {
        const value = createMemo(async () => {
          await new Promise(resolve => setTimeout(resolve, 5));
          event.response.headers.set("Location", "/elsewhere");
          return "late";
        });
        return <span>{value()}</span>;
      };
      const response = await storage.run(event, () =>
        createSSRResponse(
          renderToStream(() => (
            <Loading fallback={<span>loading</span>}>
              <Late />
            </Loading>
          )),
          event,
          { nonce }
        )
      );
      expect(await response.text()).toContain(expected);
    }
  });
});

describe("composeMiddleware (event-first)", () => {
  test("each middleware receives the event; the terminal next() takes no arguments", async () => {
    const event = makeEvent();
    const seen: unknown[] = [];
    const run = composeMiddleware([
      async (e, next) => {
        seen.push(e);
        e.locals.order = ["a"];
        const response = await next();
        response.headers.set("x-a", "1");
        return response;
      },
      (e, next) => {
        seen.push(e);
        e.locals.order.push("b");
        return next();
      }
    ]);
    const response = await run(event, (...args: unknown[]) => {
      seen.push(args.length);
      return new Response(event.locals.order.join(","));
    });
    expect(seen).toEqual([event, event, 0]);
    expect(await response.text()).toBe("a,b");
    expect(response.headers.get("x-a")).toBe("1");
  });

  test("a request substituted on the event is what downstream sees", async () => {
    const event = makeEvent();
    const replaced = new Request("http://localhost/rewritten");
    const run = composeMiddleware([
      (e, next) => {
        e.request = replaced;
        return next();
      },
      (e, next) => {
        expect(e.request).toBe(replaced);
        return next();
      }
    ]);
    const response = await run(event, () => new Response(new URL(event.request.url).pathname));
    expect(await response.text()).toBe("/rewritten");
    expect(event.request).toBe(replaced);
  });

  test("next(request) rejects with a migration error", async () => {
    const run = composeMiddleware([
      (_e, next) => (next as (request: Request) => Promise<Response>)(new Request("http://x/"))
    ]);
    await expect(run(makeEvent(), () => new Response("ok"))).rejects.toThrow(
      /next\(\) takes no arguments.*event\.request/
    );
  });

  test("next() called twice rejects", async () => {
    const run = composeMiddleware([
      async (_e, next) => {
        await next();
        return next();
      }
    ]);
    await expect(run(makeEvent(), () => new Response("ok"))).rejects.toThrow(
      "next() called multiple times"
    );
  });

  test("a nonce set before next() reaches the render; one set after it does not", async () => {
    const render = () => {
      const event = getRequestEvent()!;
      return createSSRResponse(
        renderToStream(() => <Doc />),
        event
      );
    };
    const before: FetchMiddleware = (event, next) => {
      event.nonce = "early";
      return next();
    };
    const after: FetchMiddleware = async (event, next) => {
      const response = await next();
      event.nonce = "late";
      return response;
    };
    for (const [mw, expected] of [
      [before, '<script nonce="early">window._$HY'],
      [after, "<script>window._$HY"]
    ] as const) {
      const event = makeEvent();
      const response = await storage.run(event, () => composeMiddleware([mw])(event, render));
      expect(await response.text()).toContain(expected);
    }
  });
});
