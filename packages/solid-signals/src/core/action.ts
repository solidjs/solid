import {
  activeTransition,
  currentTransition,
  flush,
  globalQueue,
  schedule,
  setActiveTransition,
  type Transition
} from "./scheduler.js";

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
  return (...args: Args): Promise<R> =>
    new Promise((resolve, reject) => {
      const it = genFn(...args);
      globalQueue.initTransition();
      let ctx = activeTransition!;
      ctx._actions.push(it);

      const done = (v?: R, e?: any) => {
        ctx = currentTransition(ctx);
        const i = ctx._actions.indexOf(it);
        if (i >= 0) ctx._actions.splice(i, 1);
        setActiveTransition(ctx);
        schedule();
        e ? reject(e) : resolve(v!);
      };

      const step = (v?: any, err?: boolean): void => {
        let r: IteratorResult<Y, R> | Promise<IteratorResult<Y, R>>;
        try {
          r = err ? it.throw!(v) : it.next(v);
        } catch (e) {
          return done(undefined, e);
        }
        if (r instanceof Promise)
          return void r.then(run, e => restoreTransition(ctx, () => step(e, true)));
        run(r);
      };

      const run = (r: IteratorResult<Y, R>) => {
        if (r.done) return done(r.value);
        if (r.value instanceof Promise)
          return void r.value.then(
            v => restoreTransition(ctx, () => step(v)),
            e => restoreTransition(ctx, () => step(e, true))
          );
        restoreTransition(ctx, () => step(r.value));
      };

      step();
    });
}
