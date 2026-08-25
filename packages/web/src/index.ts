import {
  getNextElement,
  insert,
  spread,
  SVGElements,
  MathMLElements,
  Namespaces,
  registerDelegatedContainer,
  unregisterDelegatedContainer,
  getDelegatedRoot
} from "./client.js";
import {
  createComponent,
  createMemo,
  createOwner,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
  untrack,
  omit,
  sharedConfig,
  $DEVCOMP,
  Component,
  createEffect,
  createRenderEffect,
  type Owner,
  type Setter
} from "solid-js";
import type { JSX } from "../jsx/jsx.js";

export * from "./client.js";
export * from "./server-mock.js";
export * from "./response.js";
export type { JSX } from "../jsx/jsx.js";
export {
  For,
  Show,
  Switch,
  Match,
  Errored,
  Loading,
  Repeat,
  Reveal,
  NoHydration,
  Hydration
} from "solid-js";

/**
 * Build-time constant indicating whether code is running on the server. This
 * client entry sets it to `false`; the matching server entry (`@solidjs/web`
 * resolved through the `solid` server export condition) sets it to `true`.
 *
 * Bundlers can dead-code-eliminate branches gated on `isServer`, so guarding
 * browser-only code with `if (!isServer) {…}` keeps it out of the SSR bundle
 * entirely.
 *
 * @example
 * ```ts
 * import { isServer } from "@solidjs/web";
 *
 * if (!isServer) {
 *   // Browser-only: tree-shaken out of the SSR bundle.
 *   window.addEventListener("resize", onResize);
 * }
 * ```
 */
export const isServer: boolean = false;

/**
 * Build-time constant indicating whether code is running in a dev build.
 * Replaced statically (`_SOLID_DEV_`) by the bundler integration, so guards
 * like `if (isDev) {…}` are stripped from production builds.
 *
 * Use this to gate dev-only diagnostics, warnings, or expensive invariants
 * that should never ship to production.
 *
 * @example
 * ```ts
 * import { isDev } from "@solidjs/web";
 *
 * if (isDev) {
 *   console.warn("debug-only path");
 * }
 * ```
 */
export const isDev: boolean = "_SOLID_DEV_" as unknown as boolean;

export type IntrinsicElement = Extract<keyof JSX.IntrinsicElements, string>;
export type ValidComponent = IntrinsicElement | Component<any> | (string & {});
export type ComponentProps<T extends ValidComponent> =
  T extends Component<infer P>
    ? P
    : T extends keyof JSX.IntrinsicElements
      ? JSX.IntrinsicElements[T]
      : Record<string, unknown>;

export type DynamicProps<T extends ValidComponent, P = ComponentProps<T>> = {
  [K in keyof P]: P[K];
} & {
  component: T | null | undefined | false;
};

/**
 * Renders its children into a different part of the DOM (modal roots,
 * tooltips, layers that need to escape an `overflow: hidden` ancestor).
 *
 * If `mount` is omitted, the portal attaches to `document.body`. The portal
 * still participates in the parent's reactive scope and disposes when the
 * parent does.
 *
 * Portals are client-only islands: the server renders nothing for them, and
 * under hydration the children render fresh once hydration settles. Async
 * read inside a portal therefore starts on the client — data that should be
 * fetched on the server belongs above the portal (hoist the read, not the
 * render), and async UI inside one wants its own `<Loading>` boundary.
 *
 * @example
 * ```tsx
 * <Portal mount={document.getElementById("modal-root")!}>
 *   <Dialog />
 * </Portal>
 * ```
 *
 * @description https://docs.solidjs.com/reference/components/portal
 */
export function Portal(props: { mount?: Element; children: JSX.Element }): JSX.Element {
  // Everything the portal allocates (content memo, effects, anchor memo)
  // lives under one dedicated id scope: the server Portal renders nothing,
  // so without this the client primitives would advance the parent's
  // child-id counter and shift every hydration id after the portal. Both
  // sides consume exactly one slot from the parent instead — the owner
  // here, `getNextChildId` in the server Portal.
  return runWithOwner(createOwner(), () => portalImpl(props)) as unknown as JSX.Element;
}

