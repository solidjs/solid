import {
  actionStepDepth,
  activeTransition,
  currentTransition,
  enterActionStep,
  exitActionStep,
  flush,
  globalQueue,
  schedule,
  setOrigin,
  type Transition
} from "./scheduler.js";
import { isThenable } from "./async.js";
import { getOwner } from "./owner.js";
import { CONFIG_CHILDREN_FORBIDDEN } from "./constants.js";
import { emitDiagnostic } from "./dev.js";
import { attrHooks } from "./attribution-hooks.js";

const ACTION_CALLED_IN_OWNED_SCOPE_MESSAGE =
  "[ACTION_CALLED_IN_OWNED_SCOPE] Calling an action inside an owned scope (component, computation) is not allowed. " +
  "Call it from an event handler or another imperative scope.";

/** Invocation order across all actions — the provenance every slice of an
 * action runs under (scheduler `origin`): the flights and overrides its
 * ambient windows issue are stamped with it, so a later action's override
 * can tell this action's late answer from its own (#3331). */
let actionSeq = 0;

function restoreTransition<T>(seq: number, transition: Transition, fn: () => T): T {
  const prevOrigin = setOrigin(seq);
  globalQueue.initTransition(transition);
  const result = fn();
  // A nested action resuming synchronously (its body yielded a non-thenable)
  // runs this inside the OUTER action's slice: draining here would park the
  // shared transaction and detach the outer body's remaining writes (the
  // flush() rule, scheduler.ts). The outer step's own return drains.
  if (actionStepDepth === 0) flush();
  setOrigin(prevOrigin);
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
      const seq = ++actionSeq;
      // The first slice's window runs to the scheduled flush, which clears
      // the provenance with the window — no restore here.
      setOrigin(seq);
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
        // Attribution hooks bracket the synchronous slice of generator body
        // this step runs (up to the next yield): writes inside are the
        // action's. Both sites sit outside the try (attribution-hooks.ts).
        if (__OBSERVE__ && attrHooks !== null)
          attrHooks.actionStepStart(it, genFn.name || undefined);
        // The body is on the stack between these brackets: flush() is
        // refused inside (FLUSH_IN_ACTION, scheduler.ts).
        enterActionStep();
        try {
          r = err ? it.throw!(v) : it.next(v);
        } catch (e) {
          exitActionStep();
          if (__OBSERVE__ && attrHooks !== null) attrHooks.actionStepEnd(it);
          return done(undefined, e, true);
        }
        exitActionStep();
        if (__OBSERVE__ && attrHooks !== null) attrHooks.actionStepEnd(it);
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
                restoreTransition(seq, ctx, () => step(v));
              },
              e => {
                if (settled) return;
                settled = true;
                restoreTransition(seq, ctx, () => step(e, true));
              }
            );
        } catch (e) {
          if (settled) return;
          settled = true;
          return void restoreTransition(seq, ctx, () => step(e, true));
        }
        restoreTransition(seq, ctx, () => step(r.value));
      };

      step();
    });
  };
}
