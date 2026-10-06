/**
 * Shared support for the frames/hydration consistency contract
 * (documentation/server-components/frames-consistency-contract.md): the
 * pins under test/consistency and the property harness under
 * test/consistency/harness build their pages and streams from these.
 *
 * Two faces are modelled, both with EXPLICIT timing (every async step is a
 * resolver the test holds):
 *
 *  - the DOCUMENT face: a page the server rendered — `_$HY` with its data
 *    records, the real inline reveal runtime (`$df`/`$dfr`/`$dfl`, read from
 *    src/server.ts so the swap mechanics are the shipped ones, not a
 *    paraphrase), `<solid-frame>` boundaries with slot ranges, deferred
 *    fragments (`<template id="pl-K">` … `<!--pl-K-->` + `K_fr`), slot and
 *    region records, the `sc:live` channel, container-trace markers minted
 *    as raw seroval streams (the wire shape since the stream-mint protocol).
 *  - the STREAM face: hand-framed frame-stream Responses behind a stubbed
 *    fetch, held open so chunks arrive when the test says (the
 *    lifecycle-matrix harness vocabulary, re-exported).
 *
 * Module-state caveat (frames client): `findBoundaryElement` builds its
 * index ONCE from `document.body` and extends it only at fragment reveals
 * (`installRevealHook`). A spec file's second page therefore announces its
 * shell through the ledger's reveal channel (`announceShell`) — the same
 * path a streamed boundary lands by — or its boundary is never adoptable.
 * `claimedBoundaries` is per function id: every page must use a fresh fid
 * (`freshFid`).
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { enableHydration, flush } from "solid-js";
import { sharedConfig } from "solid-js/internal";
import { installServerComponents, createFrameHost, getFrameHost } from "../../frames/src/client.js";
import {
  reviveContainerTraces,
  isMaterializedContainer
} from "../../frames/src/frame-container-plugin.js";
import { createJSONDataTable } from "../../serialization/src/serializer.js";
import { createChunk } from "../../server-functions/src/shared.js";

export {
  frameResponse,
  openFrameResponse,
  openLiveFrameResponse,
  stubLiveFetch,
  until,
  pump,
  settle,
  createDataSource,
  dataChunks
} from "../lifecycle-matrix/harness.js";

const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** One macrotask. */
export const macrotask = () => new Promise<void>(r => setTimeout(r));
/** `n` microtasks. */
export async function microtasks(n = 1) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}
/** The beat the hydration specs use to let everything settle: flush, a
 *  macrotask, flush, a macrotask — twice is what the drain of
 *  `drainHydrationCallbacks` (its own setTimeout) needs to run. */
export async function quiesce(rounds = 3) {
  for (let i = 0; i < rounds; i++) {
    flush();
    await macrotask();
  }
  flush();
}

// ---------------------------------------------------------------------------
// The document runtime — the shipped inline script, verbatim
// ---------------------------------------------------------------------------

/**
 * `REPLACE_SCRIPT` as src/server.ts emits it into every streamed document:
 * `$df` (policy-routed swap), `$dfr` (the raw swap), `$dfl` (fallback
 * materialization), `$dfd` (retry drain), the stylesheet gates. Read from
 * the source so the harness exercises the real mechanics.
 */
