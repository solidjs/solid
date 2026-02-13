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
