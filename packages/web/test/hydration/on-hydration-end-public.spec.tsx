/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * `onHydrationEnd` as public API (`solid-js`, `@experimental`, #4000): the
 * documented contract, through the public import rather than
 * `sharedConfig.onHydrationEnd`. It fires when the hydration phase ends —
 * which says nothing about whether hydration succeeded — and it must be
 * registered after `hydrate()` has started hydration to wait for it.
 * Hand-built `_$HY` fixtures, as preload-hold.spec.tsx and
 * preload-failure-document-root.spec.tsx build them; GH5 (several roots) is
 * pinned in consistency/generic/preload-hold.spec.tsx.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { flush, onHydrationEnd } from "solid-js";
import { hydrate } from "@solidjs/web";

const macrotask = () => new Promise(r => setTimeout(r, 0));
const microtask = () => Promise.resolve();

function bootHy(extra: Record<string, unknown> = {}) {
  const hy: any = { events: [], completed: new WeakSet(), r: {}, fe() {}, ...extra };
  (globalThis as any)._$HY = hy;
  return hy;
}

// A root module map whose load is held until `land()` (hydrate() dedupes
// through `_$HY.loading`, so this promise IS the preload).
function heldPreload() {
  const hy = bootHy({ r: { _assets: { "0": "/assets/A.js" } }, modules: {}, loading: {} });
  let land!: () => void;
  hy.loading["0"] = new Promise<void>(r => (land = r)).then(() => {
    hy.modules["0"] = {};
  });
  return land;
}

function failedPreload(cause: Error) {
  const failed = Promise.reject(cause);
  failed.catch(() => {});
  bootHy({ r: { _assets: { k1: "/assets/missing.js" } }, modules: {}, loading: { k1: failed } });
}

const disposers: (() => void)[] = [];
afterEach(async () => {
  for (const d of disposers.splice(0)) d();
  vi.restoreAllMocks();
  delete (globalThis as any).reportError;
  delete (document as any).readyState;
  // drainHydrationCallbacks' trailing timeout (`_$HY.done`, registry clear)
  await macrotask();
  await macrotask();
  delete (globalThis as any)._$HY;
  document.body.innerHTML = "";
});

describe("onHydrationEnd (public, #4000)", () => {
  test("registered after hydrate(), it waits for the deferred root's claim and runs once", async () => {
    const land = heldPreload();
    const root = document.createElement("div");
    document.body.append(root);
    root.innerHTML = `<div _hk=0><button>a</button></div>`;
    const serverButton = root.querySelector("button")!;
    let clicks = 0;
    const seen: { claimed: boolean }[] = [];
    disposers.push(
      hydrate(
        () => (
          <div>
            <button onClick={() => clicks++}>a</button>
          </div>
        ),
        root
      )
    );
    onHydrationEnd(() =>
      seen.push({ claimed: (globalThis as any)._$HY.completed.has(root.firstChild) })
    );
    flush();
    await macrotask();
    expect(seen).toEqual([]);

    land();
    await macrotask();
    await macrotask();
    flush();
    expect(seen).toEqual([{ claimed: true }]);
    // the server markup was claimed, and is live
    expect(root.querySelector("button")).toBe(serverButton);
    serverButton.click();
    expect(clicks).toBe(1);
    await macrotask();
    expect(seen).toHaveLength(1);
  });

  test("registered after a hydrate() that finished synchronously, it runs in the next microtask", async () => {
    bootHy();
    const root = document.createElement("div");
    document.body.append(root);
    root.innerHTML = `<div _hk=0>server</div>`;
    disposers.push(hydrate(() => <div>server</div>, root));
    const ends: string[] = [];
    onHydrationEnd(() => ends.push("end"));
    expect(ends).toEqual([]);
    await microtask();
    expect(ends).toEqual(["end"]);
  });

  test("registered before hydrate(), it runs in the next microtask without waiting for the root", async () => {
    const land = heldPreload();
    const root = document.createElement("div");
    document.body.append(root);
    root.innerHTML = `<div _hk=0>server</div>`;
    const ends: boolean[] = [];
    onHydrationEnd(() => ends.push((globalThis as any)._$HY.completed.has(root.firstChild)));
    disposers.push(hydrate(() => <div>server</div>, root));
    await microtask();
    // ran, before the deferred root claimed anything
    expect(ends).toEqual([false]);
    land();
    await macrotask();
    await macrotask();
    flush();
    expect(ends).toEqual([false]);
  });

  test("a document root whose module preload fails ends the phase: it runs, the page is not hydrated", async () => {
    const cause = new Error("chunk 404");
    failedPreload(cause);
    const reported: unknown[] = [];
    (globalThis as any).reportError = (e: unknown) => reported.push(e);
    vi.spyOn(console, "error").mockImplementation(() => {});
    let rendered = 0;
    document.documentElement.innerHTML = "<head></head><body><div _hk=0>server</div></body>";
    const ends: string[] = [];
    disposers.push(
      hydrate(() => {
        rendered++;
        return <div>client</div>;
      }, document)
    );
    onHydrationEnd(() => ends.push(document.body.textContent!));
    await macrotask();
    flush();
    expect(ends).toEqual(["server"]);
    expect(rendered).toBe(0);
    expect(reported).toEqual([cause]);
  });

  test("a non-document root whose module preload fails runs it before the fallback client render", async () => {
    failedPreload(new Error("chunk 404"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    document.body.innerHTML = `<div id="root"><div _hk=0>server</div></div>`;
    const root = document.getElementById("root")!;
    const ends: string[] = [];
    disposers.push(hydrate(() => <div>client</div>, root));
    onHydrationEnd(() => ends.push(root.textContent!));
    await macrotask();
    flush();
    expect(ends).toEqual(["server"]);
    expect(root.textContent).toBe("client");
  });

  // #3971: an `async` entry that runs while the parser is still inside the
  // server shell parks hydrate() on the shell-end marker. Hydration has not
  // started when hydrate() returns, so a callback registered then is in the
  // "not hydrating" case and runs in the next microtask — before the parked
  // root claims anything. Documented on `onHydrationEnd`; this pins it.
  test("after a hydrate() parked mid-parse (#3971), it runs before the parked root starts", async () => {
    const hy = bootHy({ s: {} });
    Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
    const root = document.createElement("div");
    document.body.append(root);
    root.innerHTML = `<div _hk=0>server</div>`;
    const ends: boolean[] = [];
    disposers.push(hydrate(() => <div>server</div>, root));
    onHydrationEnd(() => ends.push(hy.completed.has(root.firstChild)));
    await microtask();
    expect(ends).toEqual([false]);
    // the shell-end marker the server writes after the shell
    hy.s[""] = 1;
    hy.sw("");
    await macrotask();
    flush();
    expect(hy.completed.has(root.firstChild)).toBe(true);
    expect(ends).toEqual([false]);
  });
});
