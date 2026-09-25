import {
  createOwner,
  disposeOwner,
  getOwner,
  runWithOwner,
  createLoadingBoundary as coreLoadingBoundary,
  NotReadyError,
  ErrorContext,
  getContext,
  setContext,
  runWithBoundaryErrorContext,
  RevealGroupContext,
  reportServerError,
  throwerOf,
  ownerId
} from "./signals.js";
import { OBSERVE } from "@solidjs/signals";
import { sharedConfig, NoHydrateContext } from "./shared.js";
import { IS_DEV, IS_OBSERVE, devCheck, emitFinding, errorText } from "./diagnostics.js";
import type { BoundaryEvent, BoundaryLive } from "./observe.js";
import type { SSRTemplateObject, HydrationContext } from "./shared.js";
import type { Accessor } from "./signals.js";
import type { Element as SolidElement } from "../types.js";

export { sharedConfig, NoHydrateContext } from "./shared.js";
export type { HydrationContext, SSRTemplateObject } from "./shared.js";

/**
 * Handles errors during SSR rendering.
 * Returns the promise source for NotReadyError (for async handling),
 * or delegates to the ErrorContext handler.
 *
 * `probe: true` is the side-effect-free identification mode: it answers the
 * pending source for NotReady and `undefined` for anything else, never
 * routing or rethrowing. Used where the caller only wants to know whether a
 * throw was a pending read (e.g. the head registry's shell-hold path) while
 * keeping real errors on their existing handling path.
 */
export function ssrHandleError(err: any, probe?: boolean) {
  if (err instanceof NotReadyError) {
    return (err as any).source as Promise<any>;
  }
  if (probe) return;
  // Retry passes re-pull holes from flush microtasks with no ambient owner;
  // a bare getContext there throws NoOwnerError, masking the real error on
  // its way to the renderer's containment. No owner simply means no boundary
  // handler.
  const handler = getOwner() ? getContext(ErrorContext) : null;
  if (handler) {
    handler(err);
    return;
  }
  throw err;
}

export function createLoadingBoundary<T, U>(
  fn: () => T,
  fallback: () => U,
  options?: { on?: () => any }
): Accessor<T | U> {
  const currentCtx = sharedConfig.context;
  if (!currentCtx) {
    return coreLoadingBoundary(fn, fallback);
  }
  // Under an SSR context the accessor yields resolved template fragments, not
  // T/U — the declared signature is the isomorphic contract the renderer and
  // client share; the SSR plumbing below is cast to it.
  return ssrLoadingBoundary(currentCtx, fn, fallback) as unknown as Accessor<T | U>;
}

