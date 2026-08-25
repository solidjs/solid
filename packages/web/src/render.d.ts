/** Shared `effect` / `memo` wrappers used by client and server entries. */
export function effect<T>(
  fn: (prev?: T) => T,
  effectFn: (value: T, prev?: T) => void,
  options?: { scope?: boolean }
): void;
export function memo<T>(fn: () => T): () => T;
