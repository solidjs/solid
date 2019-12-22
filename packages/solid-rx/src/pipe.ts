type Operator<T, U> = (seq: () => T) => () => U;

export function pipe<T>(): Operator<T, T>;
export function pipe<T, A>(fn1: Operator<T, A>): Operator<T, A>;
export function pipe<T, A, B>(
  fn1: Operator<T, A>,
  fn2: Operator<A, B>
): Operator<T, B>;
export function pipe<T, A, B, C>(
  fn1: Operator<T, A>,
  fn2: Operator<A, B>,
  fn3: Operator<B, C>
): Operator<T, C>;
export function pipe<T, A, B, C, D>(
  fn1: Operator<T, A>,
  fn2: Operator<A, B>,
  fn3: Operator<B, C>,
  fn4: Operator<C, D>
): Operator<T, D>;
export function pipe<T, A, B, C, D, E>(
  fn1: Operator<T, A>,
  fn2: Operator<A, B>,
  fn3: Operator<B, C>,
  fn4: Operator<C, D>,
  fn5: Operator<D, E>
): Operator<T, E>;
export function pipe<T, A, B, C, D, E, F>(
  fn1: Operator<T, A>,
  fn2: Operator<A, B>,
  fn3: Operator<B, C>,
  fn4: Operator<C, D>,
  fn5: Operator<D, E>,
  fn6: Operator<E, F>
): Operator<T, F>;
export function pipe<T, A, B, C, D, E, F, G>(
  fn1: Operator<T, A>,
  fn2: Operator<A, B>,
  fn3: Operator<B, C>,
  fn4: Operator<C, D>,
  fn5: Operator<D, E>,
  fn6: Operator<E, F>,
  fn7: Operator<F, G>
): Operator<T, G>;
export function pipe<T, A, B, C, D, E, F, G, H>(
  fn1: Operator<T, A>,
  fn2: Operator<A, B>,
  fn3: Operator<B, C>,
  fn4: Operator<C, D>,
  fn5: Operator<D, E>,
  fn6: Operator<E, F>,
  fn7: Operator<F, G>,
  fn8: Operator<G, H>
): Operator<T, H>;
export function pipe<T, A, B, C, D, E, F, G, H, I>(
  fn1: Operator<T, A>,
  fn2: Operator<A, B>,
  fn3: Operator<B, C>,
  fn4: Operator<C, D>,
  fn5: Operator<D, E>,
  fn6: Operator<E, F>,
  fn7: Operator<F, G>,
  fn8: Operator<G, H>,
  fn9: Operator<H, I>
): Operator<T, I>;
export function pipe<T, A, B, C, D, E, F, G, H, I>(
  fn1: Operator<T, A>,
  fn2: Operator<A, B>,
  fn3: Operator<B, C>,
  fn4: Operator<C, D>,
  fn5: Operator<D, E>,
  fn6: Operator<E, F>,
  fn7: Operator<F, G>,
  fn8: Operator<G, H>,
  fn9: Operator<H, I>,
  ...fns: Operator<any, any>[]
): Operator<T, {}>;
export function pipe(...fns: Array<Operator<any, any>>): Operator<any, any> {
  if (!fns) return i => i;
  if (fns.length === 1) return fns[0];
  return input => fns.reduce((prev, fn) => fn(prev), input);
}