export const REPLACE_SCRIPT: string = (() => {
  const src = readFileSync(resolve(here, "../../src/server.ts"), "utf8");
  const m = /const REPLACE_SCRIPT = `([^`]+)`/.exec(src);
  if (!m) throw new Error("REPLACE_SCRIPT not found in src/server.ts");
  return m[1];
})();

let runtimeInstalled = false;
/** Define `$df`/`$dfr`/… on the global once per worker (they are plain
 *  functions closing over nothing but `_$HY` and `document`). */
export function installDocumentRuntime() {
  if (runtimeInstalled) return;
  runtimeInstalled = true;
  (0, eval)(REPLACE_SCRIPT);
}

// ---------------------------------------------------------------------------
// Seroval-shaped wire values
// ---------------------------------------------------------------------------

/**
 * A settleable promise the way the hydration serializer writes one: the
 * ledger and `readHydratedValue` read the `.s`/`.v` stamps, never await.
 * `settle(value)` stamps `s = 1`, `reject(error)` stamps `s = 2`.
 */
export function serovalPromise<T = unknown>() {
  let resolveP!: (v: T) => void;
  let rejectP!: (e: unknown) => void;
  const p: any = new Promise<T>((res, rej) => {
    resolveP = res;
    rejectP = rej;
  });
  // A rejection nobody consumes is an unhandled rejection in the worker.
  p.catch(() => {});
  return {
    promise: p as Promise<T> & { s?: 1 | 2; v?: unknown },
    settle(value: T) {
      resolveP(value);
      p.s = 1;
      p.v = value;
    },
    reject(error: unknown) {
      rejectP(error);
      p.s = 2;
      p.v = error;
    }
  };
}

/**
 * A raw seroval stream — the `__SEROVAL_STREAM__` carrier seroval emits for
 * a streamed async iterable, exactly as the hydration serializer's factory
 * writes it (see any `__artifacts__/*.json`): `on(listener)` replays the
 * buffer SYNCHRONOUSLY, then fans later `next`/`throw`/`return` out.
 */
export function serovalStream<T = unknown>() {
  const buffer: any[] = [];
  const listeners: any[] = [];
  let alive = true;
  let success = false;
  let count = 0;
  const flushTo = (value: any, mode: string) => {
    for (let x = 0; x < count; x++) {
      const listener = listeners[x];
      if (listener) listener[mode](value);
    }
  };
  const up = (listener: any) => {
    for (let x = 0, z = buffer.length; x < z; x++) {
      const current = buffer[x];
      if (!alive && x === z - 1) listener[success ? "return" : "throw"](current);
      else listener.next(current);
    }
  };
  return {
    __SEROVAL_STREAM__: true as const,
    on(listener: any) {
      let temp = 0;
      let subscribed = alive;
      if (alive) {
        for (temp = 0; temp < count; temp++) if (!listeners[temp]) break;
        if (temp === count) count++;
        listeners[temp] = listener;
      }
      up(listener);
      return () => {
        if (alive && subscribed) {
          subscribed = false;
          listeners[temp] = void 0;
          while (count > 0 && !listeners[count - 1]) count--;
          listeners.length = count;
        }
      };
    },
    next(value: T) {
      if (alive) {
        buffer.push(value);
        flushTo(value, "next");
      }
    },
    throw(value: unknown) {
      if (alive) {
        buffer.push(value);
        flushTo(value, "throw");
        alive = false;
        success = false;
        listeners.length = 0;
      }
    },
    return(value?: unknown) {
      if (alive) {
        buffer.push(value);
        flushTo(value, "return");
        alive = false;
        success = true;
        listeners.length = 0;
      }
    }
  };
}

/**
 * A document-face container-trace marker (`{ $tr, $ta }`) over a fresh
 * stream: `snapshot(v)` emits the first value (the authoritative snapshot),
 * `patch(batch)` a patch batch — `applyPatches`' wire shape: `[[path, value]]` sets, `[[path]]` deletes, `[[path, value, 1]]` array inserts,
 * `end()` closes the trace. The marker is revived at arg-read by
 * `reviveContainerTraces` into a live projection.
 */
export function traceMarker(array = false) {
  const stream = serovalStream<any>();
  return {
    marker: { $tr: stream, $ta: array ? 1 : 0 },
    stream,
    snapshot: (v: any) => stream.next(v),
    patch: (batch: any[]) => stream.next(batch),
    end: () => stream.return(undefined),
    fail: (e: unknown) => stream.throw(e)
  };
}

// ---------------------------------------------------------------------------
// Page markup builders (the producer's vocabulary — frame-sink.ts)
// ---------------------------------------------------------------------------

let fidCounter = 0;
/** A fresh function id per page (boundaries are claimable once per fid). */
export function freshFid(label = "page") {
  return `consistency/${label}-${++fidCounter}`;
}

