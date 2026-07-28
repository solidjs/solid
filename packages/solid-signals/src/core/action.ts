import {
  activeTransition,
  currentTransition,
  flush,
  globalQueue,
  schedule,
  type Transition
} from "./scheduler.js";
import { isThenable } from "./async.js";
import { getOwner } from "./owner.js";
import { CONFIG_CHILDREN_FORBIDDEN } from "./constants.js";
import { emitDiagnostic } from "./dev.js";

const ACTION_CALLED_IN_OWNED_SCOPE_MESSAGE =
  "[ACTION_CALLED_IN_OWNED_SCOPE] Calling an action inside an owned scope (component, computation) is not allowed. " +
  "Call it from an event handler or another imperative scope.";

function restoreTransition<T>(transition: Transition, fn: () => T): T {
  globalQueue.initTransition(transition);
  const result = fn();
  flush();
  return result;
}

/**
 * The primitive for mutations: imperative async workflows whose *writes span
 * an async gap* — optimistic write, server round-trip, reconciling write —
 * where intermediate state must not leak and failure must revert cleanly
 * (pair with `createOptimistic` / `createOptimisticStore`).
 *
 * Navigation-shaped updates do not need an action. A plain setter call is
 * enough: reads pull the async, and downstream async computeds hold their
 * previous values per-node until the new ones are ready (`isPending` /
 * `latest` expose the in-flight state). Reach for `action` only when writes
 * happen *after* async work, not merely upstream of it.
 *
 * Framework-level actions (router form actions, server actions) are
 * specializations of this primitive: they are actions in exactly this sense —
 * the same transactional semantics — with form binding, serialization, and
 * submission tracking layered on top. The shared name is deliberate.
 *
 * Wraps a generator function so each invocation runs as a single transaction
 * (a "transition") that batches every signal/store write between yields. The
 * surrounding UI sees one atomic update per yielded step; nothing is committed
 * until the action either completes or the next `yield` resolves.
 *
 * `yield` is the transaction-safe suspension point: the action waits for a
 * yielded promise and re-enters the transaction before running the code after
 * it. A plain `await` does NOT — the runtime has no hook into an async
 * generator's internal await continuations, so writes to fresh signals
 * between an `await` and the next `yield` escape the transaction and commit
 * immediately. `await` is still the ergonomic choice for typed results; just
 * put a bare `yield` before any writes that follow it:
 *
 * ```ts
 * const saved = await api.createTodo(text); // typed result
 * yield; // re-enter the transaction before writing
 * setTodos(t => { ... });
 * ```
 *
 * (For the same reason, don't call `flush()` inside an action body — it
 * drains the transaction mid-step.)
 *
 * Each call returns a `Promise` that resolves with the generator's return
 * value, or rejects if it throws. Pair with `createOptimistic` /
 * `createOptimisticStore` to apply tentative writes that auto-revert if the
 * action fails.
 *
 * @example
 * ```ts
 * const [todos, setTodos] = createOptimisticStore<Todo[]>([]);
 *
 * const addTodo = action(async function* (text: string) {
 *   const tempId = crypto.randomUUID();
 *   setTodos(t => { t.push({ id: tempId, text, pending: true }); }); // optimistic
 *   const saved = await api.createTodo(text); // network round-trip, typed
 *   yield; // re-enter the transaction
 *   setTodos(t => {
 *     const i = t.findIndex(x => x.id === tempId);
 *     if (i >= 0) t[i] = saved;
 *   });
 *   return saved;
 * });
 *
 * await addTodo("buy milk");
 * ```
 */
export function action<Args extends any[], Y, R>(
  genFn: (...args: Args) => Generator<Y, R, any> | AsyncGenerator<Y, R, any>
) {
  return (...args: Args): Promise<R> => {
    // Invoking an action starts a transaction — like a write, it is invalid
    // synchronously inside an owned scope. The write guard can't catch this
    // at the real hazard point: post-await writes run with no ambient owner,
    // and a computation tracking what its action writes livelocks (every
    // write retriggers the compute, which fires a fresh invocation whose
    // transition supersedes the last — the value never commits). Same scope
    // test as setSignal: leaf imperative scopes (tracked effects, onSettled)
    // stay legal.
    if (__DEV__) {
      const owner = getOwner();
      if (owner && !(owner._config & CONFIG_CHILDREN_FORBIDDEN)) {
        emitDiagnostic({
          code: "ACTION_CALLED_IN_OWNED_SCOPE",
          kind: "write",
          severity: "error",
          message: ACTION_CALLED_IN_OWNED_SCOPE_MESSAGE,
          ownerId: owner.id,
          ownerName: (owner as any)._name
        });
        throw new Error(ACTION_CALLED_IN_OWNED_SCOPE_MESSAGE);
      }
    }
    return new Promise((resolve, reject) => {
      const it = genFn(...args);
      globalQueue.initTransition();
      let ctx = activeTransition!;
      ctx._actions.push(it);

      const done = (v?: R, e?: any, failed = false) => {
        ctx = currentTransition(ctx);
        const i = ctx._actions.indexOf(it);
        if (i >= 0) ctx._actions.splice(i, 1);
        // Re-adopt through initTransition like every other resumption site:
        // a bare setActiveTransition leaves globalQueue._batch as a detached
        // ambient batch, and anything registered before the scheduled flush
        // (held writes on a merging transition, optimistic overrides,
        // affects() marks) lands there with nothing to ever finalize it.
        globalQueue.initTransition(ctx);
        schedule();
        failed ? reject(e) : resolve(v!);
      };

      const step = (v?: any, err?: boolean): void => {
        let r: IteratorResult<Y, R> | Promise<IteratorResult<Y, R>>;
        try {
          r = err ? it.throw!(v) : it.next(v);
        } catch (e) {
          return done(undefined, e, true);
        }
        // A rejected iterator result (async generators) means the error already
        // escaped the generator body — it is completed, and throwing back in
        // would just reject again forever. Settle instead.
        if (isThenable(r)) return void r.then(run, e => done(undefined, e, true));
        run(r);
      };

      const run = (r: IteratorResult<Y, R>) => {
        if (r.done) return done(r.value);
        // Thenable assimilation can itself throw synchronously (a `then`
        // getter, or a `then()` method that throws — #2918). Match `await`
        // semantics: the failure is thrown back into the generator at the
        // yield point (catchable there); if uncaught, step()'s guard settles
        // the action so its iterator never leaks in the transition. The
        // settled flag implements A+ 2.3.3.3.4.1: a throw after the thenable
        // already called a callback is ignored.
        let settled = false;
        try {
          if (isThenable(r.value))
            return void r.value.then(
              v => {
                if (settled) return;
                settled = true;
                restoreTransition(ctx, () => step(v));
              },
              e => {
                if (settled) return;
                settled = true;
                restoreTransition(ctx, () => step(e, true));
              }
            );
        } catch (e) {
          if (settled) return;
          settled = true;
          return void restoreTransition(ctx, () => step(e, true));
        }
        restoreTransition(ctx, () => step(r.value));
      };

      step();
    });
  };
}
