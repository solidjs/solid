import type { Element as SolidElement } from "../types.js";
import type { Component, ComponentProps } from "./component.js";
import { IS_DEV, IS_OBSERVE, recordFinding } from "./diagnostics.js";
import { sharedConfig } from "./shared.js";
import { NotReadyError, createMemo, untrack } from "./signals.js";

/**
 * Options for `dynamicComponent`. Same members as the client type; `solid-js`
 * publishes the client declaration.
 */
export interface DynamicOptions {
  /**
   * SSR only: hold the document's first flush until the source settles, so
   * the resolved component renders into the shell instead of streaming in
   * behind its boundary's fallback. Same meaning as `createMemo`'s
   * `deferStream`. Default `false`.
   */
  deferStream?: boolean;
  /**
   * The source cannot change: call it once, untracked, now, and render the
   * result with no computation per instance. The source must resolve
   * synchronously.
   */
  static?: boolean;
}

// The box a factory memo holds a thenable source answer in, so the factory
// itself stays sync-valued and the per-instance memo is the one that goes
// async (and serializes). Module-local.
const FLIGHT = /*#__PURE__*/ Symbol("solid.dynamic-flight");

/**
 * A server component's brand (`frameTransformDirectResult` stamps it; the
 * frames codec plugin serializes a branded function as a flight reference).
 * `Symbol.for`, so this entry can recognize one without importing the frames
 * transport.
 */
const SERVER_COMPONENT = /*#__PURE__*/ Symbol.for("solid.server-component");

type TagArm = (tag: string, props: any) => any;

/**
 * Server twin of the client core. The tag arm is the only SSR-specific part
 * (`dynamic` passes `ssrElement`; `dynamicComponent` passes nothing).
 *
 * @internal
 */
export function dynamicCore(
  source: () => any,
  options?: DynamicOptions,
  tagArm?: TagArm
): Component<any> {
  // Static: the same owner-free path as the client — a tag is one
  // ssrElement(), a component one call — so both sides allocate the same
  // hydration keys. No memo on either level, so nothing to serialize or hold.
  if (options?.static) {
    const component: any = untrack(source);
    if (IS_DEV && component && typeof component.then === "function")
      throw new Error("dynamic(): a static source must resolve synchronously, not to a promise");
    if (typeof component === "function") return props => (component as Function)(props);
    if (typeof component === "string" && tagArm) return props => tagArm(component, props);
    return () => undefined as unknown as SolidElement;
  }
  // Mirrors the client exactly — three memos, the same owner shape on both
  // sides so hydration ids agree:
  //
  // 1. The FACTORY memo runs the source once for every mount. It is sync-
  //    valued by construction: a thenable the source returns is boxed
  //    (`FLIGHT`), never processed here, so the factory never suspends and
  //    never serializes — it is routinely hoisted (no owner, no id) and a
  //    shared value is nobody's record. A NotReady the source itself throws
  //    (a pending dependency read synchronously) propagates as usual: that is
  //    dependency async, not source async, and the dependency's own record
  //    carries the client past it.
  // 2. The per-instance VALUE memo unboxes. When the source introduced async
  //    (returned a thenable) this memo returns it, and becomes an ORDINARY
  //    async memo: it suspends the read while pending — the nearest boundary
  //    owns the wait and streams — and the async-memo machinery serializes
  //    its landing under the instance's id, exactly as it does for every
  //    other async memo (#3666). The client memo at the same id adopts that
  //    record during hydration instead of waiting on its own re-run of the
  //    source, so a hydrating <Loading> never sees a pending beat that would
  //    commit it to a fallback the server never rendered. What lands is
  //    what crosses: a server component as a flight reference (the frames
  //    codec plugin; the client re-derives the binding from it), a tag as
  //    the string; a client component FUNCTION cannot cross and is a
  //    misuse — see `classifyLanding`. A sync source lands nothing: the
  //    machinery writes a record only for an async compute, and the client
  //    re-runs the source synchronously, as before.
  // 3. The per-instance RENDER memo applies props (`sync`: re-read per
  //    commit epoch in frame renders).
  //
  // By default the pending read is NOT a renderer-blocking promise: a source
  // is data of unknown cost (a server component call, say), and gating the
  // shell on it means the boundary never shows its fallback and a slow source
  // stalls the whole document. With no boundary to defer to the read becomes a
  // root hole and resolveRootHoles blocks the shell on it anyway. Unlike
  // lazy(), whose module load always holds the shell (code is a prerequisite
  // to knowing what the segment contains), dynamic() leaves that call to the
  // author: `deferStream` holds the shell on the source's settle, with the
  // same meaning it has on createMemo — for a thenable the source returns it
  // IS createMemo's option on the value memo; for a pending dependency the
  // source reads, the value memo blocks the shell on that read itself (see
  // the catch below). Applied at the INSTANCE, not on the factory: dynamic()
  // is routinely hoisted, so the factory runs with no render context, and
  // only the mount knows which document to hold.
  const cached = createMemo(() => {
    const next: any = source();
    if (!next || typeof next.then !== "function") return next;
    return { [FLIGHT]: next };
  });
  const deferStream = !!options?.deferStream;
  return props => {
    const ctx = sharedConfig.context;
    let gated = !deferStream || !ctx?.async;
    const value = createMemo(
      () => {
        let c: any;
        try {
          c = cached();
        } catch (err) {
          // `deferStream` for the source's OTHER way of being async: a
          // dependency it reads synchronously is pending (a NotReady the
          // source threw, no thenable to hand the memo). Hold the shell on it
          // once per instance — a no-op after the shell has flushed, like
          // every blocker; a rejection is the memo's to surface on the retry,
          // the block only needs to clear.
          //
          // Never on a client hole (a bare `ssrSource: "client"` read in the
          // source, #3659): FINAL — the server can never fill it, so a block
          // on it would hold the shell forever. Rethrow untouched: the
          // enclosing <Loading> discovery pass reads the tag and hands the
          // position to the client (the same rule `serverEffect` applies).
          if (err instanceof NotReadyError && !gated && !(err.source as any)?.$clientHole) {
            gated = true;
            ctx!.block(
              Promise.resolve(err.source).then(
                () => {},
                () => {}
              )
            );
          }
          throw err;
        }
        if (!c || !c[FLIGHT]) return c;
        const next: PromiseLike<any> = c[FLIGHT];
        // Transparent: the landing is classified inside the source promise's
        // own handlers, no extra microtask hop. A rejection the classifier
        // raises goes through `onRejected` — a throw inside the handler would
        // reject a promise nobody observes. Either handler may be absent
        // (`.then(undefined, noop)` is how a flight gets observed).
        return {
          then: (onFulfilled?: (v: any) => any, onRejected?: (e: any) => any) =>
            next.then((resolved: any) => {
              let landed: any;
              try {
                landed = classifyLanding(resolved);
              } catch (err) {
                if (onRejected) return onRejected(err);
                throw err;
              }
              return onFulfilled ? onFulfilled(landed) : landed;
            }, onRejected)
        };
      },
      { deferStream } as any
    );
    return createMemo(
      () => {
        const c: unknown = value();
        if (c) {
          if (typeof c === "function") return (c as Function)(props);
          // No tag arm (`dynamicComponent`): a string renders nothing, as it
          // does on the client. `dynamic` passes an arm.
          if (typeof c === "string" && tagArm) return tagArm(c, props);
        }
      },
      { sync: true } as any
    ) as unknown as SolidElement;
  };
}

