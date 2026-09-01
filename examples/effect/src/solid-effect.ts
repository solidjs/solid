// The entire Solid 2.0 × Effect integration. A few exports, no wrapper types.
//
// Context propagation — the `R` channel: services are provided by a
// `ManagedRuntime` carried on Solid context. Effect's requirement channel
// maps 1:1 onto Solid's ownership tree: `runEffect` resolves the runtime at
// the reading computation, `effectAction` at component setup, and the
// runtime's `Layer` scope is disposed by `onCleanup` — so service lifetime
// *is* subtree lifetime. Providing a different runtime lower in the tree
// overrides services for that subtree only, which a global atom registry
// has to bolt on.
//
// Read path — `runEffect`: adapts an Effect to the AsyncIterable protocol,
// which any Solid 2.0 computation consumes natively. No Result wrapper, no
// hook layer: pending flows to `<Loading>` via NotReadyError, failure flows
// to `<Errored>`, and stale-while-revalidate comes from `latest`/`isPending`.
// The load-bearing alignment is cancellation: when a memo recomputes, Solid
// closes the superseded flight's iterator (`it.return()`), and our `return()`
// interrupts the fiber — so Effect's structured interruption (retries,
// timeouts, finalizers, the whole tree) composes with Solid's flight
// semantics without either side knowing about the other.
//
// Action path — `effectAction`: a Solid `action` whose suspension points are
// Effect programs. Effect values are iterable (that's how `Effect.gen`
// works), so `yield*` inside a plain generator delegates a `YieldWrap`ped
// Effect out to our driver loop with full inferred types. Each yielded
// Effect runs as its own interruptible fiber; writes between yields stay
// inside the action's transaction. Because every suspension is a `yield*`
// (Effect has no `await`), the "`await` escapes the transaction" hazard
// documented on `action` cannot be expressed — the discipline Effect
// enforces is exactly the discipline the transaction wants.

import { Cause, Effect, Exit, Fiber, Layer, ManagedRuntime } from "effect";
import { YieldWrap, yieldWrapGet } from "effect/Utils";
import { action, createContext, onCleanup, useContext } from "solid-js";

/** Solid context carrying the Effect runtime. Provide with
 * `<RuntimeContext value={createRuntime(layer)}>`. The explicit `null`
 * default matters: `useContext` throws on a provider-less read unless the
 * context has a default, and we want that read to mean "default runtime". */
export const RuntimeContext = createContext<ManagedRuntime.ManagedRuntime<any, never> | null>(null);

/** Build a `ManagedRuntime` from a Layer, scoped to the current owner: the
 * runtime (and every service's finalizer in the Layer) is disposed when the
 * providing subtree unmounts.
 *
 * Nested providers share the parent runtime's `MemoMap`, so layers common to
 * ancestor and descendant runtimes are built once and refcounted by Effect
 * itself — a service shared across subtrees is finalized when the last
 * runtime using it disposes (i.e. when the last subtree unmounts). */
export function createRuntime<R>(layer: Layer.Layer<R>): ManagedRuntime.ManagedRuntime<R, never> {
  const parent = useContext(RuntimeContext);
  const runtime = ManagedRuntime.make(layer, parent?.memoMap);
  onCleanup(() => void runtime.dispose());
  return runtime;
}

/** Resolve the forking strategy from Solid context (must be called under an
 * owner — a computation body or component setup). Falls back to the default
 * runtime, which is only sound when `R = never`. */
function resolveFork(): <A, E>(effect: Effect.Effect<A, E, any>) => Fiber.RuntimeFiber<A, E> {
  const runtime = useContext(RuntimeContext);
  return runtime ? effect => runtime.runFork(effect) : (Effect.runFork as any);
}

/** Run an Effect as a Solid-consumable async source. Interruptible: if the
 * consuming computation re-runs or disposes before the fiber settles, the
 * fiber is interrupted and its finalizers run. Services in `R` resolve from
 * the nearest `RuntimeContext` above the reading computation. */
export function runEffect<A, E, R = never>(effect: Effect.Effect<A, E, R>): AsyncIterable<A> {
  const fork = resolveFork(); // context resolves at the *reading* computation
  return {
    [Symbol.asyncIterator]() {
      const fiber = fork(effect);
      let yielded = false; // the single value was already delivered
      let closed = false; // return() was called (supersede / dispose)
      const DONE = { done: true, value: undefined } as const;
      return {
        async next(): Promise<IteratorResult<A>> {
          if (yielded || closed) return DONE;
          const exit = await Effect.runPromise(Fiber.await(fiber));
          if (closed) return DONE; // superseded while in flight
          if (Exit.isSuccess(exit)) {
            yielded = true;
            return { done: false, value: exit.value };
          }
          closed = true;
          if (Exit.isInterrupted(exit)) return DONE;
          throw Cause.squash(exit.cause);
        },
        // Solid calls this when the flight is superseded or the owner
        // disposes — the bridge from Solid's flight identity to Effect's
        // structured interruption.
        async return(): Promise<IteratorResult<A>> {
          if (!yielded && !closed) Effect.runFork(Fiber.interrupt(fiber));
          closed = true;
          return DONE;
        }
      };
    }
  };
}

/** Thrown into the saga generator when its in-flight step is interrupted
 * (cancel button, superseding invocation). Catch it to run compensation;
 * rethrow to reject the action and revert optimistic state. */
export class ActionInterruptedError extends Error {
  constructor() {
    super("Action interrupted");
    this.name = "ActionInterruptedError";
  }
}

type SagaStep = YieldWrap<Effect.Effect<any, any, any>>;

export interface EffectAction<Args extends unknown[], R> {
  (...args: Args): Promise<R>;
  /** Interrupt the in-flight step's fiber. The interruption surfaces inside
   * the generator as a thrown `ActionInterruptedError` at the `yield*`. */
  interrupt(): void;
}

/** A Solid action written as an Effect saga. Each `yield*`-ed Effect is one
 * transaction step running as an interruptible fiber; typed failures are
 * thrown back into the generator at the `yield*` (so `instanceof` narrows
 * `Data.TaggedError` classes), and interruption arrives as
 * `ActionInterruptedError`. A superseding invocation interrupts the previous
 * one's in-flight fiber before starting. Services in step `R` channels
 * resolve from the nearest `RuntimeContext` at creation (component setup). */
export function effectAction<Args extends unknown[], R>(
  genFn: (...args: Args) => Generator<SagaStep, R, never>
): EffectAction<Args, R> {
  const fork = resolveFork(); // context resolves where the action is created
  let inFlight: Fiber.RuntimeFiber<any, any> | null = null;

  const base = action(function* (...args: Args) {
    const it = genFn(...args);
    let step = it.next();
    while (!step.done) {
      const fiber = fork(yieldWrapGet(step.value));
      inFlight = fiber;
      const exit: Exit.Exit<any, any> = yield Effect.runPromise(Fiber.await(fiber));
      if (inFlight === fiber) inFlight = null;
      if (Exit.isSuccess(exit)) step = it.next(exit.value as never);
      else if (Exit.isInterrupted(exit)) step = it.throw(new ActionInterruptedError());
      else step = it.throw(Cause.squash(exit.cause));
    }
    return step.value;
  });

  const invoke = (...args: Args) => {
    invoke.interrupt(); // superseding call cancels the previous flight
    return base(...args);
  };
  invoke.interrupt = () => {
    const fiber = inFlight;
    inFlight = null;
    if (fiber) Effect.runFork(Fiber.interrupt(fiber));
  };
  return invoke;
}
