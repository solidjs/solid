import { createMemo, createRenderEffect, getOwner, OBSERVE } from "solid-js";

// Replaced with a boolean literal by the build (see rollup.config.js); the cast
// keeps the typed module honest about it being a build-time flag.
const IS_DEV = "_SOLID_DEV_" as unknown as boolean;
const IS_OBSERVE = "_SOLID_OBSERVE_" as unknown as boolean;

const transparentOptions = { transparent: true, sync: true };

// Observe/dev: the element tag a `spread` is being applied for, while its
// body runs (`spread` sets it, see client.ts). The effects and inserts the
// body creates take their labels from it — `<tag>.spread` for the attribute
// effect, `<tag>.children` for the children insert — instead of `spread`
// passing an options argument to each of its call sites, which would leave a
// trailing `undefined` argument in the production artifact. Synchronous:
// `spread` creates its nodes before it returns and restores the outer value.
export let spreadName: string | undefined;
export function setSpreadName(name: string | undefined): void {
  spreadName = name;
}
const syncOptions = { sync: true };

// Dev: the binding effect whose callback is currently writing the DOM. The
// DOM helpers (setAttribute, insertExpression, …) tag it with the element they
// touch, so a diagnostic about that effect can print a live element reference
// beside its message — hover highlights it, click jumps to Elements.
let bindingEffect: { _devElement?: Node } | null = null;

/** Dev: remember the element the running binding effect writes (first one wins). */
export function tagElement(node: Node): void {
  if (IS_DEV && bindingEffect !== null && bindingEffect._devElement === undefined)
    bindingEffect._devElement = node;
}

// `scope: true` (set by insert for compiler-tagged hole accessors) makes the
// render effect non-transparent so the hole gets its own id scope, mirroring
// the server's ssrScope owner. `name` is the binding's target as the
// compiler wrote it under `sourceNames.bindings` (`span.textContent`,
// `div.class:active`); the dev and observe runtimes label the effect node
// with it, production ignores it.
export function effect<T>(
  fn: (prev?: T) => T,
  effectFn: (value: T, prev?: T) => void | (() => void),
  options?: { scope?: boolean; name?: string }
): void {
  if (
    IS_OBSERVE &&
    spreadName !== undefined &&
    (options === undefined || options.name === undefined)
  )
    options = { ...options, name: spreadName + ".spread" };
  const nodeOptions = options
    ? { sync: true, ...options, transparent: !options.scope }
    : transparentOptions;
  if (IS_DEV) {
    // The compute half runs as the effect node's owner; capture it there and
    // surround the imperative half with it for tagElement.
    let node: { _devElement?: Node } | null = null;
    createRenderEffect(
      (prev?: T) => {
        node = getOwner() as typeof node;
        return fn(prev);
      },
      (value: T, prev?: T) => {
        const outer = bindingEffect;
        bindingEffect = node;
        try {
          // The callback's return (a cleanup) must pass through untouched.
          return effectFn(value, prev);
        } finally {
          bindingEffect = outer;
        }
      },
      nodeOptions
    );
    return;
  }
  createRenderEffect(fn, effectFn, nodeOptions);
}

// NOT transparent, despite the temptation (#3033): the compiler emits
// `_$memo` in two roles, and one is id-load-bearing. Besides pure condition
// memos (`() => !!cond`), the ssr generate wraps whole hole bodies in
// `_$memo` — the compute CREATES the branch's templates (`ssrHydrationKey()`
// mints inside it), so the memo's id slot is the retry-stable scope a
// deferred hole re-runs under. Making it transparent leaks the branch keys
// onto the parent's live counter and breaks async-hole parity (pinned by the
// async-cond-before-for harness scenario).
export function memo<T>(fn: () => T): () => T {
  return createMemo(() => fn(), syncOptions);
}

// === Interaction provenance (observe tier) ===
//
// Delegated events — every INP-relevant type: click, input, keydown,
// pointer*… — reach user code through the delegated dispatch in client.ts, and
// runtime-attached direct handlers (spreads, non-literal handler expressions)
// through addEvent (client/attributes.ts).
// Wrapping those two in the signals attribution engine's `withInteraction`
// stamps every root write a handler performs with the event that caused it
// (`click on button#next "Next →"`) — what turns a transition hold or a hot
// scope into a per-interaction number. Not covered: non-delegated events
// whose handler is a literal function (the compiler emits a bare
// `addEventListener` for those) and hand-written `ref`-based listeners.

/** `button#next "Next →"`, `input[name=q]`, `a "Docs"` — what the user hit. */
function describeEventTarget(target: any): string | undefined {
  if (!target || typeof target.tagName !== "string") return undefined;
  const tag = target.tagName.toLowerCase();
  let out = tag;
  if (target.id) out += `#${target.id}`;
  else if (typeof target.name === "string" && target.name) out += `[name=${target.name}]`;
  if (tag !== "input" && tag !== "textarea" && tag !== "select") {
    const text = (target.textContent || "").trim().replace(/\s+/g, " ");
    if (text) out += ` "${text.length > 30 ? text.slice(0, 29) + "…" : text}"`;
  }
  return out;
}

/**
 * The interaction's start on the `performance.now()` clock: the event's own
 * `timeStamp` — when the browser created it, before any queued task ran —
 * not the moment the handler was reached, so the wait the record measures
 * begins where the user's does. It is also the join key to the browser's
 * Event Timing entry for the same interaction (`PerformanceEventTiming
 * .startTime` equals it), which is how a consumer lines an interaction
 * record up with INP without a time-window guess. Guarded: an environment
 * that still stamps events with epoch milliseconds (jsdom, pre-2016
 * browsers) puts the value far past `performance.now()`, and a value from
 * the wrong clock is worse than none — the engine then defaults to now.
 */
function interactionStart(e: Event): number | undefined {
  const at = e.timeStamp;
  return typeof at === "number" && at >= 0 && at <= performance.now() ? at : undefined;
}

export function dispatchAsInteraction<T>(e: Event, fn: () => T): T {
  // Reached only from `"_SOLID_OBSERVE_"`-gated sites, where `OBSERVE` is the
  // live channel (the prod tier exports `undefined` and folds the sites out).
  return OBSERVE!.attribution.withInteraction(
    { type: e.type, target: describeEventTarget(e.target), at: interactionStart(e) },
    fn
  );
}
