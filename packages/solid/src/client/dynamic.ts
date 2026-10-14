import { onCleanup, untrack, type Setter } from "@solidjs/signals";
import type { Element as SolidElement } from "../types.js";
import type { Component, ComponentProps } from "./component.js";
import { $DEVCOMP, IS_DEV } from "./core.js";
import { createMemo, createSignal, sharedConfig } from "./hydration.js";

/**
 * Options for `dynamicComponent` (and for `@solidjs/web`'s `dynamic`, which
 * passes them through to the same core).
 */
export interface DynamicOptions {
  /**
   * SSR only: hold the document's first flush until the source settles, so
   * the resolved component renders into the shell instead of streaming in
   * behind its boundary's fallback. Same meaning as `createMemo`'s
   * `deferStream`. Default `false` — a source is data of unknown cost and
   * streams by default. Ignored on the client.
   */
  deferStream?: boolean;
  /**
   * The source cannot change: call it once, untracked, now, and render the
   * result with no computation per instance. The source must resolve
   * synchronously.
   */
  static?: boolean;
}

// The server-component transport's binding contract (`Symbol.for`, so no
// import ties this entry to the frames transport): a value the transport
// resolved carries `{ component, address }` — `component` is the MOUNT
// identity, one per server function; `address` names the call's content
// store. Same component across resolutions means "same instance, new
// binding". See frames/src/frame-transport.ts (COMPONENT_BINDING).
const COMPONENT_BINDING = /*#__PURE__*/ Symbol.for("solid.component-binding");
// The box a factory memo holds a thenable source answer in, so the factory
// stays sync-valued and the per-instance memo is the one that goes async
// (and, under hydration, adopts the server's record). Module-local.
const FLIGHT = /*#__PURE__*/ Symbol("solid.dynamic-flight");

function bindingOf(value: any): { component: Function; address: string } | undefined {
  // Nullish has no properties; every other value boxes. A missing brand is
  // undefined, and a falsy brand is not a binding.
  return value?.[COMPONENT_BINDING] || undefined;
}

/**
 * How a tag name a source resolved to becomes an element. Renderers pass
 * one (`dynamic` passes `staticElement` / `ssrElement`); `dynamicComponent`
 * passes nothing, and a string then renders nothing. The core never names
 * the element runtime, so a bundle that only uses `dynamicComponent` drops
 * it.
 */
type TagArm = (tag: string, props: any) => any;

/**
 * Shared implementation behind `dynamicComponent` and a renderer's `dynamic`.
 * The tag arm is the only DOM/SSR-specific part. Not application API —
 * `@internal`, read back through `solid-js/internal`.
 *
 * @internal
 */