function portalImpl(props: { mount?: Element; children: JSX.Element }): JSX.Element {
  const treeMarker = document.createTextNode(""),
    startMarker = document.createTextNode(""),
    endMarker = document.createTextNode(""),
    mount = () => props.mount || document.body,
    // `ssrSource: "client"`: the server renders nothing for portals, so under
    // hydration the children must not evaluate during the hydration walk —
    // the gate defers the compute to the settle flush, where it runs as a
    // plain fresh render. Ancestor boundaries are `_initialized` by then, so
    // async discovered inside the portal forwards as ordinary pending status
    // instead of regressing anything to a fallback (#2876).
    // `loadingValue: undefined` is the declared commit #0: the server renders
    // nothing for portals, so "nothing" is exactly what the pre-compute
    // window shows (#2981).
    content = createMemo<JSX.Element>(
      () => [startMarker, props.children] as unknown as JSX.Element,
      {
        ssrSource: "client",
        loadingValue: undefined
      }
    );

  createRenderEffect<[Element, JSX.Element, Owner | null]>(
    // `getOwner()` is captured in the compute-half: the effect-half runs from
    // the queue with no ambient owner, so the insert effect must be parented
    // explicitly or it leaks (NO_OWNER_EFFECT, #2758).
    () => [mount(), content(), getOwner()],
    ([, c, owner]) => {
      const m = untrack(mount);
      m.appendChild(endMarker);
      // The insert effect lives in its own root scoped to this run: it is
      // disposed when the mount changes or the Portal is disposed — not
      // left attached to the component where previous mounts' effects
      // would accumulate. The owner parenting preserves context.
      const dispose = runWithOwner(owner, () =>
        createRoot(d => {
          insert(m, c, endMarker, undefined, { host: () => treeMarker.parentNode });
          return d;
        })
      );
      return () => {
        dispose!();
        // remove [startMarker, endMarker] inclusive — endMarker was appended
        // by this same effect run and must not survive the cleanup
        let c: Node | null = startMarker;
        while (c) {
          const n: Node | null = c.nextSibling;
          m.removeChild(c);
          if (c === endMarker) break;
          c = n;
        }
      };
    },
    // Also `ssrSource: "client"` (like `content` above) so the effect never
    // fires with empty content during the hydration window — the first run
    // happens post-settle with the real children, exactly like a fresh mount.
    { schedule: true, ssrSource: "client" }
  );

  createEffect(
    mount,
    () => {
      const m = untrack(mount);
      const ownerRoot = getDelegatedRoot(treeMarker);
      if (!ownerRoot || (ownerRoot as Node).contains(m)) return;
      registerDelegatedContainer(m, ownerRoot);
      return () => unregisterDelegatedContainer(m, ownerRoot);
    },
    { ssrSource: "client" }
  );

  // The anchor is client-only content too: during the hydration walk the
  // parent's insert only claims server nodes, so a bare `treeMarker` would be
  // silently dropped and break everything resolving through
  // `treeMarker.parentNode` (`_$host` retargeting, delegated containers).
  // Gate it like the rest. The memo isn't caching the (constant) marker —
  // it's the reactive carrier of the hydration gate: `ssrSource: "client"`
  // wraps the compute in a hidden gate signal, so the memo reads undefined
  // during the walk and flips to the marker in the settle flush, re-running
  // the parent's insert when fresh nodes may be placed again. A memo (not a
  // naked accessor) so the flip is equals-gated and resolved under this
  // owner, like any control-flow return.
  // `loadingValue: undefined` = declared commit #0 ("server rendered
  // nothing"), same as `content` above (#2981).
  if (sharedConfig.hydrating)
    return createMemo<Text | undefined>(() => treeMarker, {
      ssrSource: "client",
      loadingValue: undefined
    }) as unknown as JSX.Element;
  return treeMarker as unknown as JSX.Element;
}