/**
 * What an async source landed, as the value memo's record will carry it —
 * or the one thing it cannot carry.
 *
 * A server component crosses as a reference (the document already holds its
 * markup; the client mounts the reference and adopts the frame by id), a tag
 * crosses as its string, and `undefined`/`null`/`false` cross as themselves.
 * A client component FUNCTION cannot: the client would have to re-run the
 * source and wait on it mid-hydration, which is exactly the pending beat the
 * record exists to remove (#3666) — and the serializer has no encoding for a
 * function anyway. That shape is a misuse with two correct spellings, so it
 * is an error here, at the point the memo would serialize it, in every tier:
 * dev with the guidance, prod with the code (the alternative — a record the
 * serializer cannot write — would leave the client waiting on it forever).
 */
function classifyLanding(resolved: any) {
  if (typeof resolved !== "function" || SERVER_COMPONENT in resolved) return resolved;
  const message = IS_DEV
    ? "[DYNAMIC_ASYNC_COMPONENT] An async dynamic() source resolved to a client component " +
      "function, which cannot be serialized for hydration: the client would re-run the source " +
      "and wait on it while hydrating, committing the enclosing <Loading> to a fallback the " +
      "server never rendered. Resolve the async upstream — a createAsync()/createMemo() the " +
      "source reads synchronously (`dynamic(() => page() ? Editor : Viewer)`) — or use lazy() " +
      "for a code-split component. A source may stay async when it resolves to a server " +
      "component or a serializable value (a tag name)."
    : "[DYNAMIC_ASYNC_COMPONENT] An async dynamic() source resolved to a client component function";
  // Landed in a promise continuation — no owner is current, so the finding
  // carries no location; the thrown error is the console face.
  if (IS_OBSERVE)
    recordFinding(
      {
        code: "DYNAMIC_ASYNC_COMPONENT",
        kind: "ssr",
        severity: "error",
        message,
        data: { component: (resolved as Function).name || undefined }
      },
      null
    );
  throw new Error(message);
}

/**
 * The server twin of `dynamicComponent`. Same owner shape as `dynamic` on
 * both sides (factory / value / render memos), so hydration ids agree
 * whichever of the two mounts the same value. One signature with the client
 * (including `AsyncIterable`); `solid-js` ships a single types file.
 */
export const dynamicComponent = dynamicCore as {
  <C extends Component<any>>(
    source: () => C | Promise<C> | AsyncIterable<C> | null | undefined | false,
    options?: DynamicOptions
  ): Component<ComponentProps<C>>;
};