/** The `<solid-frame>` boundary element the document carries for `fid`. */
export const frameHtml = (fid: string, inner: string) =>
  `<solid-frame data-fid="${fid}" style="display:contents">${inner}</solid-frame>`;

/** A slot range (template occurrence) with its server-rendered interior. */
export const slotRange = (occurrence: string, inner = "") =>
  `<!--slot:${occurrence}:start-->${inner}<!--slot:${occurrence}:end-->`;

/** The hydration key the producer stamps on a fill's `n`-th top-level element. */
export const fillKey = (fid: string, occurrence: string, n = 0) => `sc-${fid}-${occurrence}-${n}`;

/**
 * The server render of the contract's standard fill, `props => <li>{props.text}</li>`
 * (one element, ONE text hole as its sole child): the element claims by key;
 * a sole-child text hole is rendered as bare text — no `<!--$-->…<!--/-->`
 * markers (see hydration/hydrate-falsy-sole-child-issue-3571.spec.tsx; the
 * markers appear only when the hole has siblings). With markers written
 * here the hole would claim the comment nodes and go inert.
 */
export const fillHtml = (fid: string, occurrence: string, text: string, tag = "li") =>
  `<${tag} _hk="${fillKey(fid, occurrence)}">${text}</${tag}>`;

/**
 * The server render of a fill with TWO adjacent text holes,
 * `props => <li>{props.text}{tick()}</li>`: sibling holes carry their
 * `<!--$-->…<!--/-->` markers.
 */
export const fillHtml2 = (fid: string, occurrence: string, a: string, b: string, tag = "li") =>
  `<${tag} _hk="${fillKey(fid, occurrence)}"><!--$-->${a}<!--/--><!--$-->${b}<!--/--></${tag}>`;

/**
 * A pending deferred-fragment placeholder as the shell carries it: the
 * `pl-K` template (whose content is the fallback for `$dfl`), the live
 * fallback nodes, and the closing comment.
 */
export const placeholderHtml = (key: string, fallback: string) =>
  `<template id="pl-${key}">${fallback}</template>${fallback}<!--pl-${key}-->`;

/** A live-hole range (`<!--lh:N-->…<!--lh:/N-->`). */
export const holeHtml = (n: number, inner: string) => `<!--lh:${n}-->${inner}<!--lh:/${n}-->`;

// ---------------------------------------------------------------------------
// A page: `_$HY`, the shell, records, fragments, the live channel
// ---------------------------------------------------------------------------

export interface Page {
  hy: any;
  container: HTMLDivElement;
  host: any;
  table: any;
  /** Warnings and errors the runtime logged while the page lived. */
  warnings: string[];
  errors: string[];
  /** `_$HY.r[key] = value` — a data script executing. */
  record(key: string, value: unknown): void;
  /** The slot record for an occurrence (`sc:slot:<fid>:<occurrence>`). */
  slotRecord(fid: string, occurrence: string, args: Record<string, unknown>): void;
  /** The region record for a nested region (`sc:region:<childId>`). */
  regionRecord(childId: string, html: string | Promise<string>): void;
  /** Declare a deferred fragment: `K_fr` pending until `settle`/`reject`. */
  declareFragment(key: string): ReturnType<typeof serovalPromise<boolean>>;
  /**
   * The fragment's content chunk arriving: `<template id="K">html</template>`
   * then `$df("K")`, then — as the producer orders it — the `_fr` settle.
   * Returns `$df`'s result (1 = swapped, 0 = held/queued).
   */
  revealFragment(key: string, html: string, settleFr?: boolean): number;
  /** The fallback-reveal task (`$dfl`): materialize `pl-K`'s template content. */
  revealFallback(key: string): number;
  /** The `sc:live` channel: push an op (`{ type, key, fid?, html?, attrs? }`). */
  live: { push(op: any): void; close(): void };
  /** Announce the shell to the frames client's boundary index (see module doc). */
  announceShell(): void;
  /** Tear the page down: unstub, delete globals, empty the body. */
  cleanup(): Promise<void>;
}