/**
 * Returns a stable `Component` whose identity is driven by a reactive (and
 * optionally async) `source`. The returned component can be used anywhere a
 * normal component is used; children and props flow through JSX as usual.
 *
 * `source` may return a component, a native tag name (`'input'`, `'textarea'`,
 * etc.), `undefined`, or a `Promise` of any of the above. A pending promise
 * propagates as `NotReadyError` through the surrounding reactive scope, so
 * async swaps compose with `<Loading>` boundaries the same way as `lazy`.
 *
 * @example
 * ```tsx
 * // `source` can return either a custom Component or a native tag
 * // name — they're interchangeable, and the returned reference is a
 * // stable Component you can use anywhere a normal one would go.
 * const Field = dynamic(() => multiline() ? RichTextEditor : "input");
 * return <Field value={value()} onInput={onInput} />;
 * ```
 *
 * @description https://docs.solidjs.com/reference/components/dynamic
 */
// The server-component transport's binding contract (`Symbol.for`, so no
// import ties this entry to the frames transport): a value the transport
// resolved carries `{ component, address }` — `component` is the MOUNT
// identity, one per server function; `address` names the call's content
// store. Same component across resolutions means "same instance, new
// binding". See frames/src/frame-transport.ts (COMPONENT_BINDING).
const COMPONENT_BINDING = Symbol.for("solid.component-binding");
function bindingOf(value: any): { component: Function; address: string } | undefined {
  return (
    (value !== null &&
      (typeof value === "function" || typeof value === "object") &&
      value[COMPONENT_BINDING]) ||
    undefined
  );
}

export function dynamic<T extends ValidComponent>(
  source: () => T | Promise<T> | null | undefined | false
): Component<ComponentProps<T>> {
  // `prev` threads into the resolution so a source switching server-component
  // calls of the same function DELIVERS instead of swapping: the memo keeps
  // its previous value (the mount below never re-renders) and the new call's
  // address flows into the live accessor the instance mounted with — the
  // instance re-binds its frame's pull to the new address's store (warm
  // store re-materializes instantly; an in-flight stream morphs in; keyed
  // slot state survives). Everything else resolves to `next` and swaps.
  // Async resolutions run the delivery in the promise chain — an ownerless
  // microtask, exactly where frame writes already happen — rather than in the
  // equals gate, whose argument order differs between sync and async commits.
  // The token pins the delivery to the LATEST computation: a superseded
  // source's late resolution must not re-bind the mount to stale content (the
  // async machinery discards its value; the side effect has to be discarded
  // here), and a transition's forked re-compute of the same source delivers
  // once, not per fork. The thenable is transparent — it transforms the value
  // inside the SAME microtask as the source promise's own handlers (a `.then`
  // chain would add a hop, observably deferring every async resolution).
  let latest = 0;
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
  const cached = createMemo<Function | string | undefined>(
    (prev: any) => {
      const next = source() as any;
      if (!next || typeof next.then !== "function") return resolveBinding(next, prev);
      const token = ++latest;
      return {
        then: (onFulfilled: any, onRejected: any) =>
          next.then(
            (resolved: any) =>
              onFulfilled(token === latest ? resolveBinding(resolved, prev) : resolved),
            onRejected
          )
      };
    },
    { lazy: true }
  );
  return props => {
    return createMemo(() => {
      const component = cached();
      switch (typeof component) {
        case "function": {
          if (isDev) Object.assign(component, { [$DEVCOMP]: true });
          const binding = bindingOf(component);
          if (binding) {
            // Mount the per-function component with a LIVE address accessor
            // (the transport's second-argument convention); kept resolutions
            // above deliver into it, and the instance follows — no re-render
            // at this seam. Initialize from the LATEST resolved address: the
            // kept binding's own `.address` is the first resolution's and
            // goes stale the moment a later call is kept-delivered.
            const [address, setAddress] = createSignal(deliveredAddress ?? binding.address);
            sites.add(setAddress);
            onCleanup(() => sites.delete(setAddress));
            return untrack(() => (binding.component as any)(props, address));
          }
          return untrack(() => (component as Function)(props));
        }

        case "string":
          const el = sharedConfig.hydrating
            ? getNextElement()
            : createElement(
                component as string,
                untrack(() => (props as any).is)
              );
          spread(el, props);
          return el;

        default:
          break;
      }
    }) as unknown as JSX.Element;
  };
}

