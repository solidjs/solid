/**
 * @jsxImportSource @solidjs/web
 *
 * `renderToString` releases its reactive graph before it returns (#3385).
 * The root used to be disposed via `setTimeout`, so every render in a
 * synchronous loop (benchmarks, batch pre-rendering, `Promise.all` over
 * many renders) was retained until the task yielded. The scope-tied
 * response primitives must still survive the render: the request event's
 * head freezes right before the dispose, as an awaited `renderToStream`
 * already does, so `httpStatus`/`httpHeader` declarations are not retracted
 * and `createSSRResponse` sees them.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createRequestEvent,
  createSSRResponse,
  getTraceContext,
  httpHeader,
  httpStatus,
  renderToString
} from "@solidjs/web";
import type { RequestEvent, ResponseStub } from "@solidjs/web";
import { onCleanup } from "solid-js";

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

describe("renderToString disposes its root synchronously (#3385)", () => {
  test("every render's cleanup has run before the next synchronous render starts", () => {
    let disposed = 0;
    const Page = () => {
      onCleanup(() => disposed++);
      return <div>page</div>;
    };
    for (let i = 0; i < 5; i++) {
      expect(disposed).toBe(i);
      const html = renderToString(() => <Page />);
      expect(html).toContain("page");
      expect(disposed).toBe(i + 1);
    }
    expect(disposed).toBe(5);
  });

  test("a render that throws still disposes what it created", () => {
    let disposed = 0;
    const Page = () => {
      onCleanup(() => disposed++);
      throw new Error("render failed");
    };
    expect(() => renderToString(() => <Page />)).toThrow("render failed");
    expect(disposed).toBe(1);
  });

  test("the render's own trace is gone as soon as the render returns", () => {
    let inside: unknown;
    const Reader = () => {
      inside = getTraceContext();
      return <span>t</span>;
    };
    renderToString(() => <Reader />);
    expect(inside).toBeDefined();
    expect(getTraceContext()).toBeUndefined();
  });

  test("httpStatus/httpHeader declarations survive the synchronous dispose", async () => {
    const evt = createRequestEvent(new Request("https://app.example/")) as HttpEvent;
    let disposed = 0;
    const Page = () => {
      onCleanup(() => disposed++);
      httpStatus(404, "Not Found");
      httpHeader("cache-control", "no-store");
      return <div>not found</div>;
    };
    const html = storage.run(evt, () => renderToString(() => <Page />));
    expect(disposed).toBe(1);
    expect(evt.response.status).toBe(404);
    expect(evt.response.statusText).toBe("Not Found");
    expect(evt.response.headers.get("cache-control")).toBe("no-store");
    const response = createSSRResponse(html, evt);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain("not found");
  });
});