/**
 * Boot a page. Order mirrors a real document: `_$HY` exists, the reveal
 * runtime is defined, `enableHydration()` installs the ledger (a real page
 * does this when the runtime module loads), the frames policy installs, the
 * shell parses. `fetch` is stubbed to THROW unless the test re-stubs it —
 * the document face must never request what the page carries.
 */
export function bootPage(shellHtml: string, options: { hostOptions?: Record<string, any> } = {}) {
  installDocumentRuntime();
  const hy: any = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  (globalThis as any)._$HY = hy;
  const live = serovalStream<any>();
  hy.r["sc:live"] = new ReadableStream({
    start(controller) {
      live.on({
        next(value: any) {
          try {
            controller.enqueue(value);
          } catch {}
        },
        throw(value: any) {
          controller.error(value);
        },
        return() {
          try {
            controller.close();
          } catch {}
        }
      });
    }
  });
  enableHydration();
  // The PRODUCTION host by default (`getFrameHost()`: per-response data
  // tables, the lazy codec, the container-trace hooks — on S1 also the lazy
  // materializer's `prepareData`/`prepareArgs` seams). A document page never
  // begins a stream, so the shared tables stay empty and `page.table` is a
  // scratch table for tests that drive `host.apply({type:"data"})` through
  // a CUSTOM host (`hostOptions`), which is the only time it is wired.
  const table = createJSONDataTable();
  let host: any;
  if (options.hostOptions) {
    host = createFrameHost({
      applyData: (c: any) => table.apply(c),
      resolve: (r: any) => table.resolve(r),
      revive: reviveContainerTraces,
      isContainer: isMaterializedContainer,
      ...options.hostOptions
    });
    installServerComponents(host);
  } else {
    installServerComponents();
    host = getFrameHost();
  }
  const warnings: string[] = [];
  const errors: string[] = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  vi.stubGlobal("fetch", (input: any) => {
    throw new Error(
      `fetch must not be called by the document face: ${String(input?.url ?? input)}`
    );
  });
  const container = document.createElement("div");
  container.innerHTML = shellHtml;
  document.body.appendChild(container);
  // See the module doc: the frames client indexes boundaries once per
  // worker and extends the index at reveals; a second page in a file lands
  // its shell through that channel (a no-op on the first page, whose first
  // lookup scans the body).
  hy.fe("__shell", container);

  const fragments = new Map<string, ReturnType<typeof serovalPromise<boolean>>>();
  const page: Page = {
    hy,
    container,
    host,
    table,
    warnings,
    errors,
    record(key, value) {
      hy.r[key] = value;
    },
    slotRecord(fid, occurrence, args) {
      hy.r[`sc:slot:${fid}:${occurrence}`] = args;
    },
    regionRecord(childId, html) {
      hy.r[`sc:region:${childId}`] = html;
    },
    declareFragment(key) {
      const fr = serovalPromise<boolean>();
      fragments.set(key, fr);
      hy.r[`${key}_fr`] = fr.promise;
      return fr;
    },
    revealFragment(key, html, settleFr = true) {
      const tpl = document.createElement("template");
      tpl.id = key;
      tpl.innerHTML = html;
      container.appendChild(tpl);
      const r = (globalThis as any).$df(key);
      // The producer's order (see any streamed artifact): the swap script,
      // then the `_fr` settle in the same task batch.
      if (settleFr) {
        const fr = fragments.get(key);
        if (fr && fr.promise.s == null) fr.settle(true);
      }
      return r;
    },
    revealFallback(key) {
      return (globalThis as any).$dfl(key);
    },
    live: {
      push: (op: any) => live.next(op),
      close: () => live.return(undefined)
    },
    announceShell() {
      hy.fe("__shell", container);
    },
    async cleanup() {
      // Let the drain's own setTimeout (verifyHydration, `_$HY.done`, the
      // registry clear) run against THIS page's `_$HY` before it goes.
      await macrotask();
      await macrotask();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      delete (globalThis as any)._$HY;
      delete (globalThis as any)._$SC;
      document.body.innerHTML = "";
    }
  };
  return page;
}