function ssrLoadingBoundary(
  currentCtx: HydrationContext,
  fn: () => any,
  fallback: () => any
): () => unknown {
  const ctx = currentCtx;
  const parent = getOwner();
  // One context lookup pass: both reads resolve off the parent's (shared,
  // immutable-at-this-point) context map — no owner switch needed, and
  // getContext takes the owner explicitly.
  const parentHandler = parent && getContext(ErrorContext, parent);
  const revealGroup = parent && getContext(RevealGroupContext, parent);
  const o = createOwner();
  // Boundaries sever reveal-group coordination for their subtree (matching the
  // client): only direct Loading children of a Reveal join its group. A nested
  // Loading is covered by its own fallback inside the (possibly held) slot and
  // activates independently instead of delaying the ancestor group (#2871).
  // setContext clones the context map, so only pay it when there IS a group
  // in scope to sever — without one, children read null regardless.
  if (revealGroup) setContext(RevealGroupContext, null, o);
  // The boundary's own, just-created owner — never a swapped hole scope.
  const id = ownerId(o)!;
  (o as any).id = id + "00"; // fake depth to match client's createLoadingBoundary nesting

  let done: ((value?: string, error?: any) => boolean) | undefined;
  let handledRenderError: any;
  let retryPromise: Promise<any> | undefined;

  // Render passes over the content: discovery, plus one per wait. Doubles as
  // the convergence budget's counter below.
  let passes = 0;

  // Observe tier: the boundary RECORD (`OBSERVE.records`, type `"boundary"`
  // — see `BoundaryEvent`), for a boundary that waited. Cost is paid only
  // with a listener (or in dev, where the checks below read the same
  // facts): one `performance.now()` at discovery, one at settle. Delivered
  // at settle; when a `<Reveal>` group coordinates the fragment swap the
  // record waits for the group's `onReveal` so it can carry `heldMs` — the
  // time finished content sat behind its siblings. (A group that never
  // reveals — the stream abandoned — loses the record;
  // `SSR_STREAM_ABANDONED` is that request's account.)
  const observed = IS_OBSERVE ? OBSERVE!.records.observed("boundary") : false;
  const timed = IS_DEV || observed;
  const discoveredAt = timed ? performance.now() : 0;
  let recorded = false;
  let streamedOnError = false;
  let pendingRecord: (() => void) | undefined;
  const record = (outcome: BoundaryEvent["outcome"], streamed: boolean, error?: unknown) => {
    if (recorded) return;
    recorded = true;
    const settledAt = timed ? performance.now() : 0;
    if (IS_DEV) checkWaited(outcome, settledAt - discoveredAt);
    // The document's `Server-Timing` (the web runtime's seam on the render
    // context — see `_timing`): a boundary the shell WAITED on — a pass past
    // discovery, settled before the flush — labelled by its owner path, the
    // label the client's `fallback` record and the findings carry. One that
    // streams settled after the head left and cannot ride the header; one
    // decided on its first pass (a renderToString fallback, a client hole)
    // held nothing up.
    const timing = timed && !streamed && passes > 1 ? ctx._timing : undefined;
    // The core's walk (`_parent` + `_name`), the same one its diagnostics
    // make over these owners, so the record, the finding it may pair with
    // and the metric locate to the same `<App> › <Page>`.
    const path = observed || timing !== undefined ? OBSERVE!.ownerPath(o) : undefined;
    if (timing !== undefined) {
      // ASCII on the wire (a header value is a byte string); the adapter
      // renders the path with the artifact's ` › `.
      timing.push({
        name: "solid-boundary",
        dur: settledAt - discoveredAt,
        desc: path ? path.join(" > ") : id
      });
    }
    if (!observed) return;
    const event: BoundaryEvent = {
      id,
      at: discoveredAt,
      durationMs: settledAt - discoveredAt,
      heldMs: 0,
      passes,
      outcome,
      streamed
    };
    if (revealGroup) event.revealGroup = revealGroup.id;
    if (path) event.ownerPath = path;
    const live: BoundaryLive = {};
    if (outcome === "error") live.error = error;
    // Only a fragment swap can be held: `done` exists once the fragment is
    // registered with the stream. The renderToString outcomes and a
    // final-at-discovery client hole ship with the shell — nothing to hold.
    if (revealGroup && done !== undefined) {
      pendingRecord = () => {
        event.heldMs = performance.now() - settledAt;
        OBSERVE!.records.emit("boundary", event, live);
      };
      return;
    }
    OBSERVE!.records.emit("boundary", event, live);
  };
  const onReveal = () => {
    const deliver = pendingRecord;
    if (deliver === undefined) return;
    pendingRecord = undefined;
    deliver();
  };
  // The dev CHECKS read off the same facts as the record, for a boundary
  // that waited — the verdicts an agent would otherwise derive from the
  // artifact, coded so the console and `expectNoDiagnostics` see them.
  const checkWaited = (outcome: BoundaryEvent["outcome"], durationMs: number) => {
    // Sequential render passes: each pass past the first is a wait that
    // could only start once the previous answered. Same thresholds as the
    // client's graph-proved ASYNC_WATERFALL — depth 2 advisory (a dependent
    // fetch is sometimes intrinsic), depth 3+ earns the console — but its
    // own code: the proof here is the boundary's pass structure, not a
    // flight chain, and the repair is read off the boundary record.
    const flights = passes - 1;
    if (flights >= 2) {
      const severity = flights > 2 ? "warn" : "info";
      devCheck(
        {
          code: "SSR_BOUNDARY_WATERFALL",
          kind: "ssr",
          severity,
          message:
            `[SSR_BOUNDARY_WATERFALL] A <Loading> boundary took ${passes} render passes — ` +
            `${flights} sequential async waits, ${durationMs.toFixed(0)}ms end to end: each ` +
            `read could start only after the previous one answered. If a later read doesn't ` +
            `need the earlier answer, derive both from the same inputs so they start together; ` +
            `if the dependency is intrinsic, preload the dependent data or join the requests.`,
          data: { boundary: id, passes, sequentialMs: durationMs }
        },
        o
      );
    }
    // Client-only content that surfaced only after a server wait: the
    // boundary streamed its fallback, did the server work, then handed the
    // whole subtree to the client anyway — the work is discarded and the
    // user sees the fallback twice as long. A client hole found on the
    // first pass ships with the shell and costs nothing extra.
    if (outcome === "client" && passes > 1) {
      devCheck(
        {
          code: "SSR_CLIENT_CONTENT_MASKED",
          kind: "ssr",
          severity: "warn",
          message:
            `[SSR_CLIENT_CONTENT_MASKED] Client-only content (ssrSource: "client") in a ` +
            `<Loading> boundary surfaced only after ${passes - 1} server ` +
            `${passes > 2 ? "waits" : "wait"} (${durationMs.toFixed(0)}ms): the boundary ` +
            `streamed its fallback and then handed the subtree to the client, discarding the ` +
            `server's work. Give the client-only content its own <Loading>, or read it before ` +
            `the async data, so the handoff ships with the shell.`,
          data: { boundary: id, passes, durationMs }
        },
        o
      );
    }
  };
  // The finding (observe/dev) for a render error this boundary routed rather
  // than an <Errored> catching it: `client` — the fragment rejected and the
  // client re-renders the subtree fresh (the response completes, the user
  // pays a client render); `failed` — nothing could contain it, the request
  // failed through the renderer's `failRender`/`onError` and the process
  // survived. The Errored fallback case reports itself (createErrorBoundary).
  const reportRouted = (err: any, handling: "client" | "failed") => {
    if (!IS_OBSERVE) return;
    emitFinding(
      {
        code: "SSR_RENDER_ERROR_CONTAINED",
        kind: "ssr",
        severity: "error",
        message:
          `[SSR_RENDER_ERROR_CONTAINED] Render error in a <Loading> boundary ` +
          (handling === "client"
            ? `— the fragment rejected and the client re-renders it: `
            : `— no boundary could contain it, the request failed: `) +
          errorText(err),
        data: { handling, boundary: id, boundaryPath: OBSERVE!.ownerPath(o), error: err }
      },
      // Located where it was THROWN (the owner it escaped), the boundary that
      // met it in `data` — the same two facts the server error hook carries.
      throwerOf(err) ?? o
    );
  };
  let serializeBuffer: [string, any, boolean?][] = [];
  // Once this boundary has flushed, it never buffers again (resets only happen
  // during retry discovery, before the first flush). A chained async source can
  // resolve *after* the boundary commits — e.g. `b` depends on `a`, so `b`
  // serializes only once `a` settled and the boundary already flushed. Those
  // late serializations must write through to the parent ctx instead of landing
  // in a buffer that will never flush again (which would orphan the fragment).
  let flushed = false;
  const bufferedCtx = Object.create(ctx) as typeof ctx;
  bufferedCtx.serialize = (id: string, value: any, deferStream?: boolean) => {
    if (flushed) ctx.serialize(id, value, deferStream);
    else serializeBuffer.push([id, value, deferStream]);
  };
  // Asset attribution (`_currentBoundaryId`) is NOT set here. The property is
  // an accessor inherited from the root context over a single shared tracking
  // slot — assigning it through `bufferedCtx` would mutate that shared state
  // with no restore, leaking this boundary's id to later document-order
  // siblings (a root-level lazy() after this boundary would file its module
  // under this boundary's already-serialized asset map, #2860). Every render
  // phase already scopes the id correctly: `runLoadingPhase` passes it to
  // `runWithBoundaryErrorContext`, which sets and restores it around the run.

  function flushSerializeBuffer() {
    for (const args of serializeBuffer) ctx.serialize(args[0], args[1], args[2]);
    serializeBuffer = [];
    flushed = true;
  }

  function commitBoundaryState() {
    flushSerializeBuffer();
    const modules = ctx.getBoundaryModules?.(id);
    // Serialize a snapshot, never the live map: it keeps mutating after this
    // first write (nested lazy modules register post-flush), and the streaming
    // serializer dedupes repeated object references — re-serializing the same
    // mutated object emits a back-reference to the stale first snapshot,
    // dropping the later entries and halting lazy hydration on the client.
    if (modules) ctx.serialize(id + "_assets", { ...modules });
  }

  function runLoadingPhase<T>(render: () => T): T {
    handledRenderError = undefined;
    return runWithBoundaryErrorContext(
      o,
      render,
      (err: any, parentHandler) => {
        handledRenderError = err;
        if (done) {
          // Once the fragment is registered, its channel owns error routing:
          // `<key>_fr` rejects and the client re-renders the subtree as fresh
          // DOM, letting a client-side Errored catch (post-flush this rides
          // the sink; pre-flush the placeholder inlines away, #2997). The
          // parent handler must NOT hear about it here — an async-time
          // Errored render has no consumer (the accessor pull is long gone),
          // so its only lasting effect is serializing the error at the
          // Errored id, which makes the hydrating client render the error
          // fallback expecting server DOM that was never emitted, derailing
          // hydration before the fragment channel can engage.
          reportRouted(err, "client");
          // The server error hook hears of it here, before the channel
          // carries it (the `_fr` rejection, a transport sink's error chunk
          // read the verdict the hook decides).
          reportServerError(err, { kind: "render", handling: "client", boundary: id }, o);
          streamedOnError = done(undefined, err);
          throw err;
        }
        // Synchronous discovery (no fragment yet): the enclosing Errored's
        // pull is still on the stack, so its handler renders the fallback
        // inline and serializes the error for matching client adoption.
        if (parentHandler) {
          parentHandler(err);
          return;
        }
        throw err;
      },
      bufferedCtx,
      id
    );
  }

  // Only ever called from the async resume loop below — there is nothing on
  // the stack to catch a throw from here. The initial (synchronous) discovery
  // pass propagates unhandled errors directly out of runLoadingPhase to the
  // renderToStream caller; by resume time that caller is gone, and a throw
  // would escape the un-awaited async function as an unhandled rejection and
  // take the host process down. `done(undefined, err)` handles the streamed
  // case (the fragment template swaps in and `<key>_fr` rejects, so the
  // client error path takes over) but answers false before the shell has
  // flushed — for that pre-shell case, and for a parent handler that itself
  // throws, route through the renderer's containment channel instead: the
  // request fails (onError + wind-down), the process survives.
  function finalizeError(err: any) {
    if (handledRenderError === err) {
      handledRenderError = undefined;
      record("error", streamedOnError, err);
      return;
    }
    if (done) {
      // Post-flush the fragment rejects to the client: the server error hook
      // hears of it BEFORE the channel carries it, so the `_fr` rejection and
      // a transport sink's error chunk read the verdict it decides. Pre-flush
      // the rejection reaches the client lazily (the funnel reads the verdict
      // when it delivers) and the failure is met next by the parent handler
      // — an <Errored> rendering its fallback — or fails the request below.
      const streamed = ctx.flushed !== undefined && ctx.flushed();
      if (streamed) reportServerError(err, { kind: "render", handling: "client", boundary: id }, o);
      if (done(undefined, err)) {
        reportRouted(err, "client");
        record("error", true, err);
        return;
      }
    }
    record("error", false, err);
    if (!parentHandler) {
      reportRouted(err, "failed");
      reportServerError(err, { kind: "render", handling: "failed", boundary: id }, o);
      ctx.failRender ? ctx.failRender(err) : console.error(err);
      return;
    }
    try {
      runWithOwner(parent!, () => parentHandler(err));
    } catch (caught) {
      if (caught !== err) {
        reportRouted(caught, "failed");
        reportServerError(caught, { kind: "render", handling: "failed", boundary: id }, o);
        ctx.failRender ? ctx.failRender(caught) : console.error(caught);
      }
    }
  }

  // The client boundary flattens `fn`'s result in a second computed, the
  // sibling after the one that ran `fn` (`o`'s "00" above mirrors that first
  // one). A zero-arg function `fn` hands back — a nested boundary's accessor,
  // a fallback thunk it returns unresolved, a function child — is unwrapped
  // there, so what it renders takes ids under `<id>01`. Resolve in a virtual
  // scope with that id (ssrScope's technique: `o` keeps its identity, only
  // its id counter is rewritten); inline under `o` the content took the
  // "00" scope's next child id instead and a server-rendered fallback
  // hydrated dead (#3414). Retry passes resume the surviving holes in the
  // same scope, the counter continuing where the last pass left it.
  let resolveCount = 0;
  function resolveIn<T>(run: () => T): T {
    const prevCount = (o as any)._childCount;
    (o as any).id = id + "01";
    (o as any)._childCount = resolveCount;
    try {
      return run();
    } finally {
      resolveCount = (o as any)._childCount;
      (o as any).id = id + "00";
      (o as any)._childCount = prevCount;
    }
  }

  function runDiscovery(): SSRTemplateObject | undefined {
    disposeOwner(o, false);
    serializeBuffer = [];
    retryPromise = undefined;
    resolveCount = 0;
    passes++;
    return runLoadingPhase(() => {
      try {
        // The boundary is an insertion root: its content never passes a
        // compiled `escape` hole, so escape here — same as the fallback path.
        const value = fn();
        return resolveIn(() => ctx.resolve(ctx.escape(value)));
      } catch (err) {
        if (err instanceof NotReadyError) {
          retryPromise = (err as any).source as Promise<any>;
          return undefined;
        }
        // Already routed: a template hole ran `ssrHandleError` on its way
        // here (the handler rethrows after routing) — propagate as before,
        // or the enclosing Errored would render its fallback twice.
        if (handledRenderError === err) throw err;
        // A bare child — `<Loading>{data()}</Loading>`, or a component whose
        // return IS the read — throws straight out of `fn()`: no template
        // hole sits between it and this boundary, so nothing ran
        // `ssrHandleError` for it the way `ssr()` does for a hole. Route it
        // the same way: the ErrorContext handler installed by
        // `runLoadingPhase` owns it once the fragment is registered (`_fr`
        // rejects, the client re-renders the subtree — `handling: "client"`,
        // the verdict #2997 pins for a hole in the same position); on the
        // synchronous first pass it defers to the enclosing Errored's
        // handler, or rethrows when there is none. Rethrown raw instead, a
        // rejection here reached `finalizeError` as an uncontained error and
        // failed the whole request pre-flush (#3569).
        ssrHandleError(err);
        return undefined;
      }
    }) as any;
  }

  // Boundary output accessors are live-hole opt-outs (`$lhSkip`): the
  // boundary owns its own update lifecycle (fragment write + reveal), so a
  // live binding over its output would at best sweep a constant forever and
  // at worst wrap the placeholder in markers that outlive the swap. Same
  // tag, same reason as slot getters — a position some other machinery owns.
  const skipLive = (f: () => unknown) => Object.assign(f, { $lhSkip: true });

  // A client hole (bare `ssrSource: "client"`) is FINAL: the server can never
  // fill it, so the moment one participates in this boundary's pending set the
  // position belongs to the client. Both pending channels carry the tag: a
  // component-body read throws it here as `retryPromise`, and a template hole
  // surfaces it in `ret.p` (the engine collects `NotReadyError.source`
  // promises verbatim, and createErrorBoundary tags its aggregate).
  const hasFinalHole = () =>
    (retryPromise as any)?.$clientHole === true ||
    !!(ret as any)?.p?.some((p: any) => p.$clientHole);

  let ret = runDiscovery();
  if (!retryPromise && !ret?.p?.length) {
    commitBoundaryState();
    return skipLive(() => ret);
  }

  const regResult = revealGroup
    ? revealGroup.register(id, observed ? { onReveal } : undefined)
    : null;
  const collapseFallback = regResult?.collapseFallback ?? false;

  if (collapseFallback && !ctx.async) {
    commitBoundaryState();
    ctx.serialize(id, "$$f");
    record("fallback", false);
    return skipLive(() => undefined);
  }

  // A final hole detected before the fragment registers takes the
  // renderToString route: plain fallback + "$$f" — the client hydrates the
  // fallback DOM and renders the content itself. No placeholder template is
  // emitted, because nothing will ever swap. (The sync path below needs no
  // check: it already answers ANY unresolved source with fallback + "$$f".)
  const finalAtDiscovery = ctx.async && hasFinalHole();

  const fallbackOwner = createOwner({ id });
  const fallbackResult = runWithOwner(fallbackOwner, () => {
    if (!ctx.async || finalAtDiscovery) return fallback();
    const tpl = collapseFallback
      ? [`<template id="pl-${id}">`, `</template><!--pl-${id}-->`]
      : [`<template id="pl-${id}"></template>`, `<!--pl-${id}-->`];
    return ctx.ssr(tpl, ctx.escape(fallback()));
  });

  if (finalAtDiscovery) {
    commitBoundaryState();
    ctx.serialize(id, "$$f");
    record("client", false);
    // Registered above like every pending boundary — release the reveal
    // frontier now or later siblings would wait on this slot forever.
    if (revealGroup) revealGroup.onResolved(id);
    return skipLive(() => fallbackResult);
  }

  if (ctx.async) {
    const regOpts = revealGroup ? { revealGroup: revealGroup.id } : undefined;
    done = ctx.registerFragment(id, regOpts);
    // A final hole surfacing only now (an earlier real async read masked it
    // during the initial discovery) can't take the "$$f" route anymore: the
    // fragment protocol requires a settle, and "settle but keep the fallback"
    // is not expressible. Reject instead — the placeholder swaps out and the
    // client renders this boundary's content fresh after hydration
    // (resume(false)), the closest streaming analogue of the client-continue.
    const clientHandoff = () => {
      if (!flushed) commitBoundaryState();
      const streamed = done!(
        undefined,
        new Error(`client-only content (bare ssrSource: "client")`)
      );
      record("client", streamed);
    };
    (async () => {
      try {
        // Convergence budget: each pass should retire at least one async
        // slot, so passes are bounded by the boundary's async-slot count in
        // any converging render — real trees sit far below this. A shape
        // that plants a fresh pending source every pass (an async read whose
        // answer is never adoptable at the re-created slot) would otherwise
        // loop at microtask speed, serializing a new deferred per pass until
        // the process OOMs (#3003). Fail the boundary loudly instead.
        const checkBudget = () => {
          if (passes <= 10000) return;
          throw new Error(
            `<Loading> boundary discovery did not converge after ${passes} passes — ` +
              `an async source produces a new pending answer on every retry. Ensure repeated ` +
              `reads settle (e.g. return a stable promise or value for the same question).`
          );
        };
        while (retryPromise) {
          if (hasFinalHole()) return clientHandoff();
          checkBudget();
          await retryPromise.catch(() => {});
          ret = runDiscovery();
        }
        commitBoundaryState();
        while (ret && ret.p && ret.p.length) {
          const pending = ret as { t: string[]; h: Function[]; p: Promise<any>[] };
          if (hasFinalHole()) return clientHandoff();
          checkBudget();
          await Promise.all(pending.p).catch(() => {});
          passes++;
          ret = runLoadingPhase(() => resolveIn(() => ctx.ssr(pending.t, ...pending.h))) as any;
        }
        flushSerializeBuffer();
        const streamed = done!(ret && Array.isArray(ret.t) ? ret.t[0] : ((ret && ret.t) as any));
        record("settled", streamed);
      } catch (err) {
        finalizeError(err);
      } finally {
        // The slot settles either way: on error, `done(undefined, err)` wrote
        // the fragment template and rejects `key_fr`, so the client error path
        // takes over. Releasing after done() keeps activation behind the
        // template write. Skipping release on error parks a sequential
        // frontier on this boundary forever, so resolved later siblings never
        // get their activation script (#2776).
        if (revealGroup) revealGroup.onResolved(id);
      }
    })();
    return skipLive(() => fallbackResult);
  }

  commitBoundaryState();
  ctx.serialize(id, "$$f");
  record("fallback", false);
  return skipLive(() => fallbackResult);
}

export { ssrScope } from "./signals.js";

/**
 * Disables hydration for its children during SSR.
 * Elements inside will not receive hydration keys (`_hk`) and signals will not be serialized.
 * Use `Hydration` to re-enable hydration within a `NoHydration` zone.
 */
export function NoHydration(props: { children: SolidElement }): SolidElement {
  const o = createOwner();
  return runWithOwner(o, () => {
    setContext(NoHydrateContext, true);
    return props.children;
  }) as unknown as SolidElement;
}

/**
 * Re-enables hydration within a `NoHydration` zone, establishing a new ID namespace.
 * Pass an `id` prop matching the client's `hydrate({ renderId })` to align hydration keys.
 * Has no effect when not inside a `NoHydration` zone (passthrough).
 */
export function Hydration(props: { id?: string; children: SolidElement }): SolidElement {
  if (!getContext(NoHydrateContext)) return props.children as unknown as SolidElement;
  const o = createOwner({ id: props.id ?? "" });
  return runWithOwner(o, () => {
    setContext(NoHydrateContext, false);
    return props.children;
  }) as unknown as SolidElement;
}
