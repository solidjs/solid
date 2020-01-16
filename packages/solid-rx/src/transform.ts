type Operator<T, U> = (seq: () => T) => () => U;

export function transform<T>(source: () => T): () => T;
export function transform<T, A>(source: () => T, fn1: Operator<T, A>): () => A;
export function transform<T, A, B>(
  source: () => T,
  fn1: Operator<T, A>,
  fn2: Operator<A, B>
): () => B;
export function transform<T, A, B, C>(
  source: () => T,
  fn1: Operator<T, A>,
  fn2: Operator<A, B>,
  fn3: Operator<B, C>
): () => C;
export function transform<T, A, B, C, D>(
  source: () => T,
  fn1: Operator<T, A>,
  fn2: Operator<A, B>,
  fn3: Operator<B, C>,
  fn4: Operator<C, D>
): () => D;
export function transform<T, A, B, C, D, E>(
  source: () => T,
  fn1: Operator<T, A>,
  fn2: Operator<A, B>,
  fn3: Operator<B, C>,
  fn4: Operator<C, D>,
  fn5: Operator<D, E>
): () => E;
export function transform<T, A, B, C, D, E, F>(
  source: () => T,
  fn1: Operator<T, A>,
  fn2: Operator<A, B>,
  fn3: Operator<B, C>,
  fn4: Operator<C, D>,
  fn5: Operator<D, E>,
  fn6: Operator<E, F>
): () => F;
export function transform<T, A, B, C, D, E, F, G>(
  source: () => T,
  fn1: Operator<T, A>,
  fn2: Operator<A, B>,
  fn3: Operator<B, C>,
  fn4: Operator<C, D>,
  fn5: Operator<D, E>,
  fn6: Operator<E, F>,
  fn7: Operator<F, G>
): () => G;
export function transform<T, A, B, C, D, E, F, G, H>(
  source: () => T,
  fn1: Operator<T, A>,
  fn2: Operator<A, B>,
  fn3: Operator<B, C>,
  fn4: Operator<C, D>,
  fn5: Operator<D, E>,
  fn6: Operator<E, F>,
  fn7: Operator<F, G>,
  fn8: Operator<G, H>
): () => H;
export function transform<T, A, B, C, D, E, F, G, H, I>(
  source: () => T,
  fn1: Operator<T, A>,
  fn2: Operator<A, B>,
  fn3: Operator<B, C>,
  fn4: Operator<C, D>,
  fn5: Operator<D, E>,
  fn6: Operator<E, F>,
  fn7: Operator<F, G>,
  fn8: Operator<G, H>,
  fn9: Operator<H, I>
): () => I;
export function transform<T, A, B, C, D, E, F, G, H, I>(
  source: () => T,
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
): () => any;
export function transform(source: () => any, ...fns: Array<Operator<any, any>>): () => any {
  if (!fns) return source;
  if (fns.length === 1) return fns[0](source);
  return fns.reduce((prev, fn) => fn(prev), source);
}
