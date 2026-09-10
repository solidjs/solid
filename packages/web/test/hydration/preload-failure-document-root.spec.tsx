/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #3338: when a root module preload fails, hydrate() falls back to a fresh
 * client render of the tree. For a DOCUMENT root there is no such fallback —
 * the shell cannot be client-created — and the old path died deep in the walk
 * with an unrelated "Hydration Mismatch … key: undefined" as an unhandled
 * rejection, leaving a page that looked hydrated and was dead. The failure is
 * now reported explicitly, with its cause, through the platform's
 * uncaught-error channel (reportError; console.error where absent).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function armPreloadFailure(cause: Error) {
  // A root module map whose only entry is already a failed load: hydrate()
  // dedupes through `_$HY.loading`, so the rejected promise IS the preload.
  const loading = { k1: Promise.reject(cause) };
  loading.k1.catch(() => {});
  (globalThis as any)._$HY = {
    events: [],
    completed: new WeakSet(),
    r: { _assets: { k1: "/assets/never-fetched.js" } },
    modules: {},
    loading,
    fe() {}
  };
}

describe("hydrate(): failed module preload at a document root (#3338)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).reportError;
  });

  test("reports an explicit, caused error instead of a hydration-mismatch rejection", async () => {
    const cause = new Error("Failed to fetch dynamically imported module: http://src/Page.tsx");
    armPreloadFailure(cause);
    const reported: unknown[] = [];
    (globalThis as any).reportError = (e: unknown) => reported.push(e);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const rejections: unknown[] = [];
    const onRejection = (r: unknown) => rejections.push(r);
    process.on("unhandledRejection", onRejection);

    let rendered = 0;
    document.documentElement.innerHTML = "<head></head><body><div _hk=0>server</div></body>";
    const dispose = hydrate(() => {
      rendered++;
      return <div>client</div>;
    }, document);
    await sleep(20);
    flush();
    process.off("unhandledRejection", onRejection);

    // The tree was never rendered fresh (a document shell can't be), and
    // nothing leaked as an unhandled rejection.
    expect(rendered).toBe(0);
    expect(rejections).toEqual([]);
    // Server markup stays in place.
    expect(document.body.textContent).toBe("server");
    // One explicit report through the platform channel, carrying the cause.
    expect(reported).toHaveLength(1);
    const err = reported[0] as Error & { cause?: unknown };
    expect(err.message).toMatch(/preload failed for a document root/);
    expect(err.message).toMatch(/cannot be client-rendered/);
    expect(err.message).toContain(cause.message);
    expect(err.cause).toBe(cause);
    expect(error).not.toHaveBeenCalled();
    dispose();
  });

  test("falls back to console.error where reportError is unavailable", async () => {
    const cause = new Error("chunk 404");
    armPreloadFailure(cause);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    document.documentElement.innerHTML = "<head></head><body><div _hk=0>server</div></body>";
    const dispose = hydrate(() => <div>client</div>, document);
    await sleep(20);
    flush();

    expect(error).toHaveBeenCalledTimes(1);
    const err = error.mock.calls[0][0] as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/preload failed for a document root/);
    expect(document.body.textContent).toBe("server");
    dispose();
  });

  test("a non-document root still falls back to a client render", async () => {
    armPreloadFailure(new Error("chunk 404"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    document.body.innerHTML = `<div id="root"><div _hk=0>server</div></div>`;
    const root = document.getElementById("root")!;
    const dispose = hydrate(() => <div>client</div>, root);
    await sleep(20);
    flush();

    expect(root.textContent).toBe("client");
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toMatch(/falling back to client render/);
    dispose();
  });
});