// ---------------------------------------------------------------------------
// Observation helpers
// ---------------------------------------------------------------------------

/** The text the node shows, markers removed. */
export const textOf = (node: ParentNode | null | undefined) =>
  node ? (node.textContent ?? "") : "";

/**
 * Record every distinct text the container shows across DOM mutations — the
 * frames a user could see. Flush-free: the observer runs at microtask
 * checkpoints, between any two awaited chunk applies.
 */
export function watchFrames(root: Node, read: () => string = () => textOf(root as ParentNode)) {
  const frames: string[] = [read()];
  const push = () => {
    const t = read();
    if (frames[frames.length - 1] !== t) frames.push(t);
  };
  const mo = new MutationObserver(push);
  mo.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
  return {
    frames,
    sample: push,
    stop() {
      mo.disconnect();
    }
  };
}

/** Whether hydration is still in progress per the runtime. */
export const hydrationInProgress = () =>
  !!(sharedConfig as any).isHydrationInProgress && (sharedConfig as any).isHydrationInProgress();

/** Register for the hydration-end callback (fires via microtask if done). */
export const onHydrationEnd = (cb: () => void) => (sharedConfig as any).onHydrationEnd(cb);

/** All `_hk`-keyed elements under `root` (document order). */
export const keyedElements = (root: ParentNode) => [...root.querySelectorAll("[_hk]")];

/** Count occurrences of a selector under `root`. */
export const count = (root: ParentNode, selector: string) => root.querySelectorAll(selector).length;

// ---------------------------------------------------------------------------
// Stream-face helpers beyond the lifecycle-matrix harness
// ---------------------------------------------------------------------------

/**
 * A frame stream whose chunk ORDER the test controls after the headers
 * resolved: `send(chunk)` enqueues one framed chunk; `close()` ends the body.
 * Same as `openFrameResponse`, re-exported for naming at the call sites that
 * vary order.
 */
export function heldStream(id: string) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    }
  });
  return {
    response: new Response(body, { headers: { "X-Frame-Stream": id } }),
    send(chunk: any) {
      controller.enqueue(createChunk(JSON.stringify(chunk)));
    },
    close() {
      controller.close();
    },
    abort(err: unknown) {
      controller.error(err);
    }
  };
}

/**
 * Stub `fetch` to hand out held streams in call order (one per call), each
 * keyed by the response's frame id. `calls` records each request's body args
 * so a test can tell which call a stream answers.
 */
export function stubHeldFetch(ids: string[]) {
  const held = ids.map(heldStream);
  const calls: { url: string; args: unknown }[] = [];
  vi.stubGlobal("fetch", async (input: any, init: any) => {
    const url = typeof input === "string" ? input : input.url;
    let args: unknown;
    try {
      args = init && init.body ? JSON.parse(String(init.body)) : undefined;
    } catch {
      args = init && init.body;
    }
    calls.push({ url, args });
    const next = held[calls.length - 1];
    if (!next) throw new Error(`unexpected fetch #${calls.length}: ${url}`);
    return next.response;
  });
  return { held, calls };
}

/** A fresh frame host backed by one JSON data table (dom-face tests). */
export function makeHost(hostOptions: Record<string, any> = {}) {
  const table = createJSONDataTable();
  const host = createFrameHost({
    applyData: (c: any) => table.apply(c),
    resolve: (ref: any) => table.resolve(ref),
    revive: reviveContainerTraces,
    isContainer: isMaterializedContainer,
    ...hostOptions
  });
  return { host, table };
}

/**
 * Every permutation of a small array — for pins that claim order
 * independence and want to assert it over all orders rather than two.
 */
export function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = items.slice(0, i).concat(items.slice(i + 1));
    for (const p of permutations(rest)) out.push([items[i], ...p]);
  }
  return out;
}