export function dynamicCore(
  source: () => any,
  options?: DynamicOptions,
  tagArm?: TagArm
): Component<any> {
  if (options?.static) return staticDynamic(untrack(source), tagArm);
  // `prev` threads into the resolution so a source switching server-component
  // calls of the same function DELIVERS instead of swapping: the memo keeps
  // its previous value (the mount below never re-renders) and the new call's
  // address flows into the live accessor the instance mounted with — the
  // instance re-binds its frame's pull to the new address's store (warm
  // store re-materializes instantly; an in-flight stream morphs in; keyed
  // slot state survives). Everything else resolves to `next` and swaps.
  // Async resolutions run the delivery in the promise chain — an ownerless
  // microtask, exactly where frame writes already happen — and not in the
  // equals gate: a kept resolution hands the memo `prev`, so the gate never
  // sees the new address at all.
  // Live delivery channels, one per mounted site: this component may be
  // mounted more than once (each mount is its own instance with its own
  // address accessor), and a kept resolution must reach every one.
  const sites = new Set<Setter<string>>();
  // The latest resolution's address, tracked at THIS level because a kept
  // resolution returns `prev` — a binding whose `.address` is frozen at the
  // first resolution — and `sites` only reaches mounts that exist right now.
  // A site mounting AFTER a delivery (unmount → remount over the same
  // dynamic, the turnkey away/back cycle) must initialize from the latest
  // delivered address, not the kept binding's original one: initializing
  // stale binds the fresh mount to the first call's resident store (the SSR
  // payload) while the refetched response warms a store nothing reads.
  let deliveredAddress: string | undefined;
  const resolveBinding = (next: any, prev: any) => {
    const binding = bindingOf(next);
    if (!binding) return next;
    deliveredAddress = binding.address;
    const prevBinding = bindingOf(prev);
    if (prevBinding && prevBinding.component === binding.component) {
      for (const deliver of sites) deliver(binding.address);
      return prev;
    }
    return next;
  };
  // The same rule at the memo's gate, for values the compute never sees: an
  // async iterable's yields land straight from the pump (a `live` server
  // component's loop re-yields its binding per connection, and the first
  // connection after hydration resolves the per-address binding where the
  // document adopted the per-function placeholder — two objects, one
  // component, one address). Same component is the same instance: equal,
  // with the incoming address delivered when it is not the one showing.
  // The comparator is `(prev, next)` on every commit path: `prev` is what
  // the memo HOLDS — the first resolution, kept ever since, whose address
  // the deliveries have long moved past — so only `next` says anything
  // about where the instance should be. (Reading "the address that is not
  // the delivered one" as incoming swung a reconnect's re-yield back to
  // the document's call after the source had switched arguments.) With
  // nothing delivered (no site mounted) a differing address is a plain
  // change — nothing is kept, so nothing is lost by swapping.
  const sameInstance = (prev: any, next: any) => {
    if (prev === next) return true;
    const held = bindingOf(prev);
    const incoming = bindingOf(next);
    if (!held || !incoming || held.component !== incoming.component) return false;
    if (held.address === incoming.address) return true;
    if (deliveredAddress === undefined) return false;
    if (incoming.address !== deliveredAddress) {
      deliveredAddress = incoming.address;
      for (const deliver of sites) deliver(incoming.address);
    }
    return true;
  };
  // Three memos, the same owner shape as the server's `dynamic` so hydration
  // ids agree (the server core has the full account):
  //
  // 1. The FACTORY memo runs the source once for every mount and is sync-
  //    valued by construction: a thenable the source returns is boxed
  //    (`FLIGHT`), so the factory never goes pending on it. It stays the
  //    consumer of an async ITERABLE answer (a `live` server component's
  //    loop): the yields land at its gate, `sameInstance` keeps a reconnect's
  //    re-yield quiet, and under hydration the frames intercept's local
  //    answer (LIVE_LOCAL) and the takeover arming both belong to this node,
  //    exactly as before — the record below never sits on it.
  // 2. The per-instance VALUE memo unboxes, and for a thenable becomes the
  //    ORDINARY async memo the boundary waits on. Under hydration it is the
  //    node the server's record is keyed to (the server's value memo at the
  //    same id serialized the landing): it ADOPTS the record — a server
  //    component's flight reference resolves to its binding, a tag to its
  //    string — and never waits on the client's own re-run of the source, so
  //    a hydrating <Loading> sees no pending beat (#3666). The trace run
  //    still reads the factory, which is how the instance follows a later
  //    source change; the token pins a delivery to this instance's LATEST
  //    computation (a superseded source's late resolution must not re-bind
  //    the mount to stale content). The thenable is transparent — it
  //    transforms the value inside the SAME microtask as the source
  //    promise's own handlers.
  // 3. The per-instance RENDER memo applies props.
  const cached = createMemo<any>(
    (prev: any) => {
      const next = source() as any;
      if (!next || typeof next.then !== "function") return resolveBinding(next, prev);
      return { [FLIGHT]: next };
    },
    { lazy: true, equals: sameInstance }
  );
  return props => {
    // Hydration adopts the value memo's record, and its trace run — the one
    // read that subscribes it to the factory — happens under the tracer's
    // mocked globals (fetch, Promise), where the factory's FIRST compute must
    // not run: the source's answer is consumed for real later (the factory is
    // lazy, and a `Promise.resolve()` minted under the mock never settles).
    // Warm the factory here, in the owner's own tick, so the trace finds it
    // computed. A NotReady (an iterable still pending its first yield, a
    // dependency) is the value memo's to see on its own read.
    if (sharedConfig.hydrating) {
      try {
        untrack(cached);
      } catch {
        // The value memo observes the NotReady on its own read.
      }
    }
    let latest = 0;
    const value = createMemo<Function | string | undefined>(
      (prev: any) => {
        const c = cached();
        if (!c || !c[FLIGHT]) return resolveBinding(c, prev);
        const next: PromiseLike<any> = c[FLIGHT];
        const token = ++latest;
        // `onFulfilled` may be absent: the hydration tracer observes a
        // compute's thenable with `.then(undefined, noop)`.
        return {
          then: (onFulfilled: any, onRejected: any) =>
            next.then((resolved: any) => {
              const landed = token === latest ? resolveBinding(resolved, prev) : resolved;
              return onFulfilled ? onFulfilled(landed) : landed;
            }, onRejected)
        };
      },
      { equals: sameInstance }
    );
    return createMemo(() => {
      const component = value();
      switch (typeof component) {
        case "function": {
          if (IS_DEV) Object.assign(component, { [$DEVCOMP]: true });
          const binding = bindingOf(component);
          if (binding) {
            // Mount the per-function component with a LIVE address accessor
            // (the transport's second-argument convention); kept resolutions
            // above deliver into it, and the instance follows — no re-render
            // at this seam. Initialize from the LATEST resolved address: the
            // kept binding's own `.address` is the first resolution's and
            // goes stale the moment a later call is kept-delivered.
            // `ownedWrite`: a delivery is a write from wherever the
            // resolution lands — a promise microtask for an async source,
            // but INSIDE the factory's compute when the source is a memo that
            // already settled the call (the multi-flight `refresh(todos)`
            // shape, and the hydrated document's first refetch), and inside
            // the equals gate for a pump's yield. None of those read the
            // address back, so the owned-scope write guard has nothing to
            // protect here.
            const [address, setAddress] = createSignal((deliveredAddress ??= binding.address), {
              ownedWrite: true
            });
            sites.add(setAddress);
            onCleanup(() => sites.delete(setAddress));
            return untrack(() => (binding.component as any)(props, address));
          }
          return untrack(() => (component as Function)(props));
        }

        case "string":
          // No tag arm (`dynamicComponent`): a string renders nothing, like
          // any other non-component value. `dynamic` passes an arm.
          return tagArm ? tagArm(component, props) : undefined;

        default:
          break;
      }
    }) as unknown as SolidElement;
  };
}

