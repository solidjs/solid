/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4033: on a page with server components, a DATA server function called
 * during hydration was held by the frames intercept waiting for a boundary
 * a data function never has, and the wait never ended:
 *
 *  - a call made under a hydration trace cached the trace's never-settling
 *    Promise stub as the wait, so every later call for that function hung;
 *  - a call made after the page's last reveal (a hydration-end recompute)
 *    was released only by a reveal, and none came.
 *
 * Both calls must reach the network once hydration ends.
 */
import { afterEach, expect, test, vi } from "vitest";
import { onHydrationEnd } from "solid-js";
import { hydrate } from "@solidjs/web";
import { createServerReference } from "../../server-functions/src/client.js";
import { bootPage, frameHtml, freshFid, quiesce, type Page } from "../consistency/support.js";

let page: Page | undefined;
const disposers: (() => void)[] = [];
afterEach(async () => {
  for (const d of disposers.splice(0)) d();
  await page?.cleanup();
  page = undefined;
});

function stubFetch() {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (input: any) => {
    calls.push(typeof input === "string" ? input : input.url);
    return new Promise(() => {});
  });
  return calls;
}

/** A server-component page; `during` runs inside the hydrating render. */
function hydratePage(during: () => void) {
  const fid = freshFid("sc-4033");
  page = bootPage(frameHtml(fid, "<h1>doc</h1>"));
  const calls = stubFetch();
  const Comp = (globalThis as any)._$SC.r(fid);
  const App = () => {
    during();
    return <Comp />;
  };
  disposers.push(hydrate(() => <App />, page.container));
  return calls;
}

test("a call made after the last reveal goes to the network at hydration end", async () => {
  const getData = createServerReference(freshFid("data-4033-late"));
  let settled = false;
  const calls = hydratePage(() => {
    // A hydration-end recompute (`ssrSource: "client"` and the like).
    onHydrationEnd(() => {
      getData(1).then(
        () => (settled = true),
        () => (settled = true)
      );
    });
  });
  await quiesce();
  expect(calls.length).toBe(1);
  expect(settled).toBe(false);
});

test("a call made under a hydration trace does not strand later calls", async () => {
  const getData = createServerReference(freshFid("data-4033-trace"));
  // The trace's global Promise, as subFetch installs it: never runs its
  // executor, never settles.
  class TraceStub {
    then() {
      return new TraceStub();
    }
    catch() {
      return new TraceStub();
    }
    finally() {
      return new TraceStub();
    }
  }
  const calls = hydratePage(() => {
    const native = Promise;
    (globalThis as any).Promise = TraceStub;
    try {
      getData(1);
    } finally {
      (globalThis as any).Promise = native;
    }
    // A later call for the same function, still during hydration.
    getData(2);
  });
  await quiesce();
  expect(calls.length).toBe(1);
});
