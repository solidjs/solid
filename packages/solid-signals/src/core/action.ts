import {
  activeTransition,
  currentTransition,
  flush,
  globalQueue,
  schedule,
  setActiveTransition,
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
 * Wraps a generator function so each invocation runs as a single transaction
 * (a "transition") that batches every signal/store write between yields. The
 * surrounding UI sees one atomic update per yielded step; nothing is committed
 * until the action either completes or the next `yield` resolves.
 *
 * Yield promises (or any awaitable) inside the generator — the action waits
 * for each before continuing, but the writes you made beforehand are already
 * visible (or held by `<Loading>` if optimistic). Yield bare values for
 * synchronous batched steps.
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
 * const addTodo = action(function* (text: string) {
 *   const tempId = crypto.randomUUID();
 *   setTodos(t => { t.push({ id: tempId, text, pending: true }); }); // optimistic
 *   const saved = yield api.createTodo(text); // network round-trip
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
        setActiveTransition(ctx);
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
        if (isThenable(r.value))
          return void r.value.then(
            v => restoreTransition(ctx, () => step(v)),
            e => restoreTransition(ctx, () => step(e, true))
          );
        restoreTransition(ctx, () => step(r.value));
      };

      step();
    });
  };
}
