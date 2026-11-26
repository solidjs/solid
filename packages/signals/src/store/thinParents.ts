/**
 * A store target's first parent and key, noted only
 * while attribution or signal identities need a path or a root (a thin
 * target keeps no parent link of its own). Its own module, so the frames
 * client's `storeName` (edges.ts) reads it without loading the store.
 */
export const thinParents = new WeakMap<object, [object, PropertyKey]>();