// `{ static: true }`: the resolved value once, no factory memo, no
// per-instance memo — the instance IS the element or the component call,
// owner-free like compiled JSX, so the server's static path (the same rule)
// produces the same hydration keys.
function staticDynamic(component: any, tagArm?: TagArm): Component<any> {
  if (IS_DEV && component && typeof component.then === "function")
    throw new Error("dynamic(): a static source must resolve synchronously, not to a promise");
  if (typeof component === "function") {
    if (IS_DEV) Object.assign(component, { [$DEVCOMP]: true });
    const binding = bindingOf(component);
    if (binding) {
      // A server-function component: its address is fixed too (the source is
      // never re-resolved), so the live accessor is a constant.
      const address = () => binding.address;
      return props => untrack(() => (binding.component as any)(props, address));
    }
    return props => untrack(() => component(props));
  }
  if (typeof component === "string" && tagArm) return props => tagArm(component, props);
  return () => undefined as unknown as SolidElement;
}

/**
 * `dynamic` for a source that only ever answers with a component — never a
 * tag name. A reactive, optionally async source; a stable `Component` back;
 * `{ static: true }` and `{ deferStream: true }`. The source's type excludes
 * strings, so a tag name is a compile error here — use `@solidjs/web`'s
 * `dynamic` for one.
 *
 * Cost model, which is the reason this exists: `dynamic` must be able to
 * render a tag, so one `dynamic` anywhere on a page retains the element
 * runtime — `createElement`, `spread` and the prop-collection helpers, the
 * SVG/MathML tables — for everyone, whether or not any source ever answers
 * with a string (a bundler cannot know what a source will resolve to).
 * `dynamicComponent` has no tag arm and never references that runtime, so a
 * page whose only dynamic mounts are components pays nothing for it.
 *
 * This is the documented way to mount a server component: a server
 * function's answer is a component reference, and the frames transport
 * resolves every call for the same function to the same mount identity, so
 * a refetch or an argument change is delivered into the mounted instance
 * rather than remounting it.
 *
 * @example
 * ```tsx
 * const Story = dynamicComponent(() => getStory(props.storyId));
 * return <Story comment={p => <Comment cid={p.cid}>{p.children}</Comment>} />;
 *
 * // A client component chosen by (sync) data — the same thing `dynamic`
 * // does, without retaining the element runtime for the page.
 * const Page = dynamicComponent(() => (page().editable ? Editor : Viewer));
 * ```
 */
export const dynamicComponent = dynamicCore as {
  <C extends Component<any>>(
    source: () => C | Promise<C> | AsyncIterable<C> | null | undefined | false,
    options?: DynamicOptions
  ): Component<ComponentProps<C>>;
};