/**
 * Renders an arbitrary custom or native component and forwards the other
 * props. JSX form of `dynamic()` — same primitive, picked at the JSX site.
 *
 * @example
 * ```tsx
 * <Dynamic
 *   component={multiline() ? RichTextEditor : "input"}
 *   value={value()}
 *   onInput={onInput}
 * />
 * ```
 *
 * @description https://docs.solidjs.com/reference/components/dynamic
 */
export function Dynamic<T extends ValidComponent>(props: DynamicProps<T>): JSX.Element {
  const Comp = dynamic<T>(() => props.component as T | null | undefined | false);
  return createComponent(Comp, omit(props, "component") as ComponentProps<T>);
}

function createElement(tagName: string, is = undefined): HTMLElement | SVGElement | MathMLElement {
  return (
    SVGElements.has(tagName)
      ? document.createElementNS(Namespaces.svg, tagName)
      : MathMLElements.has(tagName)
        ? document.createElementNS(Namespaces.mathml, tagName)
        : document.createElement(tagName, { is })
  ) as HTMLElement | SVGElement | MathMLElement;
}

function loadClientOnly<T>(
  fn: () => Promise<any>,
  setComp: Setter<T | undefined>,
  exportName?: string
) {
  fn().then((m: any) => setComp(() => (exportName ? m[exportName] : m.default)));
}

/**
 * Wraps a dynamically imported component so it renders only in the browser.
 * The server renders `props.fallback` (and nothing else); the client shows
 * the fallback until the import resolves and the tree has mounted, then
 * swaps the real component in.
 *
 * Unlike `lazy()`, this avoids Suspense entirely and never server-renders
 * the wrapped component — only the fallback — so the component participates
 * in no hydration asset manifest and its code is guaranteed to never run on
 * the server (safe for browser-only libraries touching `window`, DOM
 * measurement, etc.). The mount gate keeps hydration safe: during hydration
 * the fallback is rendered exactly as the server did, and the swap happens
 * only after settle, so there is no mismatch.
 *
 * By default the import starts as soon as `clientOnly` is called (module
 * load); pass `{ lazy: true }` to defer the import to the component's first
 * render. Pass `{ export: "Name" }` to use a named export of the resolved
 * module instead of its default (mirrors `lazy()`'s option).
 *
 * @example
 * ```tsx
 * const Chart = clientOnly(() => import("./Chart.jsx"));
 * // <Chart fallback={<div>Loading chart…</div>} data={data()} />
 * ```
 */
export function clientOnly<M extends Record<string, any>, K extends keyof M & string>(
  fn: () => Promise<M>,
  options: { lazy?: boolean; export: K },
  moduleUrl?: string
): Component<ComponentProps<M[K]> & { fallback?: JSX.Element }>;
export function clientOnly<T extends Component<any>>(
  fn: () => Promise<{ default: T }>,
  options?: { lazy?: boolean; export?: string },
  moduleUrl?: string
): Component<ComponentProps<T> & { fallback?: JSX.Element }>;
export function clientOnly<T extends Component<any>>(
  fn: () => Promise<any>,
  options: { lazy?: boolean; export?: string } = {},
  // Injected by the bundler's module-URL pass; consumed only by the server
  // half (early modulepreload hints). The client ignores it — the import
  // thunk itself is the loader here.
  _moduleUrl?: string
): Component<ComponentProps<T> & { fallback?: JSX.Element }> {
  const [comp, setComp] = createSignal<T>();
  let started = !options.lazy;
  started && loadClientOnly(fn, setComp, options.export);
  return props => {
    let Comp: T | undefined;
    let m: boolean;
    const rest = omit(props, "fallback") as ComponentProps<T>;
    // The deferred import starts on the FIRST instance only — all instances
    // share the module signal, so a second invocation of the importer could
    // at best duplicate a request the browser dedupes anyway, and at worst
    // re-run a side-effectful importer.
    if (!started) {
      started = true;
      loadClientOnly(fn, setComp, options.export);
    }
    // Deliberately untracked fast path: an already-loaded module (fresh
    // render after the import settled) skips the gate machinery entirely.
    if ((Comp = untrack(comp)) && !sharedConfig.hydrating) return Comp(rest);
    // This hand-rolled gate is NOT replaceable with `ssrSource: "client"`
    // (the Portal pattern): that defers the compute past hydration, so the
    // fallback would first evaluate with hydration over and its compiled
    // templates would CREATE fresh DOM instead of claiming the
    // server-rendered fallback — observed as an orphaned server fallback
    // duplicated next to a fresh client copy. Portal can defer because its
    // server half renders nothing; clientOnly's renders the fallback, so the
    // fallback must render DURING the walk (mounted=false branch) to adopt
    // that DOM, and only the post-settle swap is deferred.
    const [mounted, setMounted] = createSignal(!sharedConfig.hydrating);
    // The gate memo must be the component's ONLY id-consuming child so the
    // fallback's elements derive the same hydration ids as under the server
    // half's mirror memo and get claimed instead of duplicated.
    const gate = createMemo(
      () => (
        (Comp = comp()),
        (m = mounted()),
        untrack(() => (Comp && m ? Comp(rest) : props.fallback))
      )
    ) as unknown as JSX.Element;
    // The swap trigger must NOT hold an owner: onSettled registers a tracked
    // effect, and every non-transparent owner consumes one of the component's
    // child ids — an id the server half (whose only owner is the mirror memo)
    // never mints. That shifted the hydration ids of every sibling AFTER a
    // hydrated clientOnly by one slot, so their template claims missed the
    // registry and insert tracked never-inserted phantom nodes: the sibling's
    // first post-hydration re-render then reconciled against the phantom and
    // inserted beside the orphaned server node instead of replacing it.
    // onHydrationEnd is the ownerless "all hydration complete" channel
    // (waits for pending streamed boundaries; microtask-fires if already
    // done) — exactly the gate's semantics, and it consumes nothing. It is
    // installed by enableHydration() only, so CSR bundles shake it; absent
    // means hydration is definitionally complete — fire on a bare microtask,
    // which is exactly what onHydrationEnd itself does in that state.
    const onHydrationEnd = sharedConfig.onHydrationEnd;
    const release = () => setMounted(true);
    onHydrationEnd ? onHydrationEnd(release) : queueMicrotask(release);
    return gate;
  };
}

/**
 * Declares the HTTP response status (and optional status text) for the
 * lifetime of the current reactive scope during SSR — call it bare in a
 * component or reactive-scope body where the status is decided (a 404
 * route, an error fallback). Client build: a no-op — the response head was
 * sent long ago.
 *
 * Naming note — this is a scope-tied *declaration*, not a mutation: "while
 * this reactive scope is live, the response has this status." Solid
 * reserves `set*` verbs for event-time mutation; like
 * `createSignal`/`onCleanup` this is called in scope bodies and un-declares
 * on scope disposal.
 *
 * Retraction semantics (server): the write snapshots the previous
 * `event.response` status at write time and restores it when the owning
 * scope is disposed — so a boundary that errored, declared a status, and
 * then recovered retracts its write instead of stomping a status a
 * surviving part of the tree legitimately set. Once the integration marks
 * the response head `committed` (head derived/sent), writes and
 * retractions are no-ops.
 */
export function httpStatus(_code: number, _text?: string): void {}

/**
 * Declares an HTTP response header (or with `append`, appends to one) for
 * the lifetime of the current reactive scope during SSR — call it bare in a
 * component or reactive-scope body. Client build: a no-op — the response
 * head was sent long ago.
 *
 * Naming note — this is a scope-tied *declaration*, not a mutation: "while
 * this reactive scope is live, the response has this header." Solid
 * reserves `set*` verbs for event-time mutation; like
 * `createSignal`/`onCleanup` this is called in scope bodies and un-declares
 * on scope disposal.
 *
 * Retraction semantics (server): the header's prior value is snapshotted at
 * write time and restored when the owning scope is disposed (deleted if
 * there was none) — a boundary that errors or recovers retracts its writes.
 * Once the integration marks the response head `committed` (head
 * derived/sent), writes and retractions are no-ops.
 */
export function httpHeader(_name: string, _value: string, _options?: { append?: boolean }): void {}
